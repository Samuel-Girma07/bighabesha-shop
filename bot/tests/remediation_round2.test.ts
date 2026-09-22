import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import http from 'http';
import { Writable } from 'stream';
import pino from 'pino';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
import { addStockLink } from '../src/services/stock.service.js';
import { executeDirectFulfill } from '../src/bot/handlers/admin_queue.js';
import { createApiServer, createExpressApp, centralizedErrorHandler } from '../src/api/server.js';
import { setAdminBotInstance } from '../src/api/admin.js';
import { createBot } from '../src/bot/bot.js';
import { resetConfigCache } from '../src/config/env.js';
import { runLifecycleSweep } from '../src/services/lifecycle.service.js';
import { matchSmsToOrders } from '../src/services/sms_parser.service.js';
import { notifyAdminsNewReceipt } from '../src/bot/handlers/checkout.js';
import { cleanupInterruptedBroadcasts, getBroadcastJob } from '../src/services/broadcast.service.js';
import {
  startResellerRetrySweeper,
  stopResellerRetrySweeper,
  isResellerSweeperRunning,
} from '../src/services/reseller.service.js';
import * as resellerModule from '../src/services/reseller.service.js';
import { checkChannelMembership, getMembershipCacheSize, clearMembershipCache } from '../src/bot/handlers/onboarding.js';
import { handlePhotoInput } from '../src/bot/handlers/input.js';
import { setPendingAction } from '../src/bot/session.js';
import { LOGGER_REDACT_PATHS, logger } from '../src/logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ_rem2';
const ADMIN_ID = 111111111;
const ADMIN_PASSWORD = 'admin-secure-password-123';

describe('Round 2 Remediation Verification', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = String(ADMIN_ID);
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
    resetConfigCache();

    db = initDatabase(':memory:', MIGRATIONS_DIR);

    // Seed test admin user
    db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(ADMIN_ID, 'superadmin');
    db.prepare("INSERT OR REPLACE INTO admins (tg_user_id, role) VALUES (?, 'superadmin')").run(ADMIN_ID);
  });

  afterEach(() => {
    stopResellerRetrySweeper();
    closeDatabase();
    vi.restoreAllMocks();
  });

  describe('1. Dual-Surface Fulfillment Payload Delivery', () => {
    it('delivers activation link & gemini instructions to buyer on bot direct fulfillment with proper HTML escaping', async () => {
      // Seed buyer user
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202020, 'buyer_gemini');

      // Add stock payload containing query parameters (&) to verify Telegram HTML escaping
      const stockLink = 'https://g.co/gemini/activation-code-xyz123?ref=bot&source=direct';
      addStockLink('gemini_pro_18m', stockLink);

      // Create order in pending_fulfillment
      const order = createOrder({
        userId: 202020,
        username: 'buyer_gemini',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      const sentMessages: { targetId: number; text: string; opts: any }[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_ID },
        callbackQuery: { id: 'cb_123' },
        reply: vi.fn().mockResolvedValue({}),
        editMessageText: vi.fn().mockResolvedValue({}),
        answerCallbackQuery: vi.fn().mockResolvedValue({}),
        api: {
          sendMessage: vi.fn().mockImplementation((targetId: number, text: string, opts: any) => {
            sentMessages.push({ targetId, text, opts });
            return Promise.resolve({});
          }),
        },
      };

      await executeDirectFulfill(mockCtx, order.id);

      const updated = getOrderById(order.id);
      expect(updated?.status).toBe('fulfilled');
      expect(updated?.fulfillment_payload).toBe(stockLink);
      expect(updated?.fulfillment_proof).toBe('Direct fulfillment via bot admin queue');

      // Check message sent to buyer
      const buyerDelivery = sentMessages.find((m) => m.targetId === 202020);
      expect(buyerDelivery).toBeDefined();
      // Must contain escaped &amp; in Telegram HTML mode
      expect(buyerDelivery!.text).toContain('https://g.co/gemini/activation-code-xyz123?ref=bot&amp;source=direct');
      expect(buyerDelivery!.text).toContain('Activation Link:');
      expect(buyerDelivery!.text).toContain('Ensure your VPN is connected');
    });

    it('delivers activation link & instructions to buyer via Admin API POST /orders/:id/fulfill with proper HTML escaping', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(303030, 'buyer_api');

      const stockLink = 'https://g.co/gemini/activation-code-api456?ref=api&source=dashboard';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 303030,
        username: 'buyer_api',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'telebirr',
        status: 'pending_fulfillment',
      });

      const sentMessages: { targetId: number; text: string }[] = [];
      const mockBot = createBot(TOKEN);
      mockBot.api.sendMessage = vi.fn().mockImplementation((targetId: any, text: any) => {
        sentMessages.push({ targetId, text });
        return Promise.resolve({}) as any;
      });
      setAdminBotInstance(mockBot);

      const server: http.Server = createApiServer(mockBot);
      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => resolve((server.address() as any).port));
      });

      try {
        // Log in to get session token
        const loginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: ADMIN_PASSWORD }),
        });
        expect(loginRes.status).toBe(200);

        const otpRow = db.prepare('SELECT otp FROM admin_otps WHERE admin_id = ?').get(ADMIN_ID) as any;
        const verifyRes = await fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminId: ADMIN_ID, otp: otpRow.otp }),
        });
        const { token } = await verifyRes.json();
        expect(token).toBeTruthy();

        // Call fulfill
        const fulfillRes = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/fulfill`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ proofNote: 'Manual fulfillment note' }),
        });

        expect(fulfillRes.status).toBe(200);
        const data = await fulfillRes.json();
        expect(data.success).toBe(true);
        expect(data.order.fulfillment_payload).toBe(stockLink);
        expect(data.order.fulfillment_proof).toBe('Manual fulfillment note');

        const buyerMsg = sentMessages.find((m) => m.targetId === 303030);
        expect(buyerMsg).toBeDefined();
        expect(buyerMsg!.text).toContain('https://g.co/gemini/activation-code-api456?ref=api&amp;source=dashboard');
        expect(buyerMsg!.text).toContain('Activation Link:');
        expect(buyerMsg!.text).toContain('Ensure your VPN is connected');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('delivers activation link & instructions to buyer on photo proof fulfillment of stock product', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(353535, 'buyer_photo');
      const stockLink = 'https://g.co/gemini/activation-code-photo789?ref=photo&source=bot';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 353535,
        username: 'buyer_photo',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      setPendingAction(ADMIN_ID, {
        type: 'admin_queue_action',
        data: { action: 'admin_fulfill_proof', orderId: order.id },
      });

      const sentMessages: { targetId: number; text: string }[] = [];
      const sentPhotos: { targetId: number; fileId: string; opts: any }[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_ID },
        message: {
          photo: [{ file_id: 'photo_low' }, { file_id: 'photo_high' }],
          caption: 'Delivered screenshot proof',
        },
        reply: vi.fn().mockResolvedValue({}),
        api: {
          sendPhoto: vi.fn().mockImplementation((targetId: number, fileId: string, opts: any) => {
            sentPhotos.push({ targetId, fileId, opts });
            return Promise.resolve({});
          }),
          sendMessage: vi.fn().mockImplementation((targetId: number, text: string) => {
            sentMessages.push({ targetId, text });
            return Promise.resolve({});
          }),
        },
      };

      const handled = await handlePhotoInput(mockCtx);
      expect(handled).toBe(true);

      const updated = getOrderById(order.id);
      expect(updated?.status).toBe('fulfilled');
      expect(updated?.fulfillment_payload).toBe(stockLink);

      expect(sentPhotos.length).toBe(1);
      expect(sentPhotos[0].targetId).toBe(353535);

      const buyerMsg = sentMessages.find((m) => m.targetId === 353535);
      expect(buyerMsg).toBeDefined();
      expect(buyerMsg!.text).toContain('https://g.co/gemini/activation-code-photo789?ref=photo&amp;source=bot');
      expect(buyerMsg!.text).toContain('Activation Link:');
      expect(buyerMsg!.text).toContain('Ensure your VPN is connected');
    });
  });

  describe('2. Lifecycle Sweeper Ghost Reminder Prevention', () => {
    it('does not set reminded_at if message delivery rejects', async () => {
      // Create awaiting_payment order created 3 hours ago
      const order = createOrder({
        userId: 404040,
        username: 'unpaid_buyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });
      db.prepare("UPDATE orders SET created_at = datetime('now', '-3 hours') WHERE id = ?").run(order.id);

      const failingBot = {
        botInfo: { username: 'bighabesha_bot' },
        api: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Telegram API error: Bot blocked')),
        },
      };

      const result = runLifecycleSweep(failingBot);
      await Promise.allSettled(result.pendingDispatches || []);

      const updated = getOrderById(order.id);
      expect(updated?.reminded_at).toBeNull();
    });

    it('sets reminded_at when message delivery succeeds', async () => {
      const order = createOrder({
        userId: 505050,
        username: 'unpaid_buyer_ok',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });
      db.prepare("UPDATE orders SET created_at = datetime('now', '-3 hours') WHERE id = ?").run(order.id);

      const successBot = {
        botInfo: { username: 'bighabesha_bot' },
        api: {
          sendMessage: vi.fn().mockResolvedValue({}),
        },
      };

      const result = runLifecycleSweep(successBot);
      await Promise.all(result.pendingDispatches || []);

      const updated = getOrderById(order.id);
      expect(updated?.reminded_at).toBeTruthy();
    });

    it('still delivers reminder when botInfo.username is missing', async () => {
      const order = createOrder({
        userId: 555555,
        username: 'unpaid_buyer_no_uname',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });
      db.prepare("UPDATE orders SET created_at = datetime('now', '-3 hours') WHERE id = ?").run(order.id);

      const botWithoutUsername = {
        api: {
          sendMessage: vi.fn().mockResolvedValue({}),
        },
      };

      const result = runLifecycleSweep(botWithoutUsername);
      await Promise.all(result.pendingDispatches || []);

      const updated = getOrderById(order.id);
      expect(updated?.reminded_at).toBeTruthy();
      expect(botWithoutUsername.api.sendMessage).toHaveBeenCalledWith(
        555555,
        expect.stringContaining('Complete your order'),
        expect.any(Object)
      );
    });
  });

  describe('3. Reseller Sweeper Overlap Guard', () => {
    it('prevents concurrent sweeper executions when previous cycle is running', async () => {
      let isRunning = false;
      let overlaps = 0;

      const mockRetry = vi.spyOn(resellerModule, 'retryFailedResellerDeliveries').mockImplementation(async () => {
        if (isRunning) {
          overlaps++;
        }
        isRunning = true;
        await new Promise((r) => setTimeout(r, 100));
        isRunning = false;
        return { retried: 0, fulfilled: 0, failed: 0 };
      });

      expect(isResellerSweeperRunning()).toBe(false);

      // Start sweeper with rapid interval (30ms)
      startResellerRetrySweeper(undefined, 30);

      // Wait for multiple ticks
      await new Promise((r) => setTimeout(r, 150));
      stopResellerRetrySweeper();

      expect(overlaps).toBe(0);
      expect(isResellerSweeperRunning()).toBe(false);
      mockRetry.mockRestore();
    });

    it('resets isSweeperRunning to false when sweep iteration throws an error', async () => {
      const failingRetry = vi.spyOn(resellerModule, 'retryFailedResellerDeliveries').mockRejectedValue(new Error('Reseller upstream failure'));
      startResellerRetrySweeper(undefined, 20);
      await new Promise((r) => setTimeout(r, 60));
      stopResellerRetrySweeper();
      expect(isResellerSweeperRunning()).toBe(false);
      failingRetry.mockRestore();
    });
  });

  describe('4. Centralized Express Error Handling', () => {
    it('catches pipeline errors and formats JSON with proper status code', async () => {
      const bot = createBot(TOKEN);
      const app = createExpressApp(bot);

      const server = http.createServer(app);
      const port = await new Promise<number>((resolve) => {
        server.listen(0, () => resolve((server.address() as any).port));
      });

      try {
        // Send invalid JSON body to an endpoint to trigger body-parser error handled by centralized middleware
        const res = await fetch(`http://localhost:${port}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{ invalid_json_syntax ',
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data).toHaveProperty('error');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('formats custom error status and handles headersSent delegation', () => {
      let loggedStatus = 0;
      let loggedJson: any = null;
      const mockRes: any = {
        headersSent: false,
        status(code: number) {
          loggedStatus = code;
          return this;
        },
        json(payload: any) {
          loggedJson = payload;
          return this;
        },
      };
      const mockNext = vi.fn();

      const customErr: any = new Error('Gateway Timeout');
      customErr.status = 504;

      centralizedErrorHandler(customErr, {} as any, mockRes, mockNext);

      expect(loggedStatus).toBe(504);
      expect(loggedJson).toEqual({ error: 'Gateway Timeout' });
      expect(mockNext).not.toHaveBeenCalled();

      // Test headersSent delegation
      mockRes.headersSent = true;
      centralizedErrorHandler(customErr, {} as any, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith(customErr);
    });
  });

  describe('5. Database Index Preservation in SMS Parser', () => {
    it('successfully matches reference using case-insensitive indexed match', () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(606060, 'cbe_payer');

      const order = createOrder({
        userId: 606060,
        username: 'cbe_payer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });

      // Insert prior receipt evidence with same reference
      db.prepare(`
        INSERT INTO receipt_evidence (order_id, user_id, bank, reference, amount_etb, matched)
        VALUES (?, ?, 'cbe', 'FT24250001', 1100, 1)
      `).run(order.id, 606060);

      const result = matchSmsToOrders(db, 606060, { amountEtb: 1100, reference: 'ft24250001' });
      expect(result.matched).toBe(false);
      expect(result.reason).toBe('reference_already_used');
    });
  });

  describe('6. Long Note Caption Splitting in Admin Receipt Notification', () => {
    it('splits photo caption without crashing when order receipt note is very long', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(707070, 'long_note_user');

      const longNote = 'A'.repeat(1500);
      const order = createOrder({
        userId: 707070,
        username: 'long_note_user',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'pending_approval',
      });
      db.prepare('UPDATE orders SET receipt_note = ?, receipt_file_id = ? WHERE id = ?').run(
        longNote,
        'mock_file_id',
        order.id
      );

      const fullOrder = getOrderById(order.id)!;

      const sentPhotos: any[] = [];
      const sentTexts: any[] = [];

      const mockCtx: any = {
        api: {
          sendPhoto: vi.fn().mockImplementation((adminId, fileId, opts) => {
            sentPhotos.push({ adminId, fileId, opts });
            return Promise.resolve({});
          }),
          sendMessage: vi.fn().mockImplementation((adminId, text, opts) => {
            sentTexts.push({ adminId, text, opts });
            return Promise.resolve({});
          }),
        },
      };

      await notifyAdminsNewReceipt(mockCtx, fullOrder);

      expect(sentPhotos.length).toBe(1);
      // Photo caption must be <= 1024 characters
      expect(sentPhotos[0].opts.caption.length).toBeLessThanOrEqual(1024);
      // Remainder sent via sendMessage
      expect(sentTexts.length).toBeGreaterThan(0);
    });
  });

  describe('7. Startup Cleanup of Interrupted Broadcasts', () => {
    it('marks running broadcast jobs as interrupted', () => {
      db.prepare(`
        INSERT INTO broadcast_jobs (id, admin_id, status, target_lang, sent, failed, cursor_id)
        VALUES ('job-dangling-1', 111111111, 'running', 'all', 10, 2, 0)
      `).run();

      const cleaned = cleanupInterruptedBroadcasts();
      expect(cleaned).toBe(1);

      const job = getBroadcastJob('job-dangling-1');
      expect(job?.done).toBe(true);

      const row = db.prepare('SELECT status FROM broadcast_jobs WHERE id = ?').get('job-dangling-1') as any;
      expect(row.status).toBe('interrupted');
    });
  });

  describe('8. Onboarding Membership Cache Size Cap', () => {
    it('caps membership cache at 5000 entries and clears on overflow', async () => {
      clearMembershipCache();

      const mockCtx: any = {
        api: {
          getChatMember: vi.fn().mockResolvedValue({ status: 'member' }),
        },
      };

      // Fill cache with entries
      for (let i = 1; i <= 5001; i++) {
        await checkChannelMembership(mockCtx, i);
      }

      // After 5001 entries, it should have cleared at 5000 and now have 1
      expect(getMembershipCacheSize()).toBeLessThanOrEqual(5000);
      expect(getMembershipCacheSize()).toBe(1);

      clearMembershipCache();
    });
  });

  describe('9. Secret Redaction in Logger', () => {
    it('redacts otpCode and sessionToken in log statements', async () => {
      expect(LOGGER_REDACT_PATHS).toContain('otpCode');
      expect(LOGGER_REDACT_PATHS).toContain('*.otpCode');
      expect(LOGGER_REDACT_PATHS).toContain('sessionToken');
      expect(LOGGER_REDACT_PATHS).toContain('*.sessionToken');

      let loggedOutput = '';
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          loggedOutput += chunk.toString();
          callback();
        },
      });

      const testLogger = pino(
        {
          redact: { paths: LOGGER_REDACT_PATHS, censor: '[REDACTED]' },
        },
        stream
      );

      testLogger.info(
        {
          otpCode: '884920',
          nested: { otpCode: '112233' },
          sessionToken: 'sess_secret_token_123',
          auth: { sessionToken: 'sess_nested_456' },
        },
        'admin authentication attempt'
      );

      expect(loggedOutput).not.toContain('884920');
      expect(loggedOutput).not.toContain('112233');
      expect(loggedOutput).not.toContain('sess_secret_token_123');
      expect(loggedOutput).not.toContain('sess_nested_456');

      expect(loggedOutput).toContain('"otpCode":"[REDACTED]"');
      expect(loggedOutput).toContain('"sessionToken":"[REDACTED]"');
    });
  });
});
