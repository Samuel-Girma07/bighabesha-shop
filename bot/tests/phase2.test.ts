import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import {
  calculateCryptoQuote,
  fetchCoinGeckoPrices,
  setTestPriceCache,
} from '../src/services/rate_engine.service.js';
import {
  createOrder,
  getOrderById,
  submitReceipt,
  approveReceipt,
  rejectReceipt,
  updateOrderStatus,
} from '../src/services/orders.service.js';
import { addStockLink, getAvailableStockCount } from '../src/services/stock.service.js';
import { MockWalletPayAdapter } from '../src/services/payments/mock_wallet_pay.js';
import { LiveWalletPayAdapter } from '../src/services/payments/live_wallet_pay.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 2: Rate Engine & Payment Rails', () => {
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

  describe('Rate Engine & Currency Conversions', () => {
    it('calculates crypto quote accurately with configurable margin', () => {
      // 1,350 ETB at 135 ETB/USD = $10 USD base
      // With 0% margin and TON price $3.00 -> $10.00 USD, 3.3333 TON
      const quoteZeroMargin = calculateCryptoQuote(1350, 3.0, { etbPerUsd: 135, marginPct: 0 });
      expect(quoteZeroMargin.usdAmountWithMargin).toBe(10.0);
      expect(quoteZeroMargin.cryptoAmount).toBe(3.3333);

      // With 5% margin and TON price $3.00 -> $10.50 USD, 3.5 TON
      const quoteWithMargin = calculateCryptoQuote(1350, 3.0, { etbPerUsd: 135, marginPct: 5 });
      expect(quoteWithMargin.usdAmountWithMargin).toBe(10.5);
      expect(quoteWithMargin.cryptoAmount).toBe(3.5);
    });

    it('handles edge cases: zero coin price, negative margin, tiny amounts', () => {
      const edge = calculateCryptoQuote(1, 0, { etbPerUsd: 135, marginPct: -10 });
      expect(edge.usdAmountWithMargin).toBeGreaterThan(0);
      expect(edge.cryptoAmount).toBeGreaterThan(0);
    });

    it('uses cached crypto prices within TTL and respects fallback values', async () => {
      setTestPriceCache({ tonUsd: 4.25, usdtUsd: 1.0, lastFetchedAt: Date.now() });

      const prices = await fetchCoinGeckoPrices();
      expect(prices.tonUsd).toBe(4.25);
      expect(prices.usdtUsd).toBe(1.0);
    });
  });

  describe('Order Lifecycle & State Machine', () => {
    it('creates an order in awaiting_payment status', () => {
      const order = createOrder({
        userId: 123456,
        username: 'ethiopianbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
      });

      expect(order.id).toMatch(/^ORD-/);
      expect(order.status).toBe('awaiting_payment');
      expect(order.amount_etb).toBe(1100);
      expect(order.payment_rail).toBe('cbe');
    });

    it('transitions to pending_approval when manual receipt is submitted', () => {
      const order = createOrder({
        userId: 123456,
        username: 'ethiopianbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'telebirr',
      });

      const updated = submitReceipt(order.id, 'telegram_file_photo_123', 'CBE transfer ref 998877');
      expect(updated.status).toBe('pending_approval');
      expect(updated.receipt_file_id).toBe('telegram_file_photo_123');
      expect(updated.receipt_note).toBe('CBE transfer ref 998877');
    });

    it('auto-allocates stock and sets fulfilled when admin approves a stock product (Gemini)', () => {
      addStockLink('gemini_pro_18m', 'https://gemini.google.com/redeem/token_gemini_1');

      const order = createOrder({
        userId: 123456,
        username: 'geminibuyer',
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
      });

      submitReceipt(order.id, 'receipt_photo_id');

      const approval = approveReceipt(order.id, 111111111);
      expect(approval.order.status).toBe('fulfilled');
      expect(approval.autoDeliveredItem).toBeDefined();
      expect(approval.autoDeliveredItem.payload).toBe('https://gemini.google.com/redeem/token_gemini_1');
      expect(getAvailableStockCount('gemini_pro_18m')).toBe(0);
    });

    it('transitions to pending_fulfillment when admin approves a non-stock order (Premium)', () => {
      const order = createOrder({
        userId: 123456,
        username: 'premiumbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_6m',
        amountETB: 1900,
        paymentRail: 'telebirr',
      });

      submitReceipt(order.id, 'receipt_photo_id');

      const approval = approveReceipt(order.id, 111111111);
      expect(approval.order.status).toBe('pending_fulfillment');
      expect(approval.autoDeliveredItem).toBeNull();
    });

    it('transitions to rejected when admin rejects receipt with reason', () => {
      const order = createOrder({
        userId: 123456,
        username: 'badreceipt',
        productId: 'telegram_premium',
        amountETB: 250,
        paymentRail: 'cbe',
      });

      submitReceipt(order.id, 'blurry_photo_id');

      const rejected = rejectReceipt(order.id, 111111111, 'Transaction amount was only 50 ETB, expected 250 ETB.');
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejection_reason).toContain('Transaction amount was only 50 ETB');
    });
  });

  describe('Payment Rails & Adapters', () => {
    it('generates mock payment link with crypto quote in MockWalletPay', async () => {
      const mockAdapter = new MockWalletPayAdapter();
      const res = await mockAdapter.createPayment({
        orderId: 'ORD-TEST-001',
        userId: 123456,
        amountETB: 1500,
        productName: 'Gemini Pro',
        currency: 'TON',
      });

      expect(res.paymentRef).toBe('MOCK-WP-ORD-TEST-001');
      expect(res.status).toBe('awaiting_payment');
      expect(res.payUrl).toContain('MOCK-WP-ORD-TEST-001');
      expect(res.cryptoAmount).toBeGreaterThan(0);
      expect(res.cryptoCurrency).toBe('TON');
    });

    it('fails fast in LiveWalletPay if WALLET_PAY_API_KEY is missing', async () => {
      process.env.WALLET_PAY_API_KEY = '';
      const liveAdapter = new LiveWalletPayAdapter();

      await expect(
        liveAdapter.createPayment({
          orderId: 'ORD-TEST-002',
          userId: 123456,
          amountETB: 1500,
          productName: 'Gemini Pro',
        })
      ).rejects.toThrow(/WALLET_PAY_API_KEY is not configured/);
    });
  });
});
