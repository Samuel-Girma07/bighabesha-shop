import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { validateTelegramInitData } from '../src/api/auth.js';
import { createApiServer } from '../src/api/server.js';
import { createBot } from '../src/bot/bot.js';
import { addStockLink } from '../src/services/stock.service.js';
import { resolveStoredReceiptPath } from '../src/services/receipts.service.js';
import { getOrderById, createOrder, updateOrderStatus } from '../src/services/orders.service.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

describe('Phase 5: Telegram Mini App & Authenticated API', () => {
  const token = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = token;
    process.env.ADMIN_IDS = '111111111,222222333';
    process.env.ADMIN_PASSWORD = 'Bighabesha2026!Admin';
    process.env.WALLET_PAY_MODE = 'mock';
    db = initDatabase(':memory:', migrationsDir);

    const bot = createBot(token);
    server = createApiServer(bot);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
  });

  describe('Telegram initData HMAC Authentication', () => {
    it('successfully validates authentic Telegram initData and returns parsed user', () => {
      const user = { id: 123456, first_name: 'Abebe', username: 'abebe_eth', language_code: 'en' };
      const initData = generateValidInitData(user, token);

      const result = validateTelegramInitData(initData, token);
      expect(result).toBeDefined();
      expect(result?.user.id).toBe(123456);
      expect(result?.user.username).toBe('abebe_eth');
    });

    it('rejects initData older than 24 hours (86400 seconds)', () => {
      const user = { id: 123456, first_name: 'Abebe', username: 'abebe_eth' };
      const expiredDate = Math.floor(Date.now() / 1000) - 86405; // >24h ago
      const expiredInitData = generateValidInitData(user, token, expiredDate);

      const result = validateTelegramInitData(expiredInitData, token);
      expect(result).toBeNull();
    });

    it('rejects initData with future auth_date', () => {
      const user = { id: 123456, first_name: 'Abebe', username: 'abebe_eth' };
      const futureDate = Math.floor(Date.now() / 1000) + 120; // 2 min into future
      const futureInitData = generateValidInitData(user, token, futureDate);

      const result = validateTelegramInitData(futureInitData, token);
      expect(result).toBeNull();
    });

    it('rejects tampered initData where user details have been modified', () => {
      const user = { id: 123456, first_name: 'Abebe', username: 'abebe_eth' };
      const validInitData = generateValidInitData(user, token);

      // Tamper with user payload without re-signing
      const tampered = validInitData.replace('abebe_eth', 'hacked_username');

      const result = validateTelegramInitData(tampered, token);
      expect(result).toBeNull();
    });

    it('rejects initData signed with wrong bot token', () => {
      const user = { id: 123456, first_name: 'Abebe' };
      const initData = generateValidInitData(user, 'DIFFERENT_BOT_TOKEN');

      const result = validateTelegramInitData(initData, token);
      expect(result).toBeNull();
    });

    it('rejects empty or missing parameters', () => {
      expect(validateTelegramInitData('', token)).toBeNull();
      expect(validateTelegramInitData('random_query_without_hash=123', token)).toBeNull();
    });
  });

  describe('Admin Security & Multi-Admin 2FA', () => {
    it('strictly rejects dev_admin_master_session backdoor token', async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/overview`, {
        headers: {
          Authorization: 'Bearer dev_admin_master_session',
        },
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Session expired. Please log in again.');
    });

    it('allows multi-admin login and generates OTP linked to configured ADMIN_IDS', async () => {
      // Step 1: Login request for secondary admin 222222333
      const loginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'Bighabesha2026!Admin',
          adminId: 222222333,
        }),
      });

      expect(loginRes.status).toBe(200);
      const loginData = await loginRes.json();
      expect(loginData.success).toBe(true);
      expect(loginData.require2FA).toBe(true);
      expect(loginData.adminId).toBe(222222333);

      // Rejects unconfigured admin ID
      const unauthLoginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'Bighabesha2026!Admin',
          adminId: 111222333,
        }),
      });
      expect(unauthLoginRes.status).toBe(403);
    });

    it('calculates 1D overview hourly points for today in Ethiopian UTC+3 without including historical days', async () => {
      // 1. Create a valid admin session
      const token = 'admin_session_test_token_overview_1d';
      const expiresAt = Date.now() + 3600 * 1000;
      db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(token, 111111111, expiresAt);

      // 2. Insert users
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(111, 'old_user');
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(222, 'today_user');

      // 3. Insert historical order from 5 days ago (fulfilled)
      db.prepare(`
        INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-5 days'))
      `).run('HISTORICAL_ORD_1', 111, 'old_user', 'gemini_pro_18m', 1500, 'cbe', 'fulfilled');

      // 4. Insert order today (fulfilled)
      db.prepare(`
        INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run('TODAY_ORD_1', 222, 'today_user', 'gemini_pro_18m', 1500, 'cbe', 'fulfilled');

      // 5. Request 1D overview
      const res = await fetch(`http://localhost:${port}/api/admin/overview?range=1D`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.metrics.totalRevenueETB).toBe(3000); // 1500 + 1500 lifetime
      expect(data.chartPoints).toHaveLength(8);

      // Sum of hourly points in 1D chart should reflect ONLY today's order (1500 ETB), NOT historical order (3000 ETB)
      const chartPointsRevenueSum = data.chartPoints.reduce((acc: number, pt: any) => acc + pt.revenue, 0);
      expect(chartPointsRevenueSum).toBe(1500);

      const chartPointsOrdersSum = data.chartPoints.reduce((acc: number, pt: any) => acc + pt.orders, 0);
      expect(chartPointsOrdersSum).toBe(1);
    });
  });

  describe('REST API Contracts', () => {
    it('returns status ok on GET /api/health', async () => {
      const res = await fetch(`http://localhost:${port}/api/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });

    it('returns catalog bootstrap data without requiring auth', async () => {
      const res = await fetch(`http://localhost:${port}/api/bootstrap`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.products).toHaveLength(3);
      // Only whitelisted public settings are exposed
      expect(data.settings.etb_per_star).toBe('2.5');
      expect(data.settings.cbe_account).toBeDefined();
      // Operational/private settings must NOT leak
      expect(data.settings.etb_per_usd).toBe('135'); // public display-currency rate
      expect(data.settings.margin_pct).toBeUndefined();
      expect(data.settings.gemini_instructions).toBeUndefined();
      expect(data.settings.low_stock_threshold).toBeUndefined();
    });

    it('rejects unauthorized access on /api/orders without initData', async () => {
      const res = await fetch(`http://localhost:${port}/api/orders`);
      expect(res.status).toBe(401);
    });

    it('allows authorized users with valid initData to create orders and view history', async () => {
      const user = { id: 777777, first_name: 'Buyer', username: 'habeshabuyer' };
      const authInitData = generateValidInitData(user, token);

      addStockLink('gemini_pro_18m', 'https://g.co/phase5/order-create-stock');

      // Create order
      const createRes = await fetch(`http://localhost:${port}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${authInitData}`,
        },
        body: JSON.stringify({
          productId: 'gemini_pro_18m',
          variantId: 'gemini_pro_18m_default',
          paymentRail: 'cbe',
        }),
      });

      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      expect(created.order.id).toMatch(/^ORD-/);
      expect(created.order.user_id).toBe(777777);
      // Price is resolved server-side from the catalog, not from client input
      expect(created.order.amount_etb).toBe(1500);

      // View orders
      const listRes = await fetch(`http://localhost:${port}/api/orders`, {
        headers: {
          Authorization: `tma ${authInitData}`,
        },
      });

      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.orders.length).toBeGreaterThan(0);
      expect(listData.orders[0].id).toBe(created.order.id);
    });

    it('enforces Username Gate in API when purchasing Telegram Premium without a username', async () => {
      const userWithoutUsername = { id: 888888, first_name: 'NoUser' }; // no username
      const authInitData = generateValidInitData(userWithoutUsername, token);

      const res = await fetch(`http://localhost:${port}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${authInitData}`,
        },
        body: JSON.stringify({
          productId: 'telegram_premium',
          variantId: 'tg_prem_3m',
          amountETB: 1100,
          paymentRail: 'cbe',
        }),
      });

      expect(res.status).toBe(403);
      const errorData = await res.json();
      expect(errorData.error).toBe('USERNAME_REQUIRED');
    });

    it('saves uploaded base64 receipt to disk and updates order to pending_approval', async () => {
      const user = { id: 654321, first_name: 'ReceiptBuyer', username: 'receipt_buyer' };
      const authInitData = generateValidInitData(user, token);

      const order = createOrder({
        userId: user.id,
        username: user.username,
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });

      const sampleBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

      const res = await fetch(`http://localhost:${port}/api/receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${authInitData}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          receiptImageBase64: sampleBase64,
          note: 'CBE Ref #FT2608192837',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.order.status).toBe('pending_approval');
      expect(data.order.receipt_note).toBe('CBE Ref #FT2608192837');
      expect(data.order.receipt_file_id).toMatch(/receipt_.*\.jpg$/);

      // Verify the file was physically saved to disk. receipt_file_id is a
      // filename-only reference — resolve it through the receipts directory.
      const savedPath = resolveStoredReceiptPath(data.order.receipt_file_id);
      expect(savedPath).toBeTruthy();
      expect(fs.existsSync(savedPath as string)).toBe(true);

      // Clean up test file
      try {
        fs.unlinkSync(savedPath as string);
      } catch {}
    });

    it('processes Wallet Pay webhook, marking stock orders as fulfilled with auto-delivery', async () => {
      // 1. Seed stock for Gemini Pro
      addStockLink('gemini_pro_18m', 'https://g.co/gemini/claim/test-wallet-pay-link-123');

      // 2. Create order on wallet_pay rail with a stored payment quote
      //    (as the creation flow now persists at payment-creation time)
      const order = createOrder({
        userId: 999888,
        username: 'cryptobuyer',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'wallet_pay',
        status: 'awaiting_payment',
      });
      updateOrderStatus(order.id, 'awaiting_payment', {
        payment_ref: 'wp-provider-ref-1',
        crypto_amount: 3.21,
        crypto_currency: 'TON',
      });

      // 3. Post webhook event from Wallet Pay (fresh timestamp + matching amount)
      const webhookRes = await fetch(`http://localhost:${port}/api/wallet-pay/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-pay-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        body: JSON.stringify({
          event: 'ORDER_PAID',
          payload: {
            id: 12345678,
            externalId: order.id,
            status: 'PAID',
            amount: { currencyCode: 'TON', amount: '3.21' },
          },
        }),
      });

      expect(webhookRes.status).toBe(200);

      // 4. Verify order is now fulfilled with auto-allocated stock link
      const updatedOrder = getOrderById(order.id);
      expect(updatedOrder).toBeDefined();
      expect(updatedOrder?.status).toBe('fulfilled');
      expect(updatedOrder?.fulfillment_payload).toBe('https://g.co/gemini/claim/test-wallet-pay-link-123');
      expect(updatedOrder?.payment_ref).toBe('12345678');
    });

    it('processes Wallet Pay webhook for non-stock order, transitioning to pending_fulfillment', async () => {
      const order = createOrder({
        userId: 999888,
        username: 'cryptobuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'wallet_pay',
        status: 'awaiting_payment',
      });
      updateOrderStatus(order.id, 'awaiting_payment', {
        payment_ref: 'wp-provider-ref-2',
        crypto_amount: 2.36,
        crypto_currency: 'TON',
      });

      const webhookRes = await fetch(`http://localhost:${port}/api/wallet-pay/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-pay-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        body: JSON.stringify([
          {
            event: 'ORDER_PAID',
            payload: {
              id: 87654321,
              externalId: order.id,
              status: 'PAID',
              amount: { currencyCode: 'TON', amount: '2.36' },
            },
          },
        ]),
      });

      expect(webhookRes.status).toBe(200);

      const updatedOrder = getOrderById(order.id);
      expect(updatedOrder).toBeDefined();
      expect(updatedOrder?.status).toBe('pending_fulfillment');
      expect(updatedOrder?.payment_ref).toBe('87654321');
    });
  });
});
