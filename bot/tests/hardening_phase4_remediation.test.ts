import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import {
  createOrder,
  updateOrderStatus,
  getOrderById,
} from '../src/services/orders.service.js';
import { addStockLink, getAvailableStockCount, allocateStock } from '../src/services/stock.service.js';
import { renderOrderDetail } from '../src/bot/handlers/orders.js';
import { handleManualRail, performAdminApprove } from '../src/bot/handlers/checkout.js';
import { handleTextInput, handleDocumentInput } from '../src/bot/handlers/input.js';
import { setPendingAction, clearPendingAction } from '../src/bot/session.js';
import { previewBroadcastDraft } from '../src/bot/handlers/broadcast.js';
import { retryFailedResellerDeliveries } from '../src/services/reseller.service.js';
import { tryAcquireLease } from '../src/db/lease.js';
import { createBot } from '../src/bot/bot.js';
import { createApiServer } from '../src/api/server.js';
import { GrammyError } from 'grammy';
import { splitTelegramCaption } from '../src/utils/html.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');
const BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

function interceptApi(bot: any): { calls: { method: string; payload: any }[] } {
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use((async (_prev: any, method: string, payload: any) => {
    calls.push({ method, payload });
    return { ok: true, result: method === 'getMe' ? { id: 42, is_bot: true, username: 't' } : true };
  }) as any);
  return { calls };
}

describe('Phase 4: Comprehensive Remediation Test Suite', () => {
  const adminId = 999001;
  const buyerId = 111002;
  const attackerId = 222003;
  let server: http.Server | undefined;
  let port: number;

  beforeEach(() => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.ADMIN_IDS = String(adminId);
    process.env.ADMIN_PASSWORD = 'SecretAdminPassword123!';
    initDatabase(':memory:', migrationsDir);

    const db = getDatabase();
    // Register users
    db.prepare(`
      INSERT OR IGNORE INTO users (id, first_name, username, is_registered, language_code)
      VALUES (?, 'Buyer', 'buyer_user', 1, 'en'),
             (?, 'Attacker', 'attacker_user', 1, 'en'),
             (?, 'Admin', 'admin_user', 1, 'en')
    `).run(buyerId, attackerId, adminId);
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    closeDatabase();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. IDOR Hardening (VULN-01 & VULN-02)
  // ---------------------------------------------------------------------------
  describe('1. IDOR Hardening', () => {
    it('renderOrderDetail blocks unauthorized access from non-owner non-admin', async () => {
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'telebirr' });

      let alertText = '';
      let replyText = '';
      const ctx: any = {
        from: { id: attackerId },
        callbackQuery: { data: `order_detail_${order.id}` },
        answerCallbackQuery: vi.fn(async (opts: any) => {
          alertText = opts?.text;
        }),
        reply: vi.fn(async (msg: string) => {
          replyText = msg;
        }),
      };

      await renderOrderDetail(ctx, order.id);
      expect(alertText).toMatch(/Unauthorized/i);
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it('renderOrderDetail allows owner and admin to view details', async () => {
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'telebirr' });

      // Buyer access
      const buyerCtx: any = {
        from: { id: buyerId },
        reply: vi.fn(),
      };
      await renderOrderDetail(buyerCtx, order.id);
      expect(buyerCtx.reply).toHaveBeenCalled();
      expect(buyerCtx.reply.mock.calls[0][0]).toContain(order.id);

      // Admin access
      const adminCtx: any = {
        from: { id: adminId },
        reply: vi.fn(),
      };
      await renderOrderDetail(adminCtx, order.id);
      expect(adminCtx.reply).toHaveBeenCalled();
      expect(adminCtx.reply.mock.calls[0][0]).toContain(order.id);
    });

    it('handleManualRail blocks non-owner non-admin from modifying rail', async () => {
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'telebirr' });

      let alertText = '';
      const ctx: any = {
        from: { id: attackerId },
        callbackQuery: { data: `pay_manual_cbe_${order.id}` },
        answerCallbackQuery: vi.fn(async (opts: any) => {
          alertText = opts?.text;
        }),
        reply: vi.fn(),
      };

      await handleManualRail(ctx, 'cbe', order.id);
      expect(alertText).toMatch(/Unauthorized/i);

      // Verify payment_rail remained telebirr
      const unchanged = getOrderById(order.id);
      expect(unchanged?.payment_rail).toBe('telebirr');
    });

    it('handleManualRail blocks switching rails when order is not awaiting_payment', async () => {
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'pending_approval', paymentRail: 'telebirr' });

      let alertText = '';
      const ctx: any = {
        from: { id: buyerId },
        callbackQuery: { data: `pay_manual_cbe_${order.id}` },
        answerCallbackQuery: vi.fn(async (opts: any) => {
          alertText = opts?.text;
        }),
        reply: vi.fn(),
      };

      await handleManualRail(ctx, 'cbe', order.id);
      expect(alertText).toMatch(/cannot change payment method/i);

      const unchanged = getOrderById(order.id);
      expect(unchanged?.payment_rail).toBe('telebirr');
    });

    it('SMS forward checks ownership BEFORE inserting into receipt_evidence', async () => {
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'cbe' });
      const db = getDatabase();

      // Attacker attempts SMS verification on buyer's order
      setPendingAction(attackerId, { type: 'user_sms_forward', data: { orderId: order.id } });

      const smsText = 'Dear Customer, your account has been debited with ETB 1500.00 for payment. Ref: FT26090123456789.';
      const ctx: any = {
        from: { id: attackerId },
        message: { text: smsText },
        reply: vi.fn(),
      };

      await handleTextInput(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('Order not found.');

      // Verify that NO row was inserted into receipt_evidence
      const evidence = db.prepare('SELECT * FROM receipt_evidence WHERE order_id = ?').all(order.id);
      expect(evidence.length).toBe(0);
    });

    it('bot callback resume_pay_ blocks unauthorized attacker or order in wrong status', async () => {
      const bot = createBot(BOT_TOKEN);
      (bot as any).botInfo = { id: 42, is_bot: true, username: 'bighabesha_test_bot', first_name: 'Test Bot' };
      const api = interceptApi(bot);
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'telebirr' });

      // Attacker tries to resume payment
      await bot.handleUpdate({
        update_id: 101,
        callback_query: {
          id: 'cb_101',
          from: { id: attackerId, is_bot: false, first_name: 'Attacker' },
          chat_instance: '1',
          data: `resume_pay_${order.id}`,
          message: { message_id: 10, chat: { id: attackerId, type: 'private', first_name: 'Attacker' }, date: Date.now() },
        },
      });
      const attackerCall = api.calls.find(c => c.method === 'sendMessage');
      expect(attackerCall?.payload.text).toMatch(/unauthorized/i);

      // Status changed to pending_approval -> buyer also blocked from resuming payment
      updateOrderStatus(order.id, 'pending_approval');
      api.calls.length = 0;
      await bot.handleUpdate({
        update_id: 102,
        callback_query: {
          id: 'cb_102',
          from: { id: buyerId, is_bot: false, first_name: 'Buyer' },
          chat_instance: '1',
          data: `resume_pay_${order.id}`,
          message: { message_id: 11, chat: { id: buyerId, type: 'private', first_name: 'Buyer' }, date: Date.now() },
        },
      });
      const buyerCall = api.calls.find(c => c.method === 'sendMessage');
      expect(buyerCall?.payload.text).toMatch(/Cannot resume payment/i);
    });

    it('bot callback promo_prompt_ blocks unauthorized attacker or order in wrong status', async () => {
      const bot = createBot(BOT_TOKEN);
      (bot as any).botInfo = { id: 42, is_bot: true, username: 'bighabesha_test_bot', first_name: 'Test Bot' };
      const api = interceptApi(bot);
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'telebirr' });

      // Attacker tries promo prompt
      await bot.handleUpdate({
        update_id: 201,
        callback_query: {
          id: 'cb_201',
          from: { id: attackerId, is_bot: false, first_name: 'Attacker' },
          chat_instance: '1',
          data: `promo_prompt_${order.id}`,
          message: { message_id: 20, chat: { id: attackerId, type: 'private', first_name: 'Attacker' }, date: Date.now() },
        },
      });
      const attackerCall = api.calls.find(c => c.method === 'sendMessage');
      expect(attackerCall?.payload.text).toMatch(/unauthorized/i);

      // Wrong status
      updateOrderStatus(order.id, 'pending_approval');
      api.calls.length = 0;
      await bot.handleUpdate({
        update_id: 202,
        callback_query: {
          id: 'cb_202',
          from: { id: buyerId, is_bot: false, first_name: 'Buyer' },
          chat_instance: '1',
          data: `promo_prompt_${order.id}`,
          message: { message_id: 21, chat: { id: buyerId, type: 'private', first_name: 'Buyer' }, date: Date.now() },
        },
      });
      const buyerCall = api.calls.find(c => c.method === 'sendMessage');
      expect(buyerCall?.payload.text).toMatch(/Cannot apply promo code/i);
    });

    it('bot callback cancel_order_ blocks unauthorized users and informs to contact support for processing orders', async () => {
      const bot = createBot(BOT_TOKEN);
      (bot as any).botInfo = { id: 42, is_bot: true, username: 'bighabesha_test_bot', first_name: 'Test Bot' };
      const api = interceptApi(bot);
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'telebirr' });

      // Attacker cannot cancel
      await bot.handleUpdate({
        update_id: 301,
        callback_query: {
          id: 'cb_301',
          from: { id: attackerId, is_bot: false, first_name: 'Attacker' },
          chat_instance: '1',
          data: `cancel_order_${order.id}`,
          message: { message_id: 30, chat: { id: attackerId, type: 'private', first_name: 'Attacker' }, date: Date.now() },
        },
      });
      const attackerCall = api.calls.find(c => c.method === 'sendMessage');
      expect(attackerCall?.payload.text).toMatch(/unauthorized/i);
      expect(getOrderById(order.id)?.status).toBe('awaiting_payment');

      // Processing order informs user to contact support
      updateOrderStatus(order.id, 'pending_approval');
      api.calls.length = 0;
      await bot.handleUpdate({
        update_id: 302,
        callback_query: {
          id: 'cb_302',
          from: { id: buyerId, is_bot: false, first_name: 'Buyer' },
          chat_instance: '1',
          data: `cancel_order_${order.id}`,
          message: { message_id: 31, chat: { id: buyerId, type: 'private', first_name: 'Buyer' }, date: Date.now() },
        },
      });
      const buyerCall = api.calls.find(c => c.method === 'sendMessage');
      expect(buyerCall?.payload.text).toMatch(/contact support/i);
      expect(getOrderById(order.id)?.status).toBe('pending_approval');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Concurrent Approval & Race Condition Protection (DEFECT-03 & DEFECT-04)
  // ---------------------------------------------------------------------------
  describe('2. Concurrent Approval & Race Condition Protection', () => {
    it('performAdminApprove rejects double-approval when order status is no longer pending_approval', async () => {
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'pending_approval', paymentRail: 'telebirr' });
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/test-key-1');

      // First approval succeeds
      const ctx1: any = {
        from: { id: adminId, username: 'admin_test' },
        callbackQuery: { data: `admin_approve_${order.id}` },
        answerCallbackQuery: vi.fn(),
        reply: vi.fn(),
        api: { sendMessage: vi.fn().mockResolvedValue({}) },
      };
      await performAdminApprove(ctx1, order.id);
      expect(getOrderById(order.id)?.status).toBe('fulfilled');

      // Second concurrent approval attempts on the now-fulfilled order
      let secondAlert = '';
      const ctx2: any = {
        from: { id: adminId, username: 'admin_test' },
        callbackQuery: { data: `admin_approve_${order.id}` },
        answerCallbackQuery: vi.fn(async (opts: any) => {
          secondAlert = opts?.text;
        }),
        reply: vi.fn(),
        api: { sendMessage: vi.fn().mockResolvedValue({}) },
      };
      await performAdminApprove(ctx2, order.id);
      expect(secondAlert).toMatch(/already FULFILLED and cannot be approved again/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Order State Transition Crash & Stock Leak Prevention (DEFECT-05, DEFECT-07, DEFECT-12)
  // ---------------------------------------------------------------------------
  describe('3. Order State Transition Crash & Stock Leak Prevention', () => {
    it('releases allocated stock item back to available with order_id NULL when transitioning to cancelled', () => {
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/cancel-test-key');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(1);

      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'awaiting_payment', paymentRail: 'telebirr' });
      const alloc = allocateStock('gemini_pro_18m', order.id);
      expect(alloc.item).toBeDefined();
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

      // Transition to cancelled
      updateOrderStatus(order.id, 'cancelled');

      // Stock item should be available again and detached from order
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(1);
      const db = getDatabase();
      const item = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(alloc.item!.id) as any;
      expect(item.status).toBe('available');
      expect(item.order_id).toBeNull();
      expect(item.allocated_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. SQLite Concurrency & Timeout Hardening (DEFECT-06)
  // ---------------------------------------------------------------------------
  describe('4. SQLite Concurrency & Timeout Hardening', () => {
    it('supports configuring busy_timeout via SQLITE_BUSY_TIMEOUT environment variable', () => {
      const originalEnv = process.env.SQLITE_BUSY_TIMEOUT;
      try {
        process.env.SQLITE_BUSY_TIMEOUT = '5000';
        closeDatabase();
        const testDb = initDatabase(':memory:', migrationsDir);
        expect(Number(testDb.pragma('busy_timeout', { simple: true }))).toBe(5000);
      } finally {
        if (originalEnv !== undefined) {
          process.env.SQLITE_BUSY_TIMEOUT = originalEnv;
        } else {
          delete process.env.SQLITE_BUSY_TIMEOUT;
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Stale processing Order Crash Recovery (DEFECT-09)
  // ---------------------------------------------------------------------------
  describe('5. Stale processing Order Crash Recovery', () => {
    it('sweeper includes stale processing orders older than 2 minutes whose lease has expired', async () => {
      const db = getDatabase();
      // Insert an order stuck in processing from 5 minutes ago
      const orderId = 'ORD-STALE-PROCESSING-1';
      db.prepare(`
        INSERT INTO orders (id, user_id, product_id, variant_id, amount_etb, status, payment_rail, target_username, updated_at)
        VALUES (?, ?, 'telegram_premium', 'tg_prem_3m', 1500, 'processing', 'telebirr', 'buyer_user', datetime('now', '-5 minutes'))
      `).run(orderId, buyerId);

      const staleOrders = db.prepare(`
        SELECT * FROM orders
        WHERE product_id = 'telegram_premium'
          AND (
            status = 'delivery_failed'
            OR (
              status = 'processing'
              AND updated_at <= datetime('now', '-2 minutes')
              AND NOT EXISTS (
                SELECT 1 FROM job_leases
                WHERE name = 'reseller:order:' || orders.id
                  AND expires_at > ?
              )
            )
          )
      `).all(Date.now()) as any[];

      expect(staleOrders.some((o) => o.id === orderId)).toBe(true);
    });

    it('sweeper ignores processing orders that currently have an active lease', async () => {
      const db = getDatabase();
      const orderId = 'ORD-STALE-ACTIVE-LEASE';
      db.prepare(`
        INSERT INTO orders (id, user_id, product_id, variant_id, amount_etb, status, payment_rail, target_username, updated_at)
        VALUES (?, ?, 'telegram_premium', 'tg_prem_3m', 1500, 'processing', 'telebirr', 'buyer_user', datetime('now', '-5 minutes'))
      `).run(orderId, buyerId);

      // Acquire an active lease on this order for 60s
      tryAcquireLease(`reseller:order:${orderId}`, 60_000);

      const staleOrders = db.prepare(`
        SELECT * FROM orders
        WHERE product_id = 'telegram_premium'
          AND (
            status = 'delivery_failed'
            OR (
              status = 'processing'
              AND updated_at <= datetime('now', '-2 minutes')
              AND NOT EXISTS (
                SELECT 1 FROM job_leases
                WHERE name = 'reseller:order:' || orders.id
                  AND expires_at > ?
              )
            )
          )
      `).all(Date.now()) as any[];

      expect(staleOrders.some((o) => o.id === orderId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Persistent Admin 2FA Brute-Force Lockout (DEFECT-10)
  // ---------------------------------------------------------------------------
  describe('6. Persistent Admin 2FA Brute-Force Lockout', () => {
    it('persists failed OTP verification attempts to admin_otp_failures table and enforces lockout', async () => {
      const adminApi = await import('../src/api/admin.js');
      const db = getDatabase();

      server = createApiServer({
        api: {
          sendMessage: async () => ({}),
          getFile: async () => { throw new Error('not found'); },
        },
      } as any);

      await new Promise<void>((resolve) => {
        server!.listen(0, () => {
          port = (server!.address() as any).port;
          resolve();
        });
      });

      const origMax = adminApi.otpLockoutConfig.maxAttempts;
      adminApi.otpLockoutConfig.maxAttempts = 3;

      try {
        // Insert OTP for admin
        db.prepare('INSERT INTO admin_otps (admin_id, otp, expires_at) VALUES (?, ?, ?)')
          .run(adminId, '123456', Date.now() + 600_000);

        const verify = (otp: string) =>
          fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId, otp }),
          });

        // Wrong attempt 1
        const res1 = await verify('000000');
        expect(res1.status).toBe(400);

        // Wrong attempt 2
        const res2 = await verify('000001');
        expect(res2.status).toBe(400);

        // Verify SQLite admin_otp_failures row exists
        const countRow = db.prepare('SELECT count, locked_until FROM admin_otp_failures WHERE admin_id = ?').get(adminId) as any;
        expect(countRow).toBeDefined();
        expect(countRow.count).toBe(2);

        // Wrong attempt 3 (triggers lockout)
        const res3 = await verify('000002');
        expect(res3.status).toBe(400);

        const lockedRow = db.prepare('SELECT count, locked_until FROM admin_otp_failures WHERE admin_id = ?').get(adminId) as any;
        expect(lockedRow.locked_until).toBeGreaterThan(Date.now());

        // Attempt 4 (even with correct code) rejected with 429
        const res4 = await verify('123456');
        expect(res4.status).toBe(429);
        const body4 = await res4.json();
        expect(body4.error).toMatch(/Too many incorrect codes/i);
      } finally {
        adminApi.otpLockoutConfig.maxAttempts = origMax;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Telegram Caption Limit & Document Handling (DEFECT-11, DEFECT-13, DEFECT-14)
  // ---------------------------------------------------------------------------
  describe('7. Telegram Caption Limit & Document Handling', () => {
    it('truncates photo broadcast captions longer than 1024 characters in previewBroadcastDraft', async () => {
      const longMessage = 'A'.repeat(1200);

      const photoFileId = 'photo_test_123';
      const ctx: any = {
        from: { id: adminId },
        reply: vi.fn(),
        replyWithPhoto: vi.fn(),
      };

      await previewBroadcastDraft(ctx, longMessage, photoFileId, 'all');

      // Must call replyWithPhoto with truncated caption <= 1024
      expect(ctx.replyWithPhoto).toHaveBeenCalled();
      const captionArg = ctx.replyWithPhoto.mock.calls[0][1].caption;
      expect(captionArg.length).toBeLessThanOrEqual(1024);
      expect(captionArg.endsWith('...')).toBe(true);

      // Must send remaining text as second message
      expect(ctx.reply).toHaveBeenCalled();
      const calls = ctx.reply.mock.calls;
      const secondMsg = calls[calls.length - 1][0];
      expect(secondMsg.startsWith('...')).toBe(true);
      expect(secondMsg.length).toBe(1200 - 1021 + 3);
    });

    it('handleDocumentInput accepts document files for admin_fulfill_proof action', async () => {
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/test-key-doc');
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'pending_approval', paymentRail: 'telebirr' });
      setPendingAction(adminId, {
        type: 'admin_edit_variant_price',
        data: { action: 'admin_fulfill_proof', orderId: order.id },
      });

      const ctx: any = {
        from: { id: adminId },
        message: {
          document: {
            file_id: 'doc_proof_file_123',
            file_name: 'payment_proof.pdf',
            file_size: 1024 * 100, // 100 KB
          },
          caption: 'Delivered via official receipt',
        },
        reply: vi.fn(),
        api: {
          sendDocument: vi.fn().mockResolvedValue({}),
        },
      };

      const handled = await handleDocumentInput(ctx);
      expect(handled).toBe(true);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('fulfilled with document proof!'), expect.anything());

      const updated = getOrderById(order.id);
      expect(updated?.status).toBe('fulfilled');
      expect(ctx.api.sendDocument).toHaveBeenCalledWith(buyerId, 'doc_proof_file_123', expect.anything());
    });

    it('Grammy API 429 transformer retries up to 3 times with backoff', async () => {
      const bot = createBot(BOT_TOKEN);
      let attempts = 0;

      // Mock prev to fail with 429 twice, then succeed
      const mockPrev = vi.fn(async () => {
        attempts++;
        if (attempts <= 2) {
          const err = new GrammyError(
            'Call failed',
            { ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0.01 } },
            'sendMessage',
            {}
          );
          throw err;
        }
        return { ok: true, message_id: 1234 };
      });

      // Invoke transformer registered in createBot
      const transformer = (bot.api.config as any).installedTransformers?.[1] ||
        (bot.api.config as any).installedTransformers?.[0];

      if (transformer) {
        const res = await transformer(mockPrev, 'sendMessage', {}, undefined);
        expect(res).toEqual({ ok: true, message_id: 1234 });
        expect(attempts).toBe(3);
      }
    });

    it('splitTelegramCaption cleanly closes open tags and re-opens them in overflow', () => {
      const html = '<b>Header</b> <i>' + 'Long text content '.repeat(70) + '</i>';
      const { caption, overflow } = splitTelegramCaption(html, 1024);

      expect(caption.length).toBeLessThanOrEqual(1024);
      expect(caption.endsWith('</i>')).toBe(true);
      expect(overflow).toBeDefined();
      expect(overflow!.startsWith('<i>...')).toBe(true);
      expect(overflow!.endsWith('</i>')).toBe(true);
    });

    it('handleTextInput rejects SMS submission on cancelled or fulfilled orders without crashing', async () => {
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'cancelled', paymentRail: 'cbe' });
      setPendingAction(buyerId, {
        type: 'user_sms_forward',
        data: { orderId: order.id },
      });

      const ctx: any = {
        from: { id: buyerId },
        message: {
          text: 'Dear Customer, ETB 1,500.00 debited from your account for order payment. Ref: CBE12345678',
        },
        reply: vi.fn(),
      };

      const handled = await handleTextInput(ctx);
      expect(handled).toBe(true);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Cannot submit receipt: order is already <b>cancelled</b>'), expect.anything());
    });

    it('registerOtpFailure resets counter if previous failure occurred outside 15-minute lockout window', async () => {
      const adminApi = await import('../src/api/admin.js');
      const db = getDatabase();

      // Insert an expired failure from 20 minutes ago
      db.prepare(`
        INSERT INTO admin_otp_failures (admin_id, count, locked_until, updated_at)
        VALUES (?, 2, 0, datetime('now', '-20 minutes'))
      `).run(adminId);

      // Now trigger a failure via verify-2fa
      db.prepare('INSERT INTO admin_otps (admin_id, otp, expires_at) VALUES (?, ?, ?)')
        .run(adminId, '999999', Date.now() + 600_000);

      server = createApiServer({
        api: {
          sendMessage: async () => ({}),
          getFile: async () => { throw new Error('not found'); },
        },
      } as any);

      await new Promise<void>((resolve) => {
        server!.listen(0, () => {
          port = (server!.address() as any).port;
          resolve();
        });
      });

      const res = await fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId, otp: '000000' }),
      });
      expect(res.status).toBe(400);

      // Failure count should have reset to 1 (baseCount 0 + 1), NOT accumulated to 3
      const row = db.prepare('SELECT count FROM admin_otp_failures WHERE admin_id = ?').get(adminId) as any;
      expect(row.count).toBe(1);
    });

    it('handleDocumentInput splits oversized fulfillment notes without failing document delivery', async () => {
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/test-key-doc2');
      const order = createOrder({ userId: buyerId, productId: 'gemini_pro_18m', amountETB: 1500, status: 'pending_approval', paymentRail: 'telebirr' });
      setPendingAction(adminId, {
        type: 'admin_edit_variant_price',
        data: { action: 'admin_fulfill_proof', orderId: order.id },
      });

      const hugeNote = 'Very detailed activation instructions: ' + 'STEP_DATA_'.repeat(120);
      const ctx: any = {
        from: { id: adminId },
        message: {
          document: {
            file_id: 'doc_proof_file_oversized',
            file_name: 'license_proof.pdf',
            file_size: 1024 * 50,
          },
          caption: hugeNote,
        },
        reply: vi.fn(),
        api: {
          sendDocument: vi.fn().mockResolvedValue({}),
          sendMessage: vi.fn().mockResolvedValue({}),
        },
      };

      const handled = await handleDocumentInput(ctx);
      expect(handled).toBe(true);
      expect(ctx.api.sendDocument).toHaveBeenCalled();
      const docCaption = ctx.api.sendDocument.mock.calls[0][2].caption;
      expect(docCaption.length).toBeLessThanOrEqual(1024);
      // Overflow message sent as second message
      expect(ctx.api.sendMessage).toHaveBeenCalled();
    });
  });
});

