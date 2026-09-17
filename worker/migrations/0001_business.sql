PRAGMA foreign_keys = ON;

CREATE TABLE members (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    access_subject TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'reseller', 'print_operator')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE orders (
    id TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL DEFAULT 0 CHECK (
        typeof(version) = 'integer' AND version BETWEEN 0 AND 9007199254740991
    )
);

CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    -- Decimal text, never SQLite REAL: no exponent, leading/trailing zeroes or negative zero.
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
        date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z'
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

CREATE INDEX transactions_order_id ON transactions(order_id);
CREATE INDEX transactions_legacy_order ON transactions (
    coalesce(nullif(json_extract(details, '$.orderId'), ''), id)
) WHERE type = 'sale';

CREATE TABLE mutation_receipts (
    actor_id TEXT NOT NULL REFERENCES members(id),
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response TEXT NOT NULL CHECK (json_valid(response)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (actor_id, request_id)
);

CREATE TABLE activity_events (
    id INTEGER PRIMARY KEY,
    actor_id TEXT NOT NULL REFERENCES members(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    action TEXT NOT NULL,
    request_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    details TEXT NOT NULL CHECK (json_valid(details)),
    UNIQUE (actor_id, request_id)
);
CREATE INDEX activity_events_order ON activity_events(order_id, created_at);

-- Each INSERT must insert a row even on failure. A conditional zero-row UPDATE/INSERT
-- does not abort a D1 batch. Successful batches delete their transient guard rows.
CREATE TABLE _order_save_guards (
    kind TEXT NOT NULL CHECK (kind IN (
        'forbidden', 'receipt_conflict', 'conflict', 'updated',
        'version_updated', 'audit_written', 'receipt_written'
    )),
    ok INTEGER NOT NULL,
    CONSTRAINT order_save_forbidden CHECK (kind <> 'forbidden' OR ok = 1),
    CONSTRAINT order_save_receipt_conflict CHECK (kind <> 'receipt_conflict' OR ok = 1),
    CONSTRAINT order_save_conflict CHECK (kind <> 'conflict' OR ok = 1),
    CONSTRAINT order_save_updated CHECK (kind <> 'updated' OR ok = 1),
    CONSTRAINT order_save_version_updated CHECK (kind <> 'version_updated' OR ok = 1),
    CONSTRAINT order_save_audit_written CHECK (kind <> 'audit_written' OR ok = 1),
    CONSTRAINT order_save_receipt_written CHECK (kind <> 'receipt_written' OR ok = 1)
);
