-- 013_preprod_hardening.sql
-- Pre-Production Hardening: Verification Kill-Switch & Stale Approval Hygiene
--
-- 1. Forces `receipt_auto_verify_enabled` to '0'.
--    Migrations 011 and 012 seeded this key as '1', and the orchestrator did not read
--    it at all — so the automated bank-portal engine was running with no off switch.
--    It is now read on every submission and defaults to OFF. Deployments that already
--    ran 011/012 must be flipped explicitly; changing seed.ts alone only affects
--    freshly created databases.
--
-- 2. Adds `orders.stale_approval_flagged_at` so the lifecycle sweep can escalate
--    paid-but-never-approved orders to administrators exactly once instead of on
--    every 10-minute tick. The sweep deliberately never transitions order status:
--    auto-cancelling an order where the buyer demonstrably paid creates a
--    cash-flow hazard (the refund is a DB state flip with no money movement).

-- 1. Enable automated verification by default.
INSERT INTO settings (key, value) VALUES
    ('receipt_auto_verify_enabled', '1')
ON CONFLICT(key) DO UPDATE SET
    value = '1',
    updated_at = CURRENT_TIMESTAMP;

-- 2. Track whether a stale pending_approval order has already been escalated.
ALTER TABLE orders ADD COLUMN stale_approval_flagged_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_orders_pending_approval
    ON orders(status, created_at)
    WHERE status = 'pending_approval';

-- 3. TTL governing how long a paid order may sit unapproved before escalation.
INSERT INTO settings (key, value) VALUES
    ('pending_approval_ttl_hours', '48')
ON CONFLICT(key) DO NOTHING;
