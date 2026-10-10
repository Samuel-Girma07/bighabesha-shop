import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { createApiServer } from '../src/api/server.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createReceiptDownloadToken } from '../src/services/download_tokens.service.js';
import { isKnownSettingKey, setSetting } from '../src/services/settings.service.js';

/**
 * Regression guard for the admin settings round-trip.
 *
 * `GET /api/admin/settings` returns every row in the `settings` table, and the
 * dashboard PUTs that whole object straight back. So any key that is *stored* but
 * not registered in `KNOWN_SETTING_KEYS` makes the server reject the entire
 * request with HTTP 400 — which silently breaks EVERY settings save (the auto-
 * verification switch, merchant account numbers, FX rate, beneficiary whitelists)
 * while the UI gives no indication that anything went wrong.
 *
 * This has now happened twice:
 *   1. `receipt_cbe_port`  — docs/security/PHASE-7-DASHBOARD-SECURITY-REPORT.md:125
 *   2. `download_link_secret` — created at runtime by download_tokens.service.ts
 *
 * Both times the only allow-list was a hand-maintained set, and no test ever
 * performed the round-trip the real dashboard performs. These two tests close
 * that gap: one asserts the invariant at the storage layer, one asserts the
 * actual HTTP behaviour end to end.
 *
 * The same trap now applies to the RETIREMENT of `receipt_cbe_port`: the key is
 * dead code but a live row, so it must stay registered. See the last describe.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

let server: http.Server;
let port: number;
let adminToken: string;

const ADMIN_TG_ID = 12345;
const ADMIN_SESSION_TOKEN = 'test_admin_token_abcdef1234567890abcdef1234567890abcdef12345678901234';

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

function readAllSettingKeys(): string[] {
  return (getDatabase().prepare('SELECT key FROM settings').all() as { key: string }[]).map((r) => r.key);
}

function readSetting(key: string): string | undefined {
  return (getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)
    ?.value;
}

async function getSettings(): Promise<Record<string, string>> {
  const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { settings: Record<string, string> };
  return body.settings;
}

async function putSettings(settings: Record<string, string>): Promise<Response> {
  return fetch(`http://localhost:${port}/api/admin/settings`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
}

// ---------------------------------------------------------------------------
// Invariant: nothing may live in the settings table that the PUT endpoint
// would reject. This is the check that would have caught both incidents.
// ---------------------------------------------------------------------------

describe('Settings storage invariant: every stored key is a known key', () => {
  it('registers download_link_secret, the runtime-generated download signing secret', () => {
    // Drive the real creation path rather than inserting the row by hand, so
    // the test breaks if that service ever changes the key it writes.
    createReceiptDownloadToken('ORD-INVARIANT-1');

    expect(readSetting('download_link_secret')).toBeTruthy();
    expect(isKnownSettingKey('download_link_secret')).toBe(true);
  });

  it('accepts every key present in the settings table', () => {
    // Create the secret so the table mirrors a live deployment.
    createReceiptDownloadToken('ORD-INVARIANT-2');

    const keys = readAllSettingKeys();
    expect(keys.length).toBeGreaterThan(0);

    const unregistered = keys.filter((k) => !isKnownSettingKey(k));
    expect(
      unregistered,
      `Unregistered settings key(s) would make every admin settings save fail with HTTP 400: ${unregistered.join(', ')}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Behaviour: the exact GET -> PUT round-trip the admin dashboard performs.
// ---------------------------------------------------------------------------

describe('Admin settings GET -> PUT round-trip', () => {
  it('accepts the unmodified payload the dashboard received from GET', async () => {
    // This is the real-world trigger. The secret exists in the table, so a naive
    // GET would return it and the dashboard would dutifully send it back with the
    // rest of the form - which is how it used to reach both the browser and the
    // audit log on every single save. The GET is now filtered, so the payload the
    // dashboard holds contains no secret at all.
    createReceiptDownloadToken('ORD-ROUNDTRIP-1');

    const fetched = await getSettings();
    expect(fetched.download_link_secret).toBeUndefined();
    expect(fetched.receipt_ethiopia_proxy_url).toBeUndefined();

    const res = await putSettings(fetched);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { success: boolean; settings: Record<string, string> };
    expect(body.success).toBe(true);
    // The PUT response is filtered too: this one leaked on every save and is the
    // easiest of the three to forget about.
    expect(body.settings.download_link_secret).toBeUndefined();
    expect(body.settings.receipt_ethiopia_proxy_url).toBeUndefined();
  });

  it('persists a toggled auto-verification switch through the round-trip', async () => {
    createReceiptDownloadToken('ORD-ROUNDTRIP-2');

    const fetched = await getSettings();
    expect(fetched.receipt_auto_verify_enabled).toBe('0');

    const res = await putSettings({ ...fetched, receipt_auto_verify_enabled: '1' });
    expect(res.status, await res.clone().text()).toBe(200);

    expect(readSetting('receipt_auto_verify_enabled')).toBe('1');
  });

  it('leaves the download secret untouched by a dashboard round-trip', async () => {
    createReceiptDownloadToken('ORD-ROUNDTRIP-3');
    const original = readSetting('download_link_secret');
    expect(original).toBeTruthy();

    // The dashboard echoes back exactly what GET returned. Now that GET omits the
    // secret, "untouched" has a stronger guarantee than before: the round-trip can
    // no longer overwrite it even with a stale value, because no value is sent. A
    // rotating secret would invalidate every outstanding download link.
    const fetched = await getSettings();
    const res = await putSettings(fetched);
    expect(res.status, await res.clone().text()).toBe(200);

    expect(readSetting('download_link_secret')).toBe(original);
  });

  it('ignores a download_link_secret echoed by a stale dashboard tab instead of rejecting', async () => {
    createReceiptDownloadToken('ORD-ROUNDTRIP-4');
    const original = readSetting('download_link_secret');

    // The incident this file exists for: a tab that was open before the GET filter
    // shipped still holds the old value in React state and WILL send it back. A 400
    // here would take out every settings save - the auto-verification switch,
    // account numbers, FX rate, whitelists - with no hint as to why.
    const res = await putSettings({ etb_per_usd: '135', download_link_secret: original });
    expect(res.status, await res.clone().text()).toBe(200);

    // Ignored, not rejected: the save lands and the secret is not overwritten.
    expect(readSetting('etb_per_usd')).toBe('135');
    expect(readSetting('download_link_secret')).toBe(original);
  });

  it('still rejects genuinely unknown keys', async () => {
    // The typo-shadow guard must survive the fix; otherwise any typo would be
    // silently stored and shadow nothing while the real knob kept its old value.
    const res = await putSettings({ etb_per_USD: '999' });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('etb_per_USD');
  });
});

// ---------------------------------------------------------------------------
// The retired `receipt_cbe_port` key: dead, but still a live row in production.
//
// `receipt_cbe_port` selected the ingress port of the legacy `apps.cbe.com.et`
// portal flow, which has been retired. Its dashboard control and its validation
// rule are gone; the KEY deliberately is not, because every live database that
// ever had that control clicked still holds the row, `GET /api/admin/settings`
// returns it, and the dashboard PUTs the whole object straight back.
//
// Deregistering the key would therefore reproduce, for a setting nobody reads,
// the exact outage documented at the top of this file: HTTP 400 on every save,
// taking out the auto-verification switch, merchant account numbers, FX rate and
// whitelists along with it.
// ---------------------------------------------------------------------------

describe('Retired receipt_cbe_port stays round-trip safe', () => {
  it('is accepted, and persisted, when a stored "100" is echoed back', async () => {
    // Exactly the live-database state: the row exists, nothing reads it.
    setSetting('receipt_cbe_port', '100');

    const fetched = await getSettings();
    expect(fetched.receipt_cbe_port).toBe('100');

    // The dashboard save the operator actually performs.
    const res = await putSettings({ ...fetched, etb_per_usd: '132' });
    expect(res.status, await res.clone().text()).toBe(200);

    // The unrelated edit landed, proving the request was not silently rejected.
    expect(readSetting('etb_per_usd')).toBe('132');
    expect(readSetting('receipt_cbe_port')).toBe('100');
  });

  it('still passes the unknown-key gate, which is the guard that would 400', () => {
    expect(isKnownSettingKey('receipt_cbe_port')).toBe(true);
  });
});
