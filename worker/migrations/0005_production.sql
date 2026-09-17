-- Apply before enabling PRINT_QUEUE_ENABLED. No employee identities are seeded.
-- Only physical line data participates. Payments, contacts, comments, return tags
-- and other financial metadata must never invalidate artwork/blank instructions.
CREATE VIEW production_source_state AS
SELECT t.id AS source_id,
    coalesce(nullif(json_extract(t.details, '$.orderId'), ''), t.id) AS order_id,
    json_array(t.type, t.category,
        coalesce(nullif(json_extract(t.details, '$.orderId'), ''), t.id),
        json_extract(t.details, '$.removedFromOrder'), json_extract(t.details, '$.club'),
        json_extract(t.details, '$.itemName'), json_extract(t.details, '$.name'),
        json_extract(t.details, '$.brand'), json_extract(t.details, '$.color'),
        json_extract(t.details, '$.linkedColor'), json_extract(t.details, '$.size'),
        json_extract(t.details, '$.quantity'), json_extract(t.details, '$.category'),
        json_extract(t.details, '$.productId'),
        CASE WHEN json_type(t.details, '$.items') = 'array' THEN (
            SELECT json_group_array(json_array(
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.id'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.productId'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.itemName'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.name'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.brand'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.color'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.linkedColor'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.size'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.quantity'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.category'),
                json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.removedFromOrder')
            )) FROM json_each(t.details, '$.items') i
        ) ELSE NULL END
    ) AS fingerprint
FROM transactions t;

-- Used by the order owner's atomic Ready guard. A missing job is not completion.
CREATE VIEW production_order_shirt_lines AS
WITH lines AS (
    SELECT t.id AS source_id, s.order_id, s.fingerprint,
        CASE WHEN json_type(t.details,'$.items')='array' THEN CAST(i.key AS INTEGER) ELSE -1 END AS item_index,
        CASE WHEN json_type(i.value,'$.details')='object' THEN json_extract(i.value,'$.details') ELSE i.value END AS item,
        t.category
    FROM transactions t JOIN production_source_state s ON s.source_id=t.id
    JOIN json_each(CASE WHEN json_type(t.details,'$.items')='array'
        THEN json_extract(t.details,'$.items') ELSE json_array(json(coalesce(t.details,'{}'))) END) i
    WHERE t.type='sale'
        AND coalesce(json_extract(t.details,'$.removedFromOrder'),0) NOT IN (1,'true')
        AND coalesce(json_extract(t.details,'$.club'),'')<>'downtown-dinks'
), normalized AS (
    SELECT *, lower(trim(coalesce(nullif(json_extract(item,'$.category'),''),category,''))) AS item_category
    FROM lines
)
SELECT source_id,order_id,fingerprint,item_index,
    CAST(coalesce(json_extract(item,'$.quantity'),1) AS INTEGER) AS required
FROM normalized
WHERE coalesce(json_extract(item,'$.removedFromOrder'),0) NOT IN (1,'true')
    AND (item_category IN ('shirts','blanks') OR
        (item_category IN ('','sale','sales','general')
            AND coalesce(nullif(json_extract(item,'$.size'),''),'N/A')<>'N/A'));

CREATE TABLE production_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    job_code TEXT NOT NULL UNIQUE,
    source_id TEXT NOT NULL,
    item_index INTEGER NOT NULL DEFAULT -1 CHECK (item_index >= -1),
    legacy_item_key TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    design_name TEXT NOT NULL,
    brand TEXT NOT NULL,
    color TEXT NOT NULL,
    size TEXT NOT NULL,
    required INTEGER NOT NULL CHECK (typeof(required) = 'integer' AND required BETWEEN 1 AND 100000),
    pending INTEGER NOT NULL DEFAULT 0 CHECK (typeof(pending) = 'integer' AND pending >= 0),
    accepted INTEGER NOT NULL DEFAULT 0 CHECK (typeof(accepted) = 'integer' AND accepted >= 0),
    rejected INTEGER NOT NULL DEFAULT 0 CHECK (typeof(rejected) = 'integer' AND rejected >= 0),
    rework INTEGER NOT NULL DEFAULT 0 CHECK (typeof(rework) = 'integer' AND rework >= 0),
    instructions TEXT NOT NULL DEFAULT '',
    assignee_id TEXT NOT NULL REFERENCES members(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','released','printing','awaiting_qa','problem','held','completed','superseded')),
    superseded_by TEXT REFERENCES production_jobs(id),
    source_changed INTEGER NOT NULL DEFAULT 0 CHECK (source_changed IN (0,1)),
    version INTEGER NOT NULL DEFAULT 0 CHECK (typeof(version) = 'integer' AND version BETWEEN 0 AND 9007199254740990),
    released_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CONSTRAINT production_counts CHECK (accepted + pending <= required AND rework <= required - accepted - pending),
    CONSTRAINT production_completed CHECK (status <> 'completed' OR accepted = required)
);
CREATE UNIQUE INDEX production_jobs_current_source ON production_jobs(source_id,item_index) WHERE status <> 'superseded';
CREATE INDEX production_jobs_assignee ON production_jobs(assignee_id, status, updated_at);
CREATE INDEX production_jobs_order ON production_jobs(order_id);

CREATE TABLE production_events (
    id INTEGER PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES production_jobs(id),
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0,
    rejected INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX production_events_job ON production_events(job_id, id);
CREATE TRIGGER production_events_no_update BEFORE UPDATE ON production_events
BEGIN SELECT RAISE(ABORT, 'production_events_immutable'); END;
CREATE TRIGGER production_events_no_delete BEFORE DELETE ON production_events
BEGIN SELECT RAISE(ABORT, 'production_events_immutable'); END;
CREATE TRIGGER production_jobs_no_delete BEFORE DELETE ON production_jobs
BEGIN SELECT RAISE(ABORT, 'production_jobs_immutable'); END;

CREATE TABLE production_request_receipts (
    actor_id TEXT NOT NULL REFERENCES members(id),
    request_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response TEXT NOT NULL CHECK(json_valid(response)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(actor_id, request_id)
);
CREATE TABLE _production_guards (
    kind TEXT NOT NULL CHECK(kind IN ('forbidden','conflict','receipt','write')),
    ok INTEGER NOT NULL,
    CONSTRAINT production_forbidden CHECK(kind <> 'forbidden' OR ok = 1),
    CONSTRAINT production_conflict CHECK(kind <> 'conflict' OR ok = 1),
    CONSTRAINT production_receipt CHECK(kind <> 'receipt' OR ok = 1),
    CONSTRAINT production_write CHECK(kind <> 'write' OR ok = 1)
);

CREATE TRIGGER production_source_update AFTER UPDATE ON transactions
WHEN EXISTS (
    SELECT 1 FROM production_jobs j WHERE j.source_id = OLD.id AND j.status <> 'superseded'
) AND (OLD.id <> NEW.id OR (
    SELECT fingerprint FROM production_source_state WHERE source_id = NEW.id
) <> json_array(OLD.type, OLD.category,
    coalesce(nullif(json_extract(OLD.details, '$.orderId'), ''), OLD.id),
    json_extract(OLD.details, '$.removedFromOrder'), json_extract(OLD.details, '$.club'),
    json_extract(OLD.details, '$.itemName'), json_extract(OLD.details, '$.name'),
    json_extract(OLD.details, '$.brand'), json_extract(OLD.details, '$.color'),
    json_extract(OLD.details, '$.linkedColor'), json_extract(OLD.details, '$.size'),
    json_extract(OLD.details, '$.quantity'), json_extract(OLD.details, '$.category'),
    json_extract(OLD.details, '$.productId'),
    CASE WHEN json_type(OLD.details, '$.items') = 'array' THEN (
        SELECT json_group_array(json_array(
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.id'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.productId'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.itemName'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.name'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.brand'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.color'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.linkedColor'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.size'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.quantity'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.category'),
            json_extract(coalesce(json_extract(i.value, '$.details'), i.value), '$.removedFromOrder')
        )) FROM json_each(OLD.details, '$.items') i
    ) ELSE NULL END)
)
BEGIN
    UPDATE production_jobs SET status = 'held', source_changed = 1, version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE source_id = OLD.id AND status <> 'superseded';
    INSERT INTO production_events(job_id,actor_name,action,note,version)
        SELECT id,'System','source_changed','Source line changed. Owner review required.',version
        FROM production_jobs WHERE source_id = OLD.id AND status <> 'superseded';
    UPDATE transactions SET details=json_set(coalesce(details,'{}'),'$.fulfillmentStatus','in_progress','$.status','in_progress','$.packingConfirmed',json('false'))
    WHERE type='sale'
        AND coalesce(nullif(json_extract(details,'$.orderId'),''),id)=coalesce(nullif(json_extract(OLD.details,'$.orderId'),''),OLD.id)
        AND coalesce(json_extract(details,'$.removedFromOrder'),0) NOT IN (1,'true')
        AND coalesce(json_extract(details,'$.fulfillmentStatus'),json_extract(details,'$.status'),'pending') IN ('ready','shipped');
END;
CREATE TRIGGER production_source_delete AFTER DELETE ON transactions
BEGIN
    UPDATE production_jobs SET status = 'held', source_changed = 1, version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source_id = OLD.id AND status <> 'superseded';
    INSERT INTO production_events(job_id,actor_name,action,note,version)
        SELECT id,'System','source_deleted','Source removed. Do not print.',version FROM production_jobs WHERE source_id = OLD.id AND status <> 'superseded';
    UPDATE transactions SET details=json_set(coalesce(details,'{}'),'$.fulfillmentStatus','in_progress','$.status','in_progress','$.packingConfirmed',json('false'))
    WHERE type='sale'
        AND coalesce(nullif(json_extract(details,'$.orderId'),''),id)=coalesce(nullif(json_extract(OLD.details,'$.orderId'),''),OLD.id)
        AND coalesce(json_extract(details,'$.removedFromOrder'),0) NOT IN (1,'true')
        AND coalesce(json_extract(details,'$.fulfillmentStatus'),json_extract(details,'$.status'),'pending') IN ('ready','shipped')
        AND EXISTS(SELECT 1 FROM production_jobs WHERE source_id=OLD.id AND status <> 'superseded');
END;
CREATE TRIGGER production_operator_revoke AFTER UPDATE OF active,role ON members
WHEN OLD.role = 'print_operator' AND (NEW.active <> 1 OR NEW.role <> 'print_operator')
BEGIN
    UPDATE production_jobs SET status = 'held', version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE assignee_id = NEW.id AND status NOT IN ('completed','superseded');
    INSERT INTO production_events(job_id,actor_name,action,note,version)
        SELECT id,'System','operator_revoked','Employee access revoked. Owner review required.',version
        FROM production_jobs WHERE assignee_id = NEW.id AND status = 'held';
END;

-- This is the complete employee response allowlist. No transaction JSON is joined.
CREATE VIEW production_job_public AS
SELECT j.id, json_object(
    'id',j.id,'jobCode',j.job_code,'designName',j.design_name,
    'brand',j.brand,'color',j.color,'size',j.size,'required',j.required,
    'awaitingQA',j.pending,'accepted',j.accepted,'rejected',j.rejected,
    'reworkRemaining',j.rework,'remainingToPrint',j.required-j.accepted-j.pending,
    'instructions',j.instructions,'status',j.status,'version',j.version,
    'assignee',json_object('id',j.assignee_id,'name',coalesce(nullif(trim(
        CASE WHEN json_type(p.profile,'$.full_name')='text' THEN json_extract(p.profile,'$.full_name') END
    ),''),'Print operator')),
    'releasedAt',j.released_at,'updatedAt',j.updated_at,
    'events',json(coalesce((SELECT json_group_array(json(event)) FROM (
        SELECT json_object('id',e.id,'actorName',e.actor_name,'action',e.action,
            'quantity',e.quantity,'accepted',e.accepted,'rejected',e.rejected,
            'note',e.note,'version',e.version,'createdAt',e.created_at) AS event
        FROM production_events e WHERE e.job_id=j.id ORDER BY e.id DESC LIMIT 100
    )), '[]'))
) AS payload FROM production_jobs j LEFT JOIN member_profiles p ON p.member_id=j.assignee_id;
