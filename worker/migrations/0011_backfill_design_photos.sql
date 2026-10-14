-- One-time backfill (2026-10-14): jobs prepared before 0009 have no design photo snapshot.
-- Attach the same photo a new job would get: the line's own photo first (nested item
-- details, then the item, then the parent order), and only when it is PUBLIC product media
-- in this app's media table. Jobs that already have a photo, external URLs and private
-- files are untouched. Safe to re-run; counts, versions and events are not changed.
UPDATE production_jobs SET design_image_id = (
    SELECT m.id FROM media_objects m
    WHERE m.visibility = 'public' AND m.id = (
        SELECT lower(substr(url, 20)) FROM (
            SELECT replace(replace(coalesce(
                CASE WHEN production_jobs.item_index >= 0 THEN coalesce(
                    nullif(trim(CASE WHEN json_type(t.details, '$.items[' || production_jobs.item_index || '].details') = 'object'
                        THEN json_extract(t.details, '$.items[' || production_jobs.item_index || '].details.imageUrl') END), ''),
                    nullif(trim(json_extract(t.details, '$.items[' || production_jobs.item_index || '].imageUrl')), '')) END,
                nullif(trim(json_extract(t.details, '$.imageUrl')), '')),
                'https://www.sportstechph.store', ''), 'https://sportstechph.store', '') AS url
            FROM transactions t WHERE t.id = production_jobs.source_id
        ) WHERE url LIKE '/api/media/objects/%' AND length(url) = 55
    )
)
WHERE design_image_id IS NULL;
