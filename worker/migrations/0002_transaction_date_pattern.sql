-- D1 limits LIKE/GLOB patterns to 50 bytes. Preserve data while replacing
-- the original date CHECK; migration execution must remain transactional.
CREATE TABLE _transactions_date_pattern_next (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    amount TEXT NOT NULL CHECK (
        typeof(amount) = 'text'
        AND (amount GLOB '[0-9]*' OR amount GLOB '-[0-9]*')
        AND amount NOT GLOB '*[^0-9.-]*'
        AND instr(substr(amount, 2), '-') = 0
        AND amount NOT GLOB '0[0-9]*'
        AND amount NOT GLOB '-0[0-9]*'
        AND amount <> '-0'
        AND length(amount) - length(replace(amount, '.', '')) <= 1
        AND (instr(amount, '.') = 0 OR (amount NOT LIKE '%.' AND amount NOT LIKE '%0'))
    ),
    date TEXT NOT NULL CHECK (
        date GLOB '????-??-??T??:??:??*Z'
        AND substr(date, 1, 4) <> '0000'
        AND strftime('%Y-%m-%dT%H:%M:%S', substr(date, 1, 19) || 'Z', '+0 seconds') IS substr(date, 1, 19)
        AND (length(date) = 20 OR (
            length(date) BETWEEN 22 AND 30 AND substr(date, 20, 1) = '.'
            AND substr(date, 21, length(date) - 21) NOT GLOB '*[^0-9]*'
        ))
    ),
    description TEXT,
    details TEXT CHECK (details IS NULL OR json_valid(details)),
    order_id TEXT REFERENCES orders(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO _transactions_date_pattern_next (
    id, type, category, amount, date, description, details, order_id, created_at
)
SELECT id, type, category, amount, date, description, details, order_id, created_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE _transactions_date_pattern_next RENAME TO transactions;

CREATE INDEX transactions_order_id ON transactions(order_id);
CREATE INDEX transactions_legacy_order ON transactions (
    coalesce(nullif(json_extract(details, '$.orderId'), ''), id)
) WHERE type = 'sale';
