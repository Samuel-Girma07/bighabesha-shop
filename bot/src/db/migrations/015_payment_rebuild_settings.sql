-- ============================================================================
-- Migration 015: Payment Rebuild — secrets at rest, audit trail, new config
-- ============================================================================
--
-- Three things land here:
--
--   1. `settings.is_secret` — marks a row whose `value` column holds an
--      AES-256-GCM envelope (`enc:v1:<iv>:<tag>:<ct>`) produced by
--      secrets.service.ts. This is a STORAGE ENCODING flag, not a sensitivity
--      flag. Sensitivity lives in `SECRET_SETTING_KEYS`
--      (settings.service.ts) and is enforced at the API boundary. The two
--      concerns are separate on purpose: a row can be sensitive without being
--      encrypted yet, and only `is_secret = 1` rows may be read through
--      `getSecret()`.
--
--   2. `settings.audit` -> `settings_audit` — one row per secret or toggle
--      mutation, holding the MASKED value only. This is deliberately a separate
--      table from `audit_logs`: `audit_logs.changes` is an opaque JSON blob, so
--      "show me every time the links.et key changed" is not answerable from it.
--      Key rotation history needs to be queryable per key and age out on its
--      own retention clock.
--
--   3. The configuration keys for the verification lane chain, the payment
--      method toggles and the fulfillment cascade. Every one ships DISABLED or
--      inert until its live-test gate passes (plan D7). Nothing here changes
--      live behaviour: `receipt_auto_verify_enabled` is deliberately NOT touched,
--      and the recency-window tightening is a GATE change that ships in Phase 1
--      with the rest of the gate work, not in a config migration.
--
-- Note on the two pre-existing secrets: `download_link_secret` and
-- `receipt_ethiopia_proxy_url` are marked `is_secret = 1` but their stored
-- `value` is still plaintext from before this migration. `decryptSecret()`
-- passes a non-envelope value through unchanged and logs once, so they keep
-- working without a forced rotation. Any subsequent write through `setSecret()`
-- stores real ciphertext.
--
-- `provider_mystars_wallet_seed` is stored here for the same reason and is the
-- single most sensitive row in the table: it is a TON hot-wallet private key.
-- Losing `SECRET_ENCRYPTION_KEY` makes every secret on this page permanently
-- unreadable, including that seed.

-- ---------------------------------------------------------------------------
-- 1. Secret-flag columns
-- ---------------------------------------------------------------------------

ALTER TABLE settings ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN rotated_at DATETIME;

-- Backfill the two secrets that predate this column.
UPDATE settings SET is_secret = 1
WHERE key IN ('download_link_secret', 'receipt_ethiopia_proxy_url');

-- ---------------------------------------------------------------------------
-- 2. Audit trail for settings mutations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settings_audit (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id     INTEGER NOT NULL,
    key          TEXT NOT NULL,
    -- 'set' | 'clear' | 'rotate' | 'forced' | 'seed'
    action       TEXT NOT NULL,
    -- Last 4 characters at most. Never the plaintext.
    masked_value TEXT,
    ip           TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_key_time
    ON settings_audit(key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_admin_time
    ON settings_audit(admin_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Configuration keys
-- ---------------------------------------------------------------------------
--
-- ON CONFLICT DO NOTHING, not DO UPDATE: an operator who has already tuned a
-- value must not have it silently reset by a deploy. New keys appear; existing
-- ones are left alone. This matches how 012 and 013 seed defaults.

INSERT INTO settings (key, value, is_secret) VALUES
    -- Payment method toggles ---------------------------------------------
    ('payment_method_cbe_enabled',       '1', 0),
    ('payment_method_telebirr_enabled',  '1', 0),
    ('payment_method_stars_enabled',     '1', 0),

    -- Verification lanes -------------------------------------------------
    -- Default lane order starts with `direct` so that behaviour on deploy day
    -- is identical to today. The hosted lanes are appended behind it and are
    -- inert until enabled AND reordered from the admin surface.
    ('verify_links_enabled',             '0', 0),
    ('verify_links_api_key',             '',  1),
    ('verify_verifyet_enabled',          '0', 0),
    ('verify_verifyet_api_key',          '',  1),
    ('verify_cheki_enabled',             '1', 0),
    ('verify_request_timeout_ms',        '30000', 0),
    ('verify_lane_order_cbe',            '["direct","links","cheki"]', 0),
    ('verify_lane_order_telebirr',       '["direct","links","verifyet"]', 0),
    -- The direct Telebirr scraper is RETAINED as a disabled last lane. links.et,
    -- verify.et and this adapter all read the same Ethio Telecom page, so they
    -- share a single point of failure; keeping a 4th path costs nothing.
    ('telebirr_direct_enabled',          '0', 0),

    -- Fulfillment providers ----------------------------------------------
    ('provider_gramix_enabled',          '1', 0),
    ('provider_gramix_api_key',          '',  1),
    ('provider_catfee_enabled',          '0', 0),
    ('provider_catfee_api_key',          '',  1),
    ('provider_catfee_api_secret',       '',  1),
    ('provider_mystars_enabled',         '0', 0),
    ('provider_mystars_api_key',         '',  1),
    ('provider_mystars_webhook_secret',  '',  1),
    -- TON hot-wallet seed. Encrypted at rest like every other secret. There is
    -- no env-var fallback for this one by design: a seed that lives in a
    -- process environment is a seed that ends up in a deploy log.
    ('provider_mystars_wallet_seed',     '',  1),
    ('provider_cascade_order',           '["gramix","catfee","mystars"]', 0),
    ('provider_float_cap_usdt',          '50', 0)
ON CONFLICT(key) DO NOTHING;

-- Record what this migration introduced so the audit trail has a starting row
-- for every secret it created a placeholder for.
INSERT INTO settings_audit (admin_id, key, action, masked_value, ip)
SELECT
    0,
    key,
    'seed',
    '(empty)',
    'migration:015'
FROM settings
WHERE is_secret = 1
  AND value = ''
  AND key IN (
      'verify_links_api_key',
      'verify_verifyet_api_key',
      'provider_gramix_api_key',
      'provider_catfee_api_key',
      'provider_catfee_api_secret',
      'provider_mystars_api_key',
      'provider_mystars_webhook_secret',
      'provider_mystars_wallet_seed'
  );
