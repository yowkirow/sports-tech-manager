-- Owner report (2026-11-03): deleting an order left its print jobs on hold with nothing to
-- review. A deleted line can't be replaced or re-released, so the owner could only retire each
-- job, and the card hid that action. Deleting an order line now retires its print jobs at once.
-- Every count and event stays in the job's history, and print pay is unchanged:
-- print_wallet_credits (0007) counts QA events whatever the job's status.
-- As before, other rows of the same order that were Ready or Shipped move back to In progress
-- with the packing confirmation cleared, because the package changed. That runs first, while the
-- deleted line's jobs are still active.
DROP TRIGGER production_source_delete;
CREATE TRIGGER production_source_delete AFTER DELETE ON transactions
BEGIN
    UPDATE transactions SET details=json_set(coalesce(details,'{}'),'$.fulfillmentStatus','in_progress','$.status','in_progress','$.packingConfirmed',json('false'))
    WHERE type='sale'
        AND coalesce(nullif(json_extract(details,'$.orderId'),''),id)=coalesce(nullif(json_extract(OLD.details,'$.orderId'),''),OLD.id)
        AND coalesce(json_extract(details,'$.removedFromOrder'),0) NOT IN (1,'true')
        AND coalesce(json_extract(details,'$.fulfillmentStatus'),json_extract(details,'$.status'),'pending') IN ('ready','shipped')
        AND EXISTS(SELECT 1 FROM production_jobs WHERE source_id=OLD.id AND status <> 'superseded');
    INSERT INTO production_events(job_id,actor_name,action,note,version)
        SELECT id,'System','source_deleted','Order line deleted. Do not print.',version + 1
        FROM production_jobs WHERE source_id = OLD.id AND status <> 'superseded';
    INSERT INTO production_events(job_id,actor_name,action,note,version)
        SELECT id,'System','superseded','Retired because its order line was deleted. Print and QA history stays.',version + 1
        FROM production_jobs WHERE source_id = OLD.id AND status <> 'superseded';
    UPDATE production_jobs SET status = 'superseded', source_changed = 1, version = version + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source_id = OLD.id AND status <> 'superseded';
END;

-- One-time: retire the jobs already held because their order line was deleted (8 in production
-- on 2026-11-03, from orders deleted on October 25, 27 and 28).
INSERT INTO production_events(job_id,actor_name,action,note,version)
    SELECT j.id,'System','superseded','Retired because its order was deleted. Print and QA history stays.',j.version + 1
    FROM production_jobs j WHERE j.status <> 'superseded' AND NOT EXISTS(SELECT 1 FROM transactions t WHERE t.id = j.source_id);
UPDATE production_jobs SET status = 'superseded', source_changed = 1, version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE status <> 'superseded' AND NOT EXISTS(SELECT 1 FROM transactions t WHERE t.id = production_jobs.source_id);
