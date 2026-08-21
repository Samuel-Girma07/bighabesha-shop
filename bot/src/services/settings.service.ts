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
