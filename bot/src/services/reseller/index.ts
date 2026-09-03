import type { AppConfig } from '../../config/env.js';
import { GramixAdapter } from './gramix.js';
import { IStarAdapter } from './istar.js';
import { GenericWebhookAdapter } from './generic.js';
import { MockResellerAdapter } from './mock.js';
import { CascadeResellerAdapter } from './cascade.js';
import { ProviderUnavailableError, type IResellerProvider } from './types.js';

/**
 * Instantiate the reseller provider configured by RESELLER_PROVIDER.
 * Returns null when no provider is configured so the Premium pipeline can
 * fall back to the manual `pending_fulfillment` queue without special-casing
 * every call site (caller checks `if (!provider) useManualFlow()`).
 */
export function createResellerProvider(config: AppConfig): IResellerProvider | null {
  const key = config.RESELLER_PROVIDER;
  if (!key) return null;

  switch (key) {
    case 'mock':
      return new MockResellerAdapter();
    case 'gramix':
      return new GramixAdapter(config);
    case 'istar':
      return new IStarAdapter(config);
    case 'generic':
      return new GenericWebhookAdapter(config);
    case 'both':
    case 'cascade':
      return new CascadeResellerAdapter(config);
    default:
      throw new ProviderUnavailableError(String(key), `Unknown RESELLER_PROVIDER "${key}"`);
  }
}

export { CascadeResellerAdapter };

export type {
  IResellerProvider,
  ResellerFulfillParams,
  ResellerFulfillResult,
  ResellerBalanceResult,
  ResellerBalanceSubProvider,
} from './types.js';
export { InsufficientFloatError, InvalidTargetUserError, ProviderUnavailableError } from './types.js';
