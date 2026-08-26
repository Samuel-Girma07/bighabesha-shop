import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createApiServer } from '../src/api/server.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createOrder, submitReceipt, approveReceipt } from '../src/services/orders.service.js';
import { saveReceiptImage, resolveStoredReceiptPath } from '../src/services/receipts.service.js';
import { allocateStock } from '../src/services/stock.service.js';
import {
  createReceiptDownloadToken,
  verifyReceiptDownloadToken,
} from '../src/services/download_tokens.service.js';
import { csvCell, guardExcelString } from '../src/utils/csv.js';
import {
  startBroadcastJob,
  BroadcastBusyError,
} from '../src/services/broadcast.service.js';
import { loadEnv } from '../src/config/env.js';
import { addStockLink as addLink } from '../src/services/stock.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let server: http.Server;
let port: number;
let adminToken: string;

function seedAdminSession(): void {
  const db = getDatabase();
  db.prepare('INSERT OR IGNORE INTO users (id, first_name, username, is_registered) VALUES (?, ?, ?, 1)').run(12345, 'Admin', 'admin_boss');
  db.prepare('INSERT OR REPLACE INTO admins (tg_user_id, role, is_active, created_by) VALUES (?, ?, 1, ?)').run(12345, 'superadmin', 'test');
  adminToken = 'test_admin_token_abcdef1234567890abcdef1234567890abcdef12345678901234';
  db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(adminToken, 12345, Date.now() + 3_600_000);
}

const mockBot = {
  api: {
    getFile: async () => { throw new Error('Telegram file not found'); },
    sendMessage: async () => ({}),
  },
} as any;

beforeEach(async () => {
  process.env.ADMIN_IDS = '12345';
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

// ---------------------------------------------------------------------------
// C1 + H1: receipt storage resolution & signed download links
// ---------------------------------------------------------------------------

describe('Hardening: receipt path resolution', () => {
  it('resolves filename-only ids stored by the current upload flow', () => {
    const order = createOrder({ userId: 99, productId: 'gemini_pro_18m', amountETB: 500, paymentRail: 'cbe' });
    const saved = saveReceiptImage(PNG_1PX, order.id);
    expect(resolveStoredReceiptPath(saved.storedName)).toBeTruthy();
    // The stored name must be relative now — absolute paths were the bug.
    expect(path.isAbsolute(saved.storedName)).toBe(false);
  });

  it('still resolves legacy absolute-path rows written by earlier builds', () => {
    const order = createOrder({ userId: 99, productId: 'gemini_pro_18m', amountETB: 500, paymentRail: 'cbe' });
    const saved = saveReceiptImage(PNG_1PX, order.id);
    expect(resolveStoredReceiptPath(saved.filePath)).toBe(resolveStoredReceiptPath(saved.storedName));
  });

  it.each(['../../etc/passwd', '....//....//etc/passwd', 'C:\\Windows\\system32\\config', '', '/etc/passwd'])(
    'refuses traversal / foreign reference: %s',
    (evil) => {
      expect(resolveStoredReceiptPath(evil)).toBeNull();
    }
  );

  it('returns null for missing files and non-string ids', () => {
    expect(resolveStoredReceiptPath('receipt_does_not_exist_9x.png')).toBeNull();
    expect(resolveStoredReceiptPath(undefined)).toBeNull();
    expect(resolveStoredReceiptPath(42)).toBeNull();
  });

  it('serves a web-uploaded receipt through the dashboard endpoint end-to-end', async () => {
    const order = createOrder({ userId: 99999, productId: 'gemini_pro_18m', amountETB: 500, paymentRail: 'cbe' });
    const saved = saveReceiptImage(PNG_1PX, order.id);
    submitReceipt(order.id, saved.storedName, 'note');

    const res = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/receipt`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(50);
  });

  it('rejects traversal payloads injected into receipt_file_id with 404', async () => {
    const order = createOrder({ userId: 99999, productId: 'gemini_pro_18m', amountETB: 500, paymentRail: 'cbe' });
    submitReceipt(order.id, '../../package.json', 'evil');
    const res = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/receipt`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([404, 401]).toContain(res.status); // falls through Telegram case → 404 JSON
    if (res.status === 404) {
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    }
  });
});

describe('Hardening: signed one-time receipt links (H1)', () => {
  it('round-trips a valid token to the correct orderId', () => {
    const t = createReceiptDownloadToken('ORD-123-AB');
    const sig = t.url.split('/').pop() as string;
    const payload = decodeURIComponent(t.url.split('/')[4]);
    expect(verifyReceiptDownloadToken(payload, sig)).toBe('ORD-123-AB');
  });

  it('rejects tampered signatures and foreign orders', () => {
    const t = createReceiptDownloadToken('ORD-123-AB');
    const parts = t.url.split('/');
    const payload = decodeURIComponent(parts[4]);
    const badSig = parts[5].slice(0, -2) + (parts[5].endsWith('AA') ? 'BB' : 'AA');
    expect(verifyReceiptDownloadToken(payload, badSig)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const t = createReceiptDownloadToken('ORD-123-AB');
    const parts = t.url.split('/');
    const payload = decodeURIComponent(parts[4]);
    expect(verifyReceiptDownloadToken(payload, parts[5], Date.now() + 61_000)).toBeNull();
  });

  it('issues links via the API and serves the image WITHOUT any Bearer header', async () => {
    const order = createOrder({ userId: 99999, productId: 'gemini_pro_18m', amountETB: 500, paymentRail: 'cbe' });
    const saved = saveReceiptImage(PNG_1PX, order.id);
    submitReceipt(order.id, saved.storedName);

    const linkRes = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/receipt-link`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(linkRes.status).toBe(200);
    const { url, expiresIn } = await linkRes.json();
    expect(expiresIn).toBeLessThanOrEqual(60);
    expect(url).not.toContain(adminToken); // session token never appears in URLs

    const dl = await fetch(`http://localhost:${port}${url}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toContain('image/png');
  });

  it('rejects forged/garbage signed URLs with 403', async () => {
    const res = await fetch(`http://localhost:${port}/api/admin/receipt-dl/ORD-1%7C9999999999999%7Cdeadbeef/Zm9vYmFy`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// W4: concurrency armor
// ---------------------------------------------------------------------------

describe('Hardening: stock allocation invariants (W4)', () => {
  it('allocates exactly once when N buyers race over one remaining key', () => {
    addLink('gemini_pro_18m', 'https://key/only-one');
    const results = Array.from({ length: 25 }, (_, i) =>
      approveReceipt(createOrder({ userId: 1000 + i, productId: 'gemini_pro_18m', amountETB: 1500, paymentRail: 'stars' }).id, 0)
    );
    const delivered = results.filter((r) => r.autoDeliveredItem !== null);
    expect(delivered.length).toBe(1);
  });

  it('enforces the partial UNIQUE index at the SQL layer (no double-bind)', () => {
    const db = getDatabase();
    addLink('gemini_pro_18m', 'https://key/idx-a');
    const alloc = allocateStock('gemini_pro_18m', 'ORD-A');
    expect(alloc.item).toBeTruthy();

    // A second key arrives; binding it to the SAME order must be impossible.
    addLink('gemini_pro_18m', 'https://key/idx-b');
    expect(() =>
      db.prepare("UPDATE stock_items SET order_id = 'ORD-A' WHERE order_id IS NULL").run()
    ).toThrow(/UNIQUE/i);
  });

  it('claims are no-op safe when stock is empty (no phantom allocation)', () => {
    const r = allocateStock('gemini_pro_18m', 'ORD-NONE');
    expect(r.item).toBeNull();
    expect(getDatabase().prepare("SELECT COUNT(*) c FROM stock_items WHERE order_id='ORD-NONE'").get() as any).toEqual({ c: 0 });
  });
});

describe('Hardening: payout decision race guard', () => {
  it('second decision on the same payout returns 409 and debits once', async () => {
    const db = getDatabase();
    db.prepare('INSERT OR IGNORE INTO users (id, first_name) VALUES (?, ?)').run(777, 'Affiliate');
    db.prepare(
      "INSERT INTO ledger_entries (user_id, direction, amount_etb, type, idempotency_key, note) VALUES (777,'credit',500,'commission','seed:t','t')"
    ).run();
    const p = db.prepare(
      "INSERT INTO payout_requests (user_id, amount_etb, method, destination, status) VALUES (777, 300, 'telebirr', '+251911000000','pending')"
    ).run();

    const decide = (id: number) =>
      fetch(`http://localhost:${port}/api/admin/payouts/${id}/decision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'paid' }),
      });

    const first = await decide(Number(p.lastInsertRowid));
    expect(first.status).toBe(200);
    const second = await decide(Number(p.lastInsertRowid));
    expect(second.status).toBe(409);

    const debits = db.prepare("SELECT COUNT(*) c FROM ledger_entries WHERE user_id=777 AND type='payout'").get() as any;
    expect(debits.c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// M1/M3/L5/L1/W5 misc hardening
// ---------------------------------------------------------------------------

describe('Hardening: OTP uses CSPRNG format', () => {
  const login = () =>
    fetch(`http://localhost:${port}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'TestPassword123!' }),
    });
  const readOtp = () => (getDatabase().prepare('SELECT otp FROM admin_otps LIMIT 1').get() as any)?.otp;
  const verify = (otp: string, adminId = 12345) =>
    fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId, otp }),
    });

  it('login writes a 6-digit numeric code', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(String(readOtp())).toMatch(/^\d{6}$/);
  });

  it('locks OTP verification to the admin IDENTITY after repeated failures — even with the correct code and a fresh IP bucket', async () => {
    const adminApi = await import('../src/api/admin.js');
    const originalMax = adminApi.otpLockoutConfig.maxAttempts;
    adminApi.otpLockoutConfig.maxAttempts = 2; // exercise lockout inside the IP budget
    try {
      await login();
      const otp = readOtp();

      const wrong1 = await verify('000000');
      expect(wrong1.status).toBe(400);
      const wrong2 = await verify('000001');
      expect(wrong2.status).toBe(400);

      // Third request is well inside the IP limiter budget, but the identity
      // lockout must now reject even the CORRECT code.
      const third = await verify(otp);
      expect(third.status).toBe(429);
      const body = await third.json();
      expect(body.error).toMatch(/Too many incorrect codes/i);
    } finally {
      adminApi.otpLockoutConfig.maxAttempts = originalMax;
    }
  });
});

describe('Hardening: settings key whitelist (L5)', () => {
  it('rejects unknown keys with an explicit error', async () => {
    const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { etb_per_USD: '999' } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('etb_per_USD');
  });

  it('accepts known keys', async () => {
    const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { etb_per_usd: '137' } }),
    });
    expect(res.status).toBe(200);
    expect((getDatabase().prepare("SELECT value FROM settings WHERE key='etb_per_usd'").get() as any).value).toBe('137');
  });
});

describe('Hardening: CSV/XLSX formula-injection guard (M3)', () => {
  it('prefixes dangerous leading characters in CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell('@SUM(1+1)')).toBe('"\'@SUM(1+1)"');
    expect(csvCell('+cmd')).toBe("\"'+cmd\"");
    expect(csvCell('plain value')).toBe('"plain value"');
    expect(csvCell(null)).toBe('""');
  });

  it('guards ExcelJS formula interpretation in xlsx rows', () => {
    const guarded = guardExcelString({ username: '=cmd|/C calc', note: 'safe' });
    expect(guarded.username).toBe("'=cmd|/C calc");
    expect(guarded.note).toBe('safe');
  });
});

describe('Hardening: TRUST_PROXY production auto-default (H2)', () => {
  it('coerces empty TRUST_PROXY to loopback in production', () => {
    const cfg = loadEnv({
      NODE_ENV: 'production',
      BOT_TOKEN: 'x',
      ADMIN_IDS: '1',
      ADMIN_PASSWORD: 'longenough1',
      WALLET_PAY_MODE: 'live',
      WALLET_PAY_API_KEY: 'k',
      WEBAPP_URL: 'https://shop.example.com',
      TRUST_PROXY: '',
    });
    expect(cfg.TRUST_PROXY).toBe('loopback');
  });

  it('preserves explicit overrides', () => {
    const cfg = loadEnv({
      NODE_ENV: 'production',
      BOT_TOKEN: 'x',
      ADMIN_IDS: '1',
      ADMIN_PASSWORD: 'longenough1',
      WALLET_PAY_MODE: 'live',
      WALLET_PAY_API_KEY: 'k',
      WEBAPP_URL: 'https://shop.example.com',
      TRUST_PROXY: '1',
    });
    expect(cfg.TRUST_PROXY).toBe('1');
  });
});

describe('Hardening: broadcast registry hard bound (M8)', () => {
  it('throws BroadcastBusyError instead of growing past MAX_TRACKED_JOBS', () => {
    const hangingApi = { sendMessage: (_id: number) => new Promise(() => {}), sendPhoto: () => new Promise(() => {}) } as any;
    let thrown: unknown = null;
    try {
      for (let i = 0; i < 25; i++) {
        startBroadcastJob(hangingApi, { messageText: 'm', targetLanguage: 'all' });
      }
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BroadcastBusyError);
  }, 10_000);
});
