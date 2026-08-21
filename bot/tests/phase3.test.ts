import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { isUsernameRequired, hasPublicUsername } from '../src/bot/handlers/gate.js';
import { addStockLink, getAvailableStockCount, allocateStock } from '../src/services/stock.service.js';
import {
  createOrder,
  getOrderById,
  getOrdersByUserId,
  approveReceipt,
  updateOrderStatus,
} from '../src/services/orders.service.js';
import { getStatusBadge } from '../src/bot/handlers/orders.js';
import { getSetting } from '../src/services/settings.service.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 3: End-to-End Purchases, Gate, Delivery & Order History', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = '1397163638,987654321';
    db = initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Username Gate Verification', () => {
    it('requires public @username for Telegram Premium and Telegram Stars, but not Gemini Pro', () => {
      expect(isUsernameRequired('telegram_premium')).toBe(true);
      expect(isUsernameRequired('telegram_stars')).toBe(true);
      expect(isUsernameRequired('gemini_pro_18m')).toBe(false);
    });

    it('identifies users without public username and blocks them', () => {
      expect(hasPublicUsername({ username: undefined })).toBe(false);
      expect(hasPublicUsername({ username: '' })).toBe(false);
      expect(hasPublicUsername({ username: '   ' })).toBe(false);
      expect(hasPublicUsername(undefined)).toBe(false);
    });

    it('unblocks users who have a valid public username', () => {
      expect(hasPublicUsername({ username: 'bighabeshabuyer' })).toBe(true);
      expect(hasPublicUsername({ username: 'Vweah' })).toBe(true);
    });
  });

  describe('Gemini Pro 18m Automated Stock Delivery', () => {
    it('consumes exactly one link from stock on payment approval and saves to order', () => {
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/alpha_1');
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/alpha_2');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(2);

      const order1 = createOrder({
        userId: 101,
        username: 'user_1',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'stars',
      });

      const approval1 = approveReceipt(order1.id, 0);
      expect(approval1.order.status).toBe('fulfilled');
      expect(approval1.order.fulfillment_payload).toBe('https://gemini.google.com/redeem/alpha_1');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(1);

      const order2 = createOrder({
        userId: 102,
        username: 'user_2',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
      });

      const approval2 = approveReceipt(order2.id, 1397163638);
      expect(approval2.order.status).toBe('fulfilled');
      expect(approval2.order.fulfillment_payload).toBe('https://gemini.google.com/redeem/alpha_2');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);
    });

    it('handles out of stock gracefully when no stock item is left', () => {
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);

      const order = createOrder({
        userId: 103,
        username: 'user_3',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'wallet_pay',
      });

      const approval = approveReceipt(order.id, 0);
      // Moves to pending_fulfillment since stock is empty
      expect(approval.order.status).toBe('pending_fulfillment');
      expect(approval.autoDeliveredItem).toBeNull();
    });
  });

  describe('Order History & Details', () => {
    it('retrieves user orders in chronological order descending', () => {
      const uId = 777;
      createOrder({
        userId: uId,
        username: 'historyuser',
        productId: 'telegram_stars',
        amountETB: 125,
        paymentRail: 'stars',
      });
      createOrder({
        userId: uId,
        username: 'historyuser',
        productId: 'telegram_premium',
        amountETB: 1100,
        paymentRail: 'cbe',
      });

      const orders = getOrdersByUserId(uId);
      expect(orders).toHaveLength(2);
      expect(orders[0].product_id).toBe('telegram_premium');
      expect(orders[1].product_id).toBe('telegram_stars');
    });

    it('formats human readable status badges correctly', () => {
      expect(getStatusBadge('fulfilled')).toBe('✅ Delivered');
      expect(getStatusBadge('pending_fulfillment')).toBe('⏳ Processing');
      expect(getStatusBadge('pending_approval')).toBe('⏳ Verifying Receipt');
      expect(getStatusBadge('awaiting_payment')).toBe('💳 Awaiting Payment');
      expect(getStatusBadge('rejected')).toBe('❌ Rejected');
      expect(getStatusBadge('cancelled')).toBe('🚫 Cancelled');
    });

    it('persists user language preference', () => {
      const uId = 888;
      const database = getDatabase();
      database.prepare('INSERT INTO users (id, username, language_code) VALUES (?, ?, ?)').run(uId, 'languser', 'en');

      database.prepare('UPDATE users SET language_code = ? WHERE id = ?').run('en', uId);
      const user = database.prepare('SELECT language_code FROM users WHERE id = ?').get(uId) as any;
      expect(user.language_code).toBe('en');
    });
  });
});
