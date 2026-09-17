CREATE TABLE system_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (
        typeof(revision) = 'integer' AND revision BETWEEN 0 AND 9007199254740991
    )
);
INSERT INTO system_state(singleton, revision) VALUES (1, 0);

-- Triggers also cover order-store and guest checkout, without adding statements
-- to their atomic batches. Failed writes roll their revisions back with the data.
CREATE TRIGGER transactions_revision_insert AFTER INSERT ON transactions BEGIN
    UPDATE system_state SET revision = revision + 1 WHERE singleton = 1;
END;
CREATE TRIGGER transactions_revision_update AFTER UPDATE ON transactions BEGIN
    UPDATE system_state SET revision = revision + 1 WHERE singleton = 1;
END;
CREATE TRIGGER transactions_revision_delete AFTER DELETE ON transactions BEGIN
    UPDATE system_state SET revision = revision + 1 WHERE singleton = 1;
END;

CREATE INDEX transactions_history ON transactions(
    substr(date, 1, 19) DESC,
    substr((CASE WHEN length(date) > 20 THEN substr(date, 21, length(date) - 21)
        ELSE '' END) || '000000000', 1, 9) DESC,
    id DESC
);
CREATE INDEX transactions_actor ON transactions(json_extract(details, '$.createdBy'));

CREATE TABLE customers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    contact_number TEXT,
    address TEXT,
    notes TEXT,
    total_spent TEXT NOT NULL DEFAULT '0' CHECK (
        typeof(total_spent) = 'text'
        AND total_spent GLOB '[0-9]*'
        AND total_spent NOT GLOB '*[^0-9.]*'
        AND total_spent NOT GLOB '0[0-9]*'
        AND length(total_spent) - length(replace(total_spent, '.', '')) <= 1
        AND (instr(total_spent, '.') = 0 OR (total_spent NOT LIKE '%.' AND total_spent NOT LIKE '%0'))
    ),
    -- Imported owner records keep NULL scope; resellers have isolated address books.
    owner_id TEXT REFERENCES members(id),
    metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX customers_scoped_name ON customers(coalesce(owner_id, ''), name);

CREATE TABLE referrers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    voucher_code TEXT,
    tournament_name TEXT,
    tournament_date TEXT,
    tournament_category TEXT,
    target_reimbursement TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    admin_email TEXT,
    metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT
);

CREATE TABLE member_profiles (
    member_id TEXT PRIMARY KEY NOT NULL REFERENCES members(id),
    profile TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(profile) AND json_type(profile) = 'object')
);

CREATE TABLE activity_logs (
    id TEXT PRIMARY KEY NOT NULL,
    actor_id TEXT REFERENCES members(id),
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    entity_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX activity_logs_history ON activity_logs(created_at DESC, id DESC);

-- Critical server-authored audit is distinct from optional client activity logs.
-- Targets are text, not cascading FKs: authorized deletion never removes evidence.
CREATE TABLE business_events (
    id INTEGER PRIMARY KEY,
    actor_id TEXT NOT NULL REFERENCES members(id),
    request_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL CHECK (json_valid(details)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(actor_id, request_id)
);
CREATE TRIGGER business_events_no_update BEFORE UPDATE ON business_events BEGIN
    SELECT RAISE(ABORT, 'business audit is append only');
END;
CREATE TRIGGER business_events_no_delete BEFORE DELETE ON business_events BEGIN
    SELECT RAISE(ABORT, 'business audit is append only');
END;

CREATE TABLE transaction_tombstones (
    id TEXT PRIMARY KEY NOT NULL,
    actor_id TEXT NOT NULL REFERENCES members(id),
    request_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE _business_guards (
    kind TEXT NOT NULL CHECK (kind IN (
        'forbidden', 'receipt_conflict', 'conflict', 'written', 'production_locked'
    )),
    ok INTEGER NOT NULL,
    CONSTRAINT business_forbidden CHECK (kind <> 'forbidden' OR ok = 1),
    CONSTRAINT business_receipt_conflict CHECK (kind <> 'receipt_conflict' OR ok = 1),
    CONSTRAINT business_conflict CHECK (kind <> 'conflict' OR ok = 1),
    CONSTRAINT business_written CHECK (kind <> 'written' OR ok = 1),
    CONSTRAINT business_production_locked CHECK (kind <> 'production_locked' OR ok = 1)
);
