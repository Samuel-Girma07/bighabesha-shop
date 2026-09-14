import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
import { addStockLink } from '../src/services/stock.service.js';
import { formatFulfillmentDeliveryMessage, escapeHtml, splitTelegramCaption } from '../src/utils/html.js';
import { renderOrderDetail } from '../src/bot/handlers/orders.js';
import { performAdminApprove } from '../src/bot/handlers/checkout.js';
import { notifyBuyerOfAutoApproval } from '../src/services/buyer_notify.js';
import { executeDirectFulfill } from '../src/bot/handlers/admin_queue.js';
import { handleTextInput, handlePhotoInput, handleDocumentInput } from '../src/bot/handlers/input.js';
import { setPendingAction } from '../src/bot/session.js';
import { createApiServer } from '../src/api/server.js';
import { setAdminBotInstance } from '../src/api/admin.js';
import { createBot } from '../src/bot/bot.js';
import { resetConfigCache } from '../src/config/env.js';
import { stopResellerRetrySweeper } from '../src/services/reseller.service.js';
import { saveUserLanguage } from '../src/services/users.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ_rem3';
const ADMIN_ID = 111111111;
const ADMIN_PASSWORD = 'admin-secure-password-123';

describe('Round 3 Remediation Verification', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = String(ADMIN_ID);
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.NODE_ENV = 'development';
    resetConfigCache();

    db = initDatabase(':memory:', MIGRATIONS_DIR);

    // Seed admin
    db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(ADMIN_ID, 'superadmin');
    db.prepare("INSERT OR REPLACE INTO admins (tg_user_id, role) VALUES (?, 'superadmin')").run(ADMIN_ID);
  });

  afterEach(() => {
    stopResellerRetrySweeper();
    closeDatabase();
    vi.restoreAllMocks();
  });

  describe('1. Centralized formatFulfillmentDeliveryMessage Helper', () => {
    it('formats delivery message with escaped payload query parameters (&, <, >, ")', () => {
      const payloadWithAmp = 'https://g.co/gemini/activate?token=ABC123xyz&ref=partner&type=sub';
      const msg = formatFulfillmentDeliveryMessage('ORD-999', payloadWithAmp);

      expect(msg).toContain('<b>Payment Confirmed — Order #ORD-999</b>');
      expect(msg).toContain('<code>https://g.co/gemini/activate?token=ABC123xyz&amp;ref=partner&amp;type=sub</code>');
      expect(msg).not.toContain('&ref=');
      expect(msg).toContain('<b>Instructions:</b>');
      expect(msg).toContain('1. Ensure your VPN is connected');
      expect(msg).toContain('<i>Thank you for choosing Bighabesha Shop.</i>');
    });

    it('escapes special characters inside custom instructions template', () => {
      const payload = 'https://example.com/redeem?code=XYZ';
      const customTemplate = 'Step 1: Open <Link> & click "Activate".';
      const msg = formatFulfillmentDeliveryMessage('ORD-100', payload, customTemplate);

      expect(msg).toContain('Step 1: Open &lt;Link&gt; &amp; click &quot;Activate&quot;.');
      expect(msg).not.toContain('<Link>');
    });
  });

  describe('2. Order Detail Views in orders.ts', () => {
    it('escapes fulfillment_payload with & in English order details view', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202020, 'buyer_eng');
      const order = createOrder({
        userId: 202020,
        username: 'buyer_eng',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'fulfilled',
      });
      // Attach stock payload with &
      const stockLink = 'https://g.co/gemini/activate?id=123&user=456&role=buyer';
      db.prepare('UPDATE orders SET fulfillment_payload = ? WHERE id = ?').run(stockLink, order.id);

      const replies: { text: string; opts: any }[] = [];
      const mockCtx: any = {
        from: { id: 202020 },
        reply: vi.fn().mockImplementation((text: string, opts: any) => {
          replies.push({ text, opts });
          return Promise.resolve({});
        }),
      };

      await renderOrderDetail(mockCtx, order.id);

      expect(replies.length).toBeGreaterThan(0);
      const text = replies[0].text;
      expect(text).toContain('Activation Link:');
      expect(text).toContain('<code>https://g.co/gemini/activate?id=123&amp;user=456&amp;role=buyer</code>');
      expect(text).not.toContain('?id=123&user=456');
    });

    it('escapes fulfillment_payload with & in Amharic order details view', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202021, 'buyer_amh');
      saveUserLanguage(202021, 'am');

      const order = createOrder({
        userId: 202021,
        username: 'buyer_amh',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'fulfilled',
      });
      const stockLink = 'https://g.co/gemini/activate?id=789&key=abc&partner=cbe';
      db.prepare('UPDATE orders SET fulfillment_payload = ? WHERE id = ?').run(stockLink, order.id);

      const replies: { text: string; opts: any }[] = [];
      const mockCtx: any = {
        from: { id: 202021 },
        reply: vi.fn().mockImplementation((text: string, opts: any) => {
          replies.push({ text, opts });
          return Promise.resolve({});
        }),
      };

      await renderOrderDetail(mockCtx, order.id);

      expect(replies.length).toBeGreaterThan(0);
      const text = replies[0].text;
      expect(text).toContain('የማግበሪያ ሊንክ፦');
      expect(text).toContain('<code>https://g.co/gemini/activate?id=789&amp;key=abc&amp;partner=cbe</code>');
      expect(text).not.toContain('?id=789&key=abc');
    });
  });

  describe('3. Admin Callback Approval in checkout.ts', () => {
    it('delivers formatted delivery message with escaped & to buyer upon admin approval', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202022, 'buyer_checkout');
      const stockLink = 'https://g.co/gemini/code?batch=may&coupon=PROMO&user=test';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 202022,
        username: 'buyer_checkout',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'telebirr',
        status: 'pending_approval',
      });

      const sentMessages: { targetId: number; text: string; opts: any }[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_ID, username: 'admin_user' },
        callbackQuery: {
          id: 'cb_approval',
          message: { text: 'Receipt under review' },
        },
        answerCallbackQuery: vi.fn().mockResolvedValue({}),
        editMessageText: vi.fn().mockResolvedValue({}),
        editMessageCaption: vi.fn().mockResolvedValue({}),
        reply: vi.fn().mockResolvedValue({}),
        api: {
          sendMessage: vi.fn().mockImplementation((targetId: number, text: string, opts: any) => {
            sentMessages.push({ targetId, text, opts });
            return Promise.resolve({});
          }),
        },
      };

      await performAdminApprove(mockCtx, order.id);

      const buyerMsg = sentMessages.find((m) => m.targetId === 202022);
      expect(buyerMsg).toBeDefined();
      expect(buyerMsg!.text).toContain('<code>https://g.co/gemini/code?batch=may&amp;coupon=PROMO&amp;user=test</code>');
      expect(buyerMsg!.text).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
      expect(buyerMsg!.text).toContain('<b>Instructions:</b>');
    });
  });

  describe('4. Shared Buyer Notify Service buyer_notify.ts', () => {
    it('notifies buyer with formatFulfillmentDeliveryMessage and escaped & on auto-approval', () => {
      const mockBot: any = {
        api: {
          sendMessage: vi.fn().mockResolvedValue({}),
        },
      };
      const order = createOrder({
        userId: 202023,
        username: 'buyer_auto',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'chapa',
        status: 'pending_approval',
      });

      const stockItem = { payload: 'https://g.co/gemini/activate?t=tok123&session=sess456' };

      notifyBuyerOfAutoApproval(mockBot, order, { ...order, status: 'fulfilled' }, stockItem);

      expect(mockBot.api.sendMessage).toHaveBeenCalledTimes(1);
      const callArgs = mockBot.api.sendMessage.mock.calls[0];
      expect(callArgs[0]).toBe(202023);
      expect(callArgs[1]).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
      expect(callArgs[1]).toContain('<code>https://g.co/gemini/activate?t=tok123&amp;session=sess456</code>');
      expect(callArgs[1]).not.toContain('?t=tok123&session=');
    });
  });

  describe('5. Manual Input Fulfillment Handlers in input.ts', () => {
    it('escapes & when fulfilling via admin text note (admin_fulfill_proof)', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202024, 'buyer_text');
      const stockLink = 'https://g.co/gemini/activate?k=key1&m=mode2';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 202024,
        username: 'buyer_text',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      setPendingAction(ADMIN_ID, {
        type: 'custom',
        data: { action: 'admin_fulfill_proof', orderId: order.id },
      });

      const sentMessages: { targetId: number; text: string }[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_ID },
        message: { text: 'Here is your completion note' },
        reply: vi.fn().mockResolvedValue({}),
        api: {
          sendMessage: vi.fn().mockImplementation((targetId: number, text: string) => {
            sentMessages.push({ targetId, text });
            return Promise.resolve({});
          }),
        },
      };

      const handled = await handleTextInput(mockCtx);
      expect(handled).toBe(true);

      const buyerMsg = sentMessages.find((m) => m.targetId === 202024);
      expect(buyerMsg).toBeDefined();
      expect(buyerMsg!.text).toContain('<code>https://g.co/gemini/activate?k=key1&amp;m=mode2</code>');
      expect(buyerMsg!.text).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
    });

    it('escapes & when fulfilling via photo proof (admin_fulfill_proof)', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202025, 'buyer_photo');
      const stockLink = 'https://g.co/gemini/activate?token=photoTok&ref=img';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 202025,
        username: 'buyer_photo',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      setPendingAction(ADMIN_ID, {
        type: 'custom',
        data: { action: 'admin_fulfill_proof', orderId: order.id },
      });

      const sentMessages: { targetId: number; text: string }[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_ID },
        message: {
          photo: [{ file_id: 'photo_123', width: 100, height: 100 }],
          caption: 'Delivery screenshot proof',
        },
        reply: vi.fn().mockResolvedValue({}),
        api: {
          sendPhoto: vi.fn().mockResolvedValue({}),
          sendMessage: vi.fn().mockImplementation((targetId: number, text: string) => {
            sentMessages.push({ targetId, text });
            return Promise.resolve({});
          }),
        },
      };

      const handled = await handlePhotoInput(mockCtx);
      expect(handled).toBe(true);

      const buyerMsg = sentMessages.find((m) => m.targetId === 202025);
      expect(buyerMsg).toBeDefined();
      expect(buyerMsg!.text).toContain('<code>https://g.co/gemini/activate?token=photoTok&amp;ref=img</code>');
      expect(buyerMsg!.text).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
    });

    it('escapes & when fulfilling via document proof (admin_fulfill_proof)', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202026, 'buyer_doc');
      const stockLink = 'https://g.co/gemini/activate?token=docTok&env=prod';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 202026,
        username: 'buyer_doc',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      setPendingAction(ADMIN_ID, {
        type: 'custom',
        data: { action: 'admin_fulfill_proof', orderId: order.id },
      });

      const sentMessages: { targetId: number; text: string }[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_ID },
        message: {
          document: { file_id: 'doc_123', file_name: 'receipt.pdf' },
          caption: 'Delivery PDF proof',
        },
        reply: vi.fn().mockResolvedValue({}),
        api: {
          sendDocument: vi.fn().mockResolvedValue({}),
          sendMessage: vi.fn().mockImplementation((targetId: number, text: string) => {
            sentMessages.push({ targetId, text });
            return Promise.resolve({});
          }),
        },
      };

      const handled = await handleDocumentInput(mockCtx);
      expect(handled).toBe(true);

      const buyerMsg = sentMessages.find((m) => m.targetId === 202026);
      expect(buyerMsg).toBeDefined();
      expect(buyerMsg!.text).toContain('<code>https://g.co/gemini/activate?token=docTok&amp;env=prod</code>');
      expect(buyerMsg!.text).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
    });
  });

  describe('6. Admin API Approval & Fulfillment in admin.ts', () => {
    it('escapes & in autoDeliveredItem when approved via POST /api/admin/orders/:id/approve', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202027, 'buyer_api_approve');
      const stockLink = 'https://g.co/gemini/activate?param1=foo&param2=bar';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 202027,
        username: 'buyer_api_approve',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'telebirr',
        status: 'pending_approval',
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

        const approveRes = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/approve`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        expect(approveRes.status).toBe(200);
        const buyerMsg = sentMessages.find((m) => m.targetId === 202027);
        expect(buyerMsg).toBeDefined();
        expect(buyerMsg!.text).toContain('<code>https://g.co/gemini/activate?param1=foo&amp;param2=bar</code>');
        expect(buyerMsg!.text).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('escapes & when fulfilled via POST /api/admin/orders/:id/fulfill', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202028, 'buyer_api_fulfill');
      const stockLink = 'https://g.co/gemini/activate?plan=pro&source=dash';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 202028,
        username: 'buyer_api_fulfill',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
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
        const loginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: ADMIN_PASSWORD }),
        });
        const otpRow = db.prepare('SELECT otp FROM admin_otps WHERE admin_id = ?').get(ADMIN_ID) as any;
        const verifyRes = await fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminId: ADMIN_ID, otp: otpRow.otp }),
        });
        const { token } = await verifyRes.json();

        const fulfillRes = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/fulfill`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ proofNote: 'API delivery' }),
        });

        expect(fulfillRes.status).toBe(200);
        const buyerMsg = sentMessages.find((m) => m.targetId === 202028);
        expect(buyerMsg).toBeDefined();
        expect(buyerMsg!.text).toContain('<code>https://g.co/gemini/activate?plan=pro&amp;source=dash</code>');
        expect(buyerMsg!.text).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('7. Bot Admin Queue & Direct Fulfillment in admin_queue.ts', () => {
    it('escapes & when executing executeDirectFulfill', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202029, 'buyer_queue');
      const stockLink = 'https://g.co/gemini/activate?step=final&track=123';
      addStockLink('gemini_pro_18m', stockLink);

      const order = createOrder({
        userId: 202029,
        username: 'buyer_queue',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'telebirr',
        status: 'pending_fulfillment',
      });

      const sentMessages: { targetId: number; text: string; opts: any }[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_ID },
        callbackQuery: { id: 'cb_queue_123' },
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

      const buyerDelivery = sentMessages.find((m) => m.targetId === 202029);
      expect(buyerDelivery).toBeDefined();
      expect(buyerDelivery!.text).toContain('<code>https://g.co/gemini/activate?step=final&amp;track=123</code>');
      expect(buyerDelivery!.text).toContain('<b>Payment Confirmed — Order #' + order.id + '</b>');
    });
  });

  describe('8. Edge-Case Hardening: Adversarial Inputs, Rejection Escaping & Caption Splitting', () => {
    it('escapes orderId with special characters (<, >, &, quotes) in formatFulfillmentDeliveryMessage', () => {
      const maliciousOrderId = 'ORD<999>&test="quoted"';
      const payload = 'https://g.co/gemini/activate?token=SECURE';
      const msg = formatFulfillmentDeliveryMessage(maliciousOrderId, payload);

      expect(msg).toContain('<b>Payment Confirmed — Order #ORD&lt;999&gt;&amp;test=&quot;quoted&quot;</b>');
      expect(msg).not.toContain('ORD<999>');
      expect(msg).not.toContain('&test=');
    });

    it('escapes adversarial payloads containing raw HTML tags and multiple query parameters', () => {
      const adversarialPayload = 'https://g.co/gemini/activate?<script>alert("XSS")</script>&token=abc&ref=<a>link</a>';
      const msg = formatFulfillmentDeliveryMessage('ORD-ADV', adversarialPayload);

      expect(msg).toContain('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;&amp;token=abc&amp;ref=&lt;a&gt;link&lt;/a&gt;');
      expect(msg).not.toContain('<script>');
      expect(msg).not.toContain('<a>link</a>');
    });

    it('escapes special characters in rejection reason via POST /api/admin/orders/:id/reject', async () => {
      db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(202030, 'buyer_reject_esc');
      const order = createOrder({
        userId: 202030,
        username: 'buyer_reject_esc',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'telebirr',
        status: 'pending_approval',
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
        const loginRes = await fetch(`http://localhost:${port}/api/admin/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: ADMIN_PASSWORD }),
        });
        const otpRow = db.prepare('SELECT otp FROM admin_otps WHERE admin_id = ?').get(ADMIN_ID) as any;
        const verifyRes = await fetch(`http://localhost:${port}/api/admin/auth/verify-2fa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminId: ADMIN_ID, otp: otpRow.otp }),
        });
        const { token } = await verifyRes.json();

        const adversarialReason = 'Payment < 1500 ETB & slip reference was invalid or reused ("DUPLICATE")';
        const rejectRes = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/reject`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: adversarialReason }),
        });

        expect(rejectRes.status).toBe(200);
        const buyerMsg = sentMessages.find((m) => m.targetId === 202030);
        expect(buyerMsg).toBeDefined();
        expect(buyerMsg!.text).toContain('<b>Reason:</b> Payment &lt; 1500 ETB &amp; slip reference was invalid or reused (&quot;DUPLICATE&quot;)');
        expect(buyerMsg!.text).not.toContain('< 1500');
        expect(buyerMsg!.text).not.toContain('& slip');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('splitTelegramCaption avoids bisecting HTML entities across chunk cut boundary', () => {
      // Construct a string where the 1024-character threshold falls precisely inside an &amp; or &quot; entity
      const prefix = '<b>Order Proof</b>\n' + 'A'.repeat(1005);
      const entityStr = '&amp;&amp;&quot;Remaining notes';
      const fullText = prefix + entityStr;

      const result = splitTelegramCaption(fullText, 1024);
      expect(result.caption.length).toBeLessThanOrEqual(1024);
      expect(result.overflow).not.toBeNull();

      // Ensure no split entities like '&a...' or '...mp;' in caption or overflow
      expect(result.caption).not.toMatch(/&[a-zA-Z0-9#]{1,4}\.\.\./);
      expect(result.overflow).not.toMatch(/^\.\.\.[a-zA-Z0-9#]+;/);

      // Verify HTML tags remain balanced
      const openCount = (result.caption.match(/<b>/g) || []).length;
      const closeCount = (result.caption.match(/<\/b>/g) || []).length;
      expect(openCount).toBe(closeCount);
    });
  });
});
