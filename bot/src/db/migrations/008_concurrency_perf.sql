-- 008_concurrency_perf.sql
-- Indexes and constraints required for 1000-concurrent-user operation.

-- A14/A27: Stock payload unique lookup index
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_items_payload ON stock_items(payload);

-- A24: Order queries filtering by product
CREATE INDEX IF NOT EXISTS idx_orders_product_status
    ON orders(product_id, status, created_at DESC);

-- A13: Sargable range scans for dashboard revenue buckets
CREATE INDEX IF NOT EXISTS idx_orders_fulfilled_created
    ON orders(created_at) WHERE status = 'fulfilled';

-- A6: Reconciliation sweeper driving predicate
CREATE INDEX IF NOT EXISTS idx_orders_awaiting_created
    ON orders(created_at) WHERE status = 'awaiting_payment';

-- A16/A24: User status and referral lookups
CREATE INDEX IF NOT EXISTS idx_users_registered ON users(is_registered) WHERE is_registered = 1;
CREATE INDEX IF NOT EXISTS idx_users_referrer   ON users(referrer_id) WHERE referrer_id IS NOT NULL;

-- A18: Promo redemption per-user check index
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON promo_redemptions(promo_id, user_id);

-- Maintenance sweeper indices
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_expires   ON bot_sessions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipt_evidence_order ON receipt_evidence(order_id);
CREATE INDEX IF NOT EXISTS idx_support_threads_topic  ON support_threads(forum_topic_id) WHERE forum_topic_id IS NOT NULL;

-- A8: Process leader and background worker leases
CREATE TABLE IF NOT EXISTS job_leases (
    name       TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

-- A8/A16: Broadcast jobs progress tracking
CREATE TABLE IF NOT EXISTS broadcast_jobs (
    id          TEXT PRIMARY KEY,
    admin_id    INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
    target_lang TEXT,
    sent        INTEGER NOT NULL DEFAULT 0,
    failed      INTEGER NOT NULL DEFAULT 0,
    cursor_id   INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- A8: Admin 2FA lockout store
CREATE TABLE IF NOT EXISTS admin_otp_failures (
    admin_id     INTEGER PRIMARY KEY,
    count        INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- A21: Request idempotency store
CREATE TABLE IF NOT EXISTS request_idempotency (
    key        TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    scope      TEXT NOT NULL,
    result_id  TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_request_idempotency_created ON request_idempotency(created_at);

-- A22: Webhook event deduplication store
CREATE TABLE IF NOT EXISTS webhook_events (
    provider    TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, event_id)
);
