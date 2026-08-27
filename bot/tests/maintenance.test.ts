import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { resetConfigCache, resolveEnvCandidates, loadEnv } from '../src/config/env.js';
import { createApiServer } from '../src/api/server.js';
import {
  createOrder,
  getOrderById,
  updateOrderStatus,
  updateOrderMeta,
  submitReceipt,
  rejectReceipt,
  refundOrder,
  isTransitionAllowed,
  InvalidOrderTransitionError,
} from '../src/services/orders.service.js';
import {
  detectImageExtension,
  saveReceiptImage,
  purgeOldReceipts,
  resolveReceiptsDir,
  ReceiptValidationError,
} from '../src/services/receipts.service.js';
import { purgeExpiredData } from '../src/services/maintenance.service.js';
import { deliverBroadcast, BroadcastTarget } from '../src/services/broadcast.service.js';
import { redactSecret, previewUserText } from '../src/logger/index.js';
import { addStockLink, getAvailableStockCount } from '../src/services/stock.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

function seedUser(db: Database.Database, id: number): void {
  db.prepare('INSERT INTO users (id, username, first_name) VALUES (?, ?, ?)').run(id, `u${id}`, 'U');
}

// ---------------------------------------------------------------------------
// Fix 3: Order state machine
// ---------------------------------------------------------------------------

describe('Medium #3: Strict order state machine', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 601001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('allows the documented happy-path chain', () => {
    const order = createOrder({ userId: 601001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    submitReceipt(order.id, 'file-1', 'note');            // awaiting -> pending_approval
    rejectReceipt(order.id, 111111111, 'unreadable');     // pending_approval -> rejected
    const resubmitted = submitReceipt(order.id, 'file-2'); // rejected -> pending_approval
    expect(resubmitted.status).toBe('pending_approval');

    const approved = updateOrderStatus(order.id, 'pending_fulfillment');
    expect(approved.status).toBe('pending_fulfillment');
    const fulfilled = updateOrderStatus(order.id, 'fulfilled');
    expect(fulfilled.status).toBe('fulfilled');
  });

  /** Walks the order to the requested starting status via legal transitions where possible. */
  function orderInState(userId: number, from: string): ReturnType<typeof createOrder> {
    const order = createOrder({ userId, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    if (from === 'awaiting_payment' || from === 'new') return order;
    if (from === 'pending_approval') return submitReceipt(order.id);
    // Deeper states: use force for test SETUP only (the assertions below test
    // the guarded transition itself, not setup).
    updateOrderStatus(order.id, 'pending_approval', {}, { force: true });
    return updateOrderStatus(order.id, from as any, {}, { force: true });
  }

  it.each([
    ['pending_approval', 'awaiting_payment'], // receipt-destroying regression
    ['pending_approval', 'cancelled'],
    ['fulfilled', 'awaiting_payment'],
    ['fulfilled', 'pending_approval'],
    ['fulfilled', 'pending_fulfillment'],
    ['fulfilled', 'rejected'],
    ['fulfilled', 'cancelled'],
    ['refunded', 'awaiting_payment'],
    ['refunded', 'pending_fulfillment'],
    ['refunded', 'fulfilled'],
    ['cancelled', 'awaiting_payment'],
    ['cancelled', 'pending_approval'],
    ['cancelled', 'fulfilled'],
    ['rejected', 'awaiting_payment'],
  ] as [string, string][])('blocks illegal transition %s -> %s', (from, to) => {
    const order = orderInState(601001, from);
    expect(() => updateOrderStatus(order.id, to as any)).toThrow(InvalidOrderTransitionError);
    expect(getOrderById(order.id)?.status).toBe(from);
  });

  it('permits refunds only from operationally refundable states', () => {
    for (const from of ['pending_approval', 'pending_fulfillment', 'fulfilled', 'rejected'] as const) {
      const order = orderInState(601001, from);
      const refunded = refundOrder(order.id, 111111111, 'test refund');
      expect(refunded.status).toBe('refunded');
      expect(isTransitionAllowed('refunded', 'fulfilled')).toBe(false);
    }
  });

  it('updateOrderMeta switches payment rails WITHOUT status changes or receipt loss', async () => {
    const order = createOrder({ userId: 601001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'stars' });
    const withReceipt = submitReceipt(order.id, 'proof-file-77', 'bank transfer done');

    // Buyer switches rail AFTER uploading a receipt — previously this reset
    // the order to awaiting_payment and silently discarded the receipt.
    const switched = updateOrderMeta(order.id, { payment_rail: 'telebirr' });

    expect(switched.status).toBe('pending_approval');                       // preserved
    expect(switched.payment_rail).toBe('telebirr');
    expect(switched.receipt_file_id).toBe(withReceipt.receipt_file_id);      // preserved
    expect(switched.receipt_note).toBe('bank transfer done');                // preserved
  });

  it('force flag exists for exceptional administrative corrections', () => {
    const order = createOrder({ userId: 601001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    submitReceipt(order.id);
    const forced = updateOrderStatus(order.id, 'awaiting_payment', {}, { force: true });
    expect(forced.status).toBe('awaiting_payment');
  });
});

// ---------------------------------------------------------------------------
// Fix 10: Deep health check
// ---------------------------------------------------------------------------

describe('Medium #10: Health check verifies database connectivity', () => {
  let server: http.Server;
  let port: number;
  let db: Database.Database;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    server = createApiServer((await import('../src/bot/bot.js')).createBot(TOKEN));
    port = await new Promise<number>((resolve) => {
      server.listen(0, () => resolve((server.address() as any).port));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    resetConfigCache();
  });

  it('returns 200 with read+write probes when the database is healthy', async () => {
    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.databaseRead).toBe('ok');
    expect(body.databaseWrite).toBe('ok');

    // Heartbeat row actually written and updated in place
    const hb = db.prepare('SELECT ts FROM _health_heartbeat WHERE id = 1').get() as any;
    expect(hb?.ts).toBeTruthy();
  });

  it('returns 503 when the database is disconnected', async () => {
    closeDatabase(); // simulate DB outage

    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.database).toBe('unavailable');
  });

  it('returns 503 when the database is corrupted', async () => {
    // Simulate corruption by dropping a table the probe depends on
    db.exec('DROP TABLE settings;');

    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Fix 7: Expired data purge
// ---------------------------------------------------------------------------

describe('Medium #7: Expired sessions, OTPs, drafts & receipts purge', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  function insertSession(token: string, expiresAt: number): void {
    db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(token, 111111111, expiresAt);
  }

  it('removes only expired rows across all session tables', async () => {
    const now = Date.now();

    insertSession('tok-expired-1', now - 1000);
    insertSession('tok-expired-2', now - 999999);
    insertSession('tok-fresh', now + 86400_000);

    db.prepare('INSERT INTO admin_otps (admin_id, otp, expires_at) VALUES (?, ?, ?)').run(222222222, '123456', now - 5000);
    db.prepare('INSERT INTO admin_otps (admin_id, otp, expires_at) VALUES (?, ?, ?)').run(333333333, '654321', now + 600000);

    db.prepare('INSERT INTO bot_sessions (user_id, type, data, expires_at) VALUES (?, ?, ?, ?)').run(7001, 'user_receipt_upload', '{}', now - 1);
    db.prepare('INSERT INTO bot_sessions (user_id, type, data, expires_at) VALUES (?, ?, ?, ?)').run(7002, 'user_receipt_upload', '{}', now + 600000);

    const result = await purgeExpiredData(90, now);

    expect(result.expiredAdminSessions).toBe(2);
    expect(result.expiredAdminOtps).toBe(1);
    expect(result.expiredBotSessions).toBe(1);

    const remainingSessions = (db.prepare('SELECT COUNT(*) c FROM admin_sessions').get() as any).c;
    const remainingOtps = (db.prepare('SELECT COUNT(*) c FROM admin_otps').get() as any).c;
    const remainingBotSessions = (db.prepare('SELECT COUNT(*) c FROM bot_sessions').get() as any).c;
    expect(remainingSessions).toBe(1);
    expect(remainingOtps).toBe(1);
    expect(remainingBotSessions).toBe(1);
  });

  it('purges stale broadcast drafts beyond the retention window', async () => {
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('INSERT INTO broadcast_drafts (admin_id, text, target_lang, updated_at) VALUES (?, ?, ?, ?)').run(1, 'old draft', 'all', old);
    db.prepare("INSERT INTO broadcast_drafts (admin_id, text, target_lang, updated_at) VALUES (?, ?, ?, datetime('now'))").run(2, 'fresh draft', 'all');

    const result = await purgeExpiredData(90);

    expect(result.staleBroadcastDrafts).toBe(1);
    const remaining = db.prepare('SELECT text FROM broadcast_drafts').all() as any[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('fresh draft');
  });

  it('purges expired receipt files but keeps recent ones', async () => {
    process.env.RECEIPTS_DIR = path.join(__dirname, '../tmp-receipts-purge-test');
    resetConfigCache();
    fs.rmSync(process.env.RECEIPTS_DIR, { recursive: true, force: true });
    fs.mkdirSync(process.env.RECEIPTS_DIR, { recursive: true });

    const oldFile = path.join(process.env.RECEIPTS_DIR, 'receipt_OLD_1.jpg');
    const freshFile = path.join(process.env.RECEIPTS_DIR, 'receipt_NEW_1.jpg');
    fs.writeFileSync(oldFile, 'x');
    fs.writeFileSync(freshFile, 'x');
    const past = new Date(Date.now() - 120 * 24 * 3600 * 1000);
    fs.utimesSync(oldFile, past, past); // set mtime 120 days ago

    const removed = await purgeOldReceipts(90);

    expect(removed).toBe(1);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);

    fs.rmSync(process.env.RECEIPTS_DIR, { recursive: true, force: true });
    delete process.env.RECEIPTS_DIR;
    resetConfigCache();
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Receipt validation & storage
// ---------------------------------------------------------------------------

describe('Medium #4: Receipt magic-byte validation & size caps', () => {
  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    process.env.RECEIPTS_DIR = path.join(__dirname, '../tmp-receipts-test');
    resetConfigCache();
    fs.rmSync(path.join(__dirname, '../tmp-receipts-test'), { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(path.join(__dirname, '../tmp-receipts-test'), { recursive: true, force: true });
    delete process.env.RECEIPTS_DIR;
    delete process.env.RECEIPT_MAX_BYTES;
    delete process.env.DATABASE_PATH;
    resetConfigCache();
  });

  it('detects JPEG, PNG, and WebP magic bytes; rejects everything else', () => {
    expect(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(detectImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(detectImageExtension(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('webp');
    expect(detectImageExtension(Buffer.from('%PDF-1.4'))).toBeNull();
    expect(detectImageExtension(Buffer.from('<script>alert(1)</script>'))).toBeNull();
    expect(detectImageExtension(Buffer.alloc(0))).toBeNull();
  });

  it('stores receipts under a truthful extension derived from content', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto_ignored()]);
    const saved = await saveReceiptImage(png.toString('base64'), 'ORD-X/../../etc/passwd');

    expect(saved.extension).toBe('png');
    expect(saved.filePath.endsWith('.png')).toBe(true);
    // Path traversal components were sanitized out of the filename
    expect(path.basename(saved.filePath)).toMatch(/^receipt_ORD-X__/);
    expect(fs.existsSync(saved.filePath)).toBe(true);
  });

  it('rejects non-image payloads with a validation error (no file written)', async () => {
    const before = countReceiptFiles();
    await expect(saveReceiptImage(Buffer.from('definitely not an image').toString('base64'), 'ORD-Y')).rejects.toThrow(ReceiptValidationError);
    expect(countReceiptFiles()).toBe(before);
  });

  it('enforces the configured byte cap', async () => {
    process.env.RECEIPT_MAX_BYTES = '1024';
    resetConfigCache();
    const bigPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 1)]);
    await expect(saveReceiptImage(bigPng.toString('base64'), 'ORD-Z')).rejects.toThrow(/too large/i);
    delete process.env.RECEIPT_MAX_BYTES;
    resetConfigCache();
  });

  it('resolves the receipts dir next to the database when RECEIPTS_DIR unset', () => {
    delete process.env.RECEIPTS_DIR;
    resetConfigCache();
    process.env.DATABASE_PATH = '/var/lib/shop/data/shop.db';
    resetConfigCache();
    expect(resolveReceiptsDir()).toBe(path.resolve('/var/lib/shop/data/receipts'));
    process.env.DATABASE_PATH = './data/shop.db';
    resetConfigCache();
  });

  function countReceiptFiles(): number {
    const dir = resolveReceiptsDir();
    return fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
  }

  function crypto_ignored(): Buffer {
    return Buffer.alloc(32, 7);
  }
});

// ---------------------------------------------------------------------------
// Fix 8: Stock gate on API order creation
// ---------------------------------------------------------------------------

describe('Medium #8: API refuses orders/invoices for sold-out stock products', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    initDatabase(':memory:', MIGRATIONS_DIR);
    server = createApiServer((await import('../src/bot/bot.js')).createBot(TOKEN));
    port = await new Promise<number>((resolve) => {
      server.listen(0, () => resolve((server.address() as any).port));
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    resetConfigCache();
  });

  function signedInitData(userId: number): string {
    const userObj = { id: userId, first_name: 'Gate', username: `gate${userId}` };
    const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'q1', user: JSON.stringify(userObj) };
    const items = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(items.join('\n')).digest('hex');
    const sp = new URLSearchParams(params as any);
    sp.set('hash', hash);
    return sp.toString();
  }

  async function createGeminiOrder(userId: number): Promise<Response> {
    return fetch(`http://localhost:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${signedInitData(userId)}` },
      body: JSON.stringify({ productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', paymentRail: 'wallet_pay' }),
    });
  }

  it('returns 409 OUT_OF_STOCK and creates NO order at zero stock', async () => {
    expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

    const res = await createGeminiOrder(710001);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('OUT_OF_STOCK');

    const db = getDatabase();
    const count = (db.prepare("SELECT COUNT(*) c FROM orders WHERE user_id = 710001").get() as any).c;
    expect(count).toBe(0);
  });

  it('creates the order and invoice link once stock is available', async () => {
    addStockLink('gemini_pro_18m', 'https://g.co/gate-stock-1');

    const res = await createGeminiOrder(710002);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.order.amount_etb).toBe(1500);
  });

  it('does not gate non-stock products', async () => {
    const res = await fetch(`http://localhost:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${signedInitData(710003)}` },
      body: JSON.stringify({ productId: 'telegram_premium', variantId: 'tg_prem_3m', paymentRail: 'wallet_pay' }),
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Fix 6: Broadcast delivery resilience & chunking
// ---------------------------------------------------------------------------

describe('Medium #6: Broadcast chunking & per-user error isolation', () => {
  function makeTargets(n: number): BroadcastTarget[] {
    return Array.from({ length: n }, (_, i) => ({ id: i + 1, language_code: 'en' }));
  }

  it('delivers to every reachable user despite hard failures on some targets', async () => {
    const targets = makeTargets(10);
    const failed: number[] = [];

    const result = await deliverBroadcast(targets, async (id) => {
      if (id === 3 || id === 7) {
        failed.push(id);
        throw new Error('Forbidden: bot was blocked by the user');
      }
    }, { delayMs: 0, chunkSize: 4, chunkDelayMs: 0 });

    expect(result.total).toBe(10);
    expect(result.sent).toBe(8);
    expect(result.failed).toBe(2);
    expect(failed.sort()).toEqual([3, 7]);
  });

  it('processes every chunk exactly once (chunk boundary math)', async () => {
    const delivered: number[] = [];
    const targets = makeTargets(23);

    await deliverBroadcast(targets, async (id) => { delivered.push(id); }, { delayMs: 0, chunkSize: 5, chunkDelayMs: 0 });

    expect(delivered).toHaveLength(23);
    expect(new Set(delivered).size).toBe(23); // no duplicates, none skipped
  });

  it('completes even when EVERY send fails', async () => {
    const result = await deliverBroadcast(makeTargets(5), async () => {
      throw new Error('network down');
    }, { delayMs: 0, chunkSize: 2, chunkDelayMs: 0 });

    expect(result).toEqual({ sent: 0, failed: 5, total: 5 });
  });
});

// ---------------------------------------------------------------------------
// Fix 9: Log redaction utilities
// ---------------------------------------------------------------------------

describe('Medium #9: Sensitive value redaction helpers', () => {
  it('redactSecret reveals length and edges only — never the payload', () => {
    const secret = 'https://gemini.google.com/redeem/SUPER-SECRET-CODE-1234567890';
    const redacted = redactSecret(secret);

    expect(redacted).not.toContain('SUPER-SECRET');
    expect(redacted).not.toContain(secret);
    expect(redacted.startsWith('http'));
    expect(redacted).toMatch(/^\w{4}…\w{4}\(\d+\)$/);

    expect(redactSecret('short')).toBe('***(5)');
    expect(redactSecret('')).toBe('');
    expect(redactSecret(null)).toBe('');
    expect(redactSecret(undefined)).toBe('');
  });

  it('previewUserText truncates and collapses whitespace without leaking long payloads', () => {
    const longText = 'my secret bank note '.repeat(20);
    const preview = previewUserText(longText, 40);
    expect(preview.length).toBeLessThanOrEqual(46); // 40 chars + ellipsis + length suffix
    expect(preview).toMatch(/\(\d+\)$/);

    expect(previewUserText('/start')).toBe('/start');
    expect(previewUserText('   spaced\t\nout   ')).toBe('spaced out');
    expect(previewUserText('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Fix 1: Deterministic .env resolution
// ---------------------------------------------------------------------------

describe('Medium #1: Environment loading determinism', () => {
  it('candidate list always prioritizes the monorepo root over cwd', () => {
    const candidates = resolveEnvCandidates();
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    // First non-DOTENV_PATH candidate must point at the repo root .env
    const rootCandidate = candidates.find((p) => !process.env.DOTENV_PATH || p !== path.resolve(process.env.DOTENV_PATH));
    expect(rootCandidate).toBeDefined();
    expect(rootCandidate!).toContain(path.join('.env'));
    expect(candidates[candidates.length - 1]).toBe(path.resolve(process.cwd(), '.env')); // cwd is last resort
  });

  it('honours explicit DOTENV_PATH override above all else', () => {
    process.env.DOTENV_PATH = '/custom/path/.env';
    const candidates = resolveEnvCandidates();
    expect(candidates[0]).toBe(path.resolve('/custom/path/.env'));
    delete process.env.DOTENV_PATH;
  });

  it('production requires an HTTPS WEBAPP_URL (no silent ephemeral defaults)', () => {
    expect(() =>
      loadEnv({
        BOT_TOKEN: TOKEN,
        ADMIN_IDS: '111111111',
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'long-enough-password',
        WALLET_PAY_MODE: 'live',
        WALLET_PAY_API_KEY: 'k',
      })
    ).toThrow(/WEBAPP_URL must be set to an HTTPS URL/);

    const ok = loadEnv({
      BOT_TOKEN: TOKEN,
      ADMIN_IDS: '111111111',
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'long-enough-password',
      WALLET_PAY_MODE: 'live',
      WALLET_PAY_API_KEY: 'k',
      WEBAPP_URL: 'https://shop.bighabesha.com',
    });
    expect(ok.WEBAPP_URL).toBe('https://shop.bighabesha.com');
  });

  it('dev mode tolerates a missing WEBAPP_URL (menu button simply omitted)', () => {
    const cfg = loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '111111111', WEBAPP_URL: '' });
    expect(cfg.WEBAPP_URL).toBeUndefined();
  });
});
