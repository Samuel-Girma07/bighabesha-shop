import { HttpError } from '../../lib/http.js';
import { logger } from '../../logger/index.js';
import { HttpResellerProviderBase } from './http-base.js';
import type { ResellerBalanceResult, ResellerFulfillParams, ResellerFulfillResult } from './types.js';
import { InsufficientFloatError, InvalidTargetUserError, ProviderUnavailableError } from './types.js';

const DEFAULT_BASE_URL = 'https://api.gramix.io/v1';

interface GramixOrderResponse {
  ok?: boolean;
  order_id?: string;
  transaction_id?: string;
  cost?: number | string;
  cost_usdt?: number | string;
  status?: string;
  error?: string;
  message?: string;
}

interface GramixBalanceResponse {
  balance?: number | string;
  balance_usdt?: number | string;
  currency?: string;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Gramix B2B adapter. Contract:
 *   POST /premium/orders  { username, months, external_id }  -> { ok, transaction_id, cost_usdt }
 *   GET  /account/balance                                    -> { balance_usdt, currency }
 *
 * Deterministic 4xx mapping:
 *   402 / insufficient_funds -> InsufficientFloatError
 *   400 / 404 / user_not_found -> InvalidTargetUserError
 *   everything else -> ProviderUnavailableError
 */
export class GramixAdapter extends HttpResellerProviderBase {
  readonly name = 'gramix';

  protected override apiKey(): string {
    return this.config.GRAMIX_API_KEY || this.config.RESELLER_API_KEY;
  }

  protected override baseUrl(): string {
    return (this.config.GRAMIX_API_URL ?? this.config.RESELLER_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult> {
    let response: GramixOrderResponse;
    try {
      response = await this.postJson<GramixOrderResponse>('premium/orders', {
        username: params.targetUsername,
        months: params.months,
        // Provider-side idempotency key: a duplicate delivery attempt for the
        // same order must not double-charge our float.
        external_id: params.orderId,
      });
    } catch (err) {
      throw this.mapFulfillError(err, params);
    }

    if (response.ok === false || (response.status && response.status === 'failed')) {
      const reason = response.error || response.message || 'unknown provider rejection';
      if (/insufficient|balance|funds/i.test(reason)) {
        throw new InsufficientFloatError(this.name);
      }
      if (/user|username|recipient|not.?found/i.test(reason)) {
        throw new InvalidTargetUserError(this.name, params.targetUsername);
      }
      throw new ProviderUnavailableError(this.name, `Gramix rejected order: ${reason}`);
    }

    const providerTxId = response.transaction_id || response.order_id;
    logger.info(
      { ...this.logContext(), orderId: params.orderId, providerTxId },
      'Gramix premium activation accepted'
    );

    return {
      success: true,
      provider: 'gramix',
      providerTxId,
      costUsdt: toNumber(response.cost_usdt) ?? toNumber(response.cost),
      rawResponse: response,
    };
  }

  async getBalance(): Promise<ResellerBalanceResult> {
    let response: GramixBalanceResponse;
    try {
      response = await this.getJson<GramixBalanceResponse>('account/balance');
    } catch (err) {
      throw this.toUnavailable(err);
    }

    const balanceUsdt = toNumber(response.balance_usdt) ?? toNumber(response.balance);
    if (balanceUsdt === undefined) {
      throw new ProviderUnavailableError(this.name, 'Gramix balance response missing a numeric balance');
    }
    return { balanceUsdt, currency: response.currency || 'USDT', provider: this.name };
  }

  private mapFulfillError(err: unknown, params: ResellerFulfillParams): Error {
    if (err instanceof HttpError) {
      const body = err.body ?? '';
      if (err.status === 402 || /insufficient|balance|funds/i.test(body)) {
        return new InsufficientFloatError(this.name);
      }
      if (err.status === 404 || (err.status === 400 && /user|username|recipient/i.test(body))) {
        return new InvalidTargetUserError(this.name, params.targetUsername);
      }
    }
    return this.toUnavailable(err);
  }
}
