import { getConfig } from '../../config/env.js';
import { PaymentAdapter } from './types.js';
import { MockWalletPayAdapter } from './mock_wallet_pay.js';
import { LiveWalletPayAdapter } from './live_wallet_pay.js';
import { chapaQueryStatus, isChapaEnabled } from './chapa.js';
import { verifyTonPayment, isTonConnectEnabled } from './ton.service.js';
import { fetchCoinGeckoPrices, calculateCryptoQuote } from '../rate_engine.service.js';
import { notifyBuyerOfAutoApproval } from '../buyer_notify.js';
import { getDatabase } from '../../db/index.js';
import { logger } from '../../logger/index.js';
import type { Bot } from 'grammy';
import { Order, approveReceipt } from '../orders.service.js';

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
 * Unified stuck-payment reconciliation sweep (runs every 60s).
 *
 * Catches orders whose webhook/poll never arrived across ALL auto-settled
 * rails:
 *  - wallet_pay:  provider API verifyPayment()
 *  - chapa:       gateway status query by tx_ref (= our order id)
 *  - ton_connect: on-chain verification against the treasury feed
 *
 * This is the safety net for the "buyer paid but closed the Mini App before
 * the poll succeeded" edge case. Mock adapters are hard-refused in production.
 */
export async function reconcileStuckPayments(botInstance?: any): Promise<number> {
  try {
    const db = getDatabase();
    const stuckOrders = db.prepare(`
      SELECT * FROM orders
      WHERE status = 'awaiting_payment'
        AND payment_rail IN ('wallet_pay', 'chapa', 'ton_connect')
        AND created_at <= datetime('now', '-5 minutes')
    `).all() as Order[];

    if (stuckOrders.length === 0) return 0;

    const config = getConfig();
    const walletAdapter = getWalletPayAdapter();

    // Defense-in-depth: the mock adapter must never fulfil real orders.
    // (Production boots with mock mode are already blocked by env validation.)
    if (config.NODE_ENV === 'production' && walletAdapter instanceof MockWalletPayAdapter) {
      logger.error(
        { stuckCount: stuckOrders.length },
        'Refusing to reconcile payments through the mock adapter in production'
      );
      return 0;
    }

    let reconciledCount = 0;

    for (const order of stuckOrders) {
      try {
        let isPaid = false;

        if (order.payment_rail === 'chapa') {
          if (isChapaEnabled()) {
            const status = await chapaQueryStatus(order.id);
            isPaid = status === 'success';
          }
        } else if (order.payment_rail === 'ton_connect') {
          if (isTonConnectEnabled()) {
            const { tonUsd } = await fetchCoinGeckoPrices();
            const netEtb = Math.max(order.amount_etb - (order.discount_etb || 0), 1);
            const { cryptoAmount } = calculateCryptoQuote(netEtb, tonUsd);
            const result = await verifyTonPayment({ memo: order.id, expectedTon: cryptoAmount });
            isPaid = result.verified;
          }
        } else {
          const ref = order.payment_ref || order.id;
          isPaid = await walletAdapter.verifyPayment(ref);
        }

        if (!isPaid) continue;

        const { order: updated, autoDeliveredItem } = approveReceipt(order.id, 0);
        reconciledCount++;
        logger.info(
          { orderId: order.id, rail: order.payment_rail, status: updated.status },
          'Stuck payment order reconciled via polling'
        );

        if (botInstance) {
          notifyBuyerOfAutoApproval(botInstance as Bot, order, updated, autoDeliveredItem);
        }
      } catch (err) {
        logger.error({ err, orderId: order.id }, 'Error reconciling individual stuck payment order');
      }
    }

    return reconciledCount;
  } catch (err) {
    logger.error({ err }, 'Failed to reconcile stuck payment orders');
    return 0;
  }
}

/** Back-compat alias for earlier call sites and tests. */
export const reconcileStuckWalletPayOrders = reconcileStuckPayments;

let reconciliationTimer: NodeJS.Timeout | null = null;

export function startWalletPayReconciliation(botInstance?: any, intervalMs: number = 60000): NodeJS.Timeout {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
  }

  reconciliationTimer = setInterval(() => {
    reconcileStuckPayments(botInstance).catch((err) => {
      logger.error({ err }, 'Error in periodic payment reconciliation cycle');
    });
  }, intervalMs);

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
