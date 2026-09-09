-- 012_admin_dashboard_optimizations.sql
-- Admin Dashboard Bank Verification Performance & Persistence Optimization
--
-- 1. Composite Index on receipt_evidence(order_id, id DESC)
--    Optimizes the batch enrichment query in GET /api/admin/orders:
--    SELECT MAX(id) FROM receipt_evidence WHERE order_id IN (...) GROUP BY order_id
--    Providing index-only covering scans across pagination boundaries.
--
-- 2. Completes default verification engine configuration in settings table,
--    ensuring receipt_ethiopia_proxy_url and all 18 dashboard settings keys
--    are guaranteed present with clean fail-safe defaults.

-- 1. Optimized composite index for batch receipt evidence resolution
CREATE INDEX IF NOT EXISTS idx_receipt_evidence_order_id
    ON receipt_evidence(order_id, id DESC);

-- 2. Idempotent seed for all bank verification engine settings
INSERT INTO settings (key, value) VALUES
    ('receipt_auto_verify_enabled', '1'),
    ('receipt_recency_before_mins', '120'),
    ('receipt_recency_after_mins', '120'),
    ('receipt_circuit_breaker_threshold', '5'),
    ('receipt_circuit_breaker_cooldown_sec', '60'),
    ('receipt_retention_days_raw_payloads', '14'),
    ('receipt_retention_days_unverified', '30'),
    ('receipt_retention_days_verified', '365'),
    ('receipt_cbe_beneficiaries', '["0000000000000"]'),
    ('receipt_telebirr_beneficiaries', '["0000000000"]'),
    ('receipt_abyssinia_beneficiaries', '["0000000000000"]'),
    ('receipt_ethiopia_proxy_url', '')
ON CONFLICT(key) DO NOTHING;
