-- Payout receipts (owner request 2026-11-03): when the owner pays a print operator, they attach a
-- photo or screenshot of the GCash or bank transfer. The paid operator sees it in their history.
-- print_payouts stays append-only; the receipt lives here so it can be attached after recording
-- (for example to older payouts) or replaced if the wrong image was chosen. One current receipt
-- per payout. The image itself is a private media object under payout-receipts/: the owner and the
-- paid operator can open it, nobody else.
CREATE TABLE print_payout_receipts (
    payout_id TEXT PRIMARY KEY NOT NULL REFERENCES print_payouts(id),
    media_id TEXT NOT NULL UNIQUE REFERENCES media_objects(id),
    attached_by TEXT NOT NULL REFERENCES members(id),
    attached_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Print staff history (same request): each operator's own print records and the QA results
-- credited to them, newest first.
CREATE INDEX production_events_actor ON production_events(actor_id, action);
CREATE INDEX production_events_operator ON production_events(operator_id, action);
