import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { resetConfigCache } from '../src/config/env.js';
import { createApiServer } from '../src/api/server.js';
import { createBot } from '../src/bot/bot.js';
import type { Bot } from 'grammy';
import { createOrder, getOrderById, updateOrderStatus, approveReceipt, submitReceipt } from '../src/services/orders.service.js';
import { addStockLink, getAvailableStockCount } from '../src/services/stock.service.js';
import { getPublicSettings, getSetting, setSetting } from '../src/services/settings.service.js';
import { saveUserPhone, isUserRegistered } from '../src/services/users.service.js';
import {
  verifyWalletPayWebhookSignature,
  isWebhookTimestampFresh,
  WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS,
} from '../src/services/payments/live_wallet_pay.js';
import { MockWalletPayAdapter } from '../src/services/payments/mock_wallet_pay.js';
import { reconcileStuckWalletPayOrders, resetWalletPayAdapter } from '../src/services/payments/index.js';
import { generateSvgBanner } from '../src/services/banner_generator.service.js';
import { promptReceiptUpload, performAdminApprove } from '../src/bot/handlers/checkout.js';
import { handleTextInput } from '../src/bot/handlers/input.js';
import { setPendingAction, getPendingAction } from '../src/bot/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
const ADMIN_PASSWORD = 'secure-test-password-2026!';
const WEBHOOK_KEY = 'wh-secret-store-key';
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as any).port));
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Signs a webhook body exactly the way Wallet Pay documents it. */
function signWebhook(key: string, body: string, tsSec: number, p = '/api/wallet-pay/webhook'): string {
  const b64Body = Buffer.from(body, 'utf-8').toString('base64');
  const dataToSign = `POST.${p}.${tsSec}.${b64Body}`;
  return crypto.createHmac('sha256', key).update(dataToSign).digest('hex');
}

/** Intercepts all Bot API traffic — records every method call, never touches the network. */
function interceptApi(bot: Bot): { calls: { method: string; payload: any }[] } {
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use((async (_prev: any, method: string, payload: any) => {
    calls.push({ method, payload });
    return { ok: true, result: method === 'getMe' ? { id: 42, is_bot: true, username: 't' } : true };
  }) as any);
  return { calls };
}

function makeBotWithInfo(token: string): Bot {
  const bot = createBot(token);
  (bot as any).botInfo = { id: 42, is_bot: true, username: 'bighabesha_test_bot', first_name: 'Test Bot' };
  return bot;
}

async function sendText(bot: Bot, userId: number, text: string): Promise<void> {
  await bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      from: { id: userId, is_bot: false, first_name: 'T', username: `u${userId}` },
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text,
      entities: [{ offset: 0, length: text.split(/\s+/)[0].length, type: 'bot_command' }],
    },
  } as any);
}

async function sendCallback(bot: Bot, userId: number, data: string): Promise<void> {
  await bot.handleUpdate({
    update_id: Date.now(),
    callback_query: {
      id: String(Math.random()),
      from: { id: userId, is_bot: false, first_name: 'T', username: `u${userId}` },
      data,
      chat_instance: 'ci',
      message: { message_id: 77, date: Math.floor(Date.now() / 1000), chat: { id: userId, type: 'private' } },
    },
  } as any);
}

async function sendPreCheckout(bot: Bot, userId: number, orderId: string): Promise<void> {
  await bot.handleUpdate({
    update_id: Date.now(),
    pre_checkout_query: {
      id: 'pcq-1',
      from: { id: userId, is_bot: false, first_name: 'T' },
      currency: 'XTR',
      total_amount: 600,
      invoice_payload: `order_${orderId}`,
    },
  } as any);
}

async function sendSuccessfulStarsPayment(bot: Bot, userId: number, orderId: string): Promise<void> {
  await bot.handleUpdate({
    update_id: Date.now(),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      from: { id: userId, is_bot: false, first_name: 'T', username: `u${userId}` },
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      successful_payment: {
        currency: 'XTR',
        total_amount: 600,
        invoice_payload: `order_${orderId}`,
        telegram_payment_charge_id: 'chg-test-001',
        provider_payment_charge_id: '',
      },
    },
  } as any);
}

function seedUser(db: Database.Database, id: number, username: string): void {
  db.prepare('INSERT INTO users (id, username, first_name) VALUES (?, ?, ?)').run(id, username, 'U');
}

// ---------------------------------------------------------------------------
// Fix 1: Wallet Pay signature & freshness primitives
// ---------------------------------------------------------------------------

describe('Fix 1a: Wallet Pay webhook signature primitives', () => {
  const KEY = 'unit-key';
  const BODY = '{"event":"ORDER_PAID"}';
  const TS = '1700000000';

  it('accepts the canonical hex-encoded HMAC over method.path.timestamp.base64(body)', () => {
    const sig = signWebhook(KEY, BODY, Number(TS));
    expect(verifyWalletPayWebhookSignature(KEY, sig, TS, 'POST', '/api/wallet-pay/webhook', BODY)).toBe(true);
  });

  it('accepts base64 encoding of the same HMAC (encoding tolerance, same scheme)', () => {
    const b64Body = Buffer.from(BODY).toString('base64');
    const base = `POST./x.${TS}.${b64Body}`;
    const b64Sig = crypto.createHmac('sha256', KEY).update(base).digest('base64');
    expect(verifyWalletPayWebhookSignature(KEY, b64Sig, TS, 'POST', '/x', BODY)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signWebhook(KEY, BODY, Number(TS));
    expect(verifyWalletPayWebhookSignature(KEY, sig, TS, 'POST', '/api/wallet-pay/webhook', '{"event":"ORDER_PAID","amount":0}')).toBe(false);
  });

  it('rejects signatures computed with the wrong key', () => {
    const sig = signWebhook('other-key', BODY, Number(TS));
    expect(verifyWalletPayWebhookSignature(KEY, sig, TS, 'POST', '/api/wallet-pay/webhook', BODY)).toBe(false);
  });

  it('rejects the old shotgun "direct-body HMAC" schemes', () => {
    const directB64 = crypto.createHmac('sha256', KEY).update(BODY).digest('base64');
    expect(verifyWalletPayWebhookSignature(KEY, directB64, TS, 'POST', '/api/wallet-pay/webhook', BODY)).toBe(false);
  });

  it('rejects missing inputs', () => {
    expect(verifyWalletPayWebhookSignature('', 'sig', TS, 'POST', '/x', BODY)).toBe(false);
    expect(verifyWalletPayWebhookSignature(KEY, '', TS, 'POST', '/x', BODY)).toBe(false);
    expect(verifyWalletPayWebhookSignature(KEY, 'sig', '', 'POST', '/x', BODY)).toBe(false);
  });

  it('enforces timestamp freshness within the configured skew window', () => {
    const now = 1_700_000_000_000;
    expect(isWebhookTimestampFresh(now / 1000, now)).toBe(true);
    expect(isWebhookTimestampFresh(now / 1000 - 60, now)).toBe(true);
    expect(isWebhookTimestampFresh(now / 1000 - WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS - 1, now)).toBe(false);
    expect(isWebhookTimestampFresh(now / 1000 + WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS + 1, now)).toBe(false);
    expect(isWebhookTimestampFresh('not-a-number', now)).toBe(false);
    expect(isWebhookTimestampFresh('0', now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fix 1b + 2 + 7: webhook endpoint integration (mock mode: freshness & amount rules)
// ---------------------------------------------------------------------------

describe('Fix 1b: Webhook endpoint validation & amount verification', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();

    db = initDatabase(':memory:', MIGRATIONS_DIR);
    const bot = makeBotWithInfo(TOKEN);
    interceptApi(bot);
    server = createApiServer(bot);
    port = await listen(server);
  });

  afterEach(async () => {
    await closeServer(server);
    closeDatabase();
    resetConfigCache();
    resetWalletPayAdapter();
  });

  function walletOrderWithQuote(amount: number, currency = 'TON'): ReturnType<typeof createOrder> {
    const order = createOrder({
      userId: 444000,
      username: 'wp_buyer',
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1100,
      paymentRail: 'wallet_pay',
    });
    updateOrderStatus(order.id, 'awaiting_payment', {
      payment_ref: `wp-ref-${order.id}`,
      crypto_amount: amount,
      crypto_currency: currency,
    });
    return order;
  }

  async function postWebhook(payloadBody: any, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`http://localhost:${port}/api/wallet-pay/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payloadBody),
    });
  }

  it('rejects events without a timestamp header (replay guard)', async () => {
    const order = walletOrderWithQuote(3.21);
    const res = await postWebhook({ event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', amount: { currencyCode: 'TON', amount: '3.21' } } });
    expect(res.status).toBe(400);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('rejects replayed events older than the freshness window even with otherwise-valid content', async () => {
    const order = walletOrderWithQuote(3.21);
    const staleTs = Math.floor(Date.now() / 1000) - WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS - 30;
    const res = await postWebhook(
      { event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', amount: { currencyCode: 'TON', amount: '3.21' } } },
      { 'x-wallet-pay-timestamp': String(staleTs) }
    );
    expect(res.status).toBe(400);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('rejects timestamps far in the future', async () => {
    const order = walletOrderWithQuote(3.21);
    const futureTs = Math.floor(Date.now() / 1000) + WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS * 10;
    const res = await postWebhook(
      { event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', amount: { currencyCode: 'TON', amount: '3.21' } } },
      { 'x-wallet-pay-timestamp': String(futureTs) }
    );
    expect(res.status).toBe(400);
  });

  it('does NOT fulfil an order when the paid amount mismatches the stored quote', async () => {
    const order = walletOrderWithQuote(3.21);
    const res = await postWebhook(
      { event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', amount: { currencyCode: 'TON', amount: '0.01' } } },
      { 'x-wallet-pay-timestamp': String(Math.floor(Date.now() / 1000)) }
    );
    expect(res.status).toBe(200); // accepted but ignored
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('does NOT fulfil an order when the currency mismatches the stored quote', async () => {
    const order = walletOrderWithQuote(3.21, 'TON');
    const res = await postWebhook(
      { event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', amount: { currencyCode: 'USDT', amount: '3.21' } } },
      { 'x-wallet-pay-timestamp': String(Math.floor(Date.now() / 1000)) }
    );
    expect(res.status).toBe(200);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('fails closed when neither the order nor the event carries a verifiable amount', async () => {
    // Order created directly without quote metadata (legacy/simulated row)
    const order = createOrder({
      userId: 444001,
      username: 'legacy_wp',
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1100,
      paymentRail: 'wallet_pay',
    });
    const res = await postWebhook(
      { event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID' } },
      { 'x-wallet-pay-timestamp': String(Math.floor(Date.now() / 1000)) }
    );
    expect(res.status).toBe(200);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('fulfils when amount AND currency match the stored quote', async () => {
    addStockLink('gemini_pro_18m', 'https://g.co/gemini/wp-matched-link-1');
    const order = createOrder({
      userId: 444002,
      username: 'wp_match',
      productId: 'gemini_pro_18m',
      variantId: 'gemini_pro_18m_default',
      amountETB: 1500,
      paymentRail: 'wallet_pay',
    });
    updateOrderStatus(order.id, 'awaiting_payment', {
      payment_ref: 'wp-ref-match',
      crypto_amount: 4.5,
      crypto_currency: 'TON',
    });

    const res = await postWebhook(
      {
        event: 'ORDER_PAID',
        payload: {
          externalId: order.id,
          status: 'PAID',
          id: 'provider-event-id-9',
          amount: { currencyCode: 'TON', amount: '4.50' }, // string form, equal value
        },
      },
      { 'x-wallet-pay-timestamp': String(Math.floor(Date.now() / 1000)) }
    );

    expect(res.status).toBe(200);
    const updated = getOrderById(order.id);
    expect(updated?.status).toBe('fulfilled');
    expect(updated?.fulfillment_payload).toBe('https://g.co/gemini/wp-matched-link-1');
    expect(updated?.payment_ref).toBe('provider-event-id-9');
  });
});

// ---------------------------------------------------------------------------
// Fix 1c: live-mode signature enforcement over HTTP
// ---------------------------------------------------------------------------

describe('Fix 1c: Live-mode webhook requires strict signature', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'live';
    process.env.WALLET_PAY_API_KEY = WEBHOOK_KEY;
    process.env.NODE_ENV = 'development';
    resetConfigCache();

    db = initDatabase(':memory:', MIGRATIONS_DIR);
    const bot = makeBotWithInfo(TOKEN);
    interceptApi(bot);
    server = createApiServer(bot);
    port = await listen(server);
  });

  afterEach(async () => {
    await closeServer(server);
    closeDatabase();
    resetConfigCache();
    resetWalletPayAdapter();
  });

  function seedPaidOrder(): ReturnType<typeof createOrder> {
    seedUser(db, 455000, 'live_wp');
    addStockLink('gemini_pro_18m', 'https://g.co/gemini/live-sig-link-1');
    const order = createOrder({
      userId: 455000,
      username: 'live_wp',
      productId: 'gemini_pro_18m',
      variantId: 'gemini_pro_18m_default',
      amountETB: 1500,
      paymentRail: 'wallet_pay',
    });
    updateOrderStatus(order.id, 'awaiting_payment', {
      payment_ref: 'wp-live-ref',
      crypto_amount: 4.5,
      crypto_currency: 'TON',
    });
    return order;
  }

  it('returns 401 for unsigned requests', async () => {
    const res = await fetch(`http://localhost:${port}/api/wallet-pay/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'ORDER_PAID' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 for an invalid signature', async () => {
    const order = seedPaidOrder();
    const body = JSON.stringify({ event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', amount: { currencyCode: 'TON', amount: '4.5' } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await fetch(`http://localhost:${port}/api/wallet-pay/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wallet-pay-signature': 'deadbeef'.repeat(8), 'x-wallet-pay-timestamp': ts },
      body,
    });
    expect(res.status).toBe(403);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('rejects a REPLAYED event whose signature is valid but timestamp is stale', async () => {
    const order = seedPaidOrder();
    const body = JSON.stringify({ event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', amount: { currencyCode: 'TON', amount: '4.5' } } });
    const staleTs = Math.floor(Date.now() / 1000) - WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS - 60;
    const sig = signWebhook(WEBHOOK_KEY, body, staleTs);

    const res = await fetch(`http://localhost:${port}/api/wallet-pay/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wallet-pay-signature': sig, 'x-wallet-pay-timestamp': String(staleTs) },
      body,
    });
    expect(res.status).toBe(400);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('fulfils a correctly signed, fresh, amount-matching live event', async () => {
    const order = seedPaidOrder();
    const body = JSON.stringify({ event: 'ORDER_PAID', payload: { externalId: order.id, status: 'PAID', id: 'evt-live-1', amount: { currencyCode: 'TON', amount: '4.5' } } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signWebhook(WEBHOOK_KEY, body, Number(ts));

    const res = await fetch(`http://localhost:${port}/api/wallet-pay/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wallet-pay-signature': sig, 'x-wallet-pay-timestamp': ts },
      body,
    });
    expect(res.status).toBe(200);
    expect(getOrderById(order.id)?.status).toBe('fulfilled');
  });
});

// ---------------------------------------------------------------------------
// Fix 2: payment_ref persisted at creation & used by reconciliation
// ---------------------------------------------------------------------------

describe('Fix 2: payment_ref persistence & reconciliation wiring', () => {
  let db: Database.Database;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    const bot = makeBotWithInfo(TOKEN);
    interceptApi(bot);
    server = createApiServer(bot);
    port = await listen(server);
  });

  afterEach(async () => {
    await closeServer(server);
    closeDatabase();
    resetConfigCache();
    resetWalletPayAdapter();
  });

  it('persists payment_ref and crypto quote immediately when creating a Wallet Pay payment via the API', async () => {
    addStockLink('gemini_pro_18m', 'https://g.co/high-sev/wp-ref-stock');
    // Inline initData generator (same HMAC scheme as the other suites)
    const userObj = { id: 466000, first_name: 'WP', username: 'wp_api_buyer' };
    const rawParams = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAHdF6IQAAAAAN0XohD_x',
      user: JSON.stringify(userObj),
    };
    const items = Object.entries(rawParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(items.join('\n')).digest('hex');
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(rawParams)) sp.set(k, v);
    sp.set('hash', hash);

    const res = await fetch(`http://localhost:${port}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${sp.toString()}` },
      body: JSON.stringify({ productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', paymentRail: 'wallet_pay' }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    const stored = getOrderById(data.order.id);
    expect(stored?.payment_ref).toBeTruthy();
    expect(String(stored?.payment_ref)).toMatch(/^MOCK-WP-/);
    expect(stored?.crypto_amount).toBeGreaterThan(0);
    expect(stored?.crypto_currency).toBe('TON');
  });

  it('reconciliation queries Wallet Pay using the stored payment_ref (not the internal order id)', async () => {
    seedUser(db, 466100, 'stuck_ref_user');
    db.prepare(`
      INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, payment_ref, status, created_at)
      VALUES ('ORD-REF-STUCK-1', 466100, 'stuck_ref_user', 'telegram_premium', 1100, 'wallet_pay', 'wp-provider-ref-XYZ', 'awaiting_payment', datetime('now', '-6 minutes'))
    `).run();

    const original = MockWalletPayAdapter.prototype.verifyPayment;
    let capturedRef: string | null = null;
    (MockWalletPayAdapter.prototype as any).verifyPayment = async function (ref: string) {
      capturedRef = ref;
      return true;
    };

    try {
      const reconciled = await reconcileStuckWalletPayOrders(undefined);
      expect(reconciled).toBe(1);
      expect(capturedRef).toBe('wp-provider-ref-XYZ');
    } finally {
      (MockWalletPayAdapter.prototype as any).verifyPayment = original;
    }

    expect(getOrderById('ORD-REF-STUCK-1')?.status).toBe('pending_fulfillment');
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Authorization & ownership enforcement
// ---------------------------------------------------------------------------

describe('Fix 3: Authorization & ownership guards on order actions', () => {
  let db: Database.Database;
  let bot: Bot;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    bot = makeBotWithInfo(TOKEN);
    interceptApi(bot);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  function makeCtx(userId: number) {
    const ctx = {
      from: { id: userId, is_bot: false, first_name: 'U', username: `u${userId}` },
      reply: async () => ({}),
      editMessageText: async () => ({}),
      editMessageCaption: async () => ({}),
      answerCallbackQuery: async () => ({}),
      api: { sendMessage: async () => ({}), sendPhoto: async () => ({}) },
      callbackQuery: undefined as any,
    };
    return ctx as any;
  }

  it('blocks IDOR: a foreign user cannot cancel another user’s order', async () => {
    seedUser(db, 477001, 'owner');
    const order = createOrder({ userId: 477001, username: 'owner', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });

    await sendCallback(bot, 999999, `cancel_order_${order.id}`);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('allows the owner to cancel their own awaiting-payment order', async () => {
    seedUser(db, 477002, 'owner2');
    const order = createOrder({ userId: 477002, username: 'owner2', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });

    await sendCallback(bot, 477002, `cancel_order_${order.id}`);
    expect(getOrderById(order.id)?.status).toBe('cancelled');
  });

  it('prevents cancelling orders in terminal states', async () => {
    seedUser(db, 477003, 'owner3');
    const order = createOrder({ userId: 477003, username: 'owner3', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    updateOrderStatus(order.id, 'fulfilled');

    await sendCallback(bot, 477003, `cancel_order_${order.id}`);
    expect(getOrderById(order.id)?.status).toBe('fulfilled');
  });

  it('promptReceiptUpload refuses foreign orders (no session planted)', async () => {
    seedUser(db, 477004, 'victim');
    const foreignOrder = createOrder({ userId: 477004, username: 'victim', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });

    await promptReceiptUpload(makeCtx(888888), foreignOrder.id);
    expect(getPendingAction(888888)).toBeUndefined();
  });

  it('promptReceiptUpload plants the receipt session for the rightful owner', async () => {
    seedUser(db, 477005, 'owner5');
    const order = createOrder({ userId: 477005, username: 'owner5', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });

    await promptReceiptUpload(makeCtx(477005), order.id);
    const session = getPendingAction(477005);
    expect(session?.type).toBe('user_receipt_upload');
  });

  it('performAdminApprove ignores non-admin callers entirely', async () => {
    seedUser(db, 477006, 'buyer6');
    const order = createOrder({ userId: 477006, username: 'buyer6', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    submitReceipt(order.id);

    await performAdminApprove(makeCtx(666666), order.id);
    expect(getOrderById(order.id)?.status).toBe('pending_approval');
  });

  it('performAdminApprove works for configured administrators', async () => {
    seedUser(db, 477007, 'buyer7');
    const order = createOrder({ userId: 477007, username: 'buyer7', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    submitReceipt(order.id);

    await performAdminApprove(makeCtx(111111111), order.id);
    expect(getOrderById(order.id)?.status).toBe('pending_fulfillment');
  });

  it('admin_fulfill_proof text action is inert for non-admins', async () => {
    seedUser(db, 477008, 'buyer8');
    const order = createOrder({ userId: 477008, username: 'buyer8', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    updateOrderStatus(order.id, 'pending_fulfillment');

    plantActionSession(777777, 'admin_fulfill_proof', { orderId: order.id });

    const ctx = makeCtx(777777);
    ctx.message = { text: 'Delivered via Fragment' };
    const handled = await handleTextInput(ctx);

    expect(handled).toBe(true); // consumed silently, but...
    expect(getOrderById(order.id)?.status).toBe('pending_fulfillment'); // ...NOT fulfilled
  });

  it('refund_order text action is inert for non-admins', async () => {
    seedUser(db, 477009, 'buyer9');
    const order = createOrder({ userId: 477009, username: 'buyer9', productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });

    plantActionSession(555555, 'refund_order', { orderId: order.id });
    const ctx = makeCtx(555555);
    ctx.message = { text: 'fraudulent order' };
    await handleTextInput(ctx);

    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });
});

// Session-planting helper for input-handler tests
function plantActionSession(userId: number, action: string, extra: Record<string, unknown>): void {
  setPendingAction(userId, {
    type: 'stars_custom_amount',
    data: { minStars: 10, maxStars: 100, etbPerStar: 2.5, action, ...extra },
  } as any);
}

// ---------------------------------------------------------------------------
// Fix 4: Stars checkout stock race & paid-order recovery
// ---------------------------------------------------------------------------

describe('Fix 4: Stars pre-checkout stock gate & delivery-failure recovery', () => {
  let db: Database.Database;
  let bot: Bot;
  let api: ReturnType<typeof interceptApi>;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111,222222333';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    bot = makeBotWithInfo(TOKEN);
    api = interceptApi(bot);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  function starsStockOrder(userId: number, username: string): ReturnType<typeof createOrder> {
    seedUser(db, userId, username);
    return createOrder({
      userId,
      username,
      productId: 'gemini_pro_18m',
      variantId: 'gemini_pro_18m_default',
      amountETB: 1500,
      paymentRail: 'stars',
    });
  }

  it('REJECTS the Stars invoice when stock is empty (no funds captured)', async () => {
    const order = starsStockOrder(488001, 'race_buyer'); // no stock added

    await sendPreCheckout(bot, 488001, order.id);

    const answer = api.calls.find((c) => c.method === 'answerPreCheckoutQuery');
    expect(answer).toBeDefined();
    expect(answer!.payload.ok).toBe(false);
    expect(String(answer!.payload.error_message)).toMatch(/sold out/i);
    expect(getOrderById(order.id)?.status).toBe('awaiting_payment');
  });

  it('ACCEPTS the Stars invoice when stock is available', async () => {
    const order = starsStockOrder(488002, 'happy_star');
    addStockLink('gemini_pro_18m', 'https://g.co/gemini/precheck-ok-1');

    await sendPreCheckout(bot, 488002, order.id);

    const answer = api.calls.find((c) => c.method === 'answerPreCheckoutQuery');
    expect(answer?.payload.ok).toBe(true);
  });

  it('ACCEPTS invoices for non-stock products regardless of stock counters', async () => {
    seedUser(db, 488003, 'premium_nostock');
    const order = createOrder({
      userId: 488003,
      username: 'premium_nostock',
      productId: 'telegram_premium',
      variantId: 'tg_prem_6m',
      amountETB: 1900,
      paymentRail: 'stars',
    });

    await sendPreCheckout(bot, 488003, order.id);
    const answer = api.calls.find((c) => c.method === 'answerPreCheckoutQuery');
    expect(answer?.payload.ok).toBe(true);
  });

  it('recovers gracefully when funds are captured but stock is gone before allocation', async () => {
    const order = starsStockOrder(488004, 'unlucky_buyer');
    // Stock raced to zero between invoice acceptance and payment capture:
    expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

    await sendSuccessfulStarsPayment(bot, 488004, order.id);

    const final = getOrderById(order.id);
    // Order MUST remain actionable (pending_fulfillment), never silently dropped
    expect(final?.status).toBe('pending_fulfillment');
    expect(final?.admin_notes).toMatch(/AUTOMATIC DELIVERY FAILED/i);

    // Urgent admin alert broadcast to every configured admin
    const adminMsgs = api.calls.filter(
      (c) => c.method === 'sendMessage' &&
        [111111111, 222222333].includes(c.payload.chat_id) &&
        String(c.payload.text).includes('Needs Manual Fulfillment')
    );
    expect(adminMsgs.length).toBeGreaterThanOrEqual(2);

    // Buyer got a reassuring confirmation acknowledging the captured payment
    const buyerMsgs = api.calls.filter(
      (c) => c.method === 'sendMessage' && c.payload.chat_id === 488004
    );
    expect(buyerMsgs.length).toBeGreaterThanOrEqual(1);
    expect(String(buyerMsgs[0]?.payload.text)).toMatch(/Payment Received/i);
  });

  it('delivers normally when stock is available through the full Stars flow', async () => {
    const order = starsStockOrder(488005, 'smooth_buyer');
    addStockLink('gemini_pro_18m', 'https://g.co/gemini/smooth-delivery-1');
    updateOrderStatus(order.id, 'pending_approval');

    await sendSuccessfulStarsPayment(bot, 488005, order.id);

    const final = getOrderById(order.id);
    expect(final?.status).toBe('fulfilled');
    expect(final?.fulfillment_payload).toBe('https://g.co/gemini/smooth-delivery-1');
    expect(final?.payment_ref).toBe('chg-test-001');
  });
});

// ---------------------------------------------------------------------------
// Fix 6: Registration works when starting directly from /shop
// ---------------------------------------------------------------------------

describe('Fix 6: Phone registration succeeds without ever sending /start', () => {
  let db: Database.Database;
  let bot: Bot;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    bot = makeBotWithInfo(TOKEN);
    interceptApi(bot);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('/shop -> share contact registers a user that never ran /start', async () => {
    expect(isUserRegistered(491001)).toBe(false);

    // Step 1: brand-new user sends /shop — gets registration prompt
    await sendText(bot, 491001, '/shop');
    expect(isUserRegistered(491001)).toBe(false);
    expect(getPendingAction(491001)?.type).toBe('user_phone_registration');

    // Step 2: user shares contact
    await bot.handleUpdate({
      update_id: Date.now(),
      message: {
        message_id: 5,
        from: { id: 491001, is_bot: false, first_name: 'New', username: 'fresh_user' },
        chat: { id: 491001, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        contact: { phone_number: '+251911223344', first_name: 'New', user_id: 491001 },
      },
    } as any);

    // Step 3: registration SUCCEEDED (row created, flagged, phone normalized)
    expect(isUserRegistered(491001)).toBe(true);
    const row = db.prepare('SELECT phone_number, is_registered FROM users WHERE id = ?').get(491001) as any;
    expect(row.is_registered).toBe(1);
    expect(row.phone_number).toBe('+251911223344');
  });

  it('/shop -> manual phone text entry also registers cleanly', async () => {
    await sendText(bot, 491002, '/shop');
    await sendText(bot, 491002, '0911223344');

    expect(isUserRegistered(491002)).toBe(true);
    const row = db.prepare('SELECT phone_number FROM users WHERE id = ?').get(491002) as any;
    expect(row.phone_number).toBe('+251911223344');
  });

  it('saveUserPhone creates missing rows instead of silently no-oping', () => {
    const saved = saveUserPhone(491003, '+251900000000');
    expect(saved.is_registered).toBe(1);
    expect(saved.phone_number).toBe('+251900000000');
    expect(isUserRegistered(491003)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 7: Public settings whitelist (bootstrap leak)
// ---------------------------------------------------------------------------

describe('Fix 7: getPublicSettings whitelist', () => {
  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    initDatabase(':memory:', MIGRATIONS_DIR);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('exposes storefront-facing keys only', () => {
    const pub = getPublicSettings();
    expect(pub.etb_per_star).toBeDefined();
    expect(pub.cbe_account).toBeDefined();
    expect(pub.telebirr_account).toBeDefined();

    // Display-currency FX is public; operational params stay private
    expect(pub.etb_per_usd).toBeDefined();
    expect(pub.margin_pct).toBeUndefined();
    expect(pub.low_stock_threshold).toBeUndefined();
    expect(pub.gemini_instructions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fix 8 + 9: hardcoded merchant data & magic admin IDs purged from source
// ---------------------------------------------------------------------------

describe('Fix 8/9: No real merchant accounts or magic admin IDs in source', () => {
  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    initDatabase(':memory:', MIGRATIONS_DIR);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  function* walkSources(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walkSources(full);
      else if (/\.(ts|sql)$/.test(entry.name)) yield full;
    }
  }

  it('source tree contains no real bank/merchant account numbers', () => {
    const srcDir = path.join(__dirname, '../src');
    const forbidden = ['1000510711258', '0965579045'];
    for (const file of walkSources(srcDir)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const acct of forbidden) {
        expect(content.includes(acct), `${file} contains hardcoded account ${acct}`).toBe(false);
      }
    }
  });

  it('seeded defaults are placeholders, not production accounts', () => {
    expect(getSetting('cbe_account', '')).toBe('0000000000000');
    expect(getSetting('telebirr_account', '')).toBe('0000000000');
  });

  it('no magic fallback admin ID remains in source code', () => {
    const srcDir = path.join(__dirname, '../src');
    for (const file of walkSources(srcDir)) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content.includes('1397163638'), `${file} contains magic admin ID`).toBe(false);
    }
  });

  it('banner content follows the settings table dynamically', () => {
    const before = generateSvgBanner('checkout');
    expect(before).toContain('0000000000000');

    setSetting('cbe_account', '5555123456');
    setSetting('telebirr_account', '0911122233');
    const after = generateSvgBanner('checkout');
    expect(after).toContain('5555123456');
    expect(after).toContain('0911122233');

    // Prices are catalog-driven too
    const geminiSvg = generateSvgBanner('gemini');
    expect(geminiSvg).toContain('1,500 ETB');
  });

  it('welcome banner reflects catalog prices rather than constants', () => {
    const welcome = generateSvgBanner('welcome');
    expect(welcome).toContain('1,500 ETB');   // gemini seed price
    expect(welcome).toContain('from 1,100 ETB'); // premium min seed price
    expect(welcome).toContain('1 Star = 2.5 ETB');
  });
});
