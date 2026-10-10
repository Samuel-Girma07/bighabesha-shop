-- ============================================================================
-- Migration 014: Enable receipt auto-verification on existing databases
-- ============================================================================

INSERT INTO settings (key, value) VALUES
    ('receipt_auto_verify_enabled', '1')
ON CONFLICT(key) DO UPDATE SET
    value = '1',
    updated_at = CURRENT_TIMESTAMP;
