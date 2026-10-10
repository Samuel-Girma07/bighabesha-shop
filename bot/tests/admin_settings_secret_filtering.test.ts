import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { createApiServer } from '../src/api/server.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createReceiptDownloadToken } from '../src/services/download_tokens.service.js';
import { SECRET_SETTING_KEYS, getAdminVisibleSettings } from '../src/services/settings.service.js';
import { sanitizeProxyEndpoint } from '../src/logger/index.js';

/**
 * Settings-secret containment.
 *
 * `settings.read` is held by superadmin, ops AND finance, and `GET
 * /api/admin/settings` used to return every row in the table. Two of those rows
 * are secrets:
 *
 *   - `download_link_secret` - the HMAC key `download_tokens.service.ts`
 *     generates for itself. It signs every receipt download link.
 *   - `receipt_ethiopia_proxy_url` - an egress proxy URI embedding `user:pass`.
 *
 * So the value used to reach three places it should never have: the browser of
 * every admin role, the `PUT` echo response, and - worst of all - the
 * `audit_logs` table, where `JSON.stringify(entry.changes)` wrote it verbatim on
 * every save and Litestream replicated it to Backblaze B2 indefinitely.
 *
 * These tests pin all three.
 *
 * NOTE ON FIXTURES: every credential below is syntactically valid but
 * fabricated. Nothing here is a real proxy account, bank reference, or secret.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

let server: http.Server;
let port: number;
let adminToken: string;

const ADMIN_TG_ID = 12345;
const ADMIN_SESSION_TOKEN = 'test_admin_token_abcdef1234567890abcdef1234567890abcdef12345678901234';

/** Fabricated credentials - shaped like the real thing, owned by nobody. */
const FAKE_PROXY_PASSWORD = 'notarealproxysecret';
const FAKE_PROXY_USER = 'shop-egress-fixture';
const FAKE_PROXY_URL = `http://${FAKE_PROXY_USER}:${FAKE_PROXY_PASSWORD}@proxy.example-et.invalid:8888`;
const FAKE_PROXY_ENDPOINT = 'proxy.example-et.invalid:8888';

function seedAdminSession(): void {
  const db = getDatabase();
  db.prepare(
    'INSERT OR IGNORE INTO users (id, first_name, username, is_registered) VALUES (?, ?, ?, 1)'
  ).run(ADMIN_TG_ID, 'Admin', 'admin_boss');
  db.prepare(
    'INSERT OR REPLACE INTO admins (tg_user_id, role, is_active, created_by) VALUES (?, ?, 1, ?)'
  ).run(ADMIN_TG_ID, 'superadmin', 'test');
  db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(
    ADMIN_SESSION_TOKEN,
    ADMIN_TG_ID,
    Date.now() + 3_600_000
  );
  adminToken = ADMIN_SESSION_TOKEN;
}

const mockBot = {
  api: {
    getFile: async () => {
      throw new Error('Telegram file not found');
    },
    sendMessage: async () => ({}),
  },
} as any;

beforeEach(async () => {
  process.env.ADMIN_IDS = String(ADMIN_TG_ID);
  process.env.ADMIN_PASSWORD = 'TestPassword123!';
  process.env.BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
  initDatabase(':memory:', migrationsDir);
  seedAdminSession();
  server = createApiServer(mockBot);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
});

function readSetting(key: string): string | undefined {
  return (getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)
    ?.value;
}

function writeSetting(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .run(key, value);
}

async function getSettingsRaw(): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  return { status: res.status, body: await res.json() };
}

async function putSettings(settings: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  return { status: res.status, body: await res.json() };
}

function readAuditChanges(action: string): string | null {
  const row = getDatabase()
    .prepare('SELECT changes FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1')
    .get(action) as { changes: string | null } | undefined;
  return row?.changes ?? null;
}

// ---------------------------------------------------------------------------
// Denylist shape
// ---------------------------------------------------------------------------

describe('SECRET_SETTING_KEYS', () => {
  it('covers both known secrets and stays disjoint from the public allow-list', async () => {
    expect(SECRET_SETTING_KEYS.has('download_link_secret')).toBe(true);
    expect(SECRET_SETTING_KEYS.has('receipt_ethiopia_proxy_url')).toBe(true);

    // The public allow-list is served to UNAUTHENTICATED Mini App clients. A key
    // present in both sets would defeat the denylist entirely, so assert the two
    // can never overlap rather than trusting a reviewer to remember.
    const { getPublicSettings } = await import('../src/services/settings.service.js');
    const publicKeys = Object.keys(getPublicSettings());
    for (const key of SECRET_SETTING_KEYS) {
      expect(publicKeys).not.toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/settings
// ---------------------------------------------------------------------------

describe('GET /api/admin/settings excludes secrets', () => {
  it('omits download_link_secret and receipt_ethiopia_proxy_url', async () => {
    // Drive the real creation path so the test breaks if the service ever renames
    // the key it writes.
    createReceiptDownloadToken('ORD-SECRET-1');
    writeSetting('receipt_ethiopia_proxy_url', FAKE_PROXY_URL);

    const { status, body } = await getSettingsRaw();

    expect(status).toBe(200);
    expect(body.settings).toBeDefined();
    expect(body.settings.download_link_secret).toBeUndefined();
    expect(body.settings.receipt_ethiopia_proxy_url).toBeUndefined();

    // And the raw credential must not appear anywhere in the serialised body -
    // catches a leak through some other key or a duplicated field.
    expect(JSON.stringify(body)).not.toContain(FAKE_PROXY_PASSWORD);
    expect(JSON.stringify(body)).not.toContain(readSetting('download_link_secret') as string);
  });

  it('still returns the ordinary settings the dashboard depends on', async () => {
    const { status, body } = await getSettingsRaw();

    expect(status).toBe(200);
    expect(body.settings.receipt_auto_verify_enabled).toBe('0');
    expect(body.settings.etb_per_usd).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// secretStatus: enough to render the field, not enough to leak it
// ---------------------------------------------------------------------------

describe('secretStatus', () => {
  it('reports configured=false and an empty endpoint when nothing is stored', async () => {
    const { body } = await getSettingsRaw();

    expect(body.secretStatus.receipt_ethiopia_proxy_url).toEqual({ configured: false, endpoint: '' });
  });

  it('reports configured=true with a credential-free endpoint', async () => {
    writeSetting('receipt_ethiopia_proxy_url', FAKE_PROXY_URL);

    const { body } = await getSettingsRaw();

    expect(body.secretStatus.receipt_ethiopia_proxy_url).toEqual({
      configured: true,
      endpoint: FAKE_PROXY_ENDPOINT,
    });

    // The operator learns which proxy is live without learning the password.
    expect(JSON.stringify(body.secretStatus)).not.toContain(FAKE_PROXY_PASSWORD);
    expect(JSON.stringify(body.secretStatus)).not.toContain(FAKE_PROXY_USER);
  });

  it('survives a malformed proxy URI without throwing', async () => {
    // A malformed value must degrade to a harmless string. `sanitizeProxyEndpoint`
    // is string-based precisely so that `new URL()` cannot throw here and dump the
    // raw value through some fallback path - this function is on the path of every
    // settings read, so an exception would take the whole dashboard down.
    const malformed = 'ht!tp://:::not a uri at all@@';
    writeSetting('receipt_ethiopia_proxy_url', malformed);

    // No try/catch on purpose: an exception here fails the test outright, which is
    // the point. `sanitizeProxyEndpoint` is string-based precisely so that
    // `new URL()` cannot throw and dump the raw value through some fallback path -
    // this read sits on the path of every settings load, so a throw would take
    // the whole dashboard down.
    const { status, body } = await getSettingsRaw();

    expect(status).toBe(200);
    expect(body.secretStatus.receipt_ethiopia_proxy_url.configured).toBe(true);
    expect(body.secretStatus.receipt_ethiopia_proxy_url.endpoint).not.toContain('@');
    expect(JSON.stringify(body)).not.toContain('not a uri at all');

    // Same guarantee at the unit level, including the defensive empty-return
    // branch when a userinfo separator survives stripping.
    expect(sanitizeProxyEndpoint(malformed)).not.toContain('@');
    expect(sanitizeProxyEndpoint(null)).toBe('');
    expect(sanitizeProxyEndpoint(undefined)).toBe('');
    expect(sanitizeProxyEndpoint('')).toBe('');
  });

  it('keeps getAdminVisibleSettings() consistent with the endpoint helper', async () => {
    writeSetting('receipt_ethiopia_proxy_url', FAKE_PROXY_URL);
    createReceiptDownloadToken('ORD-SECRET-2');

    const visible = getAdminVisibleSettings();

    expect(visible.secretStatus.receipt_ethiopia_proxy_url.endpoint).toBe(
      sanitizeProxyEndpoint(FAKE_PROXY_URL)
    );
    for (const key of SECRET_SETTING_KEYS) {
      expect(visible.settings[key]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/settings
// ---------------------------------------------------------------------------

describe('PUT /api/admin/settings', () => {
  it('excludes both secrets from its response body', async () => {
    createReceiptDownloadToken('ORD-SECRET-3');
    writeSetting('receipt_ethiopia_proxy_url', FAKE_PROXY_URL);

    const { status, body } = await putSettings({ etb_per_usd: '135' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.settings.download_link_secret).toBeUndefined();
    expect(body.settings.receipt_ethiopia_proxy_url).toBeUndefined();
    expect(body.secretStatus.receipt_ethiopia_proxy_url).toEqual({
      configured: true,
      endpoint: FAKE_PROXY_ENDPOINT,
    });

    // The echo response is the easiest of the three vectors to miss, because the
    // happy path looks identical to the leaking version.
    expect(JSON.stringify(body)).not.toContain(FAKE_PROXY_PASSWORD);
  });

  it('ignores a download_link_secret in the payload with 200 and no write', async () => {
    createReceiptDownloadToken('ORD-SECRET-4');
    const original = readSetting('download_link_secret') as string;
    expect(original).toBeTruthy();

    const { status, body } = await putSettings({
      etb_per_usd: '135',
      // Deliberately a DIFFERENT value from the stored one: if this were
      // persisted the assertion below would catch it, so the test fails either way
      // rather than passing because the value happened to match.
      download_link_secret: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    });

    // 200, not 400. Rejecting is the incident this whole file is named after.
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // The other key in the same payload still persisted: this is an ignore, not
    // a rejection of the whole request.
    expect(readSetting('etb_per_usd')).toBe('135');
    expect(readSetting('download_link_secret')).toBe(original);
  });

  it('accepts a proxy write and reports the new state without echoing it', async () => {
    const { status, body } = await putSettings({ receipt_ethiopia_proxy_url: FAKE_PROXY_URL });

    expect(status).toBe(200);
    expect(readSetting('receipt_ethiopia_proxy_url')).toBe(FAKE_PROXY_URL);
    expect(body.settings.receipt_ethiopia_proxy_url).toBeUndefined();
    expect(body.secretStatus.receipt_ethiopia_proxy_url).toEqual({
      configured: true,
      endpoint: FAKE_PROXY_ENDPOINT,
    });
  });

  it('still rejects an unknown key, so the typo-shadow guard survives', async () => {
    const { status, body } = await putSettings({ etb_per_USD: '999' });

    expect(status).toBe(400);
    expect(body.error).toContain('etb_per_USD');
  });
});

// ---------------------------------------------------------------------------
// audit_logs: the permanently-replicated copy
// ---------------------------------------------------------------------------

describe('audit redaction at the recordAudit choke point', () => {
  it('writes no proxy credential into audit_logs for a settings save', async () => {
    const { status } = await putSettings({
      etb_per_usd: '135',
      receipt_ethiopia_proxy_url: FAKE_PROXY_URL,
    });
    expect(status).toBe(200);

    const changes = readAuditChanges('settings.update');
    expect(changes).toBeTruthy();

    // The password, the username, and the raw URI must all be absent.
    expect(changes).not.toContain(FAKE_PROXY_PASSWORD);
    expect(changes).not.toContain(FAKE_PROXY_USER);
    expect(changes).not.toContain(FAKE_PROXY_URL);

    // The audit record still explains what happened, and stays correlatable with
    // the logs: the key is present, reduced to the codebase's standard preview.
    const parsed = JSON.parse(changes as string);
    expect(Object.keys(parsed)).toContain('receipt_ethiopia_proxy_url');
    expect(parsed.receipt_ethiopia_proxy_url).toContain(FAKE_PROXY_URL.slice(0, 4));
    expect(parsed.receipt_ethiopia_proxy_url).toContain(String(FAKE_PROXY_URL.length));
    // Non-secret keys are untouched.
    expect(parsed.etb_per_usd).toBe('135');
  });

  it('writes no raw download_link_secret into audit_logs', async () => {
    createReceiptDownloadToken('ORD-SECRET-5');
    const secret = readSetting('download_link_secret') as string;

    // Simulates a stale dashboard tab echoing the secret it still holds.
    const { status } = await putSettings({ etb_per_usd: '140', download_link_secret: secret });
    expect(status).toBe(200);

    const changes = readAuditChanges('settings.update') as string;
    expect(changes).not.toContain(secret);
    // Stripped before the audit call, so the key is not even listed as changed.
    expect(JSON.parse(changes)).not.toHaveProperty('download_link_secret');
  });

  it('does not echo a proxy credential into the changed-keys target_id', async () => {
    await putSettings({ receipt_ethiopia_proxy_url: FAKE_PROXY_URL });

    const row = getDatabase()
      .prepare('SELECT target_id FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1')
      .get('settings.update') as { target_id: string };

    expect(row.target_id).toBe('receipt_ethiopia_proxy_url');
    expect(row.target_id).not.toContain(FAKE_PROXY_PASSWORD);
  });
});