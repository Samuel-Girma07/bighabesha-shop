import { HttpError } from '../../lib/http.js';
import { logger } from '../../logger/index.js';
import { HttpResellerProviderBase } from './http-base.js';
import type { ResellerBalanceResult, ResellerFulfillParams, ResellerFulfillResult } from './types.js';
import { InsufficientFloatError, InvalidTargetUserError, ProviderUnavailableError } from './types.js';

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/**
 * Generic webhook adapter for any provider that accepts a plain JSON POST.
 * Requires RESELLER_API_URL to be configured (no sensible default — a webhook
 * target is inherently deployment-specific).
 *
 * Sends a normalized payload and expects a normalized-ish response; tolerant of
 * several common field namings so it can front a custom relay without a code
 * change.
 */
export class GenericWebhookAdapter extends HttpResellerProviderBase {
  readonly name = 'generic';

  private fulfillPath = 'fulfill';
  private balancePath = 'balance';

  protected baseUrl(): string {
    const url = this.config.RESELLER_API_URL;
    if (!url) {
      throw new ProviderUnavailableError(this.name, 'RESELLER_API_URL is required for the generic webhook provider');
    }
    return url.replace(/\/+$/, '');
  }

  async fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult> {
    let response: Record<string, unknown>;
    try {
      response = await this.postJson<Record<string, unknown>>(this.fulfillPath, {
        order_id: params.orderId,
        external_id: params.orderId,
        username: params.targetUsername,
        months: params.months,
      });
    } catch (err) {
      throw this.mapError(err, params);
    }

    const failed = response.ok === false || response.success === false || response.status === 'failed';
    if (failed) {
      const reason = String(pick(response, ['error', 'message', 'reason']) ?? 'unknown provider rejection');
      if (/insufficient|balance|funds/i.test(reason)) throw new InsufficientFloatError(this.name);
      if (/user|username|recipient|not.?found/i.test(reason)) {
        throw new InvalidTargetUserError(this.name, params.targetUsername);
      }
      throw new ProviderUnavailableError(this.name, `Generic provider rejected order: ${reason}`);
    }

    const providerTxId = toStr(pick(response, ['transaction_id', 'tx_id', 'provider_tx_id', 'id', 'order_id']));
    logger.info(
      { ...this.logContext(), orderId: params.orderId, providerTxId },
      'Generic webhook delivery accepted'
    );

    return {
      success: true,
      providerTxId,
      costUsdt: toNumber(pick(response, ['cost_usdt', 'cost', 'price'])),
      rawResponse: response,
    };
  }

  async getBalance(): Promise<ResellerBalanceResult> {
    let response: Record<string, unknown>;
    try {
      response = await this.getJson<Record<string, unknown>>(this.balancePath);
    } catch (err) {
      throw this.toUnavailable(err);
    }
    const balanceUsdt = toNumber(pick(response, ['balance_usdt', 'balance', 'amount']));
    if (balanceUsdt === undefined) {
      throw new ProviderUnavailableError(this.name, 'Generic provider balance response missing a numeric balance');
    }
    return { balanceUsdt, currency: String(pick(response, ['currency']) ?? 'USDT'), provider: this.name };
  }

  private mapError(err: unknown, params: ResellerFulfillParams): Error {
    if (err instanceof HttpError) {
      const body = err.body ?? '';
      if (err.status === 402 || /insufficient|balance|funds/i.test(body)) return new InsufficientFloatError(this.name);
      if (err.status === 404 || (err.status === 400 && /user|username|recipient/i.test(body))) {
        return new InvalidTargetUserError(this.name, params.targetUsername);
      }
    }
    return this.toUnavailable(err);
  }
}

function toStr(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
