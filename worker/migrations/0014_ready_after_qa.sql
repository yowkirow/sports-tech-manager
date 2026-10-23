-- One-time backfill (owner decision 2026-10-23): "Once production has been accepted by QA, the
-- orders must be put into Ready." From now on the Worker moves an order to Ready in the same save
-- as the QA that accepts its last shirt (READY_ORDERS in worker/production-api.ts). This applies
-- the identical rule once to orders whose shirts were all accepted before that:
--   - every active (not retired) print job on the order is completed, fully accepted and current;
--   - every shirt line of the order has such a job (an unqueued shirt keeps the order open);
--   - every active row is still Pending or In progress (Shipped, Returned or Cancelled untouched).
-- Only fulfillmentStatus changes, so no job is held (it is not in the source fingerprint). Order
-- versions advance so open edit screens reload. Safe to re-run: Ready orders no longer qualify.
UPDATE orders SET version = version + 1 WHERE id IN (
    SELECT DISTINCT o.order_id FROM production_jobs o WHERE o.status <> 'superseded'
        AND NOT EXISTS (SELECT 1 FROM production_jobs x WHERE x.order_id = o.order_id AND x.status <> 'superseded'
            AND (x.status <> 'completed' OR x.accepted <> x.required OR x.source_changed <> 0))
        AND NOT EXISTS (SELECT 1 FROM production_order_shirt_lines line WHERE line.order_id = o.order_id
            AND NOT EXISTS (SELECT 1 FROM production_jobs y WHERE y.source_id = line.source_id AND y.item_index = line.item_index
                AND y.order_id = line.order_id AND y.required = line.required AND y.accepted = y.required AND y.status = 'completed'
                AND y.source_changed = 0 AND y.source_fingerprint = line.fingerprint))
        AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.type = 'sale'
            AND coalesce(nullif(json_extract(t.details, '$.orderId'), ''), t.id) = o.order_id
            AND coalesce(json_extract(t.details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
            AND coalesce(json_extract(t.details, '$.fulfillmentStatus'),
                CASE WHEN coalesce(json_extract(t.details, '$.status'), 'paid') = 'paid' THEN 'pending' ELSE json_extract(t.details, '$.status') END)
                NOT IN ('pending', 'in_progress'))
);

UPDATE transactions SET details = json_set(coalesce(details, '{}'), '$.fulfillmentStatus', 'ready')
WHERE type = 'sale'
    AND coalesce(json_extract(details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
    AND coalesce(nullif(json_extract(details, '$.orderId'), ''), id) IN (
        SELECT DISTINCT o.order_id FROM production_jobs o WHERE o.status <> 'superseded'
            AND NOT EXISTS (SELECT 1 FROM production_jobs x WHERE x.order_id = o.order_id AND x.status <> 'superseded'
                AND (x.status <> 'completed' OR x.accepted <> x.required OR x.source_changed <> 0))
            AND NOT EXISTS (SELECT 1 FROM production_order_shirt_lines line WHERE line.order_id = o.order_id
                AND NOT EXISTS (SELECT 1 FROM production_jobs y WHERE y.source_id = line.source_id AND y.item_index = line.item_index
                    AND y.order_id = line.order_id AND y.required = line.required AND y.accepted = y.required AND y.status = 'completed'
                    AND y.source_changed = 0 AND y.source_fingerprint = line.fingerprint))
            AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.type = 'sale'
                AND coalesce(nullif(json_extract(t.details, '$.orderId'), ''), t.id) = o.order_id
                AND coalesce(json_extract(t.details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
                AND coalesce(json_extract(t.details, '$.fulfillmentStatus'),
                    CASE WHEN coalesce(json_extract(t.details, '$.status'), 'paid') = 'paid' THEN 'pending' ELSE json_extract(t.details, '$.status') END)
                    NOT IN ('pending', 'in_progress'))
    );
