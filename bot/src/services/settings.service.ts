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
  'etb_per_star',
  'stars_min',
  'stars_max',
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
  'etb_per_star',
  'fallback_ton_usd',
  'margin_pct',
  'stars_min',
  'stars_max',
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
  'stars_cashout_pct',
  'wallet_gas_bps',
]);

export function isKnownSettingKey(key: string): boolean {
  return KNOWN_SETTING_KEYS.has(key);
}
