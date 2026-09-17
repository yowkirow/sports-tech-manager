// Call after source writes in the same D1 batch, only when production is enabled
// and an order enters Ready (including inserts), or a physical edit leaves it
// Ready. Unchanged historical Ready orders need no new job coverage merely for a
// payment/comment edit. Owner/packing guards belong to Orders. Delete transient
// _production_guards afterwards; failures roll back and expose production_conflict.
export function productionReadyGuard(db: D1Database, orderId: string): D1PreparedStatement {
    return db.prepare(`INSERT INTO _production_guards(kind,ok) SELECT 'conflict',(
        NOT EXISTS(
            SELECT 1 FROM production_order_shirt_lines s WHERE s.order_id=? AND NOT EXISTS(
                SELECT 1 FROM production_jobs j WHERE j.source_id=s.source_id AND j.item_index=s.item_index
                AND j.order_id=s.order_id AND j.source_fingerprint=s.fingerprint
                AND j.required=s.required AND j.accepted=j.required AND j.status='completed' AND j.source_changed=0
            )
        ) AND NOT EXISTS(
            SELECT 1 FROM production_jobs WHERE order_id=? AND status <> 'superseded'
            AND (status<>'completed' OR accepted<>required OR source_changed<>0)
        )
    )`).bind(orderId, orderId);
}
