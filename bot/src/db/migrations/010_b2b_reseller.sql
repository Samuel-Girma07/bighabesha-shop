-- 010_b2b_reseller.sql
-- B2B reseller fulfillment pipeline for Telegram Premium.
--
-- Adds four provider-tracking columns and extends the orders.status CHECK to
-- include 'processing' and 'delivery_failed', which the reseller pipeline uses
-- to bracket the outbound HTTP call.
--
-- SQLite cannot amend a CHECK constraint in place, so the table is rebuilt and
-- all rows are copied forward. 'pending_fulfillment' is intentionally RETAINED:
-- it remains the manual/stock fulfillment path (Gemini Pro activation links and
-- any order an admin completes by hand). The new statuses are additive, not a
-- replacement.

-- 1. Rebuild orders with the extended status CHECK + reseller columns.
CREATE TABLE orders_new (
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
    status TEXT NOT NULL CHECK (status IN (
        'new',
        'awaiting_payment',
        'pending_approval',
        'pending_fulfillment',
        'processing',
        'delivery_failed',
        'fulfilled',
        'rejected',
        'refunded',
        'cancelled'
    )),
    receipt_file_id TEXT,
    receipt_note TEXT,
    fulfillment_payload TEXT,
    fulfillment_proof TEXT,
    rejection_reason TEXT,
    admin_notes TEXT,
    -- B2B reseller fulfillment tracking
    target_username TEXT,
    reseller_provider TEXT,
    reseller_tx_id TEXT,
    reseller_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orders_new (
    id, user_id, username, product_id, variant_id, quantity, amount_etb,
    discount_etb, promo_code, payment_rail, payment_ref, crypto_amount,
    crypto_currency, reminded_at, cost_basis_usd, fx_rate_at_sale, status,
    receipt_file_id, receipt_note, fulfillment_payload, fulfillment_proof,
    rejection_reason, admin_notes, created_at, updated_at
)
SELECT
    id, user_id, username, product_id, variant_id, quantity, amount_etb,
    COALESCE(discount_etb, 0), promo_code, payment_rail, payment_ref, crypto_amount,
    crypto_currency, reminded_at, cost_basis_usd, fx_rate_at_sale, status,
    receipt_file_id, receipt_note, fulfillment_payload, fulfillment_proof,
    rejection_reason, admin_notes, created_at, updated_at
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

-- 2. Restore the indexes dropped with the original table.
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_rail ON orders(payment_rail, status);
CREATE INDEX IF NOT EXISTS idx_orders_product_status
    ON orders(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_fulfilled_created
    ON orders(created_at) WHERE status = 'fulfilled';
CREATE INDEX IF NOT EXISTS idx_orders_awaiting_created
    ON orders(created_at) WHERE status = 'awaiting_payment';

-- Failed deliveries are swept by the retry/attention path; keep that scan cheap.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_failed
    ON orders(status, created_at ASC) WHERE status = 'delivery_failed';

-- 3. Backfill recipients for existing Premium orders that were paid but not yet
--    delivered, so the new pipeline has a target without re-prompting the buyer.
UPDATE orders
SET target_username = username
WHERE target_username IS NULL
  AND product_id = 'telegram_premium'
  AND username IS NOT NULL
  AND status IN ('pending_approval', 'pending_fulfillment');

-- 4. Update the Premium product description: delivery now runs through a
--    reseller provider that activates on a @username, not Fragment directly.
UPDATE products
SET description = 'Direct Telegram Premium subscription activated on any public @username via our reseller provider. Delivery is confirmed automatically.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'telegram_premium';
