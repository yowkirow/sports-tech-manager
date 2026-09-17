CREATE TABLE media_objects (
    id TEXT PRIMARY KEY NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    sha256 TEXT NOT NULL,
    owner_id TEXT REFERENCES members(id),
    order_id TEXT REFERENCES orders(id),
    original_url TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE private_settings (
    name TEXT PRIMARY KEY NOT NULL,
    encrypted_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sms_requests (
    actor_id TEXT NOT NULL REFERENCES members(id),
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (actor_id, request_id)
);

CREATE TABLE _settings_write_guards (
    ok INTEGER NOT NULL,
    CONSTRAINT settings_owner_active CHECK (ok = 1)
);

CREATE TABLE migration_archive (
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    data TEXT NOT NULL CHECK (json_valid(data)),
    PRIMARY KEY (source, source_id)
);

CREATE TABLE migration_runs (
    export_sha256 TEXT PRIMARY KEY NOT NULL,
    source_exported_at TEXT NOT NULL,
    transaction_count INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
