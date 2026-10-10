import { getDatabase } from '../db/index.js';
import { logger, redactSecret, sanitizeProxyEndpoint } from '../logger/index.js';

export interface SettingItem {
  key: string;
  value: string;
  updated_at: string;
}

export function getSetting(key: string, defaultValue: string = ''): string {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  } catch (err) {
    logger.error({ err, key }, 'Failed to get setting from database');
    return defaultValue;
  }
}

export function getNumericSetting(key: string, defaultValue: number): number {
  const val = getSetting(key, String(defaultValue));
  const parsed = Number(val);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function getBooleanSetting(key: string, defaultValue: boolean): boolean {
  const val = getSetting(key, defaultValue ? '1' : '0');
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on') return true;
    if (lower === '0' || lower === 'false' || lower === 'no' || lower === 'off') return false;
  }
  return defaultValue;
}

export function setSetting(key: string, value: string): void {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
    // Never log the raw value: settings include credentials such as
    // `receipt_ethiopia_proxy_url` (which embeds user:pass) and beneficiary
    // account lists. The key stays plain so log lines remain correlatable.
    logger.info({ key, valuePreview: redactSecret(value) }, 'Setting updated successfully');
  } catch (err) {
    logger.error({ err, key, valuePreview: redactSecret(value) }, 'Failed to set setting in database');
    throw err;
  }
}

export function setSettings(settings: Record<string, string>): void {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        stmt.run(key, String(value));
      }
    });
    tx();
    logger.info({ keys: Object.keys(settings) }, 'Settings batch updated successfully');
  } catch (err) {
    // Log key names only — the settings object can carry proxy credentials.
    logger.error({ err, keys: Object.keys(settings ?? {}) }, 'Failed to batch update settings in database');
    throw err;
  }
}

export function getAllSettings(): Record<string, string> {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch all settings');
    return {};
  }
}

/**
 * Settings that must never leave the process in an API response.
 *
 * `GET /api/admin/settings` is readable by superadmin, ops AND finance (see
 * `auth/permissions.ts` — all three hold `settings.read`), and the dashboard
 * PUTs the whole object straight back. So before this denylist existed, every
 * row in the `settings` table was handed to every one of those roles' browsers
 * and then written verbatim into `audit_logs`, which Litestream replicates to
 * Backblaze B2 indefinitely. Two of those rows are secrets:
 *
 *   - `download_link_secret` — the 32-byte HMAC key that
 *     `download_tokens.service.ts` generates for itself on first use. It signs
 *     every receipt download link, so disclosing it lets anyone mint a download
 *     token for any order without ever holding an admin session.
 *   - `receipt_ethiopia_proxy_url` — an egress proxy URI that embeds the
 *     provider's `user:pass`. That is a third party's billing identity, and it
 *     is useless for anything except reaching the proxy itself.
 *
 * This denylist is deliberately the inverse of `PUBLIC_SETTING_KEYS`, which is
 * the allow-list served to unauthenticated Mini App clients: a key must appear
 * in exactly one of them, never both. Adding a secret here does not make it
 * public; adding it to `PUBLIC_SETTING_KEYS` would defeat this entirely.
 */
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  'download_link_secret',
  'receipt_ethiopia_proxy_url',
]);

/** Non-reversible description of a write-only secret, safe for any reader. */
export interface SecretSettingStatus {
  /** Whether a value is stored. Never reveals the value itself. */
  configured: boolean;
  /** Credential-free `host[:port]`, or '' when nothing is stored. */
  endpoint: string;
}

export interface AdminSettingsSecretStatus {
  receipt_ethiopia_proxy_url: SecretSettingStatus;
}

export interface AdminVisibleSettings {
  /** Every stored setting EXCEPT `SECRET_SETTING_KEYS`. */
  settings: Record<string, string>;
  /** Write-only fields described without their values, for the dashboard. */
  secretStatus: AdminSettingsSecretStatus;
}

/**
 * The read path for the admin dashboard: the full settings map minus the
 * secret denylist, plus enough metadata to render the write-only fields
 * honestly — an operator must be able to confirm *which* proxy is live without
 * the credential ever entering a browser, a PUT payload, or an audit row.
 *
 * `endpoint` comes from `sanitizeProxyEndpoint`, which is string-based on
 * purpose: a malformed proxy URI must degrade to a harmless string instead of
 * throwing, because this function sits on the path of every settings read and
 * an exception here would take the whole dashboard down.
 *
 * Deliberately not a mutation of `getAllSettings()`: that function is also used
 * by internal callers that legitimately need the raw values (e.g. the receipt
 * verifier reading its own proxy), and narrowing it would break them.
 */
export function getAdminVisibleSettings(): AdminVisibleSettings {
  const all = getAllSettings();
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!SECRET_SETTING_KEYS.has(key)) {
      settings[key] = value;
    }
  }

  const proxy = all.receipt_ethiopia_proxy_url ?? '';
  return {
    settings,
    secretStatus: {
      receipt_ethiopia_proxy_url: {
        configured: proxy.trim().length > 0,
        endpoint: sanitizeProxyEndpoint(proxy),
      },
    },
  };
}

/**
 * Settings that are safe to expose to unauthenticated Mini App clients.
 * Deliberately excludes operational secrets: margin_pct, etb_per_usd,
 * low_stock_threshold, gemini_instructions, and any future private keys.
 */
const PUBLIC_SETTING_KEYS = new Set([
  'cbe_account',
  'cbe_name',
  'telebirr_account',
  'telebirr_name',
  'abyssinia_account',
  'abyssinia_name',
  // Display-currency conversion + growth/loyalty transparency
  'etb_per_usd',
  'tier_silver_etb',
  'tier_gold_etb',
  'tier_discount_silver_pct',
  'tier_discount_gold_pct',
  'referral_l1_pct',
  'support_username',
]);

export function getPublicSettings(): Record<string, string> {
  const all = getAllSettings();
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    if (PUBLIC_SETTING_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Canonical registry of every setting the application reads. The admin
 * dashboard PUT endpoint rejects writes for keys outside this set — a typo
 * like "etb_per_USD" would otherwise silently shadow the real key and flip
 * pricing behavior with no error anywhere.
 *
 * Keep in sync with seed.ts defaults and getSetting/getNumericSetting calls.
 */
export const KNOWN_SETTING_KEYS: ReadonlySet<string> = new Set([
  // Pricing & FX
  'etb_per_usd',
  'fallback_ton_usd',
  'margin_pct',
  // Manual rail payment accounts
  'cbe_account',
  'cbe_name',
  'telebirr_account',
  'telebirr_name',
  'abyssinia_account',
  'abyssinia_name',
  // Operations
  'low_stock_threshold',
  'gemini_instructions',
  'support_username',
  // Growth / loyalty / lifecycle
  'referral_l1_pct',
  'referral_l2_pct',
  'tier_silver_etb',
  'tier_gold_etb',
  'tier_discount_silver_pct',
  'tier_discount_gold_pct',
  'recovery_reminder_hours',
  'order_ttl_hours',
  'pending_approval_ttl_hours',
  // Analytics assumptions
  'restock_lead_days',
  'restock_safety_days',
  'chapa_fee_pct',
  'wallet_gas_bps',
  // Ethiopian Bank Receipt Verification Engine
  'receipt_auto_verify_enabled',
  'receipt_recency_before_mins',
  'receipt_recency_after_mins',
  // DEAD SETTING — RETAINED FOR ROUND-TRIP COMPATIBILITY ONLY.
  //
  // Nothing reads this. It configured the `apps.cbe.com.et:100` ingress of the
  // legacy CBE portal flow, which was retired (see the header comment in
  // `receipt_verifier/adapters/cbe.adapter.ts`); the CBE rail now talks to the
  // `mbreciept.cbe.com.et` transaction-detail API on 443 like every other rail.
  // The dashboard control is gone, and so is the validation branch — a value
  // here can no longer influence anything.
  //
  // It stays in this set because it is already stored in live databases, and
  // `GET /api/admin/settings` returns every row. `PUT /api/admin/settings`
  // rejects the WHOLE request on the first unregistered key, so deregistering it
  // would reintroduce the outage recorded for `download_link_secret` below and
  // for this very key in
  // docs/security/PHASE-7-DASHBOARD-SECURITY-REPORT.md:125 — every settings
  // save (auto-verify switch, account numbers, FX rate, whitelists) answering
  // HTTP 400 for a setting nobody reads. Ignore the value; do not add a control
  // for it.
  'receipt_cbe_port',
  'receipt_circuit_breaker_threshold',
  'receipt_circuit_breaker_cooldown_sec',
  'receipt_retention_days_raw_payloads',
  'receipt_retention_days_unverified',
  'receipt_retention_days_verified',
  'receipt_cbe_beneficiaries',
  'receipt_telebirr_beneficiaries',
  'receipt_abyssinia_beneficiaries',
  'receipt_ethiopia_proxy_url',
  // Expected credited-party NAME per rail, checked by the optional fifth
  // security pillar. Ship empty on purpose: the name Telebirr renders for this
  // shop's receiving account has not been captured yet, and a wrong value
  // would reject genuine receipts. While blank the pillar is dormant and the
  // masked-account whitelist carries the load.
  'receipt_cbe_expected_name',
  'receipt_telebirr_expected_name',
  'receipt_abyssinia_expected_name',
  // Service-owned, generated at runtime — NOT an admin-editable field.
  //
  // `download_tokens.service.ts` creates this HMAC signing secret on first use
  // and persists it through `setSetting`, which writes to the same `settings`
  // table as everything else. The admin dashboard used to GET *every* row and
  // PUT the whole object straight back, so any key present in the table but
  // absent here made `PUT /api/admin/settings` reject the entire request with
  // HTTP 400 — silently making every settings save impossible (switch, account
  // numbers, FX rate, whitelists). This is the same defect class already
  // recorded for `receipt_cbe_port` in
  // docs/security/PHASE-7-DASHBOARD-SECURITY-REPORT.md.
  //
  // It stays registered here even though the GET response now filters it out
  // (see `SECRET_SETTING_KEYS`), because a dashboard tab that was open before
  // that filter shipped still holds the old value in memory and WILL send it
  // back. Registering the key keeps that round-trip a 200; the PUT handler
  // strips the value before persisting it. Do not add an admin UI control for
  // it, and never add it to PUBLIC_SETTING_KEYS.
  'download_link_secret',
]);

export function isKnownSettingKey(key: string): boolean {
  return KNOWN_SETTING_KEYS.has(key);
}

/**
 * Canonical registry of the 18 settings that govern the Ethiopian Bank Receipt
 * Verification Engine and multi-rail payment configurations in the Admin Dashboard.
 *
 * Only keys with a validation rule below need to live here: this set gates
 * `validateVerificationSettings`, whereas `KNOWN_SETTING_KEYS` is what the PUT
 * endpoint accepts. The credited-party name keys are accepted and defaulted
 * without a format rule, so they are deliberately absent.
 */
export const VERIFICATION_SETTING_KEYS: ReadonlySet<string> = new Set([
  // Core Bank Accounts & Whitelist (6 keys)
  'cbe_account',
  'cbe_name',
  'telebirr_account',
  'telebirr_name',
  'abyssinia_account',
  'abyssinia_name',
  // Verification Pipeline & Security Gates (12 keys)
  'receipt_auto_verify_enabled',
  'receipt_recency_before_mins',
  'receipt_recency_after_mins',
  'receipt_circuit_breaker_threshold',
  'receipt_circuit_breaker_cooldown_sec',
  'receipt_retention_days_raw_payloads',
  'receipt_retention_days_unverified',
  'receipt_retention_days_verified',
  'receipt_cbe_beneficiaries',
  'receipt_telebirr_beneficiaries',
  'receipt_abyssinia_beneficiaries',
  'receipt_ethiopia_proxy_url',
]);

export const DEFAULT_VERIFICATION_SETTINGS: Readonly<Record<string, string>> = {
  cbe_account: '0000000000000',
  cbe_name: 'Bighabesha Shop',
  telebirr_account: '0000000000',
  telebirr_name: 'Bighabesha Shop',
  abyssinia_account: '0000000000000',
  abyssinia_name: 'Bighabesha Shop',
  receipt_auto_verify_enabled: '1',
  receipt_recency_before_mins: '120',
  receipt_recency_after_mins: '120',
  receipt_circuit_breaker_threshold: '5',
  receipt_circuit_breaker_cooldown_sec: '60',
  receipt_retention_days_raw_payloads: '14',
  receipt_retention_days_unverified: '30',
  receipt_retention_days_verified: '365',
  receipt_cbe_beneficiaries: '["0000000000000"]',
  receipt_telebirr_beneficiaries: '["0000000000"]',
  receipt_abyssinia_beneficiaries: '["0000000000000"]',
  receipt_ethiopia_proxy_url: '',
  // Credited-party name pillar (opt-in). Empty = pillar dormant; see the
  // `BANK_BENEFICIARY_CONFIG_MAP.expectedNameSettingKey` rationale.
  receipt_cbe_expected_name: '',
  receipt_telebirr_expected_name: '',
  receipt_abyssinia_expected_name: '',
};

export interface VerificationSettingsValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates dashboard verification settings updates before SQLite persistence.
 * Enforces numeric bounds, regex formatting for bank accounts, and JSON array integrity.
 */
export function validateVerificationSettings(
  settings: Record<string, string>
): VerificationSettingsValidationResult {
  const errors: string[] = [];

  for (const [key, val] of Object.entries(settings)) {
    // Keys with no rule below (the credited-party name keys, and the retired
    // `receipt_cbe_port`) are skipped: they are registered, so the PUT endpoint
    // accepts them, and they have no format to enforce.
    if (!VERIFICATION_SETTING_KEYS.has(key)) continue;

    const strVal = String(val).trim();

    switch (key) {
      case 'cbe_account':
        if (strVal !== '0000000000000' && !/^\d{13}$/.test(strVal)) {
          errors.push(`cbe_account must be exactly 13 digits (received: "${strVal}")`);
        }
        break;

      case 'telebirr_account':
        if (strVal !== '0000000000' && !/^(09|07|\+2519|\+2517|\d{10})\d*$/.test(strVal)) {
          errors.push(`telebirr_account must be a valid Ethiopian phone/merchant number (received: "${strVal}")`);
        }
        break;

      case 'abyssinia_account':
        if (strVal !== '0000000000000' && !/^\d{8,16}$/.test(strVal)) {
          errors.push(`abyssinia_account must be 8 to 16 digits (received: "${strVal}")`);
        }
        break;

      case 'receipt_recency_before_mins':
      case 'receipt_recency_after_mins': {
        const num = Number(strVal);
        if (!Number.isInteger(num) || num < 5 || num > 1440) {
          errors.push(`${key} must be an integer between 5 and 1440 minutes (received: "${strVal}")`);
        }
        break;
      }

      case 'receipt_circuit_breaker_threshold': {
        const num = Number(strVal);
        if (!Number.isInteger(num) || num < 2 || num > 20) {
          errors.push(`${key} must be an integer between 2 and 20 (received: "${strVal}")`);
        }
        break;
      }

      case 'receipt_circuit_breaker_cooldown_sec': {
        const num = Number(strVal);
        if (!Number.isInteger(num) || num < 10 || num > 600) {
          errors.push(`${key} must be an integer between 10 and 600 seconds (received: "${strVal}")`);
        }
        break;
      }

      case 'receipt_retention_days_raw_payloads':
      case 'receipt_retention_days_unverified':
      case 'receipt_retention_days_verified': {
        const num = Number(strVal);
        if (!Number.isInteger(num) || num < 1 || num > 3650) {
          errors.push(`${key} must be a positive integer between 1 and 3650 days (received: "${strVal}")`);
        }
        break;
      }

      case 'receipt_cbe_beneficiaries':
      case 'receipt_telebirr_beneficiaries':
      case 'receipt_abyssinia_beneficiaries': {
        if (strVal && strVal.startsWith('[')) {
          try {
            const parsed = JSON.parse(strVal);
            if (!Array.isArray(parsed)) {
              errors.push(`${key} JSON must be an array of account strings`);
            }
          } catch {
            errors.push(`${key} contains invalid JSON`);
          }
        }
        break;
      }

      case 'receipt_ethiopia_proxy_url': {
        // Only HTTP/HTTPS proxies are supported. `https-proxy-agent` does NOT
        // reject a `socks5://` URI: it constructs successfully and then speaks
        // HTTP CONNECT to it, which fails as a broken tunnel rather than
        // falling back to direct egress. Rejecting it here turns a confusing
        // geo-block at request time into an actionable configuration error.
        if (strVal && !/^https?:\/\/[^\s]+$/.test(strVal)) {
          errors.push(
            `receipt_ethiopia_proxy_url must be empty or a valid HTTP/HTTPS proxy URI (SOCKS5 is not supported: the agent cannot speak the SOCKS5 handshake and would fail as a broken tunnel)`
          );
        }
        break;
      }

      // No `receipt_cbe_port` case on purpose. The port-100 branch of the
      // legacy CBE flow is retired and nothing reads the setting, so an enum
      // check on it was validating a value with no consumer. It remains
      // registered in `KNOWN_SETTING_KEYS` (see the note there) purely so an
      // already-stored `'100'` round-trips as a 200 instead of a 400.
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
