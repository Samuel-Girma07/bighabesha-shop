import type { AppConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';
import { GramixAdapter } from './gramix.js';
import { IStarAdapter } from './istar.js';
import type {
  IResellerProvider,
  ResellerBalanceResult,
  ResellerBalanceSubProvider,
  ResellerFulfillParams,
  ResellerFulfillResult,
} from './types.js';
import {
  InsufficientFloatError,
  InvalidTargetUserError,
  ProviderUnavailableError,
} from './types.js';

export class CascadeResellerAdapter implements IResellerProvider {
  readonly name = 'cascade';
  readonly primary: IResellerProvider;
  readonly secondary: IResellerProvider;

  constructor(
    private config: AppConfig,
    primary?: IResellerProvider,
    secondary?: IResellerProvider
  ) {
    this.primary = primary ?? new GramixAdapter(config);
    this.secondary = secondary ?? new IStarAdapter(config);
  }

  async fulfill(params: ResellerFulfillParams): Promise<ResellerFulfillResult> {
    let primaryError: unknown;

    // 1. Attempt Primary Provider (Gramix)
    try {
      const res = await this.primary.fulfill(params);
      return {
        ...res,
        provider: res.provider ?? this.primary.name,
      };
    } catch (err) {
      primaryError = err;

      // Fail-fast: Invalid target username is an immutable user error, not a provider fault.
      // Must not cascade to secondary provider.
      if (err instanceof InvalidTargetUserError) {
        logger.info(
          { orderId: params.orderId, targetUsername: params.targetUsername, provider: this.primary.name },
          'Target user invalid on primary provider — skipping fallback'
        );
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          orderId: params.orderId,
          primary: this.primary.name,
          secondary: this.secondary.name,
          err: errMsg,
        },
        `Primary provider ${this.primary.name} failed (${errMsg}). Cascading to secondary provider ${this.secondary.name}...`
      );
    }

    // 2. Attempt Secondary Provider (iStar)
    try {
      const res = await this.secondary.fulfill(params);
      logger.info(
        {
          orderId: params.orderId,
          provider: res.provider ?? this.secondary.name,
          fallbackFrom: this.primary.name,
          providerTxId: res.providerTxId,
        },
        'Cascading failover to secondary provider succeeded'
      );
      return {
        ...res,
        provider: res.provider ?? this.secondary.name,
      };
    } catch (secondaryError) {
      logger.error(
        {
          orderId: params.orderId,
          primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
          secondaryError: secondaryError instanceof Error ? secondaryError.message : String(secondaryError),
        },
        'All cascading reseller providers failed'
      );

      throw this.combineErrors(primaryError, secondaryError);
    }
  }

  async getBalance(): Promise<ResellerBalanceResult> {
    const [primarySettled, secondarySettled] = await Promise.allSettled([
      this.primary.getBalance(),
      this.secondary.getBalance(),
    ]);

    const primaryOk = primarySettled.status === 'fulfilled';
    const secondaryOk = secondarySettled.status === 'fulfilled';

    if (!primaryOk && !secondaryOk) {
      const pErr = primarySettled.reason instanceof Error ? primarySettled.reason.message : String(primarySettled.reason);
      const sErr = secondarySettled.reason instanceof Error ? secondarySettled.reason.message : String(secondarySettled.reason);
      throw new ProviderUnavailableError(
        this.name,
        `All reseller balance queries failed: ${this.primary.name} (${pErr}); ${this.secondary.name} (${sErr})`
      );
    }

    const primaryBal = primaryOk ? primarySettled.value.balanceUsdt : undefined;
    const secondaryBal = secondaryOk ? secondarySettled.value.balanceUsdt : undefined;
    const totalBalance = (primaryBal ?? 0) + (secondaryBal ?? 0);

    const pLabel = primaryOk ? `$${primaryBal!.toFixed(2)}` : 'unavailable';
    const sLabel = secondaryOk ? `$${secondaryBal!.toFixed(2)}` : 'unavailable';

    const providers: ResellerBalanceSubProvider[] = [
      primaryOk
        ? {
            name: this.primary.name,
            balance: primaryBal!,
            balanceUsdt: primaryBal!,
            currency: primarySettled.value.currency || 'USDT',
            ok: true,
          }
        : {
            name: this.primary.name,
            balance: 0,
            balanceUsdt: 0,
            currency: 'USDT',
            ok: false,
            error: primarySettled.reason instanceof Error ? primarySettled.reason.message : String(primarySettled.reason),
          },
      secondaryOk
        ? {
            name: this.secondary.name,
            balance: secondaryBal!,
            balanceUsdt: secondaryBal!,
            currency: secondarySettled.value.currency || 'USDT',
            ok: true,
          }
        : {
            name: this.secondary.name,
            balance: 0,
            balanceUsdt: 0,
            currency: 'USDT',
            ok: false,
            error: secondarySettled.reason instanceof Error ? secondarySettled.reason.message : String(secondarySettled.reason),
          },
    ];

    return {
      balanceUsdt: totalBalance,
      currency: 'USDT',
      provider: `cascade (${this.primary.name}: ${pLabel}, ${this.secondary.name}: ${sLabel})`,
      providers,
    };
  }

  private combineErrors(primaryErr: unknown, secondaryErr: unknown): Error {
    if (secondaryErr instanceof InvalidTargetUserError) {
      return secondaryErr;
    }

    const pMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    const sMsg = secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr);

    if (primaryErr instanceof InsufficientFloatError && secondaryErr instanceof InsufficientFloatError) {
      return new InsufficientFloatError(`both (${this.primary.name} & ${this.secondary.name})`);
    }

    if (secondaryErr instanceof InsufficientFloatError) {
      return new InsufficientFloatError(
        `${this.secondary.name} (primary ${this.primary.name} failed: ${pMsg})`,
        secondaryErr.balanceUsdt,
        secondaryErr.requiredUsdt
      );
    }

    if (primaryErr instanceof InsufficientFloatError) {
      return new InsufficientFloatError(
        `${this.primary.name} (secondary ${this.secondary.name} failed: ${sMsg})`,
        primaryErr.balanceUsdt,
        primaryErr.requiredUsdt
      );
    }

    return new ProviderUnavailableError(
      this.name,
      `${this.primary.name}: ${pMsg} | ${this.secondary.name}: ${sMsg}`
    );
  }
}
