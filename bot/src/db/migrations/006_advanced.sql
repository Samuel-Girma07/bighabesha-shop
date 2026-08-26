-- Migration 006: Advanced commerce platform tables.
-- Covers: promo codes/flash sales, order events timeline, loyalty tiers,
-- referrals & affiliate ledger, payouts, support bridge, SMS evidence,
-- RBAC admins, variant costs, and payment-rail extension (chapa, ton_connect).
-- The orders table is rebuilt to extend the payment_rail CHECK and add
-- discount/cost/reminder columns in one pass.

CREATE TABLE IF NOT EXISTS promo_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('pct','flat')),
    value INTEGER NOT NULL CHECK (value > 0),
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    expires_at DATETIME,
    min_amount_etb INTEGER NOT NULL DEFAULT 0,
    product_scope TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    promo_id INTEGER NOT NULL REFERENCES promo_codes(id),
    user_id INTEGER NOT NULL,
    order_id TEXT NOT NULL UNIQUE,
    discount_etb INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Rebuild orders: relaxed rail CHECK + new columns, preserving all data.
CREATE TABLE IF NOT EXISTS orders_new (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    username TEXT,
    product_id TEXT NOT NULL REFERENCES products(id),
    variant_id TEXT REFERENCES variants(id),
    quantity INTEGER DEFAULT 1,
    amount_etb INTEGER NOT NULL,
    discount_etb INTEGER NOT NULL DEFAULT 0,
    promo_code TEXT,
    payment_rail TEXT NOT NULL,
    payment_ref TEXT,
    crypto_amount REAL,
    crypto_currency TEXT,
    reminded_at DATETIME,
    cost_basis_usd REAL,
    fx_rate_at_sale REAL,
    status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'pending_approval', 'pending_fulfillment', 'fulfilled', 'rejected', 'refunded', 'cancelled')),
    receipt_file_id TEXT,
    receipt_note TEXT,
    fulfillment_payload TEXT,
    fulfillment_proof TEXT,
    rejection_reason TEXT,
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orders_new (
    id, user_id, username, product_id, variant_id, quantity, amount_etb,
    payment_rail, payment_ref, crypto_amount, crypto_currency, status,
    receipt_file_id, receipt_note, fulfillment_payload, fulfillment_proof,
    rejection_reason, admin_notes, created_at, updated_at
)
SELECT
    id, user_id, username, product_id, variant_id, quantity, amount_etb,
    payment_rail, payment_ref, crypto_amount, crypto_currency, status,
    receipt_file_id, receipt_note, fulfillment_payload, fulfillment_proof,
    rejection_reason, admin_notes, created_at, updated_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_rail ON orders(payment_rail, status);

CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_type TEXT NOT NULL DEFAULT 'system',
    actor_id TEXT,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, id);

CREATE TABLE IF NOT EXISTS user_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    lifetime_etb INTEGER NOT NULL DEFAULT 0,
    orders_count INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'bronze',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN referrer_id INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN referral_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
    amount_etb INTEGER NOT NULL CHECK (amount_etb > 0),
    type TEXT NOT NULL,
    ref_order_id TEXT,
    idempotency_key TEXT UNIQUE,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, id DESC);

CREATE TABLE IF NOT EXISTS payout_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount_etb INTEGER NOT NULL CHECK (amount_etb > 0),
    method TEXT NOT NULL DEFAULT 'telebirr',
    destination TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
    processed_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    forum_topic_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL REFERENCES support_threads(id),
    sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin','system')),
    body TEXT NOT NULL,
    tg_message_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, id);

CREATE TABLE IF NOT EXISTS receipt_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'sms',
    raw_text TEXT,
    amount_etb INTEGER,
    reference TEXT,
    matched INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
    tg_user_id INTEGER PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'support' CHECK (role IN ('superadmin','ops','finance','support')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS variant_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id TEXT NOT NULL REFERENCES variants(id),
    unit_cost_usd REAL NOT NULL CHECK (unit_cost_usd >= 0),
    effective_from DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_variant_costs_latest ON variant_costs(variant_id, effective_from DESC);
