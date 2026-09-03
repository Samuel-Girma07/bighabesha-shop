import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { getConfig, resetConfigCache } from '../src/config/env.js';
import {
  createResellerProvider,
  CascadeResellerAdapter,
  IResellerProvider,
  InsufficientFloatError,
  InvalidTargetUserError,
  ProviderUnavailableError,
  ResellerBalanceResult,
  ResellerFulfillParams,
  ResellerFulfillResult,
} from '../src/services/reseller/index.js';
import {
  deliverWithReseller,
  notifyAdminsLowFloatFromResult,
  setResellerProviderForTest,
  resetResellerProviderCache,
} from '../src/services/reseller.service.js';
import { createOrder, getOrderById, updateOrderStatus } from '../src/services/orders.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MockProvider implements IResellerProvider {
  constructor(
    public readonly name: string,
    public fulfillFn: (params: ResellerFulfillParams) => Promise<ResellerFulfillResult> = async () => ({
      success: true,
      provider: name,
      providerTxId: `tx-${name}-123`,
    }),
    public balanceFn: () => Promise<ResellerBalanceResult> = async () => ({
      balanceUsdt: 100,
      currency: 'USDT',
      provider: name,
    })
  ) {}

  async fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult> {
    return this.fulfillFn(params);
  }

  async getBalance(): Promise<ResellerBalanceResult> {
    return this.balanceFn();
  }
}

describe('Dual-Provider Cascading Failover (Gramix -> iStar)', () => {
  let db: Database.Database;
  const migrationsDir = path.join(__dirname, '../src/db/migrations');
  const ADMIN_1 = 111111111;
  const ADMIN_2 = 222222333;

  beforeEach(() => {
    process.env.BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
    process.env.ADMIN_IDS = `${ADMIN_1},${ADMIN_2}`;
    process.env.RESELLER_PROVIDER = 'both';
    process.env.RESELLER_LOW_BALANCE_ALERT_USDT = '50';
    process.env.GRAMIX_API_KEY = 'gramix-key';
    process.env.ISTAR_API_KEY = 'istar-key';
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

  describe('CascadeResellerAdapter.fulfill()', () => {
    it('fulfills via primary provider when primary succeeds', async () => {
      const primary = new MockProvider('gramix', async () => ({
        success: true,
        provider: 'gramix',
        providerTxId: 'gx-999',
        costUsdt: 12.5,
      }));
      const secondaryFulfill = vi.fn();
      const secondary = new MockProvider('istar', secondaryFulfill);

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);
      const res = await cascade.fulfill({
        orderId: 'order-1',
        targetUsername: 'durov',
        months: 3,
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe('gramix');
      expect(res.providerTxId).toBe('gx-999');
      expect(res.costUsdt).toBe(12.5);
      expect(secondaryFulfill).not.toHaveBeenCalled();
    });

    it('re-throws InvalidTargetUserError immediately without cascading', async () => {
      const primary = new MockProvider('gramix', async () => {
        throw new InvalidTargetUserError('gramix', 'nonexistent_user');
      });
      const secondaryFulfill = vi.fn();
      const secondary = new MockProvider('istar', secondaryFulfill);

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);

      await expect(
        cascade.fulfill({
          orderId: 'order-2',
          targetUsername: 'nonexistent_user',
          months: 6,
        })
      ).rejects.toThrow(InvalidTargetUserError);

      expect(secondaryFulfill).not.toHaveBeenCalled();
    });

    it('cascades to secondary when primary throws InsufficientFloatError', async () => {
      const primary = new MockProvider('gramix', async () => {
        throw new InsufficientFloatError('gramix', 5.0, 15.0);
      });
      const secondary = new MockProvider('istar', async () => ({
        success: true,
        provider: 'istar',
        providerTxId: 'istar-888',
        costUsdt: 14.0,
      }));

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);
      const res = await cascade.fulfill({
        orderId: 'order-3',
        targetUsername: 'durov',
        months: 3,
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe('istar');
      expect(res.providerTxId).toBe('istar-888');
    });

    it('cascades to secondary when primary throws ProviderUnavailableError', async () => {
      const primary = new MockProvider('gramix', async () => {
        throw new ProviderUnavailableError('gramix', 'Gramix server 503 error');
      });
      const secondary = new MockProvider('istar', async () => ({
        success: true,
        provider: 'istar',
        providerTxId: 'istar-777',
      }));

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);
      const res = await cascade.fulfill({
        orderId: 'order-4',
        targetUsername: 'durov',
        months: 3,
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe('istar');
      expect(res.providerTxId).toBe('istar-777');
    });

    it('throws combined error when both providers fail', async () => {
      const primary = new MockProvider('gramix', async () => {
        throw new InsufficientFloatError('gramix', 2.0, 15.0);
      });
      const secondary = new MockProvider('istar', async () => {
        throw new InsufficientFloatError('istar', 1.0, 15.0);
      });

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);

      await expect(
        cascade.fulfill({
          orderId: 'order-5',
          targetUsername: 'durov',
          months: 3,
        })
      ).rejects.toThrow(InsufficientFloatError);
    });

    it('throws composite ProviderUnavailableError when both providers encounter transport errors', async () => {
      const primary = new MockProvider('gramix', async () => {
        throw new ProviderUnavailableError('gramix', 'Gramix timeout');
      });
      const secondary = new MockProvider('istar', async () => {
        throw new ProviderUnavailableError('istar', 'iStar HTTP 502');
      });

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);

      await expect(
        cascade.fulfill({
          orderId: 'order-6',
          targetUsername: 'durov',
          months: 3,
        })
      ).rejects.toThrow(ProviderUnavailableError);
    });
  });

  describe('CascadeResellerAdapter.getBalance()', () => {
    it('aggregates balances when both providers respond successfully', async () => {
      const primary = new MockProvider('gramix', undefined, async () => ({
        balanceUsdt: 45.5,
        currency: 'USDT',
        provider: 'gramix',
      }));
      const secondary = new MockProvider('istar', undefined, async () => ({
        balanceUsdt: 75.25,
        currency: 'USDT',
        provider: 'istar',
      }));

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);
      const balance = await cascade.getBalance();

      expect(balance.balanceUsdt).toBeCloseTo(120.75);
      expect(balance.currency).toBe('USDT');
      expect(balance.providers).toHaveLength(2);
      expect(balance.providers![0]).toMatchObject({
        name: 'gramix',
        balanceUsdt: 45.5,
        ok: true,
      });
      expect(balance.providers![1]).toMatchObject({
        name: 'istar',
        balanceUsdt: 75.25,
        ok: true,
      });
    });

    it('survives single provider balance query failure and returns available float', async () => {
      const primary = new MockProvider('gramix', undefined, async () => {
        throw new ProviderUnavailableError('gramix', 'Network error');
      });
      const secondary = new MockProvider('istar', undefined, async () => ({
        balanceUsdt: 60.0,
        currency: 'USDT',
        provider: 'istar',
      }));

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);
      const balance = await cascade.getBalance();

      expect(balance.balanceUsdt).toBe(60.0);
      expect(balance.providers).toHaveLength(2);
      expect(balance.providers![0].ok).toBe(false);
      expect(balance.providers![0].name).toBe('gramix');
      expect(balance.providers![1].ok).toBe(true);
      expect(balance.providers![1].balanceUsdt).toBe(60.0);
    });

    it('throws ProviderUnavailableError when both provider balance queries fail', async () => {
      const primary = new MockProvider('gramix', undefined, async () => {
        throw new ProviderUnavailableError('gramix', 'down');
      });
      const secondary = new MockProvider('istar', undefined, async () => {
        throw new ProviderUnavailableError('istar', 'down');
      });

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);
      await expect(cascade.getBalance()).rejects.toThrow(ProviderUnavailableError);
    });
  });

  describe('Factory and Service Integration', () => {
    it('createResellerProvider supports "both" and "cascade"', () => {
      const cfgCascade = { ...getConfig(), RESELLER_PROVIDER: 'cascade' as const };
      const adapterCascade = createResellerProvider(cfgCascade);
      expect(adapterCascade).toBeInstanceOf(CascadeResellerAdapter);

      const cfgBoth = { ...getConfig(), RESELLER_PROVIDER: 'both' as const };
      const adapterBoth = createResellerProvider(cfgBoth);
      expect(adapterBoth).toBeInstanceOf(CascadeResellerAdapter);
    });

    it('deliverWithReseller records fulfilling provider in orders.reseller_provider on failover', async () => {
      const primary = new MockProvider('gramix', async () => {
        throw new InsufficientFloatError('gramix');
      });
      const secondary = new MockProvider('istar', async () => ({
        success: true,
        provider: 'istar',
        providerTxId: 'istar-success-tx',
      }));
      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);
      setResellerProviderForTest(cascade);

      const order = createOrder({
        userId: 12345,
        username: 'testbuyer',
        productId: 'telegram_premium',
        variantId: 'tg_prem_3m',
        amountETB: 1100,
        paymentRail: 'cbe',
        status: 'pending_approval',
        targetUsername: 'targetuser',
      });

      const outcome = await deliverWithReseller(order.id, ADMIN_1);
      expect(outcome.delivered).toBe(true);
      expect(outcome.order.status).toBe('fulfilled');
      expect(outcome.order.reseller_provider).toBe('istar');
      expect(outcome.order.reseller_tx_id).toBe('istar-success-tx');

      const persisted = getOrderById(order.id);
      expect(persisted?.reseller_provider).toBe('istar');
    });

    it('notifyAdminsLowFloatFromResult formats multi-provider alert breakdown', async () => {
      const sentAlerts: { to: number; text: string }[] = [];
      const mockApi: any = {
        sendMessage: async (chatId: number, text: string) => {
          sentAlerts.push({ to: chatId, text });
          return { message_id: 1 };
        },
      };

      await notifyAdminsLowFloatFromResult(mockApi, 'cascade', 35.0, [
        { name: 'gramix', balance: 10.0, balanceUsdt: 10.0, currency: 'USDT', ok: true },
        { name: 'istar', balance: 25.0, balanceUsdt: 25.0, currency: 'USDT', ok: true },
      ]);

      expect(sentAlerts.length).toBe(2);
      const text = sentAlerts[0].text;
      expect(text).toContain('Reseller Float Low');
      expect(text).toContain('Total Float: <b>$35.00 USDT</b>');
      expect(text).toContain('• Gramix: $10.00 (low)');
      expect(text).toContain('• iStar: $25.00 (low)');
      expect(text).toContain('Alert threshold: $50.00');
    });
  });

  describe('Security Invariants & Redaction', () => {
    it('redacts GRAMIX_API_KEY, ISTAR_API_KEY, and RESELLER_API_KEY via redactSecret and logger paths', async () => {
      const { redactSecret, logger } = await import('../src/logger/index.js');
      expect(redactSecret('secret-gramix-api-key-12345')).toBe('secr…2345(27)');
      expect(redactSecret('short')).toBe('***(5)');
      expect(redactSecret('')).toBe('');

      // Test Pino redacts configured paths
      const pino = (await import('pino')).default;
      let logged = '';
      const dest = { write(msg: string) { logged += msg; } };
      const testLogger = pino((logger as any)[Symbol.for('pino.metadata')] ? {} : {
        redact: {
          paths: [
            'GRAMIX_API_KEY',
            '*.GRAMIX_API_KEY',
            'ISTAR_API_KEY',
            '*.ISTAR_API_KEY',
            'RESELLER_API_KEY',
            '*.RESELLER_API_KEY',
          ],
          censor: '[REDACTED]',
        },
      }, dest);
      testLogger.info({
        GRAMIX_API_KEY: 'secret1',
        nested: { ISTAR_API_KEY: 'secret2', RESELLER_API_KEY: 'secret3' },
      });
      expect(logged).toContain('"GRAMIX_API_KEY":"[REDACTED]"');
      expect(logged).toContain('"ISTAR_API_KEY":"[REDACTED]"');
      expect(logged).toContain('"RESELLER_API_KEY":"[REDACTED]"');
    });

    it('ensures composite failover errors never leak internal bearer tokens or stack traces', () => {
      const primary = new MockProvider('gramix', async () => {
        throw new ProviderUnavailableError('gramix', 'Upstream 502 Bad Gateway');
      });
      const secondary = new MockProvider('istar', async () => {
        throw new ProviderUnavailableError('istar', 'Upstream 504 Gateway Timeout');
      });
      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);

      return cascade
        .fulfill({ orderId: 'ord-sec-1', targetUsername: 'durov', months: 3 })
        .catch((err) => {
          expect(err).toBeInstanceOf(ProviderUnavailableError);
          expect(err.message).toBe('gramix: Upstream 502 Bad Gateway | istar: Upstream 504 Gateway Timeout');
          expect(err.message).not.toContain('Bearer');
          expect(err.message).not.toContain('gramix-key');
          expect(err.message).not.toContain('istar-key');
          expect(err.message).not.toContain('\n    at ');
        });
    });

    it('ensures fail-fast on InvalidTargetUserError prevents secondary provider invocation on malformed handles', async () => {
      const primary = new MockProvider('gramix', async () => {
        throw new InvalidTargetUserError('gramix', 'attacker_handle_404');
      });
      const secondaryFulfill = vi.fn();
      const secondary = new MockProvider('istar', secondaryFulfill);

      const cascade = new CascadeResellerAdapter(getConfig(), primary, secondary);

      await expect(
        cascade.fulfill({
          orderId: 'ord-attack-1',
          targetUsername: 'attacker_handle_404',
          months: 3,
        })
      ).rejects.toThrow(InvalidTargetUserError);

      // Verify secondary was NEVER contacted (defense against denial-of-wallet / quota exhaustion)
      expect(secondaryFulfill).not.toHaveBeenCalled();
    });
  });
});

