import { getConfig } from '../../config/env.js';
import { PaymentAdapter } from './types.js';
import { MockWalletPayAdapter } from './mock_wallet_pay.js';
import { LiveWalletPayAdapter } from './live_wallet_pay.js';
import { logger } from '../../logger/index.js';

let adapterInstance: PaymentAdapter | null = null;

export function getWalletPayAdapter(): PaymentAdapter {
  if (!adapterInstance) {
    const config = getConfig();
    if (config.WALLET_PAY_MODE === 'live') {
      adapterInstance = new LiveWalletPayAdapter();
    } else {
      adapterInstance = new MockWalletPayAdapter();
    }
  }
  return adapterInstance;
}

export function resetWalletPayAdapter(): void {
  adapterInstance = null;
}

/**
 * Automated payment rails are decommissioned.
 * Reconciling stuck payments is a safe no-op that returns immediately.
 */
export async function reconcileStuckPayments(_botInstance?: any): Promise<number> {
  logger.debug('reconcileStuckPayments: automated payment rails are decommissioned; skipping sweep');
  return 0;
}

/** Back-compat alias for earlier call sites and tests. */
export const reconcileStuckWalletPayOrders = reconcileStuckPayments;

export async function drainReconciliation(_maxWaitMs = 10_000): Promise<void> {
  // Safe no-op
}

let reconciliationTimer: NodeJS.Timeout | null = null;

export function startWalletPayReconciliation(_botInstance?: any, _intervalMs: number = 60000): NodeJS.Timeout {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
  }
  reconciliationTimer = setTimeout(() => {}, 2147483647);
  if (reconciliationTimer.unref) {
    reconciliationTimer.unref();
  }
  return reconciliationTimer;
}

export function stopWalletPayReconciliation(): void {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }
}

export * from './types.js';
export * from './mock_wallet_pay.js';
export * from './live_wallet_pay.js';
