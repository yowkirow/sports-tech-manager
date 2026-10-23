-- Follow-up to 0015 (2026-10-23). 15 of the corrected old-app orders have lines without a stored
-- item price (originalAmount, unitPrice or price). The Orders screen then takes the line amount as
-- the item price, and after 0015 that amount includes the shipping fee, so the order showed
-- "Items 1,200 + Shipping 200 - Adjustment 200" instead of "Items 1,000 + Shipping 200". Each
-- such line records its item value: the amount before 0015 added the shipping fee (kept in its
-- shippingCorrection note). Totals do not change. Safe to re-run.
UPDATE transactions
SET details = json_set(details, '$.originalAmount', CAST(json_extract(details, '$.shippingCorrection.previousAmount') AS INTEGER))
WHERE type = 'sale'
    AND json_type(details, '$.shippingCorrection') = 'object'
    AND json_type(details, '$.originalAmount') IS NULL
    AND json_type(details, '$.unitPrice') IS NULL
    AND json_type(details, '$.price') IS NULL
    AND json_extract(details, '$.shippingCorrection.previousAmount') GLOB '[0-9]*'
    AND json_extract(details, '$.shippingCorrection.previousAmount') NOT GLOB '*[^0-9]*';
