CREATE TABLE guest_checkout_receipts (
    request_id TEXT PRIMARY KEY NOT NULL,
    payload_hash TEXT NOT NULL,
    order_id TEXT NOT NULL REFERENCES orders(id),
    response TEXT NOT NULL CHECK (json_valid(response)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE guest_receipts (
    id TEXT PRIMARY KEY NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    capability_hash TEXT NOT NULL,
    order_id TEXT REFERENCES orders(id),
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX guest_receipts_order ON guest_receipts(order_id);
CREATE INDEX guest_receipts_expiry ON guest_receipts(expires_at) WHERE order_id IS NULL;

CREATE TABLE rate_limit_state (
    key TEXT PRIMARY KEY NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL CHECK (count > 0),
    expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limit_expiry ON rate_limit_state(expires_at);

-- Legacy UUID orders may not yet have an orders header, so the capability scope
-- is checked against live transaction membership rather than an orders FK.
CREATE TABLE guest_order_grants (
    id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT NOT NULL,
    contact_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX guest_order_grants_expiry ON guest_order_grants(expires_at);
CREATE INDEX guest_order_grants_order ON guest_order_grants(order_id);

CREATE TABLE guest_order_receipts (
    order_id TEXT NOT NULL REFERENCES orders(id),
    request_id TEXT NOT NULL,
    contact_hash TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response TEXT NOT NULL CHECK (json_valid(response)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (order_id, request_id)
);

CREATE TABLE guest_order_events (
    id INTEGER PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    request_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL CHECK (json_valid(details)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (order_id, request_id)
);

CREATE TABLE _guest_order_guards (
    kind TEXT NOT NULL CHECK (kind IN ('scope', 'pending', 'conflict', 'updated')),
    ok INTEGER NOT NULL,
    CONSTRAINT guest_order_scope CHECK (kind <> 'scope' OR ok = 1),
    CONSTRAINT guest_order_pending CHECK (kind <> 'pending' OR ok = 1),
    CONSTRAINT guest_order_conflict CHECK (kind <> 'conflict' OR ok = 1),
    CONSTRAINT guest_order_updated CHECK (kind <> 'updated' OR ok = 1)
);

CREATE TABLE _guest_checkout_guards (
    kind TEXT NOT NULL CHECK (kind IN ('request', 'revision', 'receipt', 'inserted', 'written')),
    ok INTEGER NOT NULL,
    CONSTRAINT guest_checkout_request CHECK (kind <> 'request' OR ok = 1),
    CONSTRAINT guest_checkout_revision CHECK (kind <> 'revision' OR ok = 1),
    CONSTRAINT guest_checkout_receipt CHECK (kind <> 'receipt' OR ok = 1),
    CONSTRAINT guest_checkout_inserted CHECK (kind <> 'inserted' OR ok = 1),
    CONSTRAINT guest_checkout_written CHECK (kind <> 'written' OR ok = 1)
);
