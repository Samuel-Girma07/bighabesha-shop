import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import {
  createOrder,
  updateOrderStatus,
  refundOrder,
  approveReceipt,
  InvalidOrderTransitionError,
} from '../src/services/orders.service.js';
import { addStockLink, getAvailableStockCount } from '../src/services/stock.service.js';
import { matchSmsToOrders } from '../src/services/sms_parser.service.js';
import { getLedgerBalance } from '../src/services/referral.service.js';
import { isKnownSettingKey, getSetting, setSetting } from '../src/services/settings.service.js';
import { setPendingAction } from '../src/bot/session.js';
import { handleTextInput } from '../src/bot/handlers/input.js';
import { createApiServer } from '../src/api/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');
const BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

function generateValidInitData(userObj: any, token: string = BOT_TOKEN): string {
  const userJson = JSON.stringify(userObj);
  const params: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
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

describe('Domain Defect Remediation Suite', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    process.env.BOT_TOKEN = BOT_TOKEN;
    process.env.ADMIN_IDS = '12345';
    process.env.ADMIN_PASSWORD = 'TestPassword123!';

    initDatabase(':memory:', migrationsDir);
    const db = getDatabase();
    // Seed test users
    db.prepare('INSERT OR IGNORE INTO users (id, first_name, username, is_registered) VALUES (?, ?, ?, 1)')
      .run(1001, 'BuyerOne', 'buyer_one');
    db.prepare('INSERT OR IGNORE INTO users (id, first_name, username, is_registered) VALUES (?, ?, ?, 1)')
      .run(2001, 'ReferrerOne', 'referrer_one');
    db.prepare('INSERT OR IGNORE INTO users (id, first_name, is_registered) VALUES (?, ?, 1)')
      .run(3001, 'UserWithoutHandle');

    const mockBot = {
      api: {
        getFile: async () => ({ file_id: 'mock', file_path: 'mock.jpg' }),
        sendMessage: async () => ({}),
      },
    } as any;

    server = createApiServer(mockBot);
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

  describe('Defect 1: Refund stock link restoration and affiliate ledger reversal', () => {
    it('restores allocated stock item back to available with order_id NULL upon refund', () => {
      const db = getDatabase();
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/test_restore_1');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(1);

      const order = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      const approved = approveReceipt(order.id, 999);
      expect(approved.order.status).toBe('fulfilled');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

      // Verify item is allocated
      const itemBefore = db.prepare('SELECT * FROM stock_items WHERE order_id = ?').get(order.id) as any;
      expect(itemBefore.status).toBe('allocated');

      // Now refund the order
      const refunded = refundOrder(order.id, 999, 'User requested refund');
      expect(refunded.status).toBe('refunded');

      // Stock item must be restored to available
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(1);
      const itemAfter = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(itemBefore.id) as any;
      expect(itemAfter.status).toBe('available');
      expect(itemAfter.order_id).toBeNull();
    });

    it('debits earned affiliate ledger commissions when an order is refunded', () => {
      const db = getDatabase();
      const order = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'telebirr',
      });

      // Move order to pending_fulfillment via approveReceipt
      approveReceipt(order.id, 999);

      // Simulate affiliate commission credit for order
      db.prepare(`
        INSERT INTO ledger_entries (user_id, direction, amount_etb, type, ref_order_id, note)
        VALUES (?, 'credit', ?, 'commission', ?, '5% commission')
      `).run(2001, 55, order.id);

      expect(getLedgerBalance(2001)).toBe(55);

      // Refund the order
      refundOrder(order.id, 999, 'Chargeback/Refund');

      // Affiliate balance must be debited by 55 ETB back to 0
      expect(getLedgerBalance(2001)).toBe(0);

      const reversal = db.prepare(
        "SELECT * FROM ledger_entries WHERE user_id = ? AND direction = 'debit'"
      ).get(2001) as any;
      expect(reversal).toBeDefined();
      expect(reversal.amount_etb).toBe(55);
    });

    it('rolls back stock restoration and ledger debit if status transition fails', () => {
      const db = getDatabase();
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/test_atomic_refund');

      const order = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      // Approve to allocate stock item
      approveReceipt(order.id, 999);
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

      // Add a ledger entry
      db.prepare(`
        INSERT INTO ledger_entries (user_id, direction, amount_etb, type, ref_order_id, note)
        VALUES (?, 'credit', ?, 'commission', ?, '5% commission')
      `).run(2001, 75, order.id);

      // Forcibly move order status to 'cancelled' so refund transition is illegal
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);

      // Attempt refund - must throw InvalidOrderTransitionError
      expect(() => refundOrder(order.id, 999, 'Test failure')).toThrow(InvalidOrderTransitionError);

      // Verify atomic rollback:
      // Stock item should NOT be restored to available
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);
      const stockItem = db.prepare('SELECT * FROM stock_items WHERE order_id = ?').get(order.id) as any;
      expect(stockItem).toBeDefined();
      expect(stockItem.status).toBe('allocated');

      // Ledger commission debit should NOT have been recorded
      const debitEntries = db.prepare(
        "SELECT * FROM ledger_entries WHERE ref_order_id = ? AND direction = 'debit'"
      ).all(order.id);
      expect(debitEntries.length).toBe(0);
      expect(getLedgerBalance(2001)).toBe(75);
    });
  });

  describe('Defect 2: Promo code redemption release on cancellation', () => {
    it('decrements used_count and removes promo_redemptions record on cancel', () => {
      const db = getDatabase();
      // Insert a test promo code with max_uses = 1
      db.prepare(`
        INSERT INTO promo_codes (code, kind, value, max_uses, used_count, is_active)
        VALUES ('SAVE100', 'flat', 100, 1, 0, 1)
      `).run();

      const order = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
        promoCode: 'SAVE100',
      });

      expect(order.discount_etb).toBe(100);

      const promoBefore = db.prepare("SELECT used_count FROM promo_codes WHERE code = 'SAVE100'").get() as any;
      expect(promoBefore.used_count).toBe(1);

      const redemptionsBefore = db.prepare("SELECT * FROM promo_redemptions WHERE order_id = ?").all(order.id);
      expect(redemptionsBefore.length).toBe(1);

      // Cancel the order
      updateOrderStatus(order.id, 'cancelled', { admin_notes: 'Cancelled by user' });

      const promoAfter = db.prepare("SELECT used_count FROM promo_codes WHERE code = 'SAVE100'").get() as any;
      expect(promoAfter.used_count).toBe(0);

      const redemptionsAfter = db.prepare("SELECT * FROM promo_redemptions WHERE order_id = ?").all(order.id);
      expect(redemptionsAfter.length).toBe(0);
    });
  });

  describe('Defect 3: Duplicate SMS reference deduplication', () => {
    it('prevents matching an SMS reference that is already recorded in receipt_evidence', () => {
      const db = getDatabase();
      const order1 = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      // Record prior evidence with reference FT260904001
      db.prepare(`
        INSERT INTO receipt_evidence (order_id, user_id, source, raw_text, amount_etb, reference, matched)
        VALUES (?, ?, 'sms', 'Your transaction FT260904001 was completed.', 1500, 'FT260904001', 1)
      `).run(order1.id, 1001);

      createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      // Another SMS with the EXACT same reference arrives
      const result = matchSmsToOrders(db, 1001, { amountEtb: 1500, reference: 'FT260904001' });
      // Should NOT match because reference was already matched!
      expect(result.matched).toBe(false);
      expect(result.reason).toBe('reference_already_used');
    });

    it('rejects duplicate SMS reference with case-insensitive and trimmed comparison', () => {
      const db = getDatabase();
      const order1 = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      db.prepare(`
        INSERT INTO receipt_evidence (order_id, user_id, source, raw_text, amount_etb, reference, matched)
        VALUES (?, ?, 'sms', 'Your transaction FT999999 was completed.', 1500, 'FT999999', 1)
      `).run(order1.id, 1001);

      createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      const result = matchSmsToOrders(db, 1001, { amountEtb: 1500, reference: '  ft999999  ' });
      expect(result.matched).toBe(false);
      expect(result.reason).toBe('reference_already_used');
    });

    it('sends specific error message when SMS transaction reference was already used', async () => {
      const db = getDatabase();
      const order1 = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'cbe',
      });

      // Record prior evidence with reference FT260904003
      db.prepare(`
        INSERT INTO receipt_evidence (order_id, user_id, source, raw_text, amount_etb, reference, matched)
        VALUES (?, ?, 'sms', 'Your transaction FT260904003 was completed.', 1500, 'FT260904003', 1)
      `).run(order1.id, 1001);

      const order2 = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'cbe',
      });

      setPendingAction(1001, { type: 'user_sms_forward', data: { orderId: order2.id } }, 10);

      let replyMsg = '';
      const mockCtx: any = {
        from: { id: 1001 },
        message: { text: 'ETB 1,500.00 debited from your account. Ref: FT260904003' },
        reply: async (msg: string) => {
          replyMsg = msg;
        },
      };

      const handled = await handleTextInput(mockCtx);
      expect(handled).toBe(true);
      expect(replyMsg).toContain('Transaction Reference Already Used');
      expect(replyMsg).toContain('already been matched to a previous order');
    });
  });

  describe('Defect 4: Telegram Premium Username Validation Gate on API', () => {
    it('blocks order creation with 403 USERNAME_REQUIRED when user has no handle and specifies none', async () => {
      const initData = generateValidInitData({ id: 3001, first_name: 'NoHandleUser' });

      const res = await fetch(`http://localhost:${port}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          productId: 'telegram_premium',
          variantId: 'tg_prem_3m',
          paymentRail: 'telebirr',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('USERNAME_REQUIRED');
    });

    it('rejects invalid target usernames with 400', async () => {
      const initData = generateValidInitData({ id: 1001, first_name: 'BuyerOne', username: 'buyer_one' });

      const res = await fetch(`http://localhost:${port}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          productId: 'telegram_premium',
          variantId: 'tg_prem_3m',
          paymentRail: 'telebirr',
          targetUsername: 'bad!name@#$',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Defect 5: Receipt upload guard on finalized orders', () => {
    it('rejects receipt upload on fulfilled orders with 400', async () => {
      const order = createOrder({
        userId: 1001,
        username: 'buyer_one',
        productId: 'gemini_pro_18m',
        amountETB: 1500,
        paymentRail: 'telebirr',
      });

      updateOrderStatus(order.id, 'fulfilled');

      const initData = generateValidInitData({ id: 1001, first_name: 'BuyerOne', username: 'buyer_one' });
      const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const res = await fetch(`http://localhost:${port}/api/receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          receiptImageBase64: PNG_1PX,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/cannot upload receipt/i);
    });
  });

  describe('Defect 6: User Affiliate Payout Request API', () => {
    it('rejects payout requests with amount under 100 ETB', async () => {
      const initData = generateValidInitData({ id: 2001, first_name: 'ReferrerOne', username: 'referrer_one' });

      const res = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 50,
          method: 'telebirr',
          destination: '0911000000',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/minimum/i);
    });

    it('rejects payout requests exceeding available balance', async () => {
      const initData = generateValidInitData({ id: 2001, first_name: 'ReferrerOne', username: 'referrer_one' });

      const res = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 500,
          method: 'telebirr',
          destination: '0911000000',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/insufficient/i);
    });

    it('accepts valid payout request and blocks duplicate pending requests', async () => {
      const db = getDatabase();
      // Credit 300 ETB
      db.prepare(`
        INSERT INTO ledger_entries (user_id, direction, amount_etb, type, note)
        VALUES (2001, 'credit', 300, 'commission', 'bonus')
      `).run();

      const initData = generateValidInitData({ id: 2001, first_name: 'ReferrerOne', username: 'referrer_one' });

      // First request: 200 ETB
      const res1 = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 200,
          method: 'telebirr',
          destination: '0911000000',
        }),
      });

      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.success).toBe(true);

      // Verify row in database
      const row = db.prepare("SELECT * FROM payout_requests WHERE user_id = 2001 AND status = 'pending'").get() as any;
      expect(row).toBeDefined();
      expect(row.amount_etb).toBe(200);
      expect(row.destination).toBe('0911000000');

      // Second request while first is still pending must return 409 Conflict
      const res2 = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 100,
          method: 'cbe',
          destination: '1000123456789',
        }),
      });

      expect(res2.status).toBe(409);
    });

    it('rejects payout requests with decimal amounts', async () => {
      const initData = generateValidInitData({ id: 2001, first_name: 'ReferrerOne', username: 'referrer_one' });

      const res = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 150.5,
          method: 'telebirr',
          destination: '0911000000',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/whole numbers|integer/i);
    });

    it('rejects payout requests with unsupported payment methods', async () => {
      const initData = generateValidInitData({ id: 2001, first_name: 'ReferrerOne', username: 'referrer_one' });

      const res = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 150,
          method: 'paypal',
          destination: '0911000000',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/invalid payout method/i);
    });

    it('rejects payout requests with invalid or empty destination', async () => {
      const initData = generateValidInitData({ id: 2001, first_name: 'ReferrerOne', username: 'referrer_one' });

      // Destination too short (<5 chars)
      const res1 = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 150,
          method: 'telebirr',
          destination: '123',
        }),
      });
      expect(res1.status).toBe(400);

      // Destination with illegal characters
      const res2 = await fetch(`http://localhost:${port}/api/user/payout-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tma ${initData}`,
        },
        body: JSON.stringify({
          amountEtb: 150,
          method: 'telebirr',
          destination: 'bad<script>account',
        }),
      });
      expect(res2.status).toBe(400);
    });
  });

  describe('Defect 7: support_username in KNOWN_SETTING_KEYS', () => {
    it('recognizes support_username as known and permits getting and setting it', () => {
      expect(isKnownSettingKey('support_username')).toBe(true);
      setSetting('support_username', 'bighabesha_support_test');
      expect(getSetting('support_username')).toBe('bighabesha_support_test');
    });
  });
});
