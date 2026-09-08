import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';

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
    logger.info({ key, value }, 'Setting updated successfully');
  } catch (err) {
    logger.error({ err, key, value }, 'Failed to set setting in database');
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
    logger.error({ err, settings }, 'Failed to batch update settings in database');
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
  // Analytics assumptions
  'restock_lead_days',
  'restock_safety_days',
  'chapa_fee_pct',
  'wallet_gas_bps',
  // Ethiopian Bank Receipt Verification Engine
  'receipt_auto_verify_enabled',
  'receipt_recency_before_mins',
  'receipt_recency_after_mins',
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
]);

export function isKnownSettingKey(key: string): boolean {
  return KNOWN_SETTING_KEYS.has(key);
}

/**
 * Canonical registry of the 18 settings that govern the Ethiopian Bank Receipt
 * Verification Engine and multi-rail payment configurations in the Admin Dashboard.
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
    if (!VERIFICATION_SETTING_KEYS.has(key) && key !== 'receipt_cbe_port') continue;

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
        if (strVal && !/^(https?|socks5):\/\/[^\s]+$/.test(strVal)) {
          errors.push(`receipt_ethiopia_proxy_url must be empty or a valid HTTP/HTTPS/SOCKS5 URI`);
        }
        break;
      }

      case 'receipt_cbe_port': {
        if (strVal !== '100' && strVal !== '443') {
          errors.push(`receipt_cbe_port must be either "100" or "443" (received: "${strVal}")`);
        }
        break;
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
