import { randomBytes } from 'crypto';
import type {
  IResellerProvider,
  ResellerBalanceResult,
  ResellerFulfillParams,
  ResellerFulfillResult,
} from './types.js';
import { ProviderUnavailableError } from './types.js';
import { logger } from '../../logger/index.js';

/**
 * Deterministic-ish provider for local development and the Vitest suite.
 * Auto-succeeds and returns a synthetic transaction id. A single counter drives
 * balance so tests can simulate float exhaustion without network access.
 */
export interface MockResellerOptions {
  startingBalanceUsdt?: number;
  unitCostUsdt?: number;
  fulfillError?: Error | null;
}

export class MockResellerAdapter implements IResellerProvider {
  readonly name = 'mock';
  private consumedUsdt = 0;
  public fulfillError: Error | null = null;
  public customBalanceUsdt: number | null = null;

  constructor(
    private startingBalanceUsdt = 10_000,
    private readonly unitCostUsdt = 2.5,
    options?: MockResellerOptions
  ) {
    if (options?.startingBalanceUsdt !== undefined) this.startingBalanceUsdt = options.startingBalanceUsdt;
    if (options?.fulfillError) this.fulfillError = options.fulfillError;
  }

  /** Cost estimate for a term, used to gate fulfillment against float. */
  private costFor(months: number): number {
    return Math.round(this.unitCostUsdt * months * 100) / 100;
  }

  async fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult> {
    if (this.fulfillError) {
      throw this.fulfillError;
    }
    const cost = this.costFor(params.months);
    if (this.consumedUsdt + cost > this.startingBalanceUsdt) {
      throw new ProviderUnavailableError(this.name, 'mock float exhausted');
    }
    this.consumedUsdt += cost;
    const txId = `mock_${randomBytes(6).toString('hex')}`;
    logger.debug(
      { orderId: params.orderId, target: params.targetUsername, months: params.months, providerTxId: txId },
      'mock reseller delivery simulated'
    );
    return {
      success: true,
      providerTxId: txId,
      costUsdt: cost,
      rawResponse: { status: 'ok', provider: this.name },
    };
  }

  async getBalance(): Promise<ResellerBalanceResult> {
    if (this.customBalanceUsdt !== null && this.customBalanceUsdt !== undefined) {
      return {
        balanceUsdt: this.customBalanceUsdt,
        currency: 'USDT',
        provider: this.name,
      };
    }
    return {
      balanceUsdt: Math.max(0, Math.round((this.startingBalanceUsdt - this.consumedUsdt) * 100) / 100),
      currency: 'USDT',
      provider: this.name,
    };
  }
}
