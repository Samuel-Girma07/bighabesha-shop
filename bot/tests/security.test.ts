import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { loadEnv, resetConfigCache } from '../src/config/env.js';
import { createApiServer } from '../src/api/server.js';
import { createBot } from '../src/bot/bot.js';
import type { Bot } from 'grammy';
import { createOrder, getOrderById, getOrdersByUserId } from '../src/services/orders.service.js';
import { addStockLink } from '../src/services/stock.service.js';
import { assertPositiveIntegerETB, PricingError } from '../src/services/pricing.service.js';
import { MockWalletPayAdapter } from '../src/services/payments/mock_wallet_pay.js';
import { reconcileStuckWalletPayOrders, resetWalletPayAdapter, getWalletPayAdapter } from '../src/services/payments/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
const ADMIN_PASSWORD = 'secure-test-password-2026!';
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateValidInitData(userObj: any, token: string, authDate = Math.floor(Date.now() / 1000)): string {
  const userJson = JSON.stringify(userObj);
  const params: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohD_abcdef',
    user: userJson,
  };

  const items = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = items.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const searchParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    searchParams.set(k, v);
  }
  searchParams.set('hash', hash);

  return searchParams.toString();
}

function authHeader(user: { id: number; username?: string; first_name?: string }): string {
  return `tma ${generateValidInitData({ id: user.id, first_name: user.first_name || 'User', username: user.username }, TOKEN)}`;
}

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as any;
      resolve(addr.port);
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * Runs a Telegram update through the bot with all outbound Bot API calls
 * intercepted (no real network). Records every sendMessage payload so tests
 * can assert what the bot would have delivered.
 */
function collectOutboundMessages(bot: Bot): { sent: { method: string; payload: any }[] } {
  const sent: { method: string; payload: any }[] = [];
  // Registered last -> runs first -> short-circuits the network entirely.
  bot.api.config.use((async (_prev: any, method: string, payload: any) => {
    sent.push({ method, payload });
    if (method === 'getMe' || method === 'sendMessage' || method === 'sendPhoto') {
      return { ok: true, result: method === 'getMe' ? { id: 42, is_bot: true, username: 'test_bot' } : true };
    }
    return { ok: true, result: true };
  }) as any);
  return { sent };
}

async function sendCommand(bot: Bot, userId: number, text: string): Promise<void> {
  // Grammy requires botInfo before processing updates outside of bot.start().
  // Setting it directly avoids a network getMe() call in tests.
  (bot as any).botInfo = { id: 42, is_bot: true, username: 'bighabesha_test_bot', first_name: 'Test Bot' };
  await bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      from: { id: userId, is_bot: false, first_name: 'Tester', username: `user${userId}` },
      chat: { id: userId, type: 'private', first_name: 'Tester' },
      date: Math.floor(Date.now() / 1000),
      text,
      entities: [{ offset: 0, length: text.split(/\s+/)[0].length, type: 'bot_command' }],
    },
  } as any);
}

async function postOrder(
  baseUrl: string,
  user: { id: number; username?: string },
  body: Record<string, unknown>
): Promise<{ status: number; json: () => Promise<any> }> {
  return fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(user) },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Critical Security Hardening', () => {
  let db: Database.Database;
  let server: http.Server;
  let bot: Bot;
  let port: number;
  let baseUrl: string;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111,222222333';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.WALLET_PAY_API_KEY = '';
    process.env.NODE_ENV = 'development';
    process.env.WEBAPP_URL = 'https://shop.bighabesha.test';
    process.env.CORS_ORIGINS = '';
    process.env.TRUST_PROXY = '';
    resetConfigCache();

    db = initDatabase(':memory:', MIGRATIONS_DIR);
    bot = createBot(TOKEN);
    server = createApiServer(bot);
    port = await listen(server);
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    await closeServer(server);
    closeDatabase();
    resetConfigCache();
    resetWalletPayAdapter();
  });

  // -------------------------------------------------------------------------
  // FIX 1: Server-side price enforcement
  // -------------------------------------------------------------------------

  describe('Fix 1: Client-controlled price injection is neutralized', () => {
    it('stores the catalog price (1500 ETB) even when the client tampers amountETB to 1', async () => {
      addStockLink('gemini_pro_18m', 'https://g.co/sec/price-guard-1');
      const res = await postOrder(baseUrl, { id: 300001, username: 'buyer_one' }, {
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1,
        paymentRail: 'cbe',
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.order.amount_etb).toBe(1500);
      expect(getOrderById(data.order.id)?.amount_etb).toBe(1500);
    });

    it('ignores negative, zero, fractional, and absurdly large client amounts', async () => {
      let idx = 0;
      for (const amount of [-500, 0, 12.5, 999999999]) {
        addStockLink('gemini_pro_18m', `https://g.co/sec/price-guard-2-${idx}`);
        const res = await postOrder(baseUrl, { id: 300002 + idx, username: `buyer_two_${idx}` }, {
          productId: 'gemini_pro_18m',
          variantId: 'gemini_pro_18m_default',
          amountETB: amount,
          paymentRail: 'telebirr',
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.order.amount_etb).toBe(1500);
        idx++;
      }
    });

    it('ignores string-typed client prices ("1", "999999")', async () => {
      const res = await postOrder(baseUrl, { id: 300003, username: 'buyer_three' }, {
        productId: 'telegram_premium',
        variantId: 'tg_prem_12m',
        amountETB: '1',
        paymentRail: 'cbe',
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.order.amount_etb).toBe(3400); // seeded catalog price for tg_prem_12m
    });

    it('rejects orders with no pricing basis (missing variant)', async () => {
      addStockLink('gemini_pro_18m', 'https://g.co/sec/price-guard-3');
      const res = await postOrder(baseUrl, { id: 300004, username: 'buyer_four' }, {
        productId: 'gemini_pro_18m',
        paymentRail: 'cbe',
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/variant|custom/i);
    });

    it('rejects variant/product mismatch (cross-product forgery)', async () => {
      addStockLink('gemini_pro_18m', 'https://g.co/sec/price-guard-4');
      const res = await postOrder(baseUrl, { id: 300005, username: 'buyer_five' }, {
        productId: 'gemini_pro_18m',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/does not belong/i);
    });

    it('rejects unknown products and unknown variants', async () => {
      addStockLink('gemini_pro_18m', 'https://g.co/sec/price-guard-5');
      const badProduct = await postOrder(baseUrl, { id: 300006, username: 'buyer_six' }, {
        productId: 'nonexistent_product',
        variantId: 'whatever',
        amountETB: 100,
        paymentRail: 'cbe',
      });
      expect(badProduct.status).toBe(400);

      const badVariant = await postOrder(baseUrl, { id: 300006, username: 'buyer_six' }, {
        productId: 'gemini_pro_18m',
        variantId: 'ghost_variant',
        amountETB: 100,
        paymentRail: 'cbe',
      });
      expect(badVariant.status).toBe(400);
    });

    it('rejects invalid payment rails', async () => {
      addStockLink('gemini_pro_18m', 'https://g.co/sec/price-guard-7');
      const res = await postOrder(baseUrl, { id: 300007, username: 'buyer_seven' }, {
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'paypal',
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/payment method/i);
    });

    describe('service-level defense-in-depth (createOrder guard)', () => {
      it.each([0, -100, 12.5, NaN, Infinity, '500', null, undefined])(
        'throws PricingError for invalid amount %p',
        (amount) => {
          expect(() =>
            createOrder({
              userId: 320001,
              productId: 'gemini_pro_18m',
              variantId: 'gemini_pro_18m_default',
              amountETB: amount as any,
              paymentRail: 'cbe',
            })
          ).toThrow(PricingError);
        }
      );

      it('resolveOrderPrice rejects non-positive integers via assertPositiveIntegerETB', () => {
        expect(() => assertPositiveIntegerETB(0)).toThrow(PricingError);
        expect(() => assertPositiveIntegerETB(-3)).toThrow(PricingError);
        expect(() => assertPositiveIntegerETB(4.2)).toThrow(PricingError);
        expect(() => assertPositiveIntegerETB('10' as any)).toThrow(PricingError);
        expect(() => assertPositiveIntegerETB(10)).not.toThrow();
      });
    });
  });

  // -------------------------------------------------------------------------
  // FIX 2: /wp_simulate lockdown
  // -------------------------------------------------------------------------

  describe('Fix 2: /wp_simulate is admin-only and mock-only', () => {
    it('silently ignores the command for non-admin users and leaves the order untouched', async () => {
      const order = createOrder({
        userId: 330001,
        username: 'victim_user',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'wallet_pay',
      });

      const { sent } = collectOutboundMessages(bot);
      await sendCommand(bot, 999888777, `/wp_simulate ${order.id}`);

      expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
      expect(sent.filter((m) => m.method === 'sendMessage')).toHaveLength(0);
    });

    it('allows an administrator to simulate payment in mock mode', async () => {
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/sec_test_link_1');
      const order = createOrder({
        userId: 330002,
        username: 'admin_sim_buyer',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'wallet_pay',
      });

      collectOutboundMessages(bot);
      await sendCommand(bot, 111111111, `/wp_simulate ${order.id}`);

      const updated = getOrderById(order.id);
      expect(updated?.status).toBe('fulfilled');
      expect(updated?.fulfillment_payload).toBe('https://gemini.google.com/redeem/sec_test_link_1');
    });

    it('refuses to run for anyone (even admins) when WALLET_PAY_MODE=live', async () => {
      process.env.WALLET_PAY_MODE = 'live';
      process.env.WALLET_PAY_API_KEY = 'live-test-key';
      resetConfigCache();

      const order = createOrder({
        userId: 330003,
        username: 'live_mode_buyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'wallet_pay',
      });

      const { sent } = collectOutboundMessages(bot);
      await sendCommand(bot, 111111111, `/wp_simulate ${order.id}`);

      expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
      const texts = sent.map((m) => JSON.stringify(m.payload));
      expect(texts.some((t) => t.includes('/wp_simulate is disabled'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // FIX 3: Fail-closed mock payments
  // -------------------------------------------------------------------------

  describe('Fix 3: Mock adapter cannot confirm payments in production', () => {
    it('MockWalletPayAdapter.verifyPayment() returns false in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.WALLET_PAY_MODE = 'live';
      process.env.WALLET_PAY_API_KEY = 'k';
      resetConfigCache();

      const adapter = new MockWalletPayAdapter();
      await expect(adapter.verifyPayment('MOCK-WP-anything')).resolves.toBe(false);
    });

    it('MockWalletPayAdapter.verifyPayment() still works in development', async () => {
      process.env.NODE_ENV = 'development';
      resetConfigCache();
      const adapter = new MockWalletPayAdapter();
      await expect(adapter.verifyPayment('MOCK-WP-x')).resolves.toBe(true);
    });

    it('reconciliation refuses to fulfil stuck orders through the mock adapter in production', async () => {
      // Prime the adapter singleton in mock mode (dev), then flip to production
      resetWalletPayAdapter();
      expect(getWalletPayAdapter() instanceof MockWalletPayAdapter).toBe(true);

      process.env.NODE_ENV = 'production';
      process.env.WALLET_PAY_MODE = 'live';
      process.env.WALLET_PAY_API_KEY = 'k';
      resetConfigCache();

      db.prepare(`INSERT INTO users (id, username, first_name) VALUES (340001, 'stuck_buyer', 'Stuck')`).run();
      db.prepare(`
        INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, status, created_at)
        VALUES ('ORD-STUCK-SEC-1', 340001, 'stuck_buyer', 'telegram_premium', 1100, 'wallet_pay', 'awaiting_payment', datetime('now', '-6 minutes'))
      `).run();

      const reconciled = await reconcileStuckWalletPayOrders(undefined);
      expect(reconciled).toBe(0);
      expect(getOrderById('ORD-STUCK-SEC-1')?.status).toBe('awaiting_payment');
    });
  });

  // -------------------------------------------------------------------------
  // FIX 4: Credentials & timing-safe comparisons
  // -------------------------------------------------------------------------

  describe('Fix 4: Hardcoded secrets removed, fail-closed credential handling', () => {
    it('no hardcoded default admin password exists anywhere in the schema', () => {
      const src = fs.readFileSync(path.join(__dirname, '../src/config/env.ts'), 'utf-8');
      expect(src.includes('Bighabesha2026!Admin')).toBe(false);
      expect(/ADMIN_PASSWORD:\s*z\.string\(\)\.default\(/.test(src)).toBe(false);
    });

    it('refuses to boot in production without ADMIN_PASSWORD', () => {
      expect(() =>
        loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '111111111', NODE_ENV: 'production', WALLET_PAY_MODE: 'live', WALLET_PAY_API_KEY: 'k' })
      ).toThrow(/ADMIN_PASSWORD is required in production/);
    });

    it('refuses to boot in production with a weak (short) ADMIN_PASSWORD', () => {
      expect(() =>
        loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '111111111', NODE_ENV: 'production', ADMIN_PASSWORD: 'short', WALLET_PAY_MODE: 'live', WALLET_PAY_API_KEY: 'k' })
      ).toThrow(/ADMIN_PASSWORD is required in production/);
    });

    it('refuses to boot in production with WALLET_PAY_MODE=mock or omitted', () => {
      expect(() =>
        loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '111111111', NODE_ENV: 'production', ADMIN_PASSWORD: 'long-enough-password', WALLET_PAY_MODE: 'mock', WALLET_PAY_API_KEY: '' })
      ).toThrow(/WALLET_PAY_MODE must be explicitly set to "live"/);

      expect(() =>
        loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '111111111', NODE_ENV: 'production', ADMIN_PASSWORD: 'long-enough-password', WALLET_PAY_API_KEY: 'k' })
      ).toThrow(/WALLET_PAY_MODE must be explicitly set to "live"/);
    });

    it('refuses to boot in production with live mode but a missing API key', () => {
      expect(() =>
        loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '111111111', NODE_ENV: 'production', ADMIN_PASSWORD: 'long-enough-password', WALLET_PAY_MODE: 'live', WALLET_PAY_API_KEY: '' })
      ).toThrow(/WALLET_PAY_API_KEY is required in production/);
    });

    it('accepts a fully-configured production environment', () => {
      const cfg = loadEnv({
        BOT_TOKEN: TOKEN,
        ADMIN_IDS: '111111111,222222333',
        NODE_ENV: 'production',
        ADMIN_PASSWORD: 'long-enough-password',
        WALLET_PAY_MODE: 'live',
        WALLET_PAY_API_KEY: 'live-key-123',
        WEBAPP_URL: 'https://shop.example.com',
      });
      expect(cfg.NODE_ENV).toBe('production');
      expect(cfg.ADMIN_IDS).toEqual([111111111, 222222333]);
    });

    it('admin dashboard stays locked (503) when ADMIN_PASSWORD is unset, even with the right legacy password', async () => {
      process.env.ADMIN_PASSWORD = '';
      resetConfigCache();

      await closeServer(server);
      server = createApiServer(bot);
      port = await listen(server);
      baseUrl = `http://localhost:${port}`;

      const res = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'Bighabesha2026!Admin' }),
      });
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/ADMIN_PASSWORD is not configured/);
    });

    it('rejects wrong passwords and accepts correct ones (timing-safe compare functional path)', async () => {
      const wrong = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'definitely-wrong-guess' }),
      });
      expect(wrong.status).toBe(401);

      const right = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      });
      expect(right.status).toBe(200);
      const data = await right.json();
      expect(data.require2FA).toBe(true);
    });

    it('never grants OTPs to unconfigured admin IDs (no hardcoded fallback)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, adminId: 111111111 }),
      });
      expect(res.status).toBe(200);

      const outsider = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, adminId: 111222333 }),
      });
      expect(outsider.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // FIX 5: Rate limiting, CORS, headers, payload caps
  // -------------------------------------------------------------------------

  describe('Fix 5: Brute-force protection and transport hardening', () => {
    it('rate-limits admin login after 5 attempts within 15 minutes', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`${baseUrl}/api/admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: `wrong-guess-${i}` }),
        });
        statuses.push(res.status);
      }
      expect(statuses.filter((s) => s === 401)).toHaveLength(5);
      expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    });

    it('rate-limits OTP verification after 5 failed attempts within 10 minutes', async () => {
      const loginRes = await fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD, adminId: 111111111 }),
      });
      expect(loginRes.status).toBe(200);

      const row = db.prepare('SELECT otp FROM admin_otps WHERE admin_id = ?').get(111111111) as { otp: string };
      expect(row?.otp).toBeDefined();

      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`${baseUrl}/api/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminId: 111111111, otp: '000000' }),
        });
        statuses.push(res.status);
      }
      // First 5 guesses: wrong-code 400s. Attempt 6+: blocked by limiter (429),
      // even if a later guess were correct — brute force cannot succeed.
      expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
      expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    });

    it('rate-limits order creation bursts (checkout limiter)', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 13; i++) {
        const res = await postOrder(baseUrl, { id: 350001, username: 'burst_buyer' }, {
          productId: 'gemini_pro_18m',
          variantId: 'gemini_pro_18m_default',
          amountETB: 1,
          paymentRail: 'cbe',
        });
        statuses.push(res.status);
      }
      // 10 requests pass the limiter (401/201 mix), the rest must be throttled.
      expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
      expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
    });

    it('enforces the 100kb global JSON body cap with HTTP 413', async () => {
      const res = await postOrder(baseUrl, { id: 350002, username: 'big_body' }, {
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        paymentRail: 'cbe',
        junkPadding: 'A'.repeat(160 * 1024),
      });
      expect(res.status).toBe(413);
    });

    it('still accepts large base64 receipts through the dedicated 3mb parser', async () => {
      const buyer = { id: 350003, username: 'receipt_uploader' };
      const order = createOrder({
        userId: buyer.id,
        username: buyer.username,
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      // Intercept all Bot API traffic so the admin-notification fan-out
      // doesn't hit the real Telegram network in tests.
      const { sent } = collectOutboundMessages(bot);

      // ~900KB image payload — far above the 100kb global cap, below 3mb receipt cap.
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const bigBase64 = Buffer.concat([pngHeader, Buffer.alloc(900 * 1024, 7)]).toString('base64');
      const res = await fetch(`${baseUrl}/api/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader(buyer) },
        body: JSON.stringify({
          orderId: order.id,
          receiptImageBase64: `data:image/jpeg;base64,${bigBase64}`,
          note: 'transfer done',
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.order.status).toBe('pending_approval');

      // Admins must be notified of the new receipt
      expect(sent.some((m) => m.method === 'sendPhoto' || m.method === 'sendMessage')).toBe(true);
    });

    it('sets core security headers on every response', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toBeTruthy();
      expect(res.headers.get('x-frame-options') ?? res.headers.get('referrer-policy')).toBeTruthy();
    });

    it('does not grant CORS to disallowed origins but allows the configured webapp origin', async () => {
      const evil = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://evil.example.net' } });
      expect(evil.headers.get('access-control-allow-origin')).toBeNull();

      const allowed = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://shop.bighabesha.test' } });
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://shop.bighabesha.test');
    });

    it('honours extra origins configured via CORS_ORIGINS', async () => {
      process.env.CORS_ORIGINS = 'https://pages.bighabesha.test, https://staging.bighabesha.test';
      resetConfigCache();

      await closeServer(server);
      server = createApiServer(bot);
      port = await listen(server);
      baseUrl = `http://localhost:${port}`;

      const res = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://pages.bighabesha.test' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://pages.bighabesha.test');
    });
  });

  // -------------------------------------------------------------------------
  // FIX 6: i18n availability (runtime dictionary loading)
  // -------------------------------------------------------------------------

  describe('Fix 6: Translations are available through the runtime loader', () => {
    it('loads the English dictionary from disk exactly as the compiled app does', async () => {
      const { loadTranslations, t } = await import('../src/i18n/index.js');
      loadTranslations(path.join(__dirname, '../src/i18n'));
      expect(t('en', 'menu.shop')).toBe('Browse Shop');
    });

    it('ships locale files alongside source so the build copy step can bundle them', () => {
      const localeDir = path.join(__dirname, '../src/i18n');
      const files = fs.readdirSync(localeDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain('en.json');
    });

    it('build script copies locales AND sql migrations into dist (fresh-deploy schema fix)', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
      expect(pkg.scripts.build).toContain('copy-assets.mjs');
      expect(fs.existsSync(path.join(__dirname, '../scripts/copy-assets.mjs'))).toBe(true);

      // The copier must handle both i18n JSON and db migration SQL assets,
      // otherwise fresh production deployments crash with "no such table".
      const script = fs.readFileSync(path.join(__dirname, '../scripts/copy-assets.mjs'), 'utf-8');
      expect(script).toContain("'src', 'i18n'");
      expect(script).toContain("'src', 'db', 'migrations'");
    });
  });
});
