import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import {
  createOrder,
  getOrderById,
  getFulfillmentQueue,
  fulfillOrderWithProof,
  refundOrder,
  approveReceipt,
} from '../src/services/orders.service.js';
import { isAdmin } from '../src/bot/handlers/admin.js';
import { getBroadcastTargets, executeBroadcast } from '../src/services/broadcast.service.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 4: Admin Fulfillment Queue, Alerts, Broadcast & Hardening', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '111111111,222222333';
    db = initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Fulfillment Queue FIFO Ordering', () => {
    it('orders pending fulfillment orders strictly oldest-first (FIFO)', async () => {
      // Create 3 orders at slightly different times
      const o1 = createOrder({
        userId: 101,
        username: 'user_first',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'stars',
        status: 'pending_fulfillment',
      });

      const o2 = createOrder({
        userId: 102,
        username: 'user_second',
        productId: 'telegram_premium',
        variantId: 'tg_prem_6m',
        amountETB: 1900,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      const o3 = createOrder({
        userId: 103,
        username: 'user_third',
        productId: 'telegram_premium',
        variantId: 'tg_prem_12m',
        amountETB: 3400,
        paymentRail: 'telebirr',
        status: 'pending_fulfillment',
      });

      const queue = getFulfillmentQueue();
      expect(queue).toHaveLength(3);
      expect(queue[0].id).toBe(o1.id);
      expect(queue[1].id).toBe(o2.id);
      expect(queue[2].id).toBe(o3.id);
    });
  });

  describe('Proof Delivery & Admin Actions', () => {
    it('fulfills order with text and photo proof attachments', () => {
      const order = createOrder({
        userId: 201,
        username: 'buyer201',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      const fulfilled = fulfillOrderWithProof(order.id, 111111111, {
        fileId: 'photo_proof_file_id_999',
        text: 'Gifted 3 months Premium via Fragment transaction hash 0x123',
      });

      expect(fulfilled.status).toBe('fulfilled');
      expect(fulfilled.fulfillment_proof).toContain('Fragment transaction hash 0x123');
      expect(fulfilled.receipt_file_id).toBe('photo_proof_file_id_999');
      expect(fulfilled.admin_notes).toContain('Fulfilled by Admin 111111111');
    });

    it('enforces stock availability when fulfilling Gemini Pro from pending_fulfillment', async () => {
      const { addStockLink, getAvailableStockCount } = await import('../src/services/stock.service.js');

      const geminiOrder = createOrder({
        userId: 301,
        username: 'gemini_buyer',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'cbe',
        status: 'pending_fulfillment',
      });

      // Attempting to fulfill with 0 stock throws clear error
      expect(() => fulfillOrderWithProof(geminiOrder.id, 111111111)).toThrow(
        /Stock is currently sold out/i
      );

      // Add stock link
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/claim/stock-gemini-link-456');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(1);

      // Now fulfilling succeeds and attaches activation link
      const fulfilled = fulfillOrderWithProof(geminiOrder.id, 111111111);
      expect(fulfilled.status).toBe('fulfilled');
      expect(fulfilled.fulfillment_payload).toBe('https://gemini.google.com/claim/stock-gemini-link-456');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);
    });

    it('processes document upload for user bank receipt and sets order to pending_approval', async () => {
      const { setPendingAction } = await import('../src/bot/session.js');
      const { handleDocumentInput } = await import('../src/bot/handlers/input.js');

      const docOrder = createOrder({
        userId: 401,
        username: 'doc_buyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'awaiting_payment',
      });

      setPendingAction(401, {
        type: 'user_receipt_upload',
        data: { orderId: docOrder.id },
      });

      const mockDocCtx: any = {
        from: { id: 401, username: 'doc_buyer' },
        message: {
          document: {
            file_id: 'telegram_doc_file_id_receipt_pdf',
            file_name: 'receipt.pdf',
            mime_type: 'application/pdf',
          },
          caption: 'CBE Mobile Transfer Ref #FT2608199999',
        },
        reply: async () => {},
        api: {
          sendPhoto: async () => {},
          sendMessage: async () => {},
        },
      };

      const handled = await handleDocumentInput(mockDocCtx);
      expect(handled).toBe(true);

      const updated = getOrderById(docOrder.id);
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('pending_approval');
      expect(updated?.receipt_file_id).toBe('telegram_doc_file_id_receipt_pdf');
      expect(updated?.receipt_note).toBe('CBE Mobile Transfer Ref #FT2608199999');
    });

    it('processes order refund and records refund notes', () => {
      const order = createOrder({
        userId: 202,
        username: 'buyer202',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'telebirr',
        status: 'pending_fulfillment',
      });

      const refunded = refundOrder(order.id, 111111111, 'User requested cancellation before Fragment transfer.');
      expect(refunded.status).toBe('refunded');
      expect(refunded.rejection_reason).toContain('User requested cancellation');
      expect(refunded.admin_notes).toContain('Refunded by Admin 111111111');
    });
  });

  describe('Broadcast to Target Audience', () => {
    it('queries broadcast target counts based on language preference', () => {
      const database = getDatabase();
      database.prepare('INSERT INTO users (id, username, language_code) VALUES (?, ?, ?)').run(1, 'user1', 'en');
      database.prepare('INSERT INTO users (id, username, language_code) VALUES (?, ?, ?)').run(2, 'user2', 'en');
      database.prepare('INSERT INTO users (id, username, language_code) VALUES (?, ?, ?)').run(3, 'user3', 'am');

      const allTargets = getBroadcastTargets('all');
      expect(allTargets.length).toBe(3);

      const enTargets = getBroadcastTargets('en');
      expect(enTargets.length).toBe(2);

      const amTargets = getBroadcastTargets('am');
      expect(amTargets.length).toBe(1);
    });

    it('dispatches broadcast message to mocked user targets with stats summary', async () => {
      const database = getDatabase();
      database.prepare('INSERT INTO users (id, username, language_code) VALUES (?, ?, ?)').run(501, 'b1', 'en');
      database.prepare('INSERT INTO users (id, username, language_code) VALUES (?, ?, ?)').run(502, 'b2', 'en');

      const sentUsers: number[] = [];
      const mockApi: any = {
        sendMessage: async (chatId: number, text: string) => {
          sentUsers.push(chatId);
          return { message_id: 123 };
        },
      };

      const result = await executeBroadcast(mockApi, 'Special Weekend Discount 🇪🇹', undefined, 'en');
      expect(result.sent).toBe(2);
      expect(result.failed).toBe(0);
      expect(sentUsers).toContain(501);
      expect(sentUsers).toContain(502);
    });
  });

  describe('Admin Authorization Security', () => {
    it('restricts admin capabilities strictly to configured ADMIN_IDS', () => {
      expect(isAdmin(111111111)).toBe(true);
      expect(isAdmin(222222333)).toBe(true);
      expect(isAdmin(1000000000)).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
    });
  });
});
