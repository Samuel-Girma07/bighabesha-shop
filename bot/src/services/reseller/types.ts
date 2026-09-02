import type { PremiumMonths } from '../orders.service.js';

/**
 * B2B reseller fulfillment contract for Telegram Premium.
 *
 * Every provider adapter (Gramix, iStar, generic webhook, mock) implements
 * this interface. Adapters are thin HTTP clients — order state transitions,
 * persistence, and buyer notifications stay in the fulfillment service layer.
 */
export interface IResellerProvider {
  /** Stable provider identifier, e.g. 'gramix' | 'istar' | 'generic' | 'mock'. */
  readonly name: string;

  /**
   * Activate a Telegram Premium subscription on the target username.
   * Implementations MUST NOT log the raw API key — use redactSecret().
   * Throws one of the reseller error types on failure (never returns
   * { success: false } for transport/provider faults — exceptions are the
   * failure channel so callers get actionable error types).
   */
  fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult>;

  /** Query the provider float balance. Throws ProviderUnavailableError on failure. */
  getBalance(): Promise<ResellerBalanceResult>;
}

export interface ResellerFulfillParams {
  orderId: string;
  /** Sanitized Telegram username (no leading @) — already validated upstream. */
  targetUsername: string;
  /** Premium term in months, derived from the order's variant. */
  months: PremiumMonths;
}

export interface ResellerFulfillResult {
  success: boolean;
  /** Provider-side transaction/order identifier, stored in orders.reseller_tx_id. */
  providerTxId?: string;
  /** Cost charged by the provider in USDT (margin analytics). */
  costUsdt?: number;
  /** Raw provider response (already sanitized of secrets by the adapter). */
  rawResponse?: unknown;
}

export interface ResellerBalanceResult {
  balanceUsdt: number;
  currency: string;
  provider: string;
}

/** Provider float is below the cost of this order — delivery must not proceed. */
export class InsufficientFloatError extends Error {
  constructor(readonly provider: string, readonly balanceUsdt?: number, readonly requiredUsdt?: number) {
    const detail =
      balanceUsdt !== undefined && requiredUsdt !== undefined
        ? ` (balance $${balanceUsdt.toFixed(2)} < required $${requiredUsdt.toFixed(2)})`
        : '';
    super(`Insufficient reseller float on ${provider}${detail}`);
    this.name = 'InsufficientFloatError';
  }
}

/** The target username was rejected by the provider as unknown/invalid. */
export class InvalidTargetUserError extends Error {
  constructor(readonly provider: string, readonly targetUsername: string) {
    super(`Provider ${provider} rejected target user "@${targetUsername}" as invalid or not found`);
    this.name = 'InvalidTargetUserError';
  }
}

/** Provider unreachable, returned an unexpected error, or misconfigured. */
export class ProviderUnavailableError extends Error {
  constructor(readonly provider: string, message?: string, readonly cause?: unknown) {
    super(message || `Reseller provider "${provider}" is unavailable`);
    this.name = 'ProviderUnavailableError';
  }
}
