import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import {
  createOrder,
  getOrderById,
  updateOrderStatus,
  isValidUsername,
  sanitizeUsername,
  InvalidUsernameError,
  InvalidOrderTransitionError,
  Order,
} from '../src/services/orders.service.js';
import {
  deliverWithReseller,
  checkBalanceAndAlert,
  notifyAdminsLowFloatFromResult,
  isResellerEligible,
  getPremiumMonths,
  setResellerProviderForTest,
  resetResellerProviderCache,
} from '../src/services/reseller.service.js';
import { MockResellerAdapter } from '../src/services/reseller/mock.js';
import {
  InsufficientFloatError,
  InvalidTargetUserError,
  ProviderUnavailableError,
} from '../src/services/reseller/types.js';
import { handleAdminRetryDelivery } from '../src/bot/handlers/checkout.js';
import { isValidTelegramUsername } from '../src/bot/handlers/gate.js';
import { resetConfigCache } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('B2B Telegram Premium Reseller Pipeline', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');
  const ADMIN_1 = 111111111;
  const ADMIN_2 = 222222333;
  const BUYER_ID = 987654321;

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = `${ADMIN_1},${ADMIN_2}`;
    process.env.RESELLER_PROVIDER = 'mock';
    process.env.RESELLER_LOW_BALANCE_ALERT_USDT = '50';
    resetConfigCache();
    resetResellerProviderCache();
    db = initDatabase(':memory:', migrationsDir);
  });

  afterEach(() => {
    resetResellerProviderCache();
    resetConfigCache();
    closeDatabase();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Order State Machine Transitions
  // =========================================================================
  describe('1. Order State Machine Transitions', () => {
    it('allows valid happy-path transitions: pending_approval -> processing -> fulfilled', () => {
      const order = createOrder({
        userId: BUYER_ID,
        username: 'validbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'recipient_user',
      });
      expect(order.status).toBe('pending_approval');

      const processingOrder = updateOrderStatus(order.id, 'processing', {
        reseller_provider: 'mock',
      });
      expect(processingOrder.status).toBe('processing');
      expect(processingOrder.reseller_provider).toBe('mock');

      const fulfilledOrder = updateOrderStatus(order.id, 'fulfilled', {
        reseller_tx_id: 'mock_tx_12345',
        fulfillment_payload: 'Telegram Premium 3M activated on @recipient_user',
      });
      expect(fulfilledOrder.status).toBe('fulfilled');
      expect(fulfilledOrder.reseller_tx_id).toBe('mock_tx_12345');
    });

    it('allows valid error & retry transitions: processing -> delivery_failed -> processing -> fulfilled', () => {
      const order = createOrder({
        userId: BUYER_ID,
        username: 'validbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_6m',
        amountETB: 1900,
        paymentRail: 'telebirr',
        status: 'pending_approval',
        targetUsername: 'target_account',
      });

      // 1. Enter processing
      updateOrderStatus(order.id, 'processing');
      // 2. Failure occurs
      const failed = updateOrderStatus(order.id, 'delivery_failed', {
        reseller_error: 'Provider temporary outage',
      });
      expect(failed.status).toBe('delivery_failed');
      expect(failed.reseller_error).toBe('Provider temporary outage');

      // 3. Admin retries -> transitions back to processing
      const retrying = updateOrderStatus(order.id, 'processing', {
        reseller_error: null,
      });
      expect(retrying.status).toBe('processing');
      expect(retrying.reseller_error).toBeNull();

      // 4. Recovery -> fulfilled
      const fulfilled = updateOrderStatus(order.id, 'fulfilled', {
        reseller_tx_id: 'tx_recovered_999',
      });
      expect(fulfilled.status).toBe('fulfilled');
    });

    it('allows terminal exit from delivery_failed: refund and reject', () => {
      const order1 = createOrder({
        userId: BUYER_ID,
        productId: 'telegram_premium',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
      });
      updateOrderStatus(order1.id, 'processing');
      updateOrderStatus(order1.id, 'delivery_failed');

      const refunded = updateOrderStatus(order1.id, 'refunded', {
        rejection_reason: 'Float unavailable, manual refund executed',
      });
      expect(refunded.status).toBe('refunded');

      const order2 = createOrder({
        userId: BUYER_ID,
        productId: 'telegram_premium',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
      });
      updateOrderStatus(order2.id, 'processing');
      updateOrderStatus(order2.id, 'delivery_failed');

      const rejected = updateOrderStatus(order2.id, 'rejected', {
        rejection_reason: 'Buyer provided non-existent account',
      });
      expect(rejected.status).toBe('rejected');
    });

    it('enforces illegal transition guards and throws InvalidOrderTransitionError', () => {
      const order = createOrder({
        userId: BUYER_ID,
        productId: 'telegram_premium',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'new',
      });

      // Illegal: new -> delivery_failed
      expect(() => {
        updateOrderStatus(order.id, 'delivery_failed');
      }).toThrow(InvalidOrderTransitionError);

      // Illegal: awaiting_payment -> delivery_failed
      updateOrderStatus(order.id, 'awaiting_payment');
      expect(() => {
        updateOrderStatus(order.id, 'delivery_failed');
      }).toThrow(InvalidOrderTransitionError);

      // Illegal: delivery_failed -> fulfilled (must go through processing first)
      updateOrderStatus(order.id, 'pending_approval');
      updateOrderStatus(order.id, 'processing');
      updateOrderStatus(order.id, 'delivery_failed');
      expect(() => {
        updateOrderStatus(order.id, 'fulfilled');
      }).toThrow(InvalidOrderTransitionError);
    });
  });

  // =========================================================================
  // 2. Target Username Validation
  // =========================================================================
  describe('2. Target Username Validation', () => {
    it('validates public Telegram usernames according to Telegram specification', () => {
      // Valid usernames (5 to 32 chars, letters, numbers, underscores)
      expect(isValidUsername('username')).toBe(true);
      expect(isValidUsername('@username')).toBe(true);
      expect(isValidUsername('user_1234')).toBe(true);
      expect(isValidUsername('@User_Name_99')).toBe(true);
      expect(isValidUsername('abcde')).toBe(true); // exactly 5 chars
      expect(isValidUsername('a'.repeat(32))).toBe(true); // exactly 32 chars

      // Alias in gate.ts
      expect(isValidTelegramUsername('@habesha_king')).toBe(true);
    });

    it('rejects invalid username formats (too short, too long, special characters, spaces)', () => {
      expect(isValidUsername('')).toBe(false);
      expect(isValidUsername(null)).toBe(false);
      expect(isValidUsername(undefined)).toBe(false);
      expect(isValidUsername('abcd')).toBe(false); // 4 chars - too short
      expect(isValidUsername('a'.repeat(33))).toBe(false); // 33 chars - too long
      expect(isValidUsername('user-name')).toBe(false); // dash not allowed
      expect(isValidUsername('user name')).toBe(false); // space not allowed
      expect(isValidUsername('user@name')).toBe(false); // @ in middle
      expect(isValidUsername('user.name')).toBe(false); // dot not allowed
      expect(isValidUsername('user$name')).toBe(false); // symbols
      expect(isValidUsername('   ')).toBe(false);
      expect(isValidUsername('@')).toBe(false);
    });

    it('sanitizeUsername normalizes input, lowercases, and throws InvalidUsernameError on invalid format', () => {
      expect(sanitizeUsername('@bighabesha')).toBe('bighabesha');
      expect(sanitizeUsername('   @clean_user   ')).toBe('clean_user');
      expect(sanitizeUsername('telegram_vip')).toBe('telegram_vip');
      expect(sanitizeUsername('@BigHabesha')).toBe('bighabesha');
      expect(sanitizeUsername('https://t.me/User_Name')).toBe('user_name');
      expect(sanitizeUsername('t.me/VIP_User')).toBe('vip_user');

      expect(() => sanitizeUsername('bad!')).toThrow(InvalidUsernameError);
      expect(() => sanitizeUsername('@123')).toThrow(InvalidUsernameError); // 3 chars
      expect(() => sanitizeUsername('user name')).toThrow(InvalidUsernameError);
      expect(() => sanitizeUsername('123456789')).toThrow(InvalidUsernameError); // pure numeric Telegram ID rejected
      expect(() => sanitizeUsername('@987654321')).toThrow(InvalidUsernameError);
    });

    it('isValidUsername validates URLs and prefixes while rejecting pure numeric Telegram IDs', () => {
      expect(isValidUsername('https://t.me/valid_user')).toBe(true);
      expect(isValidUsername('t.me/valid_user')).toBe(true);
      expect(isValidUsername('@valid_user')).toBe(true);
      expect(isValidUsername('123456789')).toBe(false);
      expect(isValidUsername('@123456789')).toBe(false);
    });

    it('persists target_username in createOrder and updateOrderStatus', () => {
      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        targetUsername: '@custom_recipient',
      });

      expect(order.target_username).toBe('custom_recipient');

      const fetched = getOrderById(order.id);
      expect(fetched?.target_username).toBe('custom_recipient');

      const updated = updateOrderStatus(order.id, 'awaiting_payment', {
        target_username: '@another_recipient',
      });
      expect(updated.target_username).toBe('another_recipient');
    });
  });

  // =========================================================================
  // 3. End-to-End Fulfillment with MockResellerAdapter
  // =========================================================================
  describe('3. End-to-End Fulfillment with MockResellerAdapter', () => {
    it('verifies reseller eligibility and variant month parsing', () => {
      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
      });

      expect(isResellerEligible(order)).toBe(true);
      expect(getPremiumMonths(order)).toBe(3);

      const order6m = createOrder({
        userId: BUYER_ID,
        productId: 'telegram_premium',
        variantId: 'tg_prem_6m',
        amountETB: 1900,
        paymentRail: 'cbe',
      });
      expect(getPremiumMonths(order6m)).toBe(6);

      const order12m = createOrder({
        userId: BUYER_ID,
        productId: 'telegram_premium',
        variantId: 'tg_prem_12m',
        amountETB: 3500,
        paymentRail: 'cbe',
      });
      expect(getPremiumMonths(order12m)).toBe(12);

      const geminiOrder = createOrder({
        userId: BUYER_ID,
        productId: 'gemini_pro_18m',
        variantId: 'gemini_pro_18m_default',
        amountETB: 1500,
        paymentRail: 'cbe',
      });
      expect(isResellerEligible(geminiOrder)).toBe(false);
      expect(getPremiumMonths(geminiOrder)).toBeNull();
    });

    it('executes end-to-end fulfillment on deliverWithReseller()', async () => {
      const mockAdapter = new MockResellerAdapter(1000, 2.5);
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'testbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: '@target_friend',
      });

      const outcome = await deliverWithReseller(order.id, ADMIN_1);

      expect(outcome.delivered).toBe(true);
      expect(outcome.order.status).toBe('fulfilled');
      expect(outcome.order.reseller_provider).toBe('mock');
      expect(outcome.order.reseller_tx_id).toMatch(/^mock_[a-f0-9]{12}$/);
      expect(outcome.order.fulfillment_payload).toContain('Telegram Premium 3M activated on @target_friend');
      expect(outcome.order.reseller_error).toBeNull();

      // Verify stored in DB
      const freshOrder = getOrderById(order.id);
      expect(freshOrder?.status).toBe('fulfilled');
      expect(freshOrder?.reseller_tx_id).toBe(outcome.order.reseller_tx_id);
    });

    it('falls back to buyer username when target_username is unset', async () => {
      const mockAdapter = new MockResellerAdapter();
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'direct_buyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_6m',
        amountETB: 1900,
        paymentRail: 'cbe',
        status: 'pending_approval',
      });

      const outcome = await deliverWithReseller(order.id, ADMIN_1);
      expect(outcome.delivered).toBe(true);
      expect(outcome.order.fulfillment_payload).toContain('activated on @direct_buyer');
    });

    it('fails safely if order has neither target_username nor username', async () => {
      const mockAdapter = new MockResellerAdapter();
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
      });

      const outcome = await deliverWithReseller(order.id, ADMIN_1);
      expect(outcome.delivered).toBe(false);
      expect(outcome.order.status).toBe('delivery_failed');
      expect(outcome.order.reseller_error).toContain('No target @username recorded');
    });
  });

  // =========================================================================
  // 4. Provider Failure & Retry Handling
  // =========================================================================
  describe('4. Provider Failure & Retry Handling', () => {
    it('handles InsufficientFloatError, marks delivery_failed, and stores reseller_error', async () => {
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.fulfillError = new InsufficientFloatError('mock', 1.5, 7.5);
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'testbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'vipuser',
      });

      const sentAlerts: { to: number; text: string }[] = [];
      const mockApi: any = {
        sendMessage: async (chatId: number, text: string) => {
          sentAlerts.push({ to: chatId, text });
          return { message_id: 123 };
        },
      };

      const outcome = await deliverWithReseller(order.id, ADMIN_1, mockApi);

      expect(outcome.delivered).toBe(false);
      expect(outcome.order.status).toBe('delivery_failed');
      expect(outcome.order.reseller_error).toContain('Insufficient provider float ($1.50). Top up and retry.');

      // Low float alert sent to all admins
      expect(sentAlerts.length).toBe(2);
      expect(sentAlerts.map((s) => s.to)).toEqual([ADMIN_1, ADMIN_2]);
      expect(sentAlerts[0].text).toContain('Reseller Float Low');
    });

    it('handles InvalidTargetUserError, marks delivery_failed, and stores reseller_error', async () => {
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.fulfillError = new InvalidTargetUserError('mock', 'ghost_user');
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'testbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'ghost_user',
      });

      const outcome = await deliverWithReseller(order.id, ADMIN_1);

      expect(outcome.delivered).toBe(false);
      expect(outcome.order.status).toBe('delivery_failed');
      expect(outcome.order.reseller_error).toContain('Provider could not find Telegram user @ghost_user');
    });

    it('handles ProviderUnavailableError, marks delivery_failed, and stores reseller_error', async () => {
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.fulfillError = new ProviderUnavailableError('mock', 'Connection timeout');
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'testbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'target_u',
      });

      const outcome = await deliverWithReseller(order.id, ADMIN_1);
      expect(outcome.delivered).toBe(false);
      expect(outcome.order.status).toBe('delivery_failed');
      expect(outcome.order.reseller_error).toContain('Provider unreachable: Connection timeout');
    });

    it('successfully recovers and delivers on admin retry after provider failure', async () => {
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.fulfillError = new ProviderUnavailableError('mock', 'Temporary gateway error 502');
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyer_vip',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'happy_recipient',
      });

      // 1. Initial attempt fails
      const failedOutcome = await deliverWithReseller(order.id, ADMIN_1);
      expect(failedOutcome.order.status).toBe('delivery_failed');

      // 2. Provider recovers
      mockAdapter.fulfillError = null;

      // 3. Admin triggers handleAdminRetryDelivery callback
      const sentCustomerMessages: string[] = [];
      const editedMessages: string[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_1, username: 'boss_admin' },
        callbackQuery: {
          message: {
            text: 'Old message text',
          },
        },
        editMessageText: async (text: string) => {
          editedMessages.push(text);
        },
        answerCallbackQuery: async () => {},
        api: {
          sendMessage: async (chatId: number, text: string) => {
            if (chatId === BUYER_ID) {
              sentCustomerMessages.push(text);
            }
          },
        },
      };

      await handleAdminRetryDelivery(mockCtx, order.id);

      const retriedOrder = getOrderById(order.id);
      expect(retriedOrder?.status).toBe('fulfilled');
      expect(retriedOrder?.reseller_tx_id).toBeDefined();
      expect(retriedOrder?.reseller_error).toBeNull();
      expect(sentCustomerMessages[0]).toContain('Telegram Premium');
      expect(sentCustomerMessages[0]).toContain('@happy_recipient');
    });

    it('rejects retry requests from unauthorized non-admin users', async () => {
      const order = createOrder({
        userId: BUYER_ID,
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
      });
      updateOrderStatus(order.id, 'processing');
      updateOrderStatus(order.id, 'delivery_failed');

      const mockCtx: any = {
        from: { id: 999999999 }, // Not in ADMIN_IDS
        answerCallbackQuery: vi.fn(),
      };

      await handleAdminRetryDelivery(mockCtx, order.id);
      // Order remains untouched
      expect(getOrderById(order.id)?.status).toBe('delivery_failed');
    });
  });

  // =========================================================================
  // 5. Float Balance Monitoring & Alerts
  // =========================================================================
  describe('5. Float Balance Monitoring & Alerts', () => {
    it('queries provider float balance and returns USDT balance', async () => {
      const mockAdapter = new MockResellerAdapter(250);
      setResellerProviderForTest(mockAdapter);

      const mockApi: any = {
        sendMessage: vi.fn(),
      };

      const res = await checkBalanceAndAlert(mockApi);
      expect(res).not.toBeNull();
      expect(res?.provider).toBe('mock');
      expect(res?.balanceUsdt).toBe(250);
      expect(mockApi.sendMessage).not.toHaveBeenCalled();
    });

    it('sends low-float warnings to all configured ADMIN_IDS when balance drops below threshold', async () => {
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.customBalanceUsdt = 32.5; // Below RESELLER_LOW_BALANCE_ALERT_USDT = 50
      setResellerProviderForTest(mockAdapter);

      const sentAlerts: { to: number; text: string }[] = [];
      const mockApi: any = {
        sendMessage: async (chatId: number, text: string) => {
          sentAlerts.push({ to: chatId, text });
          return { message_id: 1 };
        },
      };

      const res = await checkBalanceAndAlert(mockApi);
      expect(res?.balanceUsdt).toBe(32.5);

      // Alerted both admins
      expect(sentAlerts.length).toBe(2);
      expect(sentAlerts[0].to).toBe(ADMIN_1);
      expect(sentAlerts[1].to).toBe(ADMIN_2);
      expect(sentAlerts[0].text).toContain('Reseller Float Low');
      expect(sentAlerts[0].text).toContain('$32.50 USDT');
      expect(sentAlerts[0].text).toContain('Alert threshold: $50.00');
    });

    it('notifyAdminsLowFloatFromResult formats clean HTML and handles API dispatch errors gracefully', async () => {
      const mockApi: any = {
        sendMessage: vi.fn().mockRejectedValueOnce(new Error('Telegram network error')).mockResolvedValueOnce({}),
      };

      // Should not throw even if sending to the first admin fails
      await expect(
        notifyAdminsLowFloatFromResult(mockApi, 'mock', 14.2)
      ).resolves.not.toThrow();

      expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('queries provider balance if balanceUsdt is undefined in notifyAdminsLowFloatFromResult', async () => {
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.customBalanceUsdt = 18.75;
      setResellerProviderForTest(mockAdapter);

      const sentAlerts: { to: number; text: string }[] = [];
      const mockApi: any = {
        sendMessage: async (chatId: number, text: string) => {
          sentAlerts.push({ to: chatId, text });
          return { message_id: 1 };
        },
      };

      await notifyAdminsLowFloatFromResult(mockApi, 'mock', undefined);
      expect(sentAlerts.length).toBe(2);
      expect(sentAlerts[0].text).toContain('$18.75 USDT');
    });
  });

  // =========================================================================
  // 6. Security Audit Verifications
  // =========================================================================
  describe('6. Security Audit: Target Usernames, Credential Safety & Admin Authorization', () => {
    it('neutralizes injection attacks and path traversal payloads in target_username', () => {
      const injectionPayloads = [
        "admin' OR '1'='1",
        '<script>alert("xss")</script>',
        '../../../../etc/passwd',
        'victim; DROP TABLE orders;--',
        'user\nSet-Cookie: stolen=1',
        'target\0nullbyte',
      ];

      for (const payload of injectionPayloads) {
        // Must be rejected by username validation
        expect(isValidUsername(payload)).toBe(false);
        expect(() => sanitizeUsername(payload)).toThrow(InvalidUsernameError);
      }
    });

    it('verifies that API keys and bearer tokens are never logged or exposed in client responses', () => {
      const mockAdapter = new MockResellerAdapter();
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'secure_buyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'safe_target',
      });

      const updated = updateOrderStatus(order.id, 'fulfilled', {
        reseller_tx_id: 'tx_safe_123',
        fulfillment_payload: 'Activated on @safe_target',
      });

      // Ensure no internal API keys leak in order object
      const orderKeys = Object.keys(updated);
      expect(orderKeys).not.toContain('api_key');
      expect(orderKeys).not.toContain('secret');
      expect(JSON.stringify(updated)).not.toContain('RESELLER_API_KEY');
    });

    it('ensures only verified admin IDs can execute reseller admin actions', async () => {
      const nonAdminId = 555555555;
      const { isAdmin } = await import('../src/bot/handlers/admin.js');
      expect(isAdmin(nonAdminId)).toBe(false);
      expect(isAdmin(ADMIN_1)).toBe(true);
      expect(isAdmin(ADMIN_2)).toBe(true);
      expect(isAdmin(undefined)).toBe(false);
    });
  });

  // =========================================================================
  // 7. Reseller Sweeper & Admin Queue Delivery
  // =========================================================================
  describe('7. Reseller Sweeper & Admin Queue Delivery', () => {
    it('retries delivery_failed orders when float is healthy and fulfills them', async () => {
      const { retryFailedResellerDeliveries, startResellerRetrySweeper, stopResellerRetrySweeper } = await import('../src/services/reseller.service.js');
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.customBalanceUsdt = 100;
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'telebirr',
        status: 'pending_approval',
        targetUsername: 'sweeper_target',
      });
      updateOrderStatus(order.id, 'processing');
      updateOrderStatus(order.id, 'delivery_failed', { reseller_error: 'Temporary provider glitch' });

      const mockApi: any = {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      };

      const result = await retryFailedResellerDeliveries(mockApi);
      expect(result.retried).toBe(1);
      expect(result.fulfilled).toBe(1);
      expect(result.failed).toBe(0);

      const updated = getOrderById(order.id);
      expect(updated?.status).toBe('fulfilled');
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        BUYER_ID,
        expect.stringContaining('Telegram Premium'),
        expect.anything()
      );

      const timer = startResellerRetrySweeper(mockApi, 100000);
      expect(timer).toBeDefined();
      stopResellerRetrySweeper();
    });

    it('skips sweeper retries when float is below alert threshold and alerts admins', async () => {
      const { retryFailedResellerDeliveries } = await import('../src/services/reseller.service.js');
      const mockAdapter = new MockResellerAdapter();
      mockAdapter.customBalanceUsdt = 25; // threshold is 50
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'telebirr',
        status: 'pending_approval',
        targetUsername: 'sweeper_target_2',
      });
      updateOrderStatus(order.id, 'processing');
      updateOrderStatus(order.id, 'delivery_failed', { reseller_error: 'Insufficient float' });

      const mockApi: any = {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      };

      const result = await retryFailedResellerDeliveries(mockApi);
      expect(result.retried).toBe(0);
      expect(result.fulfilled).toBe(0);
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('handleAdminQueueResellerDeliver executes delivery and notifies buyer', async () => {
      const { handleAdminQueueResellerDeliver } = await import('../src/bot/handlers/admin_queue.js');
      const mockAdapter = new MockResellerAdapter();
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'admin_queue_target',
      });

      const sentMessages: { to: number; text: string }[] = [];
      const editedMessages: string[] = [];
      const mockCtx: any = {
        from: { id: ADMIN_1, username: 'adminuser' },
        api: {
          sendMessage: vi.fn().mockImplementation(async (to: number, text: string) => {
            sentMessages.push({ to, text });
            return { message_id: 1 };
          }),
        },
        reply: vi.fn(),
        editMessageText: vi.fn().mockImplementation(async (text: string) => {
          editedMessages.push(text);
          return true;
        }),
        callbackQuery: { message: { text: 'old' } },
      };

      await handleAdminQueueResellerDeliver(mockCtx, order.id);

      const updated = getOrderById(order.id);
      expect(updated?.status).toBe('fulfilled');
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].to).toBe(BUYER_ID);
      expect(sentMessages[0].text).toContain('admin_queue_target');
      expect(editedMessages.length).toBe(1);
      expect(editedMessages[0]).toContain('Reseller Delivery Succeeded');
    });

    it('admin_queue_reseller_deliver_ callback triggers reseller fulfillment and transitions the order to fulfilled', async () => {
      const { createBot } = await import('../src/bot/bot.js');
      const mockAdapter = new MockResellerAdapter();
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'cb_queue_target',
      });

      const bot = createBot(process.env.BOT_TOKEN!);
      (bot as any).botInfo = { id: 42, is_bot: true, username: 'test_bot', first_name: 'Test Bot' };
      bot.api.config.use((async () => {
        return { ok: true, result: true };
      }) as any);

      await bot.handleUpdate({
        update_id: 123456,
        callback_query: {
          id: 'cb_queue_reseller_1',
          from: { id: ADMIN_1, is_bot: false, first_name: 'Admin', username: 'adminuser' },
          data: `admin_queue_reseller_deliver_${order.id}`,
          chat_instance: 'ci_1',
          message: {
            message_id: 10,
            date: Math.floor(Date.now() / 1000),
            chat: { id: ADMIN_1, type: 'private' },
            text: 'Queue message',
          },
        },
      } as any);

      const updated = getOrderById(order.id);
      expect(updated?.status).toBe('fulfilled');
      expect(updated?.reseller_tx_id).toBeTruthy();
      expect(updated?.fulfillment_payload).toContain('cb_queue_target');
    });
  });

  // =========================================================================
  // 12. Delivery Concurrency Lease
  // =========================================================================
  describe('12. Delivery Concurrency Lease', () => {
    it('prevents concurrent delivery attempts on the same order using atomic job lease', async () => {
      const { tryAcquireLease, releaseLease } = await import('../src/db/lease.js');
      const mockAdapter = new MockResellerAdapter();
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'lease_target_user',
      });

      // Simulate a concurrent delivery worker holding the lease
      const leaseKey = `reseller:order:${order.id}`;
      const preAcquired = tryAcquireLease(leaseKey, 60_000, 'worker-1');
      expect(preAcquired).toBe(true);

      // Attempt concurrent delivery
      const outcome = await deliverWithReseller(order.id, ADMIN_1);
      expect(outcome.delivered).toBe(false);
      expect(outcome.error).toBe('Order is already being processed');

      // Release the held lease
      releaseLease(leaseKey, 'worker-1');

      // Subsequent attempt now acquires and succeeds
      const outcome2 = await deliverWithReseller(order.id, ADMIN_1);
      expect(outcome2.delivered).toBe(true);
      expect(outcome2.order.status).toBe('fulfilled');
    });
  });

  // =========================================================================
  // 13. Gramix API v1 Protocol & Error Mapping
  // =========================================================================
  describe('13. Gramix API v1 Protocol & Error Mapping', () => {
    it('sends correct purchase/premium/N path, x-api-key, idempotency-key, and lowercase recipientName body', async () => {
      const { GramixAdapter } = await import('../src/services/reseller/gramix.js');
      const { getConfig } = await import('../src/config/env.js');
      const cfg = { ...getConfig(), GRAMIX_API_KEY: 'test-gmx-key', GRAMIX_API_URL: 'https://api.gramix.io/api/v1' };
      const adapter = new GramixAdapter(cfg);

      let capturedPath = '';
      let capturedBody: any = null;
      let capturedOptions: any = null;

      (adapter as any).postJson = async (path: string, body: any, options: any) => {
        capturedPath = path;
        capturedBody = body;
        capturedOptions = options;
        return {
          success: true,
          data: {
            orderId: 'GMX-ORD-777',
            costUsdt: 11.5,
            status: 'completed',
          },
        };
      };

      const res = await adapter.fulfill({
        orderId: 'ORD-987654',
        targetUsername: '@MixedCaseUser',
        months: 3,
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe('gramix');
      expect(res.providerTxId).toBe('GMX-ORD-777');
      expect(res.costUsdt).toBe(11.5);
      expect(capturedPath).toBe('purchase/premium/3');
      expect(capturedBody).toEqual({
        recipientName: 'mixedcaseuser',
        paymentCurrency: 'usdt',
      });
      expect(capturedOptions?.headers?.['idempotency-key']).toBe('ORD-987654');
    });

    it('queries wallets/balance with x-api-key and extracts numeric USDT balance', async () => {
      const { GramixAdapter } = await import('../src/services/reseller/gramix.js');
      const { getConfig } = await import('../src/config/env.js');
      const cfg = { ...getConfig(), GRAMIX_API_KEY: 'test-gmx-key' };
      const adapter = new GramixAdapter(cfg);

      let capturedPath = '';
      (adapter as any).getJson = async (path: string) => {
        capturedPath = path;
        return {
          success: true,
          data: {
            usdt: 245.8,
            currency: 'USDT',
          },
        };
      };

      const bal = await adapter.getBalance();
      expect(capturedPath).toBe('wallets/balance');
      expect(bal.balanceUsdt).toBe(245.8);
      expect(bal.currency).toBe('USDT');
    });

    it('maps HTTP 404 to ProviderUnavailableError and NEVER to InvalidTargetUserError', async () => {
      const { GramixAdapter } = await import('../src/services/reseller/gramix.js');
      const { HttpError } = await import('../src/lib/http.js');
      const { getConfig } = await import('../src/config/env.js');
      const cfg = { ...getConfig(), GRAMIX_API_KEY: 'test-gmx-key' };
      const adapter = new GramixAdapter(cfg);

      (adapter as any).postJson = async () => {
        throw new HttpError('Not Found', 404, 'Endpoint not found');
      };

      try {
        await adapter.fulfill({
          orderId: 'ORD-404',
          targetUsername: 'user404',
          months: 3,
        });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        expect(err).not.toBeInstanceOf(InvalidTargetUserError);
        expect(err.message).toContain('Gramix route not found (HTTP 404)');
      }
    });

    it('maps HTTP 400 with invalid username to InvalidTargetUserError', async () => {
      const { GramixAdapter } = await import('../src/services/reseller/gramix.js');
      const { HttpError } = await import('../src/lib/http.js');
      const { getConfig } = await import('../src/config/env.js');
      const cfg = { ...getConfig(), GRAMIX_API_KEY: 'test-gmx-key' };
      const adapter = new GramixAdapter(cfg);

      (adapter as any).postJson = async () => {
        throw new HttpError('Bad Request', 400, 'Invalid username or user does not exist');
      };

      await expect(
        adapter.fulfill({
          orderId: 'ORD-400',
          targetUsername: 'baduser',
          months: 3,
        })
      ).rejects.toThrow(InvalidTargetUserError);
    });

    it('maps HTTP 403, 402, and insufficient funds to InsufficientFloatError', async () => {
      const { GramixAdapter } = await import('../src/services/reseller/gramix.js');
      const { HttpError } = await import('../src/lib/http.js');
      const { getConfig } = await import('../src/config/env.js');
      const cfg = { ...getConfig(), GRAMIX_API_KEY: 'test-gmx-key' };
      const adapter = new GramixAdapter(cfg);

      (adapter as any).postJson = async () => {
        throw new HttpError('Forbidden', 403, 'Insufficient balance');
      };

      await expect(
        adapter.fulfill({
          orderId: 'ORD-403',
          targetUsername: 'gooduser',
          months: 3,
        })
      ).rejects.toThrow(InsufficientFloatError);
    });
  });

  // =========================================================================
  // 14. Web Admin Dashboard Approval Integration
  // =========================================================================
  describe('14. Web Admin Dashboard Approval Integration', () => {
    it('POST /orders/:id/approve triggers reseller delivery for telegram_premium orders and fulfills', async () => {
      const express = (await import('express')).default;
      const http = await import('http');
      const { adminRouter, setAdminBotInstance } = await import('../src/api/admin.js');
      const { ensureAdminRow } = await import('../src/auth/permissions.js');

      ensureAdminRow(ADMIN_1);
      db.prepare('INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(
        'test_admin_session_token_123',
        ADMIN_1,
        Date.now() + 86400000
      );

      const mockAdapter = new MockResellerAdapter();
      setResellerProviderForTest(mockAdapter);

      const sentMessages: { to: number; text: string }[] = [];
      const mockBot: any = {
        api: {
          sendMessage: async (to: number, text: string) => {
            sentMessages.push({ to, text });
            return { message_id: 100 };
          },
        },
      };
      setAdminBotInstance(mockBot);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'web_approved_user',
      });

      const app = express();
      app.use(express.json());
      app.use('/api/admin', adminRouter);

      const srv = http.createServer(app);
      const port = await new Promise<number>((resolve) => srv.listen(0, () => resolve((srv.address() as any).port)));

      try {
        const res = await fetch(`http://localhost:${port}/api/admin/orders/${order.id}/approve`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test_admin_session_token_123',
            'Content-Type': 'application/json',
          },
          body: '{}',
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.order.status).toBe('fulfilled');

        const updated = getOrderById(order.id);
        expect(updated?.status).toBe('fulfilled');
        expect(updated?.reseller_tx_id).toBeTruthy();

        expect(sentMessages.length).toBe(1);
        expect(sentMessages[0].to).toBe(BUYER_ID);
        expect(sentMessages[0].text).toContain('web_approved_user');
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()));
      }
    });

    it('prevents concurrent double-spend in deliverWithReseller via invocation-scoped lease', async () => {
      let fulfillCalls = 0;
      let resolveFulfill!: () => void;
      const fulfillPromise = new Promise<void>((resolve) => {
        resolveFulfill = resolve;
      });

      const mockAdapter: any = {
        name: 'mock-slow',
        fulfill: async () => {
          fulfillCalls++;
          await fulfillPromise;
          return {
            success: true,
            provider: 'mock-slow',
            providerTxId: 'slow_tx_123',
            costUsdt: 12,
          };
        },
        getBalance: async () => ({ balanceUsdt: 100, currency: 'USDT', provider: 'mock-slow' }),
      };
      setResellerProviderForTest(mockAdapter);

      const order = createOrder({
        userId: BUYER_ID,
        username: 'buyeruser',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'concurrent_user',
      });

      // Launch call 1 (will hold in provider.fulfill)
      const p1 = deliverWithReseller(order.id, ADMIN_1);

      // Give call 1 a tick to acquire lease and start fulfillment
      await new Promise((r) => setTimeout(r, 20));

      // Launch concurrent call 2 for the exact same order in the same process
      const outcome2 = await deliverWithReseller(order.id, ADMIN_1);

      // Verify call 2 was immediately rejected because the lease was held
      expect(outcome2.delivered).toBe(false);
      expect(outcome2.error).toBe('Order is already being processed');

      // Unblock call 1
      resolveFulfill();
      const outcome1 = await p1;

      expect(outcome1.delivered).toBe(true);
      expect(outcome1.order.status).toBe('fulfilled');
      expect(fulfillCalls).toBe(1); // Provider only called ONCE!
    });
  });
});

