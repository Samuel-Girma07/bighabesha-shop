import { HttpError } from '../../lib/http.js';
import { logger } from '../../logger/index.js';
import { HttpResellerProviderBase } from './http-base.js';
import type { ResellerBalanceResult, ResellerFulfillParams, ResellerFulfillResult } from './types.js';
import { InsufficientFloatError, InvalidTargetUserError, ProviderUnavailableError } from './types.js';

const DEFAULT_BASE_URL = 'https://api.gramix.io/api/v1';

interface GramixOrderResponse {
  success?: boolean;
  ok?: boolean;
  orderId?: string;
  order_id?: string;
  data?: {
    orderId?: string;
    order_id?: string;
    id?: string;
    cost?: number | string;
    costUsdt?: number | string;
    cost_usdt?: number | string;
    status?: string;
  };
  status?: string;
  error?: string;
  message?: string;
}

interface GramixBalanceResponse {
  success?: boolean;
  data?: {
    usdt?: number | string;
    balance?: number | string;
    currency?: string;
  };
  usdt?: number | string;
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
 *   POST /purchase/premium/{months}  { recipientName, paymentCurrency: 'usdt' } -> { success, data: { orderId, costUsdt } }
 *   GET  /wallets/balance                                                       -> { success, data: { usdt, currency } }
 *
 * Auth & Idempotency:
 *   Header: x-api-key: <key>
 *   Header: idempotency-key: <orderId>
 *
 * Deterministic error mapping:
 *   403 / 402 / insufficient funds -> InsufficientFloatError
 *   400 + invalid username         -> InvalidTargetUserError
 *   404 route not found            -> ProviderUnavailableError (cascades to secondary)
 *   everything else                -> ProviderUnavailableError
 */
export class GramixAdapter extends HttpResellerProviderBase {
  readonly name = 'gramix';

  protected override apiKey(): string {
    return this.config.GRAMIX_API_KEY || this.config.RESELLER_API_KEY;
  }

  protected override baseUrl(): string {
    return (this.config.GRAMIX_API_URL ?? this.config.RESELLER_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  protected override authHeaders(): Record<string, string> {
    return { 'x-api-key': this.apiKey() };
  }

  async fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult> {
    const cleanUsername = params.targetUsername.trim().replace(/^@+/, '').toLowerCase();
    let response: GramixOrderResponse;

    try {
      response = await this.postJson<GramixOrderResponse>(
        `purchase/premium/${params.months}`,
        { recipientName: cleanUsername, paymentCurrency: 'usdt' },
        { headers: { 'idempotency-key': params.orderId } }
      );
    } catch (err) {
      throw this.mapFulfillError(err, params);
    }

    if (response.success === false || response.ok === false || response.status === 'failed') {
      const reason = response.error || response.message || 'unknown provider rejection';
      if (/insufficient|balance|funds/i.test(reason)) {
        throw new InsufficientFloatError(this.name);
      }
      if (/invalid username|user.*not.*found|does not exist/i.test(reason)) {
        throw new InvalidTargetUserError(this.name, params.targetUsername);
      }
      throw new ProviderUnavailableError(this.name, `Gramix rejected order: ${reason}`);
    }

    const providerTxId = response.data?.orderId || response.order_id || response.data?.id || response.orderId || 'gramix-ok';
    logger.info(
      { ...this.logContext(), orderId: params.orderId, providerTxId },
      'Gramix premium activation accepted'
    );

    return {
      success: true,
      provider: 'gramix',
      providerTxId,
      costUsdt:
        toNumber(response.data?.costUsdt) ??
        toNumber(response.data?.cost_usdt) ??
        toNumber(response.data?.cost),
      rawResponse: response,
    };
  }

  async getBalance(): Promise<ResellerBalanceResult> {
    let response: GramixBalanceResponse;
    try {
      response = await this.getJson<GramixBalanceResponse>('wallets/balance');
    } catch (err) {
      throw this.toUnavailable(err);
    }

    const balanceUsdt =
      toNumber(response.data?.usdt) ??
      toNumber(response.data?.balance) ??
      toNumber(response.balance_usdt) ??
      0;

    return {
      balanceUsdt,
      currency: response.data?.currency || 'USDT',
      provider: this.name,
    };
  }

  private mapFulfillError(err: unknown, params: ResellerFulfillParams): Error {
    if (err instanceof HttpError) {
      const body = err.body ?? '';
      if (err.status === 403 || err.status === 402 || /insufficient|balance|funds/i.test(body)) {
        return new InsufficientFloatError(this.name);
      }
      if (err.status === 400 && /invalid username|user.*not.*found|does not exist/i.test(body)) {
        return new InvalidTargetUserError(this.name, params.targetUsername);
      }
      if (err.status === 404) {
        return new ProviderUnavailableError(this.name, 'Gramix route not found (HTTP 404)');
      }
    }
    return this.toUnavailable(err);
  }
}
