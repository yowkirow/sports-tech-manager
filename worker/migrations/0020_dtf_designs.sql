-- DTF sheet builder (owner request 2026-11-09): the owner's print-ready SVG designs.
-- The SVG itself is a private media object (R2 dtf-designs/<media id>, served only to the owner and
-- only as a download). This table names it and keeps its default print size in thousandths of an
-- inch (mils), so sizes stay exact. Deleting a design archives it, so it can be restored.
CREATE TABLE dtf_designs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
    media_id TEXT NOT NULL UNIQUE REFERENCES media_objects(id),
    width_mils INTEGER NOT NULL CHECK (typeof(width_mils) = 'integer' AND width_mils BETWEEN 100 AND 60000),
    height_mils INTEGER NOT NULL CHECK (typeof(height_mils) = 'integer' AND height_mils BETWEEN 100 AND 120000),
    created_by TEXT NOT NULL REFERENCES members(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    archived_at TEXT
);

CREATE INDEX dtf_designs_gallery ON dtf_designs(archived_at, name);
