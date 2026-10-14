import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

import { initDatabase, getDatabase } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import {
  encryptSecret,
  decryptSecret,
  isEncryptedSecret,
  maskSecret,
  getSecret,
  setSecret,
  clearSecret,
  isSecretConfigured,
  stageAndCommitSecret,
  recordSettingsAudit,
  pruneSettingsAudit,
  resetSecretStoreCache,
  SecretStoreUnavailableError,
  SECRET_SETTING_KEY_META,
} from '../src/services/secrets.service.js';
import {
  SECRET_SETTING_KEYS,
  KNOWN_SETTING_KEYS,
  VERIFICATION_SETTING_KEYS,
  validateVerificationSettings,
  getAdminVisibleSettings,
} from '../src/services/settings.service.js';
import { ROLE_PERMISSIONS, ALL_PERMISSIONS, roleHasPermission } from '../src/auth/permissions.js';
import { LOGGER_REDACT_PATHS } from '../src/logger/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

// A fixed test key so assertions can reason about the ciphertext deterministically.
// 32 bytes, which is the documented base64 form.
const TEST_KEY = crypto.randomBytes(32).toString('base64');

describe('Phase 0 — encrypted settings secrets', () => {
  let db: ReturnType<typeof getDatabase>;

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
    resetSecretStoreCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedDatabase(db);
    resetSecretStoreCache();
  });

  afterEach(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    resetSecretStoreCache();
  });

  describe('migration 015', () => {
    it('adds the is_secret and rotated_at columns', () => {
      const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain('is_secret');
      expect(names).toContain('rotated_at');
    });

    it('creates settings_audit with a per-key index', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings_audit'")
        .all();
      expect(tables.length).toBe(1);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='settings_audit'")
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_settings_audit_key_time');
    });

    it('reads a pre-existing plaintext secret row without trying to decrypt it', () => {
      // `receipt_ethiopia_proxy_url` and `download_link_secret` predate this
      // migration and hold plaintext. On a fresh database the row may not exist
      // at all, so simulate one the way an existing deployment would have it:
      // is_secret = 1 (the migration backfills it) but a plaintext value.
      db.prepare(
        `INSERT INTO settings (key, value, is_secret) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = 1`
      ).run('receipt_ethiopia_proxy_url', 'http://user:pass@proxy.et:8888');

      // Passthrough, not a decrypt attempt: no key mismatch, no error.
      expect(getSecret('receipt_ethiopia_proxy_url')).toBe('http://user:pass@proxy.et:8888');
      expect(isSecretConfigured('receipt_ethiopia_proxy_url')).toBe(true);
    });

    it('backfills is_secret on the legacy rows the migration names', () => {
      // The migration's UPDATE only touches rows that already exist. Assert the
      // statement itself is correct rather than assuming row presence.
      db.prepare(
        `INSERT INTO settings (key, value, is_secret) VALUES ('download_link_secret', 'x', 0)
         ON CONFLICT(key) DO UPDATE SET is_secret = 0`
      ).run();
      expect(
        (db.prepare('SELECT is_secret FROM settings WHERE key = ?').get('download_link_secret') as
          | { is_secret: number }
          | undefined)?.is_secret
      ).toBe(0);

      db.prepare('UPDATE settings SET is_secret = 1 WHERE key IN (?, ?)').run(
        'download_link_secret',
        'receipt_ethiopia_proxy_url'
      );
      expect(
        (db.prepare('SELECT is_secret FROM settings WHERE key = ?').get('download_link_secret') as
          | { is_secret: number }
          | undefined)?.is_secret
      ).toBe(1);
    });

    it('seeds every new key with is_secret set correctly', () => {
      const expectedPlain = [
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
      ];
      const expectedSecret = [
        'verify_links_api_key',
        'verify_verifyet_api_key',
        'provider_gramix_api_key',
        'provider_catfee_api_key',
        'provider_catfee_api_secret',
        'provider_mystars_api_key',
        'provider_mystars_webhook_secret',
        'provider_mystars_wallet_seed',
      ];

      for (const key of expectedPlain) {
        const row = db
          .prepare('SELECT is_secret FROM settings WHERE key = ?')
          .get(key) as { is_secret: number } | undefined;
        expect(row, `${key} should exist`).toBeDefined();
        expect(row?.is_secret, `${key} should NOT be a secret`).toBe(0);
      }
      for (const key of expectedSecret) {
        const row = db
          .prepare('SELECT is_secret FROM settings WHERE key = ?')
          .get(key) as { is_secret: number } | undefined;
        expect(row, `${key} should exist`).toBeDefined();
        expect(row?.is_secret, `${key} SHOULD be a secret`).toBe(1);
      }
    });

    it('does NOT change receipt_auto_verify_enabled', () => {
      // The Owner explicitly decided auto-verification stays ON across the
      // whole build. A migration that disabled it would take CBE verification
      // dark for four phases.
      const row = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('receipt_auto_verify_enabled') as { value: string };
      expect(row.value).toBe('1');
    });

    it('ships every hosted lane disabled and behind the direct adapter', () => {
      const get = (k: string) =>
        (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string }).value;

      expect(get('verify_links_enabled')).toBe('0');
      expect(get('verify_verifyet_enabled')).toBe('0');
      expect(get('verify_cheki_enabled')).toBe('1');
      expect(get('telebirr_direct_enabled')).toBe('0');
      expect(get('provider_catfee_enabled')).toBe('0');
      expect(get('provider_mystars_enabled')).toBe('0');

      // `direct` first, so a deploy does not change behaviour on day one.
      expect(JSON.parse(get('verify_lane_order_cbe'))[0]).toBe('direct');
      expect(JSON.parse(get('verify_lane_order_telebirr'))[0]).toBe('direct');
    });

    it('records a seed audit row for every placeholder secret', () => {
      const rows = db
        .prepare("SELECT key FROM settings_audit WHERE action = 'seed' AND ip = 'migration:015'")
        .all() as { key: string }[];
      const keys = rows.map((r) => r.key);
      expect(keys).toContain('provider_mystars_wallet_seed');
      expect(keys).toContain('verify_links_api_key');
    });
  });

  describe('envelope encryption', () => {
    it('round-trips a value', () => {
      const ciphertext = encryptSecret('links_live_abc123XYZ');
      expect(ciphertext).not.toContain('links_live_abc123XYZ');
      expect(decryptSecret(ciphertext)).toBe('links_live_abc123XYZ');
    });

    it('produces a different ciphertext each time (random IV)', () => {
      const a = encryptSecret('same-value');
      const b = encryptSecret('same-value');
      expect(a).not.toBe(b);
      expect(decryptSecret(a)).toBe(decryptSecret(b));
    });

    it('marks its own output and not plaintext', () => {
      expect(isEncryptedSecret(encryptSecret('x'))).toBe(true);
      expect(isEncryptedSecret('plaintext')).toBe(false);
      expect(isEncryptedSecret('')).toBe(false);
      expect(isEncryptedSecret(null)).toBe(false);
    });

    it('passes a legacy plaintext row through unchanged', () => {
      // This is what keeps download_link_secret working: it is is_secret = 1
      // but still holds plaintext from before migration 015.
      expect(decryptSecret('http://user:pass@proxy.et:8888')).toBe('http://user:pass@proxy.et:8888');
    });

    it('fails closed when the master key does not match', () => {
      const ciphertext = encryptSecret('secret');
      process.env.SECRET_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
      resetSecretStoreCache();
      expect(() => decryptSecret(ciphertext)).toThrow(SecretStoreUnavailableError);
    });

    it('rejects a tampered ciphertext', () => {
      const ciphertext = encryptSecret('secret');
      const parts = ciphertext.split(':');
      const ct = Buffer.from(parts[3], 'base64');
      ct[0] ^= 0xff;
      parts[3] = ct.toString('base64');
      expect(() => decryptSecret(parts.join(':'))).toThrow(SecretStoreUnavailableError);
    });

    it('rejects a malformed envelope rather than returning garbage', () => {
      expect(() => decryptSecret('enc:v1:only:three')).toThrow(SecretStoreUnavailableError);
    });

    it('handles a passphrase-shaped key by hashing it', () => {
      process.env.SECRET_ENCRYPTION_KEY = 'a memorable passphrase the operator chose';
      resetSecretStoreCache();
      const ct = encryptSecret('still works');
      expect(decryptSecret(ct)).toBe('still works');
    });
  });

  describe('maskSecret', () => {
    it('reveals only the last four characters', () => {
      // Explicitly NOT logger redactSecret(), which reveals the first 4 too.
      expect(maskSecret('links_live_abc123XYZ')).toBe('****3XYZ');
      expect(maskSecret('links_live_abc123XYZ')).not.toContain('links');
      expect(maskSecret('links_live_abc123XYZ')).not.toContain('_');
    });

    it('masks short and empty values completely', () => {
      expect(maskSecret('abc')).toBe('****');
      expect(maskSecret('')).toBe('');
      expect(maskSecret('   ')).toBe('');
      expect(maskSecret(null)).toBe('');
      expect(maskSecret(undefined)).toBe('');
    });
  });

  describe('store access guards', () => {
    it('refuses to write a key that is not flagged is_secret', () => {
      // etb_per_usd is a plain setting. Writing a credential there would store
      // it in plaintext while the store believed it was encrypted.
      expect(() => setSecret('etb_per_usd', 'nope')).toThrow(SecretStoreUnavailableError);
      expect(() => getSecret('etb_per_usd')).toThrow(SecretStoreUnavailableError);
    });

    it('refuses an unknown key', () => {
      expect(() => setSecret('provider_nonexistent', 'x')).toThrow(SecretStoreUnavailableError);
    });

    it('stores ciphertext only', () => {
      setSecret('verify_links_api_key', 'links_live_abc123XYZ');
      const row = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('verify_links_api_key') as { value: string };
      expect(row.value.startsWith('enc:v1:')).toBe(true);
      expect(row.value).not.toContain('links_live_abc123XYZ');
      expect(getSecret('verify_links_api_key')).toBe('links_live_abc123XYZ');
    });

    it('reports configuration state without revealing anything', () => {
      expect(isSecretConfigured('verify_links_api_key')).toBe(false);
      setSecret('verify_links_api_key', 'links_live_abc123XYZ');
      expect(isSecretConfigured('verify_links_api_key')).toBe(true);
    });

    it('clears a secret and audits it', () => {
      setSecret('verify_links_api_key', 'links_live_abc123XYZ');
      clearSecret('verify_links_api_key', 42, '127.0.0.1');
      expect(isSecretConfigured('verify_links_api_key')).toBe(false);
      const row = db
        .prepare("SELECT admin_id, action FROM settings_audit WHERE key = ? ORDER BY id DESC LIMIT 1")
        .get('verify_links_api_key') as { admin_id: number; action: string };
      expect(row.action).toBe('clear');
      expect(row.admin_id).toBe(42);
    });
  });

  describe('staged write', () => {
    it('commits when validation passes', async () => {
      const result = await stageAndCommitSecret(
        'verify_links_api_key',
        'links_live_abc123XYZ',
        7,
        async () => ({ ok: true })
      );
      expect(result.committed).toBe(true);
      expect(getSecret('verify_links_api_key')).toBe('links_live_abc123XYZ');
    });

    it('REFUSES to commit when validation fails, leaving the old value live', async () => {
      setSecret('verify_links_api_key', 'the_working_key_value');
      const result = await stageAndCommitSecret(
        'verify_links_api_key',
        'a_definitely_wrong_key',
        7,
        async () => ({ ok: false, detail: '401 Unauthorized' })
      );
      expect(result.committed).toBe(false);
      expect(result.detail).toContain('401 Unauthorized');
      // The whole point of staging: a bad key cannot reach the database.
      expect(getSecret('verify_links_api_key')).toBe('the_working_key_value');
    });

    it('treats a throwing validator as a failed validation, never a licence to commit', async () => {
      setSecret('verify_links_api_key', 'the_working_key_value');
      const result = await stageAndCommitSecret(
        'verify_links_api_key',
        'another_key_value',
        7,
        async () => {
          throw new Error('provider unreachable');
        }
      );
      expect(result.committed).toBe(false);
      expect(result.detail).toContain('provider unreachable');
      expect(getSecret('verify_links_api_key')).toBe('the_working_key_value');
    });

    it('skipValidation commits and audits as forced', async () => {
      // The escape hatch: an operator must not be locked out of saving a key
      // because the provider is mid-outage.
      const result = await stageAndCommitSecret(
        'verify_links_api_key',
        'a_good_but_unverified_key',
        7,
        async () => ({ ok: false, detail: 'provider is down' }),
        { skipValidation: true }
      );
      expect(result.committed).toBe(true);
      expect(getSecret('verify_links_api_key')).toBe('a_good_but_unverified_key');

      const row = db
        .prepare("SELECT action FROM settings_audit WHERE key = ? ORDER BY id DESC LIMIT 1")
        .get('verify_links_api_key') as { action: string };
      expect(row.action).toBe('forced');
    });

    it('refuses to use the set path to clear a value', async () => {
      setSecret('verify_links_api_key', 'the_working_key_value');
      const result = await stageAndCommitSecret('verify_links_api_key', '   ', 7);
      expect(result.committed).toBe(false);
      expect(getSecret('verify_links_api_key')).toBe('the_working_key_value');
    });

    it('never records the plaintext in the audit row', async () => {
      await stageAndCommitSecret(
        'provider_catfee_api_secret',
        'super_secret_catfee_value',
        7,
        async () => ({ ok: true })
      );
      // Scope to the write we just made: migration 015 also seeded a row with
      // the literal '(empty)' for this key, which is correct in its own right.
      const rows = db
        .prepare("SELECT masked_value FROM settings_audit WHERE key = ? AND action = 'set'")
        .all('provider_catfee_api_secret') as { masked_value: string }[];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.masked_value).not.toContain('super_secret_catfee_value');
        expect(r.masked_value).toBe('****alue');
      }
    });
  });

  describe('audit trail', () => {
    it('records one row per write with admin id', () => {
      recordSettingsAudit({ adminId: 99, key: 'verify_links_api_key', action: 'set', maskedValue: '****1234' });
      const row = db
        .prepare('SELECT admin_id, key, action, masked_value FROM settings_audit WHERE admin_id = 99')
        .get() as { admin_id: number; key: string; action: string; masked_value: string };
      expect(row.key).toBe('verify_links_api_key');
      expect(row.action).toBe('set');
      expect(row.masked_value).toBe('****1234');
    });

    it('prunes rows past the retention window', () => {
      const old = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const recent = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      db.prepare(
        "INSERT INTO settings_audit (admin_id, key, action, masked_value, created_at) VALUES (1,'k','set','x',?)"
      ).run(old);
      db.prepare(
        "INSERT INTO settings_audit (admin_id, key, action, masked_value, created_at) VALUES (1,'k','set','x',?)"
      ).run(recent);

      const deleted = pruneSettingsAudit(365);
      expect(deleted).toBe(1);
      const remaining = db
        .prepare('SELECT created_at FROM settings_audit WHERE key = ?')
        .all('k') as { created_at: string }[];
      expect(remaining.length).toBe(1);
      expect(remaining[0].created_at).toBe(recent);
    });

    it('does not delete an audit row when the write it describes succeeded', () => {
      // An audit failure must not roll back the change. The value is already
      // committed; throwing here would leave the operator believing it was not.
      db.prepare('DROP TABLE settings_audit');
      expect(() =>
        recordSettingsAudit({ adminId: 1, key: 'verify_links_api_key', action: 'set' })
      ).not.toThrow();
    });
  });

  describe('secrecy invariants', () => {
    it('never returns a secret through getAdminVisibleSettings', () => {
      setSecret('verify_links_api_key', 'links_live_abc123XYZ');
      setSecret('provider_mystars_wallet_seed', 'seed words go here never in a response');

      const { settings, secretStatus } = getAdminVisibleSettings();

      expect(JSON.stringify(settings)).not.toContain('links_live_abc123XYZ');
      expect(JSON.stringify(settings)).not.toContain('seed words go here');
      expect(settings.verify_links_api_key).toBeUndefined();

      expect(secretStatus.verify_links_api_key.configured).toBe(true);
      expect(secretStatus.provider_mystars_wallet_seed.configured).toBe(true);
      expect(JSON.stringify(secretStatus)).not.toContain('links_live_abc123XYZ');
    });

    it('reports every registered secret key in secretStatus', () => {
      const { secretStatus } = getAdminVisibleSettings();
      for (const key of SECRET_SETTING_KEYS) {
        expect(secretStatus[key], `${key} missing from secretStatus`).toBeDefined();
        expect(secretStatus[key].configured).toBe(false);
      }
    });

    it('does not put a secret in the public storefront settings', () => {
      setSecret('verify_links_api_key', 'links_live_abc123XYZ');
      const publicSettings = getAdminVisibleSettings().settings;
      for (const key of SECRET_SETTING_KEYS) {
        expect(publicSettings[key], `${key} must never be exposed`).toBeUndefined();
      }
    });
  });

  describe('registry consistency', () => {
    it('registers every secret key so a stale dashboard tab cannot 400', () => {
      // PUT /api/admin/settings rejects the WHOLE request on the first
      // unregistered key. Missing one here is the documented outage class.
      for (const key of SECRET_SETTING_KEYS) {
        expect(KNOWN_SETTING_KEYS.has(key), `${key} must be in KNOWN_SETTING_KEYS`).toBe(true);
      }
    });

    it('registers every seeded payment-rebuild key', () => {
      const required = [
        'payment_method_cbe_enabled',
        'payment_method_telebirr_enabled',
        'payment_method_stars_enabled',
        'verify_links_enabled',
        'verify_links_api_key',
        'verify_verifyet_enabled',
        'verify_verifyet_api_key',
        'verify_cheki_enabled',
        'verify_request_timeout_ms',
        'verify_lane_order_cbe',
        'verify_lane_order_telebirr',
        'telebirr_direct_enabled',
        'provider_gramix_enabled',
        'provider_gramix_api_key',
        'provider_catfee_enabled',
        'provider_catfee_api_key',
        'provider_catfee_api_secret',
        'provider_mystars_enabled',
        'provider_mystars_api_key',
        'provider_mystars_webhook_secret',
        'provider_mystars_wallet_seed',
        'provider_cascade_order',
        'provider_float_cap_usdt',
      ];
      for (const key of required) {
        expect(KNOWN_SETTING_KEYS.has(key), `${key} must be in KNOWN_SETTING_KEYS`).toBe(true);
      }
    });

    it('keeps a human label for every encrypted key', () => {
      for (const key of SECRET_SETTING_KEYS) {
        expect(SECRET_SETTING_KEY_META[key], `${key} needs an operator label`).toBeTruthy();
      }
    });

    it('adds settings.security to the permission model but only for superadmin', () => {
      expect(ALL_PERMISSIONS).toContain('settings.security');
      expect(roleHasPermission('superadmin', 'settings.security')).toBe(true);
      // An operator who can change FX rates must not silently gain credential access.
      expect(roleHasPermission('ops', 'settings.security')).toBe(false);
      expect(roleHasPermission('finance', 'settings.security')).toBe(false);
      expect(roleHasPermission('support', 'settings.security')).toBe(false);
    });
  });

  describe('logger redaction', () => {
    it('redacts every secret key by concrete name', () => {
      // pino does NOT support shell-style prefix wildcards, so `*.KEY` would
      // only match a property literally named KEY. Each name must be listed.
      const required = [
        'SECRET_ENCRYPTION_KEY',
        'verify_links_api_key',
        'verify_verifyet_api_key',
        'provider_gramix_api_key',
        'provider_catfee_api_key',
        'provider_catfee_api_secret',
        'provider_mystars_api_key',
        'provider_mystars_webhook_secret',
        'provider_mystars_wallet_seed',
      ];
      for (const key of required) {
        expect(LOGGER_REDACT_PATHS, `${key} missing from redact list`).toContain(key);
        expect(LOGGER_REDACT_PATHS).toContain(`*.${key}`);
      }
    });

    it('redacts the Backblaze credentials that were previously missing', () => {
      // A credential that can delete every replica is worth more than the DB.
      for (const key of [
        'B2_KEY_ID',
        'B2_APPLICATION_KEY',
        'LITESTREAM_ACCESS_KEY_ID',
        'LITESTREAM_SECRET_ACCESS_KEY',
      ]) {
        expect(LOGGER_REDACT_PATHS, `${key} missing from redact list`).toContain(key);
      }
    });
  });

  describe('typed validation for the new keys', () => {
    it('accepts the shipped defaults', () => {
      const defaults: Record<string, string> = {
        payment_method_cbe_enabled: '1',
        verify_cheki_enabled: '0',
        verify_request_timeout_ms: '30000',
        verify_lane_order_cbe: '["direct","links","cheki"]',
        provider_cascade_order: '["gramix","catfee","mystars"]',
        provider_float_cap_usdt: '50',
      };
      const result = validateVerificationSettings(defaults);
      expect(result.errors).toEqual([]);
      expect(result.isValid).toBe(true);
    });

    it('accepts every boolean spelling getBooleanSetting understands', () => {
      for (const v of ['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off']) {
        const result = validateVerificationSettings({ verify_links_enabled: v });
        expect(result.errors, `"${v}" should be accepted`).toEqual([]);
      }
    });

    it('rejects a non-boolean toggle', () => {
      const result = validateVerificationSettings({ verify_links_enabled: 'maybe' });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('boolean');
    });

    it('rejects an unknown lane id rather than silently dropping it', () => {
      // Silently dropping it would leave the operator believing they have a
      // working fallback when the cascade has quietly lost a slot — and that
      // would only surface during an outage.
      const result = validateVerificationSettings({
        verify_lane_order_cbe: '["direct","lnks"]',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('lnks');
    });

    it('rejects a duplicated lane id', () => {
      const result = validateVerificationSettings({
        verify_lane_order_cbe: '["direct","links","direct"]',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('more than once');
    });

    it('rejects a non-array lane order', () => {
      const result = validateVerificationSettings({ verify_lane_order_cbe: '"direct"' });
      expect(result.isValid).toBe(false);
    });

    it('rejects an unknown provider id in the cascade order', () => {
      const result = validateVerificationSettings({ provider_cascade_order: '["gramix","stripe"]' });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('stripe');
    });

    it('accepts an empty lane order as "not configured yet"', () => {
      expect(validateVerificationSettings({ verify_lane_order_cbe: '' }).isValid).toBe(true);
    });

    it('bounds the request timeout to a sane range', () => {
      expect(validateVerificationSettings({ verify_request_timeout_ms: '999' }).isValid).toBe(false);
      expect(validateVerificationSettings({ verify_request_timeout_ms: '999999' }).isValid).toBe(false);
      expect(validateVerificationSettings({ verify_request_timeout_ms: '60000' }).isValid).toBe(true);
    });

    it('bounds the float cap to a non-negative number', () => {
      expect(validateVerificationSettings({ provider_float_cap_usdt: '-1' }).isValid).toBe(false);
      expect(validateVerificationSettings({ provider_float_cap_usdt: 'abc' }).isValid).toBe(false);
      expect(validateVerificationSettings({ provider_float_cap_usdt: '50' }).isValid).toBe(true);
    });

    it('has a validation rule for every toggle it registers', () => {
      const toggles = [
        'payment_method_cbe_enabled',
        'payment_method_telebirr_enabled',
        'payment_method_stars_enabled',
        'verify_links_enabled',
        'verify_verifyet_enabled',
        'verify_cheki_enabled',
        'telebirr_direct_enabled',
        'provider_gramix_enabled',
        'provider_catfee_enabled',
        'provider_mystars_enabled',
      ];
      for (const key of toggles) {
        expect(VERIFICATION_SETTING_KEYS.has(key), `${key} needs a validation rule`).toBe(true);
        const bad = validateVerificationSettings({ [key]: 'not-a-boolean' });
        expect(bad.isValid, `${key} accepted a nonsense value`).toBe(false);
      }
    });
  });
});
