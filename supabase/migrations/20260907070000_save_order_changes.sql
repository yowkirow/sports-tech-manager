CREATE OR REPLACE FUNCTION public.save_order_changes(
    p_changes jsonb,
    p_require_pending boolean DEFAULT false
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    change jsonb;
    requested_ids uuid[];
    current_ids uuid[];
    order_key text;
    current_row public.transactions%ROWTYPE;
    expected_row public.transactions%ROWTYPE;
    updated_row public.transactions%ROWTYPE;
    saved_id uuid;
    require_pending boolean := COALESCE(p_require_pending, false) OR current_user = 'anon';
    current_status text;
BEGIN
    IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Order changes must be an array.';
    END IF;
    IF jsonb_array_length(p_changes) = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Order cannot be empty.';
    END IF;

    FOR change IN SELECT value FROM jsonb_array_elements(p_changes)
    LOOP
        IF jsonb_typeof(change) IS DISTINCT FROM 'object'
            OR NOT (change ?& ARRAY['id', 'expected', 'updates'])
            OR jsonb_typeof(change->'expected') IS DISTINCT FROM 'object'
            OR jsonb_typeof(change->'updates') IS DISTINCT FROM 'object'
            OR NOT ((change->'expected') ?& ARRAY['type', 'category', 'amount', 'date', 'details', 'description'])
            OR NOT ((change->'updates') ?& ARRAY['amount', 'details'])
            OR jsonb_typeof(change->'updates'->'amount') IS DISTINCT FROM 'number'
            OR jsonb_typeof(change->'updates'->'details') IS DISTINCT FROM 'object'
            OR (change->'updates') - ARRAY['amount', 'details', 'category', 'date', 'description'] <> '{}'::jsonb
        THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid order change.';
        END IF;
    END LOOP;

    SELECT array_agg((value->>'id')::uuid ORDER BY (value->>'id')::uuid)
    INTO requested_ids
    FROM jsonb_array_elements(p_changes);
    IF array_position(requested_ids, NULL) IS NOT NULL
        OR cardinality(requested_ids) <> (SELECT count(DISTINCT value) FROM unnest(requested_ids) AS ids(value))
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Order contains missing or duplicate item IDs.';
    END IF;

    order_key := COALESCE(
        NULLIF(p_changes->0->'expected'->'details'->>'orderId', ''),
        ((p_changes->0->>'id')::uuid)::text
    );

    -- Lock the complete visible order in a stable order, not only the requested subset.
    SELECT array_agg(locked.id ORDER BY locked.id)
    INTO current_ids
    FROM (
        SELECT t.id
        FROM public.transactions AS t
        WHERE t.type = 'sale'
            AND COALESCE(NULLIF(t.details->>'orderId', ''), t.id::text) = order_key
            AND COALESCE(t.details->>'removedFromOrder', 'false') <> 'true'
        ORDER BY t.id
        FOR UPDATE
    ) AS locked;

    IF current_ids IS DISTINCT FROM requested_ids THEN
        RAISE EXCEPTION USING ERRCODE = '40001',
            MESSAGE = 'This order changed while you were editing. Reload it before saving.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_changes) AS changes(value)
        WHERE COALESCE(value->'updates'->'details'->>'removedFromOrder', 'false') <> 'true'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Order cannot be empty.';
    END IF;

    FOR change IN SELECT value FROM jsonb_array_elements(p_changes) ORDER BY (value->>'id')::uuid
    LOOP
        SELECT t.* INTO STRICT current_row
        FROM public.transactions AS t
        WHERE t.id = (change->>'id')::uuid;
        expected_row := jsonb_populate_record(NULL::public.transactions, change->'expected');
        IF current_row.type IS DISTINCT FROM expected_row.type
            OR current_row.category IS DISTINCT FROM expected_row.category
            OR current_row.amount IS DISTINCT FROM expected_row.amount
            OR current_row.date IS DISTINCT FROM expected_row.date
            OR current_row.details IS DISTINCT FROM expected_row.details
            OR current_row.description IS DISTINCT FROM expected_row.description
        THEN
            RAISE EXCEPTION USING ERRCODE = '40001',
                MESSAGE = 'This order changed while you were editing. Reload it before saving.';
        END IF;

        current_status := COALESCE(current_row.details->>'fulfillmentStatus',
            CASE WHEN COALESCE(current_row.details->>'status', 'paid') = 'paid'
                THEN 'pending' ELSE current_row.details->>'status' END);
        IF require_pending AND current_status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only pending orders can be edited.';
        END IF;

        updated_row := jsonb_populate_record(current_row, change->'updates');
        IF updated_row.amount IS NULL OR updated_row.amount < 0
            OR updated_row.date IS NULL OR NOT isfinite(updated_row.date)
            OR updated_row.category IS NULL
            OR COALESCE(NULLIF(updated_row.details->>'orderId', ''), current_row.id::text) <> order_key
        THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid order amount, date, category or order ID.';
        END IF;
        IF require_pending AND (
            COALESCE(updated_row.details->>'fulfillmentStatus', current_status) <> 'pending'
            OR COALESCE(updated_row.details->>'status', 'pending') NOT IN ('pending', 'paid')
        ) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Only pending orders can be edited.';
        END IF;
        IF updated_row.details->>'removedFromOrder' = 'true' AND updated_row.amount <> 0 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Removed order items must have a zero amount.';
        END IF;

        -- Any later exception rolls back all earlier updates in this RPC, including trigger effects.
        UPDATE public.transactions AS t
        SET amount = updated_row.amount,
            date = updated_row.date,
            category = updated_row.category,
            description = updated_row.description,
            details = updated_row.details
        WHERE t.id = current_row.id
        RETURNING t.id INTO saved_id;
        IF saved_id IS DISTINCT FROM current_row.id THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'The complete order could not be saved.';
        END IF;
    END LOOP;

    RETURN QUERY SELECT value FROM unnest(requested_ids) AS saved(value);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_order_changes(jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_order_changes(jsonb, boolean) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
