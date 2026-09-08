-- 011_bank_receipt_verification.sql
-- Ethiopian Bank Receipt Verification Engine Schema
-- Implements Phase 1 (ADR-001) & Phase 2 (types.ts & OpenAPI) Specifications.
--
-- Upgrades receipt_evidence with explicit foreign keys, normalized references,
-- verification audit status, and security gate evaluation payloads.
-- Introduces bank_verification_audits for granular per-attempt telemetry.
-- Enforces Core Anti-Replay constraint via partial unique indexes at the SQLite storage layer.

-- 1. Rebuild receipt_evidence table with foreign keys and verification fields
CREATE TABLE receipt_evidence_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank TEXT NOT NULL DEFAULT 'unknown' CHECK (bank IN ('cbe', 'telebirr', 'abyssinia', 'unknown')),
    source TEXT NOT NULL DEFAULT 'sms' CHECK (source IN (
        'telegram_photo',
        'telegram_document',
        'webapp_upload',
        'sms_forward',
        'sms',
        'manual_admin_entry'
    )),
    raw_text TEXT,
    amount_etb INTEGER,
    reference TEXT,
    normalized_reference TEXT,
    matched INTEGER NOT NULL DEFAULT 0 CHECK (matched IN (0, 1)),
    verified_amount_etb INTEGER,
    beneficiary_account TEXT,
    security_gate_passed INTEGER NOT NULL DEFAULT 0 CHECK (security_gate_passed IN (0, 1)),
    security_gate_evaluations TEXT,
    status TEXT NOT NULL DEFAULT 'pending_manual_review' CHECK (status IN (
        'auto_verified',
        'pending_manual_review',
        'rejected',
        'upstream_failure'
    )),
    error_code TEXT,
    raw_bank_payload TEXT,
    file_path TEXT,
    file_hash TEXT,
    mime_type TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Copy forward existing records from legacy receipt_evidence.
-- Normalize reference strings and retain historical timestamps.
INSERT INTO receipt_evidence_new (
    id, order_id, user_id, bank, source, raw_text, amount_etb, reference,
    normalized_reference, matched, created_at, updated_at
)
SELECT
    id,
    order_id,
    user_id,
    'unknown' AS bank,
    source,
    raw_text,
    amount_etb,
    reference,
    CASE
        WHEN reference IS NOT NULL AND TRIM(reference) != ''
        THEN UPPER(TRIM(reference))
        ELSE NULL
    END AS normalized_reference,
    COALESCE(matched, 0),
    created_at,
    created_at AS updated_at
FROM receipt_evidence;

DROP TABLE receipt_evidence;
ALTER TABLE receipt_evidence_new RENAME TO receipt_evidence;

-- 2. Core Anti-Replay Constraint & Targeted Indexes on receipt_evidence
-- STRUCTURAL BACKSTOP: Prevents double-spending of identical transaction references
-- where matched = 1 across all writers at the database storage engine layer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_evidence_anti_replay
    ON receipt_evidence(bank, reference COLLATE NOCASE)
    WHERE matched = 1 AND reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_evidence_normalized_anti_replay
    ON receipt_evidence(bank, normalized_reference)
    WHERE matched = 1 AND normalized_reference IS NOT NULL;

-- High-speed lookups by order, user, reference, and timestamps
CREATE INDEX IF NOT EXISTS idx_receipt_evidence_order
    ON receipt_evidence(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_evidence_reference
    ON receipt_evidence(reference COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_receipt_evidence_normalized_ref
    ON receipt_evidence(normalized_reference);

CREATE INDEX IF NOT EXISTS idx_receipt_evidence_user
    ON receipt_evidence(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_evidence_status
    ON receipt_evidence(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_evidence_created
    ON receipt_evidence(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_evidence_file_hash
    ON receipt_evidence(file_hash)
    WHERE file_hash IS NOT NULL;

-- 3. Granular Bank Verification Audits Table
-- Stores attempt-level telemetry, upstream bank HTML/DOM snapshots, and security pillar gates.
CREATE TABLE IF NOT EXISTS bank_verification_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evidence_id INTEGER REFERENCES receipt_evidence(id) ON DELETE SET NULL,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank TEXT NOT NULL CHECK (bank IN ('cbe', 'telebirr', 'abyssinia', 'unknown')),
    raw_reference TEXT,
    normalized_reference TEXT NOT NULL,
    order_amount_etb INTEGER NOT NULL,
    verified_amount_etb INTEGER,
    fee_etb INTEGER DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'ETB',
    sender_name TEXT,
    sender_identifier TEXT,
    beneficiary_account TEXT,
    beneficiary_name TEXT,
    transaction_timestamp DATETIME,
    payment_channel TEXT,
    security_gate_passed INTEGER NOT NULL DEFAULT 0 CHECK (security_gate_passed IN (0, 1)),
    security_gate_evaluations TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'auto_verified',
        'pending_manual_review',
        'rejected',
        'upstream_failure'
    )),
    error_code TEXT,
    error_detail TEXT,
    raw_bank_payload TEXT,
    raw_evidence_snippet TEXT,
    http_status INTEGER,
    latency_ms INTEGER,
    ip_address TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    verified_by TEXT NOT NULL DEFAULT 'engine',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bank_audits_order
    ON bank_verification_audits(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_audits_evidence
    ON bank_verification_audits(evidence_id);

CREATE INDEX IF NOT EXISTS idx_bank_audits_ref
    ON bank_verification_audits(bank, normalized_reference);

CREATE INDEX IF NOT EXISTS idx_bank_audits_user
    ON bank_verification_audits(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_audits_status
    ON bank_verification_audits(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_audits_created
    ON bank_verification_audits(created_at DESC);

-- 4. Default System Settings for Bank Verification Engine
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
    ('receipt_abyssinia_beneficiaries', '["0000000000000"]')
ON CONFLICT(key) DO NOTHING;
