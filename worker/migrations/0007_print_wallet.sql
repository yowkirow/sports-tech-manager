-- Print wallet. Additive only: 0001-0006 are unchanged and production_events stays immutable.
-- Apply with `npm run db:staging`, then `npm run db:production`, BEFORE deploying code that
-- reads these objects. The cutover load-target preflight compares the applied migration count
-- with this directory, so do not land this file in a cutover checkout until the cutover is done.
--
-- Pay rule: PHP 1,000 (100000 centavos) for every COMPLETE 30 shirts the owner accepts in QA.
-- Self-reported "printed" quantities and rejected shirts never count; a rejected shirt that is
-- reprinted counts once, when its reprint is accepted. Progress toward the next 30 is a count,
-- never a fractional payout. Money is integer centavos; never REAL.

-- The member who certainly printed every shirt in a QA acceptance, written once when the owner
-- records QA. NULL means the printer is not certain (mixed printers), so nobody is credited.
ALTER TABLE production_events ADD COLUMN operator_id TEXT REFERENCES members(id);

-- One row per owner QA acceptance. A QA event is credited to P only when every `printed` event
-- on that job since its pending count was last zero was recorded by P. Pending is rebuilt exactly
-- from the immutable event log (printed adds its quantity; QA removes accepted + rejected).
-- Events written before operator_id existed are judged by the same rule; anything uncertain
-- stays NULL (unattributed) and is never guessed from the job's assignee.
CREATE VIEW print_wallet_credits AS
SELECT q.id AS event_id, q.job_id, j.job_code, q.accepted AS shirts, q.created_at,
    coalesce(q.operator_id, (
        SELECT CASE WHEN count(*) > 0 AND count(p.actor_id) = count(*) AND count(DISTINCT p.actor_id) = 1
            THEN max(p.actor_id) END
        FROM production_events p
        WHERE p.job_id = q.job_id AND p.action = 'printed' AND p.id < q.id
            AND p.id > coalesce((
                SELECT max(z.id) FROM production_events z
                WHERE z.job_id = q.job_id AND z.id < q.id
                    AND (SELECT sum(CASE y.action WHEN 'printed' THEN y.quantity WHEN 'qa' THEN -y.quantity ELSE 0 END)
                        FROM production_events y WHERE y.job_id = z.job_id AND y.id <= z.id) = 0
            ), 0)
    )) AS operator_id
FROM production_events q JOIN production_jobs j ON j.id = q.job_id
WHERE q.action = 'qa' AND q.accepted > 0;

-- Owner-recorded payouts. Append-only: corrections are new rows, never edits.
CREATE TABLE print_payouts (
    id TEXT PRIMARY KEY NOT NULL,
    operator_id TEXT NOT NULL REFERENCES members(id),
    amount_centavos INTEGER NOT NULL CHECK (typeof(amount_centavos) = 'integer'
        AND amount_centavos > 0 AND amount_centavos % 100000 = 0 AND amount_centavos <= 100000000),
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES members(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX print_payouts_operator ON print_payouts(operator_id, created_at);
CREATE TRIGGER print_payouts_no_update BEFORE UPDATE ON print_payouts
BEGIN SELECT RAISE(ABORT, 'print_payouts_immutable'); END;
CREATE TRIGGER print_payouts_no_delete BEFORE DELETE ON print_payouts
BEGIN SELECT RAISE(ABORT, 'print_payouts_immutable'); END;
