import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { resetConfigCache } from '../src/config/env.js';
import { createApiServer } from '../src/api/server.js';
import { createBot } from '../src/bot/bot.js';
import type { Bot } from 'grammy';
import { setAdminBotInstance } from '../src/api/admin.js';
import { syncAdminsFromEnv, ensureAdminRow } from '../src/auth/permissions.js';
import { createOrder, getOrderById, updateOrderStatus } from '../src/services/orders.service.js';
import { addStockLink } from '../src/services/stock.service.js';
import { verifyChapaSignature } from '../src/services/payments/chapa.js';
import { matchTonTransaction, tonToNano, type TonTx } from '../src/services/payments/ton.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
const ADMIN_PASSWORD = 'secure-test-password-2026!';
const CHAPA_KEY = 'chapa-test-secret';

function seedUser(db: Database.Database, id: number): void {
  db.prepare('INSERT INTO users (id, username, first_name) VALUES (?, ?, ?)').run(id, `u${id}`, 'U');
}

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, () => resolve((server.address() as any).port)));
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function signedInitData(userId: number): string {
  const userObj = { id: userId, first_name: 'T', username: `t${userId}` };
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'q', user: JSON.stringify(userObj) };
  const items = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(items.join('\n')).digest('hex');
  const sp = new URLSearchParams(params as any);
  sp.set('hash', hash);
  return sp.toString();
}

/** Full admin session via password+OTP; returns bearer token. */
async function loginAdmin(port: number, adminId: number): Promise<string> {
  const loginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD, adminId }),
  });
  expect(loginRes.status).toBe(200);
  const otpRow = getDatabase().prepare('SELECT otp FROM admin_otps WHERE admin_id = ?').get(adminId) as any;
  const verifyRes = await fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId, otp: otpRow.otp }),
  });
  const data = await verifyRes.json();
  return data.token;
}

// ---------------------------------------------------------------------------
// Feature 10: RBAC
// ---------------------------------------------------------------------------

describe('Feature: Role-based access control', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111,222222333,333333444,444444555'; // superadmin + role fixtures
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    syncAdminsFromEnv();

    // Additional role fixtures
    db.prepare("INSERT OR REPLACE INTO admins (tg_user_id, role) VALUES (222222333, 'finance')").run();
    db.prepare("INSERT OR REPLACE INTO admins (tg_user_id, role) VALUES (333333444, 'ops')").run();
    db.prepare("INSERT OR REPLACE INTO admins (tg_user_id, role) VALUES (444444555, 'support')").run();

    const bot = createBot(TOKEN);
    server = createApiServer(bot);
    port = await listen(server);
  });

  afterEach(async () => {
    await closeServer(server);
    closeDatabase();
    resetConfigCache();
  });

  it('boot backfill grants superadmin to ADMIN_IDS members idempotently', () => {
    expect(ensureAdminRow(111111111)).toBe('superadmin');
    syncAdminsFromEnv(); // second run — no duplicates/crash
    const count = getDatabase().prepare('SELECT COUNT(*) c FROM admins WHERE tg_user_id = 111111111').get() as any;
    expect(count.c).toBe(1);
  });

  it('superadmin can access everything; finance cannot approve orders', async () => {
    const superToken = await loginAdmin(port, 111111111);
    const financeToken = await loginAdmin(port, 222222333);

    // Superadmin: overview OK
    const ovSuper = await fetch(`http://localhost:${port}/api/admin/overview`, { headers: { Authorization: `Bearer ${superToken}` } });
    expect(ovSuper.status).toBe(200);

    // Finance: overview OK (analytics.view), approve → forbidden
    const ovFin = await fetch(`http://localhost:${port}/api/admin/overview`, { headers: { Authorization: `Bearer ${financeToken}` } });
    expect(ovFin.status).toBe(200);

    seedUser(db, 711001);
    const order = createOrder({ userId: 711001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    updateOrderStatus(order.id, 'pending_approval');

    const deny = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${financeToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(deny.status).toBe(403);
    expect(getOrderById(order.id)?.status).toBe('pending_approval'); // untouched

    // Audit trail recorded the denial
    const denials = getDatabase().prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='auth.login.failure' AND target_type='authz'").get() as any;
    expect(denials.c).toBeGreaterThanOrEqual(1);
  });

  it('ops can manage stock but cannot write settings', async () => {
    const opsToken = await loginAdmin(port, 333333444);

    const stockOk = await fetch(`http://localhost:${port}/api/admin/stock`, { headers: { Authorization: `Bearer ${opsToken}` } });
    expect(stockOk.status).toBe(200);

    const settingsDenied = await fetch(`http://localhost:${port}/api/admin/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${opsToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { etb_per_usd: '200' } }),
    });
    expect(settingsDenied.status).toBe(403);
    expect(getDatabase().prepare("SELECT value FROM settings WHERE key='etb_per_usd'").get() as any).toEqual({ value: '135' });
  });

  it('support role is read-only for orders and blocked from broadcast', async () => {
    const supportToken = await loginAdmin(port, 444444555);

    const ordersOk = await fetch(`http://localhost:${port}/api/admin/orders`, { headers: { Authorization: `Bearer ${supportToken}` } });
    expect(ordersOk.status).toBe(200);

    const broadcastDenied = await fetch(`http://localhost:${port}/api/admin/broadcast`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supportToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'spam', target: 'all' }),
    });
    expect(broadcastDenied.status).toBe(403);
  });

  it('deactivated administrators lose access immediately and their sessions are revoked', async () => {
    const token = await loginAdmin(port, 222222333); // finance
    getDatabase().prepare('UPDATE admins SET is_active = 0 WHERE tg_user_id = 222222333').run();

    const res = await fetch(`http://localhost:${port}/api/admin/overview`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);

    const sessions = getDatabase().prepare('SELECT COUNT(*) c FROM admin_sessions WHERE admin_id = 222222333').get() as any;
    expect(sessions.c).toBe(0);
  });

  it('financial exports are gated behind export.financial', async () => {
    const opsToken = await loginAdmin(port, 333333444);
    const finToken = await loginAdmin(port, 222222333);

    const denied = await fetch(`http://localhost:${port}/api/admin/export/orders.csv`, { headers: { Authorization: `Bearer ${opsToken}` } });
    expect(denied.status).toBe(403);

    const allowed = await fetch(`http://localhost:${port}/api/admin/export/orders.csv`, { headers: { Authorization: `Bearer ${finToken}` } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('content-type')).toContain('text/csv');
    const csv = await allowed.text();
    expect(csv).toContain('order_id');
  });
});

// ---------------------------------------------------------------------------
// Feature 13: Chapa gateway
// ---------------------------------------------------------------------------

describe('Feature: Chapa payment gateway adapter', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'live';
    process.env.WALLET_PAY_API_KEY = 'wp-live-key';
    process.env.CHAPA_SECRET_KEY = CHAPA_KEY;
    process.env.NODE_ENV = 'production';
    process.env.WEBAPP_URL = 'https://shop.example.com';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    const bot = createBot(TOKEN);
    server = createApiServer(bot);
    port = await listen(server);
  });

  afterEach(async () => {
    await closeServer(server);
    closeDatabase();
    resetConfigCache();
  });

  function chapaSignature(body: string): string {
    return crypto.createHmac('sha256', CHAPA_KEY).update(body, 'utf-8').digest('hex');
  }

  function seedPaidOrder(rail: string = 'chapa'): ReturnType<typeof createOrder> {
    seedUser(db, 720001);
    addStockLink('gemini_pro_18m', 'https://g.co/chapa-delivery-1');
    return createOrder({
      userId: 720001,
      productId: 'gemini_pro_18m',
      variantId: 'gemini_pro_18m_default',
      amountETB: 1500,
      paymentRail: rail as any,
    });
  }

  function postWebhook(orderId: string, sig: string | undefined): Promise<Response> {
    const body = JSON.stringify({ event: 'CHARGE.SUCCESS', tx_ref: orderId, status: 'success', amount: 1500 });
    return fetch(`http://localhost:${port}/api/webhooks/chapa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(sig ? { 'chapa-signature': sig } : {}) },
      body,
    });
  }

  it('signature primitive: valid passes, tampered/missing fail', () => {
    const body = '{"a":1}';
    expect(verifyChapaSignature(CHAPA_KEY, chapaSignature(body), body)).toBe(true);
    expect(verifyChapaSignature(CHAPA_KEY, chapaSignature(CHAPA_KEY), body)).toBe(false);
    expect(verifyChapaSignature(CHAPA_KEY, undefined, body)).toBe(false);
  });

  it('rejects webhooks with 410 Gone as decommissioned', async () => {
    const order = seedPaidOrder();
    const res = await postWebhook(order.id, undefined);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/decommissioned/i);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('returns 410 Gone even for signed webhooks and leaves order awaiting_payment', async () => {
    const order = seedPaidOrder();
    const body = JSON.stringify({ event: 'CHARGE.SUCCESS', tx_ref: order.id, status: 'success', amount: 1500 });
    const res = await fetch(`http://localhost:${port}/api/webhooks/chapa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'chapa-signature': chapaSignature(body) },
      body,
    });
    expect(res.status).toBe(410);
    const resBody = await res.json();
    expect(resBody.error).toMatch(/decommissioned/i);

    const updated = getOrderById(order.id);
    expect(updated?.status).toBe('awaiting_payment');
    expect(updated?.fulfillment_payload).toBeNull();
  });

  it('returns 410 Gone for amount mismatches on decommissioned endpoint', async () => {
    const order = seedPaidOrder();
    const body = JSON.stringify({ event: 'CHARGE.SUCCESS', tx_ref: order.id, status: 'success', amount: 15 }); // partial payment!
    const res = await fetch(`http://localhost:${port}/api/webhooks/chapa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'chapa-signature': chapaSignature(body) },
      body,
    });
    expect(res.status).toBe(410);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('returns 410 Gone on duplicate webhook deliveries without allocating stock', async () => {
    const order = seedPaidOrder();
    const send = () => postWebhook(order.id, chapaSignature(JSON.stringify({ event: 'CHARGE.SUCCESS', tx_ref: order.id, status: 'success', amount: 1500 })));
    const res1 = await send();
    const res2 = await send();
    const res3 = await send();
    expect(res1.status).toBe(410);
    expect(res2.status).toBe(410);
    expect(res3.status).toBe(410);
    // Stock remains untouched (0 allocated)
    expect(getDatabase().prepare("SELECT COUNT(*) c FROM stock_items WHERE status='allocated'").get() as any).toEqual({ c: 0 });
  });
});

// ---------------------------------------------------------------------------
// Feature 14: TON Connect on-chain matcher
// ---------------------------------------------------------------------------

describe('Feature: TON Connect verification', () => {
  const ORDER_ID = 'ORD-1750000-AB3D9F';
  const expectedTon = 4.5;

  function tx(comment: string | null, tonAmount: number, hash = 'h1'): TonTx {
    return { comment, valueNano: tonToNano(tonAmount).toString(), toAddress: 'treasury', txHash: hash, utime: 1 };
  }

  it('matches exact memo with sufficient value', () => {
    const match = matchTonTransaction([tx(null, 5), tx(ORDER_ID, expectedTon)], { memo: ORDER_ID, expectedNano: tonToNano(expectedTon) });
    expect(match?.txHash).toBe('h1'.replace('h1', 'h1'));
    expect(match?.comment).toBe(ORDER_ID);
  });

  it('accepts small overpayments within tolerance', () => {
    const match = matchTonTransaction([tx(ORDER_ID, expectedTon * 1.005)], { memo: ORDER_ID, expectedNano: tonToNano(expectedTon) });
    expect(match).not.toBeNull();
  });

  it('REJECTS underpayments beyond tolerance', () => {
    const match = matchTonTransaction([tx(ORDER_ID, expectedTon * 0.5)], { memo: ORDER_ID, expectedNano: tonToNano(expectedTon) });
    expect(match).toBeNull();
  });

  it('never matches wrong memos or wrong recipients semantics', () => {
    expect(matchTonTransaction([tx('OTHER-ORDER', expectedTon)], { memo: ORDER_ID, expectedNano: tonToNano(expectedTon) })).toBeNull();
    expect(matchTonTransaction([tx(null, expectedTon)], { memo: ORDER_ID, expectedNano: tonToNano(expectedTon) })).toBeNull();
  });

  it('endpoint returns 410 Gone as TON payments are decommissioned', async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    process.env.TON_TREASURY_ADDRESS = 'EQTreasuryTestAddress';
    resetConfigCache();
    initDatabase(':memory:', MIGRATIONS_DIR);
    const bot = createBot(TOKEN);
    const server = createApiServer(bot);
    const port = await listen(server);

    try {
      seedUser(getDatabase(), 730001);
      const order = createOrder({ userId: 730001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'ton_connect' as any });

      const anon = await fetch(`http://localhost:${port}/api/payments/ton/status/${order.id}`, { method: 'POST' });
      expect(anon.status).toBe(410);
      const body = await anon.json();
      expect(body.error).toMatch(/decommissioned/i);
      expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
    } finally {
      await closeServer(server);
      closeDatabase();
      resetConfigCache();
    }
  });
});

// ---------------------------------------------------------------------------
// Feature 7: Support bridge (service layer)
// ---------------------------------------------------------------------------

describe('Feature: Support bridge plumbing', () => {
  let db: Database.Database;
  let bot: Bot;
  let apiCalls: { method: string; payload: any }[];

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    process.env.SUPPORT_GROUP_ID = '-1004567890123';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    bot = createBot(TOKEN);
    apiCalls = [];
    bot.api.config.use((async (_prev: any, method: string, payload: any) => {
      apiCalls.push({ method, payload });
      if (method === 'createForumTopic') {
        return { ok: true, result: { message_thread_id: 424242, message: { message_id: 1 } } };
      }
      if (method === 'sendMessage') {
        return { ok: true, result: { message_id: 777 } };
      }
      return { ok: true, result: true };
    }) as any);
    (bot as any).botInfo = { id: 42, is_bot: true, username: 'test_bot' };
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.SUPPORT_GROUP_ID;
    resetConfigCache();
  });

  it('creates a thread with a forum topic once, then reuses it', async () => {
    const { getOrCreateThread } = await import('../src/services/support.service.js');
    seedUser(db, 740001);

    const t1 = await getOrCreateThread(bot.api, 740001, 'buyer1', 'Buyer');
    const t2 = await getOrCreateThread(bot.api, 740001, 'buyer1', 'Buyer');

    expect(t1.id).toBe(t2.id);
    expect(t1.forum_topic_id).toBeTruthy();
    expect(apiCalls.filter((c) => c.method === 'createForumTopic')).toHaveLength(1);
  });

  it('stores user messages and admin replies; routes by topic id', async () => {
    const svc = await import('../src/services/support.service.js');
    seedUser(db, 740002);
    const thread = await svc.getOrCreateThread(bot.api, 740002, 'buyer2', 'B');

    svc.insertSupportMessage(thread.id, 'user', 'Where is my order?');
    expect(svc.getThreadMessages(thread.id)).toHaveLength(1);

    // Admin reply arrives in the topic → routed back
    const found = svc.findThreadByTopic(thread.forum_topic_id!);
    expect(found?.id).toBe(thread.id);
    svc.insertSupportMessage(found!.id, 'admin', 'Shipping today!');
    const msgs = svc.getThreadMessages(thread.id);
    expect(msgs.map((m: any) => m.sender_role)).toEqual(['user', 'admin']);
  });

  it('message length caps enforced at service boundary', async () => {
    const svc = await import('../src/services/support.service.js');
    seedUser(db, 740003);
    const thread = await svc.getOrCreateThread(bot.api, 740003, 'b3', 'B');
    const long = 'x'.repeat(5000);
    svc.insertSupportMessage(thread.id, 'user', long);
    const stored = svc.getThreadMessages(thread.id)[0] as any;
    expect(stored.body.length).toBe(svc.SUPPORT_MAX_MESSAGE_LENGTH);
  });

  it('closed threads are not matched for admin routing', async () => {
    const svc = await import('../src/services/support.service.js');
    seedUser(db, 740004);
    const thread = await svc.getOrCreateThread(bot.api, 740004, 'b4', 'B');
    svc.closeThread(thread.id);
    expect(svc.findThreadByTopic(thread.forum_topic_id!)).toBeUndefined();
  });

  it('disabled bridge reports unavailable over HTTP', async () => {
    delete process.env.SUPPORT_GROUP_ID;
    resetConfigCache();
    const server = createApiServer(bot);
    const port = await listen(server);
    try {
      const res = await fetch(`http://localhost:${port}/api/support/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `tma ${signedInitData(740005)}` },
        body: JSON.stringify({ body: 'hello?' }),
      });
      expect(res.status).toBe(503);
    } finally {
      await closeServer(server);
    }
  });
});
