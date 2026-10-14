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
/**
 * Settings whose `value` column holds an AES-256-GCM envelope and that must
 * never leave the process in an API response.
 *
 * Two distinct guarantees are implemented here, and they are not the same
 * thing:
 *
 *   1. SENSITIVITY — the denylist below. Enforced by `getAdminVisibleSettings()`
 *      so the value never reaches a browser, a PUT payload or an audit row.
 *   2. ENCRYPTION — `settings.is_secret`, maintained in migration 015 and
 *      enforced by `secrets.service.ts`, so a credential can only be written
 *      through `setSecret()` and only read through `getSecret()`.
 *
 * A key belongs here if it is EITHER sensitive OR encrypted. The keys carrying
 * `*_api_key`, `*_api_secret`, `*_webhook_secret` and `*_wallet_seed` are
 * encrypted; the two legacy rows below are sensitive but still hold plaintext
 * from before migration 015, which `decryptSecret()` passes through unchanged so
 * they keep working without a forced rotation.
 *
 * This denylist is deliberately the inverse of `PUBLIC_SETTING_KEYS`, which is
 * the allow-list served to unauthenticated Mini App clients: a key must appear
 * in exactly one of them, never both. Adding a secret here does not make it
 * public; adding it to `PUBLIC_SETTING_KEYS` would defeat this entirely.
 */
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  // Legacy: sensitive, stored plaintext (pre-dates encryption)
  'download_link_secret',
  'receipt_ethiopia_proxy_url',
  // Verification platform credentials
  'verify_links_api_key',
  'verify_verifyet_api_key',
  // Fulfillment provider credentials
  'provider_gramix_api_key',
  'provider_catfee_api_key',
  'provider_catfee_api_secret',
  'provider_mystars_api_key',
  'provider_mystars_webhook_secret',
  // TON hot-wallet seed. The single most sensitive row in the table: leaking it
  // drains the wallet, and it is only reachable through getSecret().
  'provider_mystars_wallet_seed',
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
  /** Every encrypted key except the proxy, keyed by setting name. */
  [key: string]: SecretSettingStatus;
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
 * honestly — an operator must be able to confirm *which* credential is live
 * without the credential ever entering a browser, a PUT payload, or an audit
 * row.
 *
 * `secretStatus` is generated from `SECRET_SETTING_KEYS` rather than hardcoded,
 * so registering a new secret key cannot be forgotten here. The proxy keeps its
 * `endpoint` field (a credential-free `host[:port]`, which is the one piece of
 * useful diagnostic info it has); the remaining keys report `configured` only,
 * because their last-4 characters are already the whole point of a mask and
 * `sanitizeProxyEndpoint` has no meaningful analogue for them.
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
  const secretStatus: AdminSettingsSecretStatus = {
    receipt_ethiopia_proxy_url: {
      configured: proxy.trim().length > 0,
      endpoint: sanitizeProxyEndpoint(proxy),
    },
  };

  for (const key of SECRET_SETTING_KEYS) {
    if (key === 'receipt_ethiopia_proxy_url') continue;
    secretStatus[key] = { configured: (all[key] ?? '').trim().length > 0, endpoint: '' };
  }

  return { settings, secretStatus };
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
  // ── Payment rebuild: method toggles ───────────────────────────────────────
  // Admin-controlled on/off switches. OFF hides the method in the bot and the
  // mini app and makes `POST /api/orders` reject it; in-flight orders on a
  // since-disabled rail still verify and fulfil (plan D4).
  'payment_method_cbe_enabled',
  'payment_method_telebirr_enabled',
  'payment_method_stars_enabled',
  // ── Payment rebuild: encrypted credentials ────────────────────────────────
  // Registered here for the SAME reason as `download_link_secret` above: the
  // dashboard GET filters them out of the response, but a tab opened before the
  // filter shipped still holds them in React state and will PUT them back.
  // Registering keeps that round-trip a 200 instead of an HTTP 400 that takes
  // out every unrelated settings save.
  //
  // Registration does NOT make them writable through this endpoint.
  // `PUT /api/admin/settings` strips every key in `SECRET_SETTING_KEYS` before
  // validating, so a credential can only be written through the dedicated
  // `settings.security`-gated routes in `secrets.service.ts`. Do not add an admin
  // UI control for them here and never add them to PUBLIC_SETTING_KEYS.
  'verify_links_api_key',
  'verify_verifyet_api_key',
  'provider_gramix_api_key',
  'provider_catfee_api_key',
  'provider_catfee_api_secret',
  'provider_mystars_api_key',
  'provider_mystars_webhook_secret',
  'provider_mystars_wallet_seed',
  // ── Payment rebuild: verification lanes ───────────────────────────────────
  // Credential keys (verify_links_api_key, verify_verifyet_api_key, etc.) are
  // registered in SECRET_SETTING_KEYS above. They must ALSO be listed here or
  // `PUT /api/admin/settings` rejects the entire request — see the note on
  // `download_link_secret` for why an unregistered key breaks every save.
  'verify_links_enabled',
  'verify_verifyet_enabled',
  'verify_cheki_enabled',
  'verify_request_timeout_ms',
  // JSON arrays of lane ids. They ship with `direct` FIRST so a deploy does not
  // change behaviour on day one: the hosted lanes sit behind it, inert, until
  // the Owner reorders them from the admin surface after each live-test gate.
  'verify_lane_order_cbe',
  'verify_lane_order_telebirr',
  // The direct Telebirr scraper is RETAINED as a disabled last lane. links.et,
  // verify.et and this adapter all read the same Ethio Telecom receipt page, so
  // they share one point of failure — when Ethio Telecom changes a label, all
  // three break at once. A 4th path that runs behind an Ethiopian proxy costs
  // nothing and restores verification in minutes when that happens.
  'telebirr_direct_enabled',
  // ── Payment rebuild: fulfillment providers ───────────────────────────────
  'provider_gramix_enabled',
  'provider_catfee_enabled',
  'provider_mystars_enabled',
  'provider_cascade_order',
  'provider_float_cap_usdt',
]);

/** Lane ids accepted inside `verify_lane_order_*`. */
export const VERIFICATION_LANE_IDS: ReadonlySet<string> = new Set([
  'direct',
  'links',
  'verifyet',
  'cheki',
]);

/** Provider ids accepted inside `provider_cascade_order`. */
export const FULFILLMENT_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'gramix',
  'catfee',
  'mystars',
  'istar',
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
  // ── Payment rebuild keys that carry a validation rule below ───────────────
  // The encrypted credential keys are deliberately NOT here: they have no
  // format rule (any non-empty string is a valid credential) and they cannot
  // reach this function anyway, because `PUT /api/admin/settings` strips
  // SECRET_SETTING_KEYS before validating and the dedicated routes in
  // secrets.service.ts do not call through here.
  'payment_method_cbe_enabled',
  'payment_method_telebirr_enabled',
  'payment_method_stars_enabled',
  'verify_links_enabled',
  'verify_verifyet_enabled',
  'verify_cheki_enabled',
  'verify_request_timeout_ms',
  'verify_lane_order_cbe',
  'verify_lane_order_telebirr',
  'telebirr_direct_enabled',
  'provider_gramix_enabled',
  'provider_catfee_enabled',
  'provider_mystars_enabled',
  'provider_cascade_order',
  'provider_float_cap_usdt',
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
  // ── Payment rebuild defaults ───────────────────────────────────────────────
  // These mirror migration 015 exactly. When the two ever disagree, the
  // migration is authoritative for an EXISTING database (its ON CONFLICT DO
  // NOTHING means a stored operator value always wins) and this map is
  // authoritative for a FRESH one, where seed.ts applies after migrations run.
  payment_method_cbe_enabled: '1',
  payment_method_telebirr_enabled: '1',
  payment_method_stars_enabled: '1',
  verify_links_enabled: '0',
  verify_verifyet_enabled: '0',
  verify_cheki_enabled: '1',
  verify_request_timeout_ms: '30000',
  // `direct` first on purpose: a deploy must not change verification behaviour
  // before any hosted lane has passed its live-test gate.
  verify_lane_order_cbe: '["direct","links","cheki"]',
  verify_lane_order_telebirr: '["direct","links","verifyet"]',
  telebirr_direct_enabled: '0',
  provider_gramix_enabled: '1',
  provider_catfee_enabled: '0',
  provider_mystars_enabled: '0',
  provider_cascade_order: '["gramix","catfee","mystars"]',
  provider_float_cap_usdt: '50',
};

export interface VerificationSettingsValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate a JSON array of ordered ids (a lane order or a cascade order).
 *
 * Empty is allowed and means "not configured yet" — the reading code falls back
 * to its shipped default in that case, so rejecting `[]` would only block a
 * half-finished configuration in the dashboard.
 *
 * An unknown id is REJECTED rather than silently dropped. Silently dropping it
 * would leave the operator believing they have a working fallback when the
 * cascade has quietly lost a slot, and that would only surface during an
 * outage — the worst possible moment to discover it.
 */
function validateOrderedIdList(
  raw: string,
  allowed: ReadonlySet<string>,
  key: string,
  errors: string[]
): void {
  if (raw === '') return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push(`${key} contains invalid JSON`);
    return;
  }

  if (!Array.isArray(parsed)) {
    errors.push(`${key} must be a JSON array of id strings`);
    return;
  }

  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== 'string') {
      errors.push(`${key} must contain only strings, received ${typeof entry}`);
      continue;
    }
    if (!allowed.has(entry)) {
      errors.push(
        `${key} contains unknown id "${entry}". Valid ids: ${[...allowed].sort().join(', ')}`
      );
      continue;
    }
    if (seen.has(entry)) {
      errors.push(`${key} lists "${entry}" more than once`);
      continue;
    }
    seen.add(entry);
  }
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

      // ── Payment rebuild: toggles ───────────────────────────────────────────
      // Booleans are validated here rather than being accepted blindly,
      // because a typo'd toggle value has to resolve to a definite state. The
      // accepted set matches `getBooleanSetting`, so the two never disagree.
      case 'payment_method_cbe_enabled':
      case 'payment_method_telebirr_enabled':
      case 'payment_method_stars_enabled':
      case 'verify_links_enabled':
      case 'verify_verifyet_enabled':
      case 'verify_cheki_enabled':
      case 'telebirr_direct_enabled':
      case 'provider_gramix_enabled':
      case 'provider_catfee_enabled':
      case 'provider_mystars_enabled': {
        const lower = strVal.toLowerCase();
        if (!['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(lower)) {
          errors.push(
            `${key} must be a boolean (1/0, true/false, yes/no, on/off) — received "${strVal}"`
          );
        }
        break;
      }

      // ── Payment rebuild: lane + cascade ordering ───────────────────────────
      // An unknown id is rejected rather than ignored. Silently dropping it
      // would leave the operator believing they have a working fallback when
      // the cascade has quietly lost a slot — the failure would only surface
      // during an outage, which is the worst time to discover it.
      case 'verify_lane_order_cbe':
      case 'verify_lane_order_telebirr': {
        validateOrderedIdList(strVal, VERIFICATION_LANE_IDS, key, errors);
        break;
      }

      case 'provider_cascade_order': {
        validateOrderedIdList(strVal, FULFILLMENT_PROVIDER_IDS, key, errors);
        break;
      }

      case 'verify_request_timeout_ms': {
        const num = Number(strVal);
        // Upper bound is deliberately generous: links.et documents an upstream
        // slot of up to ~30s, and a timeout below that produces false outages
        // that trip the breaker on a healthy provider.
        if (!Number.isInteger(num) || num < 1000 || num > 120000) {
          errors.push(
            `${key} must be an integer between 1000 and 120000 milliseconds (received: "${strVal}")`
          );
        }
        break;
      }

      case 'provider_float_cap_usdt': {
        const num = Number(strVal);
        if (!Number.isFinite(num) || num < 0 || num > 100000) {
          errors.push(
            `${key} must be a number between 0 and 100000 USDT (received: "${strVal}")`
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
