-- Additive: design photos for print jobs (owner request, 2026-10-13).
-- Apply with db:staging / db:production before deploying code that writes design_image_id.
-- The job snapshots the order line's product photo when prepared. Only PUBLIC media
-- (catalog product photos) may be attached; the Worker resolves the id through
-- media_objects.visibility = 'public', so private receipts can never reach print staff.
ALTER TABLE production_jobs ADD COLUMN design_image_id TEXT;

DROP VIEW production_job_public;
CREATE VIEW production_job_public AS
SELECT j.id, json_object(
    'id',j.id,'jobCode',j.job_code,'designName',j.design_name,
    'brand',j.brand,'color',j.color,'size',j.size,'required',j.required,
    'designImageUrl',CASE WHEN j.design_image_id IS NULL THEN NULL ELSE '/api/media/objects/' || j.design_image_id END,
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
