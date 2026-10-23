-- Owner request (2026-10-23): "double check all items, other items doesn't add shipping fee in
-- the total". 149 online orders imported from the old app (January to August 2026, mostly
-- January to March) recorded a shipping fee (shippingDetails.shippingFee, PHP 100 or 200) that
-- was never added to the order total. Every order created since the move to Cloudflare (source
-- 'storefront') already includes it.
--
-- For each such order, the fee is added once, to one line (the lowest id), and recorded as that
-- line's shippingShare, exactly how current orders store shipping. The line keeps an audit note
-- (details.shippingCorrection) with the fee and its previous amount, so any single order can be
-- reverted. An order qualifies only when:
--   - it is an old-app online order (isOnlineOrder, no source), not removed and not a club entry;
--   - a shipping fee is recorded and no line already carries a shipping share;
--   - its total equals items - discounts + rush fees exactly (so shipping is plainly missing);
--   - every amount is whole pesos.
-- Orders whose total matches neither pattern are left alone. Order versions advance so open edit
-- screens reload. Safe to re-run: corrected orders no longer match.

UPDATE orders SET version = version + 1 WHERE id IN (
    WITH r AS (
        SELECT id, amount,
            coalesce(nullif(json_extract(details, '$.orderId'), ''), id) AS oid,
            CAST(amount AS REAL) AS a,
            coalesce(CAST(json_extract(details, '$.originalAmount') AS REAL), CAST(amount AS REAL)) AS orig,
            coalesce(CAST(json_extract(details, '$.discountShare') AS REAL), 0) AS disc,
            coalesce(CAST(json_extract(details, '$.shippingDetails.shippingFee') AS INTEGER), 0) AS fee,
            coalesce(CAST(json_extract(details, '$.shippingDetails.rushFee') AS REAL), 0) AS rush,
            coalesce(CAST(json_extract(details, '$.shippingShare') AS REAL), 0) AS share
        FROM transactions
        WHERE type = 'sale' AND json_extract(details, '$.isOnlineOrder') AND json_extract(details, '$.source') IS NULL
            AND json_type(details, '$.items') IS NULL
            AND coalesce(json_extract(details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
            AND coalesce(json_extract(details, '$.club'), '') <> 'downtown-dinks'
    )
    SELECT oid FROM r GROUP BY oid
    HAVING max(fee) > 0 AND sum(share) = 0 AND sum(instr(amount, '.') > 0) = 0
        AND abs(sum(a) - (sum(orig) - sum(disc) + sum(rush))) < 0.005
);

UPDATE transactions SET
    amount = CAST(CAST(amount AS INTEGER) + (
        SELECT max(coalesce(CAST(json_extract(x.details, '$.shippingDetails.shippingFee') AS INTEGER), 0)) FROM transactions x
        WHERE x.type = 'sale' AND coalesce(json_extract(x.details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
            AND coalesce(nullif(json_extract(x.details, '$.orderId'), ''), x.id) = coalesce(nullif(json_extract(transactions.details, '$.orderId'), ''), transactions.id)
    ) AS TEXT),
    details = json_set(details,
        '$.shippingShare', (
            SELECT max(coalesce(CAST(json_extract(x.details, '$.shippingDetails.shippingFee') AS INTEGER), 0)) FROM transactions x
            WHERE x.type = 'sale' AND coalesce(json_extract(x.details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
                AND coalesce(nullif(json_extract(x.details, '$.orderId'), ''), x.id) = coalesce(nullif(json_extract(transactions.details, '$.orderId'), ''), transactions.id)
        ),
        '$.shippingCorrection', json_object(
            'addedFee', (
                SELECT max(coalesce(CAST(json_extract(x.details, '$.shippingDetails.shippingFee') AS INTEGER), 0)) FROM transactions x
                WHERE x.type = 'sale' AND coalesce(json_extract(x.details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
                    AND coalesce(nullif(json_extract(x.details, '$.orderId'), ''), x.id) = coalesce(nullif(json_extract(transactions.details, '$.orderId'), ''), transactions.id)
            ),
            'previousAmount', amount,
            'date', '2026-10-23',
            'reason', 'Shipping fee was recorded but missing from the order total'))
WHERE id IN (
    WITH r AS (
        SELECT id, amount,
            coalesce(nullif(json_extract(details, '$.orderId'), ''), id) AS oid,
            CAST(amount AS REAL) AS a,
            coalesce(CAST(json_extract(details, '$.originalAmount') AS REAL), CAST(amount AS REAL)) AS orig,
            coalesce(CAST(json_extract(details, '$.discountShare') AS REAL), 0) AS disc,
            coalesce(CAST(json_extract(details, '$.shippingDetails.shippingFee') AS INTEGER), 0) AS fee,
            coalesce(CAST(json_extract(details, '$.shippingDetails.rushFee') AS REAL), 0) AS rush,
            coalesce(CAST(json_extract(details, '$.shippingShare') AS REAL), 0) AS share
        FROM transactions
        WHERE type = 'sale' AND json_extract(details, '$.isOnlineOrder') AND json_extract(details, '$.source') IS NULL
            AND json_type(details, '$.items') IS NULL
            AND coalesce(json_extract(details, '$.removedFromOrder'), 0) NOT IN (1, 'true')
            AND coalesce(json_extract(details, '$.club'), '') <> 'downtown-dinks'
    )
    SELECT min(id) FROM r GROUP BY oid
    HAVING max(fee) > 0 AND sum(share) = 0 AND sum(instr(amount, '.') > 0) = 0
        AND abs(sum(a) - (sum(orig) - sum(disc) + sum(rush))) < 0.005
);
