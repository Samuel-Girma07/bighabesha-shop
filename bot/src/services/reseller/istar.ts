import { HttpError } from '../../lib/http.js';
import { logger } from '../../logger/index.js';
import { HttpResellerProviderBase } from './http-base.js';
import type { ResellerBalanceResult, ResellerFulfillParams, ResellerFulfillResult } from './types.js';
import { InsufficientFloatError, InvalidTargetUserError, ProviderUnavailableError } from './types.js';

const DEFAULT_BASE_URL = 'https://istar.io/api/v2';

interface IStarTopUpResponse {
  success?: boolean;
  data?: {
    id?: string;
    reference?: string;
    price?: number | string;
    status?: string;
  };
  error?: { code?: string; message?: string } | string;
}

interface IStarBalanceResponse {
  success?: boolean;
  data?: { balance?: number | string; currency?: string };
  error?: { code?: string; message?: string } | string;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function errorMessage(err: IStarTopUpResponse['error'] | IStarBalanceResponse['error']): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return `${err.code ?? ''} ${err.message ?? ''}`.trim();
}

/**
 * iStar B2B adapter. Contract:
 *   POST /premium/topup   { to_username, duration, order_ref } -> { success, data:{ id, price } }
 *   GET  /wallet/balance                                        -> { success, data:{ balance, currency } }
 *
 * iStar prices are in USDT. Field mapping differs from Gramix; error envelope is
 * { error: { code, message } } or a bare string.
 */
export class IStarAdapter extends HttpResellerProviderBase {
  readonly name = 'istar';

  protected override apiKey(): string {
    return this.config.ISTAR_API_KEY || this.config.RESELLER_API_KEY;
  }

  protected override baseUrl(): string {
    return (this.config.ISTAR_API_URL ?? this.config.RESELLER_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult> {
    let response: IStarTopUpResponse;
    try {
      response = await this.postJson<IStarTopUpResponse>('premium/topup', {
        to_username: params.targetUsername,
        duration: params.months,
        order_ref: params.orderId, // idempotency reference
      });
    } catch (err) {
      throw this.mapFulfillError(err, params);
    }

    if (response.success === false) {
      const reason = errorMessage(response.error) || 'unknown provider rejection';
      if (/insufficient|balance|wallet|funds|not.?enough/i.test(reason)) {
        throw new InsufficientFloatError(this.name);
      }
      if (/user|username|recipient|invalid.?target|not.?found/i.test(reason)) {
        throw new InvalidTargetUserError(this.name, params.targetUsername);
      }
      throw new ProviderUnavailableError(this.name, `iStar rejected order: ${reason}`);
    }

    const providerTxId = response.data?.id || response.data?.reference;
    logger.info(
      { ...this.logContext(), orderId: params.orderId, providerTxId },
      'iStar premium activation accepted'
    );

    return {
      success: true,
      provider: 'istar',
      providerTxId,
      costUsdt: toNumber(response.data?.price),
      rawResponse: response,
    };
  }

  async getBalance(): Promise<ResellerBalanceResult> {
    let response: IStarBalanceResponse;
    try {
      response = await this.getJson<IStarBalanceResponse>('wallet/balance');
    } catch (err) {
      throw this.toUnavailable(err);
    }

    if (response.success === false) {
      throw new ProviderUnavailableError(this.name, `iStar balance query failed: ${errorMessage(response.error)}`);
    }
    const balanceUsdt = toNumber(response.data?.balance);
    if (balanceUsdt === undefined) {
      throw new ProviderUnavailableError(this.name, 'iStar balance response missing a numeric balance');
    }
    return { balanceUsdt, currency: response.data?.currency || 'USDT', provider: this.name };
  }

  private mapFulfillError(err: unknown, params: ResellerFulfillParams): Error {
    if (err instanceof HttpError) {
      const body = err.body ?? '';
      if (err.status === 402 || /insufficient|balance|wallet|funds/i.test(body)) {
        return new InsufficientFloatError(this.name);
      }
      if (err.status === 404 || (err.status === 400 && /user|username|recipient|target/i.test(body))) {
        return new InvalidTargetUserError(this.name, params.targetUsername);
      }
    }
    return this.toUnavailable(err);
  }
}
