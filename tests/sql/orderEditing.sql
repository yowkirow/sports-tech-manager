DO $tests$
DECLARE
    ids uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid()];
    extra_id uuid := gen_random_uuid();
    legacy_id uuid := gen_random_uuid();
    fixture_key text := 'ATOMIC-TEST-' || gen_random_uuid()::text;
    changes jsonb;
    broken jsonb;
    before_rows jsonb;
    after_rows jsonb;
    saved_ids uuid[];
    original_role text := current_user;
    caught boolean;
BEGIN
    SELECT array_agg(value ORDER BY value) INTO ids FROM unnest(ids) AS fixture(value);
    INSERT INTO public.transactions (id, type, category, amount, date, description, details)
    SELECT value, 'sale', 'shirts', 350, '2026-09-01T10:00:00Z', 'Atomic edit regression fixture',
        jsonb_build_object('orderId', fixture_key, 'itemName', 'Fixture shirt', 'quantity', 1,
            'originalAmount', 350, 'fulfillmentStatus', 'pending', 'paymentStatus', 'unpaid')
    FROM unnest(ids) AS fixture(value);

    SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'expected', to_jsonb(t) - ARRAY['id', 'created_at'],
        'updates', jsonb_build_object('amount', 700, 'details', t.details || '{"quantity":2,"originalAmount":700}'::jsonb)
    ) ORDER BY t.id), jsonb_agg(to_jsonb(t) ORDER BY t.id)
    INTO changes, before_rows FROM public.transactions t WHERE t.id = ANY(ids);

    -- The first row is updated before this invalid second row raises; the entire RPC must roll back.
    broken := jsonb_set(changes, '{1,updates,amount}', '-1'::jsonb);
    caught := false;
    BEGIN
        PERFORM public.save_order_changes(broken, true);
    EXCEPTION WHEN invalid_parameter_value THEN
        caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'Expected the invalid second amount to fail'; END IF;
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) INTO after_rows FROM public.transactions t WHERE t.id = ANY(ids);
    IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'A failed order save changed earlier rows'; END IF;

    broken := jsonb_set(changes, '{1,expected,amount}', '999'::jsonb);
    caught := false;
    BEGIN
        PERFORM public.save_order_changes(broken, true);
    EXCEPTION WHEN serialization_failure THEN
        caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'Expected a stale second row to fail'; END IF;
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) INTO after_rows FROM public.transactions t WHERE t.id = ANY(ids);
    IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'A stale order save changed earlier rows'; END IF;

    caught := false;
    BEGIN
        PERFORM public.save_order_changes(jsonb_build_array(changes->0), true);
    EXCEPTION WHEN serialization_failure THEN caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'A subset of an order was accepted'; END IF;

    caught := false;
    BEGIN
        PERFORM public.save_order_changes(jsonb_build_array(changes->0, changes->0), true);
    EXCEPTION WHEN invalid_parameter_value THEN caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'Duplicate IDs were accepted'; END IF;

    broken := jsonb_set(changes, '{1,updates,details,orderId}', to_jsonb(fixture_key || '-different'));
    caught := false;
    BEGIN
        PERFORM public.save_order_changes(broken, true);
    EXCEPTION WHEN invalid_parameter_value THEN caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'An item was moved to a different order'; END IF;
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) INTO after_rows FROM public.transactions t WHERE t.id = ANY(ids);
    IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'Rejected order identity change modified earlier rows'; END IF;

    SELECT jsonb_agg(jsonb_set(jsonb_set(value, '{updates,details,removedFromOrder}', 'true'::jsonb),
        '{updates,amount}', '0'::jsonb)) INTO broken FROM jsonb_array_elements(changes);
    caught := false;
    BEGIN
        PERFORM public.save_order_changes(broken, true);
    EXCEPTION WHEN invalid_parameter_value THEN caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'Removing every item was accepted'; END IF;

    INSERT INTO public.transactions (id, type, category, amount, date, details)
    VALUES (extra_id, 'sale', 'shirts', 350, now(), jsonb_build_object('orderId', fixture_key));
    caught := false;
    BEGIN
        PERFORM public.save_order_changes(changes, true);
    EXCEPTION WHEN serialization_failure THEN caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'An additional order line was ignored'; END IF;
    DELETE FROM public.transactions WHERE id = extra_id;

    -- Customers use the invoker's existing permissions and cannot bypass the pending-order guard.
    EXECUTE 'SET LOCAL ROLE anon';
    SELECT array_agg(saved.id ORDER BY saved.id) INTO saved_ids FROM public.save_order_changes(changes, true) AS saved;
    EXECUTE format('SET LOCAL ROLE %I', original_role);
    IF saved_ids IS DISTINCT FROM ids THEN RAISE EXCEPTION 'Successful save did not return every real ID'; END IF;
    IF (SELECT sum(amount) FROM public.transactions WHERE id = ANY(ids)) <> 1400 THEN
        RAISE EXCEPTION 'Successful save did not update the complete order';
    END IF;
    IF (SELECT count(*) FROM public.transactions WHERE id = ANY(ids)) <> 2 THEN RAISE EXCEPTION 'Save recreated or removed source records'; END IF;

    UPDATE public.transactions SET details = details || '{"fulfillmentStatus":"shipped","status":"shipped"}'::jsonb WHERE id = ANY(ids);
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'expected', to_jsonb(t) - ARRAY['id', 'created_at'],
        'updates', jsonb_build_object('amount', 701, 'details', t.details)) ORDER BY t.id)
    INTO changes FROM public.transactions t WHERE t.id = ANY(ids);
    caught := false;
    BEGIN
        EXECUTE 'SET LOCAL ROLE anon';
        PERFORM public.save_order_changes(changes, false);
    EXCEPTION WHEN invalid_parameter_value THEN caught := true;
    END;
    EXECUTE format('SET LOCAL ROLE %I', original_role);
    IF NOT caught THEN RAISE EXCEPTION 'Anonymous request bypassed pending protection'; END IF;
    IF (SELECT sum(amount) FROM public.transactions WHERE id = ANY(ids)) <> 1400 THEN RAISE EXCEPTION 'Rejected shipped edit changed amounts'; END IF;

    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.save_order_changes(changes, false);
    EXECUTE format('SET LOCAL ROLE %I', original_role);
    IF (SELECT sum(amount) FROM public.transactions WHERE id = ANY(ids)) <> 1402 THEN RAISE EXCEPTION 'Management cannot edit a shipped order'; END IF;

    UPDATE public.transactions SET details = details || '{"fulfillmentStatus":"pending","status":"pending"}'::jsonb WHERE id = ANY(ids);
    UPDATE public.transactions SET amount = 701.001 WHERE id = ids[1];
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'expected', to_jsonb(t) - ARRAY['id', 'created_at'],
        'updates', jsonb_build_object('amount', t.amount, 'details', t.details)) ORDER BY t.id)
    INTO changes FROM public.transactions t WHERE t.id = ANY(ids);
    PERFORM public.save_order_changes(changes, true);
    IF (SELECT amount FROM public.transactions WHERE id = ids[1]) <> 701.001 THEN RAISE EXCEPTION 'Metadata edit changed historical precision'; END IF;
    changes := jsonb_set(changes, '{0,updates,amount}', '0'::jsonb);
    changes := jsonb_set(changes, '{0,updates,details,removedFromOrder}', 'true'::jsonb);
    changes := jsonb_set(changes, '{0,updates,details,quantity}', '0'::jsonb);
    changes := jsonb_set(changes, '{1,updates,amount}', '801'::jsonb);
    changes := jsonb_set(changes, '{1,updates,details,shippingShare}', '100'::jsonb);
    PERFORM public.save_order_changes(changes, true);
    IF (SELECT amount FROM public.transactions WHERE id = ids[1]) <> 0
        OR (SELECT amount FROM public.transactions WHERE id = ids[2]) <> 801
    THEN RAISE EXCEPTION 'Removal and shipping reallocation were not saved together'; END IF;

    INSERT INTO public.transactions (id, type, category, amount, date, description, details)
    VALUES (legacy_id, 'sale', 'Sales', 850, now(), 'Legacy atomic fixture',
        '{"customer":"Fixture","items":[{"name":"Shirt","price":350,"quantity":1},{"name":"Ball","price":100,"quantity":5}]}'::jsonb);
    SELECT jsonb_build_array(jsonb_build_object('id', t.id, 'expected', to_jsonb(t) - ARRAY['id', 'created_at'],
        'updates', jsonb_build_object('amount', 1200, 'details', jsonb_set(t.details, '{items,0,quantity}', '2'::jsonb))))
    INTO changes FROM public.transactions t WHERE t.id = legacy_id;
    PERFORM public.save_order_changes(changes, true);
    IF (SELECT amount FROM public.transactions WHERE id = legacy_id) <> 1200 THEN RAISE EXCEPTION 'Legacy nested save failed'; END IF;

    DELETE FROM public.transactions WHERE id = legacy_id;
    caught := false;
    BEGIN
        PERFORM public.save_order_changes(changes, true);
    EXCEPTION WHEN serialization_failure THEN caught := true;
    END;
    IF NOT caught THEN RAISE EXCEPTION 'Deleted legacy order was recreated'; END IF;
END;
$tests$;

SELECT 'atomic_order_tests_passed' AS result;
