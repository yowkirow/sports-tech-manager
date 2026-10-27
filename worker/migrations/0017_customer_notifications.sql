-- Customer emails (owner decision 2026-10-27): "order received" after a shop checkout or an owner
-- POS sale that has an email, and "shipped" with the LBC tracking number. One row per email the app
-- means to send. The id is the dedupe key, so a replayed save or a repeated trigger never sends the
-- same email twice, while a failed send can be claimed again:
--   received:{orderId}                    one confirmation per order
--   shipped:{orderId}:{tracking}:{email}  again only for a new tracking number or a new address
--   test:{memberId}:{minute}              Settings test email, at most one a minute per owner
-- Rows keep the recipient and the outcome, never the message. No foreign key to orders, so
-- deleting an order is never blocked by its email history.
CREATE TABLE customer_notifications (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 1024),
    order_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('received', 'shipped', 'test')),
    recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254),
    status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
    message_id TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX customer_notifications_order ON customer_notifications(order_id, kind);
CREATE INDEX customer_notifications_recipient ON customer_notifications(recipient, kind, created_at);
