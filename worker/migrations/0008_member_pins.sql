-- Daily PIN unlock on top of Cloudflare Access. Additive only.
-- Access (email code) proves who the member is, about once a month per device; the PIN
-- proves the person holding that signed-in device is still the member.
-- PINs are stored as PBKDF2-SHA256 hashes with a per-member random salt, never in clear.
-- `version` changes whenever the PIN is set, so earlier unlock cookies stop working.
CREATE TABLE member_pins (
    member_id TEXT PRIMARY KEY NOT NULL REFERENCES members(id),
    pin_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INTEGER NOT NULL CHECK (typeof(iterations) = 'integer' AND iterations >= 100000),
    version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version) = 'integer' AND version >= 1),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (typeof(failed_attempts) = 'integer' AND failed_attempts >= 0),
    locked_until TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
