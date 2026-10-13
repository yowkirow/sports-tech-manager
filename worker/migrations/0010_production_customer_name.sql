-- Owner decision (2026-10-13): print staff see the customer's NAME so they can write it on
-- the package. Only the name is exposed; contacts, addresses, receipts, prices, order
-- numbers and comments stay owner-only. The name is read live from the job's source order
-- line, so a corrected name reaches the printer. Additive view change; no data is changed.
DROP VIEW production_job_public;
CREATE VIEW production_job_public AS
SELECT j.id, json_object(
    'id',j.id,'jobCode',j.job_code,'designName',j.design_name,
    'brand',j.brand,'color',j.color,'size',j.size,'required',j.required,
    'designImageUrl',CASE WHEN j.design_image_id IS NULL THEN NULL ELSE '/api/media/objects/' || j.design_image_id END,
    'customerName',(SELECT substr(coalesce(
            nullif(trim(CASE WHEN json_type(t.details,'$.customerName')='text' THEN json_extract(t.details,'$.customerName') END),''),
            nullif(trim(CASE WHEN json_type(t.details,'$.customer')='text' THEN json_extract(t.details,'$.customer') END),'')),1,120)
        FROM transactions t WHERE t.id=j.source_id),
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
