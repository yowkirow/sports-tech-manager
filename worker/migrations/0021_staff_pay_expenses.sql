-- Staff pay is an expense too (owner request, November 2026). From this release each payout also
-- writes a General expense in the same atomic batch (staffPayExpense in worker/production-api.ts).
-- This writes that expense for the payouts recorded before it, exactly as the Worker does: the
-- payout's ID, peso amount and time, "Print staff pay: {name} ({note})" and the same details.
-- A payout whose ID is already a transaction, or was deleted as one, is skipped.
INSERT INTO transactions(id, type, category, amount, date, description, details)
SELECT p.id, 'expense', 'general', CAST(p.amount_centavos / 100 AS TEXT), p.created_at,
    'Print staff pay: ' || coalesce(nullif(trim(CASE WHEN json_type(mp.profile, '$.full_name') = 'text'
        THEN json_extract(mp.profile, '$.full_name') END), ''), 'Print operator')
        || CASE WHEN p.note <> '' THEN ' (' || p.note || ')' ELSE '' END,
    json_object('club', NULL, 'createdBy', coalesce(m.email, p.created_by), 'isGeneral', json('true'),
        'payoutId', p.id, 'reimbursed', json('false'), 'reimbursedAmount', 0,
        'subCategory', 'Print staff pay', 'userRole', 'owner')
FROM print_payouts AS p
LEFT JOIN member_profiles AS mp ON mp.member_id = p.operator_id
LEFT JOIN members AS m ON m.id = p.created_by
WHERE NOT EXISTS (SELECT 1 FROM transactions AS t WHERE t.id = p.id)
    AND NOT EXISTS (SELECT 1 FROM transaction_tombstones AS x WHERE x.id = p.id)
ORDER BY p.created_at, p.rowid;
