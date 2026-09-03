import { Api, InlineKeyboard, RawApi } from 'grammy';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';
import { escapeHtml } from '../utils/html.js';
import { getVariantById } from './catalog.service.js';
import { getOrderById, updateOrderStatus, Order, PremiumMonths } from './orders.service.js';
import { createResellerProvider, IResellerProvider } from './reseller/index.js';
import {
  InsufficientFloatError,
  InvalidTargetUserError,
  ProviderUnavailableError,
  type ResellerBalanceResult,
  type ResellerBalanceSubProvider,
} from './reseller/types.js';
import { getDatabase } from '../db/index.js';
import { tryAcquireLease } from '../db/lease.js';

export interface DeliverOutcome {
  order: Order;
  delivered: boolean;
  error?: string;
}

/** Singleton provider instance for the process lifetime (recreated on config reset in tests). */
let cachedProvider: IResellerProvider | null | undefined;

/** Resolves the configured provider, or null when Premium falls back to manual fulfillment. */
export function getResellerProvider(): IResellerProvider | null {
  if (cachedProvider === undefined) {
    cachedProvider = createResellerProvider(getConfig());
  }
  return cachedProvider;
}

/** Test helper: forces provider re-resolution on the next call. */
export function resetResellerProviderCache(): void {
  cachedProvider = undefined;
}

/** Test helper: explicitly set or mock provider instance. */
export function setResellerProviderForTest(provider: IResellerProvider | null | undefined): void {
  cachedProvider = provider;
}

/** True when this order is eligible for the reseller pipeline. */
export function isResellerEligible(order: Order): boolean {
  return order.product_id === 'telegram_premium' && getResellerProvider() !== null;
}

/**
 * Extracts the Premium term (3/6/12 months) from the order's variant meta.
 * Returns null when the order has no variant or the meta lacks a valid months
 * value — callers must treat null as undeliverable (manual fallback).
 */
export function getPremiumMonths(order: Order): PremiumMonths | null {
  if (!order.variant_id) return null;
  const variant = getVariantById(order.variant_id);
  if (!variant) return null;
  try {
    const meta = JSON.parse(variant.meta || '{}');
    const months = Number(meta.months);
    if (months === 3 || months === 6 || months === 12) return months;
    return null;
  } catch {
    return null;
  }
}

/**
 * Drives the full delivery lifecycle for a Premium order:
 *   pending_approval → processing → provider call → fulfilled | delivery_failed
 *
 * All state transitions go through updateOrderStatus (state-machine enforced).
 * On failure the order lands in delivery_failed with a human-readable
 * reseller_error, and admins get an actionable retry/refund keyboard.
 */
export async function deliverWithReseller(
  orderId: string,
  adminId: number,
  api?: Api<RawApi>
): Promise<DeliverOutcome> {
  const order = getOrderById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  const provider = getResellerProvider();
  if (!provider) {
    throw new ProviderUnavailableError('reseller', 'No reseller provider configured');
  }

  // Ensure order is transitioned into processing before invoking provider or failing delivery
  if (order.status !== 'processing') {
    updateOrderStatus(orderId, 'processing', {
      reseller_provider: provider.name,
      reseller_error: null,
    }, { actorType: 'admin', actorId: String(adminId), note: `Delivery started via ${provider.name}` });
  }

  const rawTarget = order.target_username || order.username;
  const targetUsername = rawTarget ? rawTarget.trim().replace(/^@/, '') : null;
  if (!targetUsername) {
    const updated = updateOrderStatus(orderId, 'delivery_failed', {
      reseller_provider: provider.name,
      reseller_error: 'No target @username recorded for this order.',
    }, { actorType: 'admin', actorId: String(adminId) });
    return { order: updated, delivered: false, error: 'No target username' };
  }

  const months = getPremiumMonths(order);
  if (!months) {
    const updated = updateOrderStatus(orderId, 'delivery_failed', {
      reseller_provider: provider.name,
      reseller_error: 'Could not determine Premium term (months) from variant.',
    }, { actorType: 'admin', actorId: String(adminId) });
    return { order: updated, delivered: false, error: 'Unknown premium term' };
  }

  try {
    const result = await provider.fulfill({
      orderId: order.id,
      targetUsername,
      months,
    });

    const fulfillingProvider = result.provider || provider.name;
    const fulfilled = updateOrderStatus(orderId, 'fulfilled', {
      reseller_provider: fulfillingProvider,
      reseller_tx_id: result.providerTxId || null,
      fulfillment_payload: `Telegram Premium ${months}M activated on @${targetUsername}`,
      fulfillment_proof: result.providerTxId ? `Provider tx ${result.providerTxId}` : null,
    }, { actorType: 'admin', actorId: String(adminId), note: `Delivered via ${fulfillingProvider}` });

    logger.info(
      { orderId, provider: fulfillingProvider, providerTxId: result.providerTxId, months },
      'Reseller delivery succeeded'
    );

    // Low-float watch after each successful delivery (non-blocking).
    if (api) {
      void checkBalanceAndAlert(api).catch((err) => {
        logger.warn({ err }, 'Post-delivery balance check failed');
      });
    }

    return { order: fulfilled, delivered: true };
  } catch (err: unknown) {
    const message = describeResellerError(err);
    const failed = updateOrderStatus(orderId, 'delivery_failed', {
      reseller_error: message,
    }, { actorType: 'admin', actorId: String(adminId), note: `Delivery failed via ${provider.name}` });

    logger.warn({ orderId, provider: provider.name, err: message }, 'Reseller delivery failed');

    if (api && err instanceof InsufficientFloatError) {
      void notifyAdminsLowFloat(api, err).catch(() => {});
    }

    return { order: failed, delivered: false, error: message };
  }
}

function describeResellerError(err: unknown): string {
  if (err instanceof InsufficientFloatError) {
    return `Insufficient provider float${err.balanceUsdt !== undefined ? ` ($${err.balanceUsdt.toFixed(2)})` : ''}. Top up and retry.`;
  }
  if (err instanceof InvalidTargetUserError) {
    return `Provider could not find Telegram user @${err.targetUsername}.`;
  }
  if (err instanceof ProviderUnavailableError) {
    return `Provider unreachable: ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Unknown provider error';
}

/** Builds the admin action keyboard for a delivery_failed order. */
export function deliveryFailedKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔁 Retry Delivery', `admin_retry_delivery_${orderId}`)
    .row()
    .text('↩️ Refund', `admin_refund_${orderId}`)
    .text('❌ Reject', `admin_reject_${orderId}`);
}

/**
 * Queries the provider balance and alerts admins if it dips below the
 * configured threshold. Safe to call on-demand (admin button) or after delivery.
 */
export async function checkBalanceAndAlert(api: Api<RawApi>): Promise<{ provider: string; balanceUsdt: number } | null> {
  const provider = getResellerProvider();
  if (!provider) return null;

  const balance = await provider.getBalance();
  const config = getConfig();

  if (balance.balanceUsdt < config.RESELLER_LOW_BALANCE_ALERT_USDT) {
    await notifyAdminsLowFloatFromResult(api, balance.provider, balance.balanceUsdt, balance.providers);
  } else if (balance.providers && balance.providers.length > 0) {
    const hasLowSub = balance.providers.some(
      (sub) => !sub.ok || (sub.balanceUsdt ?? sub.balance) < config.RESELLER_LOW_BALANCE_ALERT_USDT
    );
    if (hasLowSub) {
      await notifyAdminsLowFloatFromResult(api, balance.provider, balance.balanceUsdt, balance.providers);
    }
  }
  return { provider: balance.provider, balanceUsdt: balance.balanceUsdt };
}

async function notifyAdminsLowFloat(api: Api<RawApi>, err: InsufficientFloatError): Promise<void> {
  let balance = err.balanceUsdt;
  let providers: ResellerBalanceSubProvider[] | undefined;
  if (balance === undefined) {
    try {
      const provider = getResellerProvider();
      if (provider) {
        const live = await provider.getBalance();
        balance = live.balanceUsdt;
        providers = live.providers;
      }
    } catch (balanceErr) {
      logger.warn({ err: balanceErr }, 'Failed to query live reseller float balance in notifyAdminsLowFloat');
    }
  }
  await notifyAdminsLowFloatFromResult(api, err.provider, balance, providers);
}

function formatProviderDisplayName(name: string): string {
  if (name.toLowerCase() === 'gramix') return 'Gramix';
  if (name.toLowerCase() === 'istar') return 'iStar';
  return name;
}

/** Broadcasts a low-float warning to every configured admin. */
export async function notifyAdminsLowFloatFromResult(
  api: Api<RawApi>,
  providerNameOrResult: string | ResellerBalanceResult,
  balanceUsdt?: number,
  subProviders?: ResellerBalanceResult['providers']
): Promise<void> {
  let providerName: string;
  let resolvedBalance = balanceUsdt;
  let providers = subProviders;

  if (typeof providerNameOrResult === 'object' && providerNameOrResult !== null) {
    providerName = providerNameOrResult.provider;
    if (resolvedBalance === undefined) resolvedBalance = providerNameOrResult.balanceUsdt;
    if (!providers) providers = providerNameOrResult.providers;
  } else {
    providerName = providerNameOrResult;
  }

  if (resolvedBalance === undefined) {
    try {
      const provider = getResellerProvider();
      if (provider) {
        const live = await provider.getBalance();
        resolvedBalance = live.balanceUsdt;
        if (!providers) providers = live.providers;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to query live reseller float balance for alert');
    }
  }

  const config = getConfig();
  const balanceLine = resolvedBalance !== undefined ? `$${resolvedBalance.toFixed(2)} USDT` : 'unknown';
  let message: string;

  if (providers && providers.length > 0) {
    const providerLines = providers.map((p) => {
      const bal = p.ok ? `$${(p.balanceUsdt ?? p.balance).toFixed(2)}` : '$0.00';
      let status = 'unavailable';
      if (p.ok) {
        status = (p.balanceUsdt ?? p.balance) < config.RESELLER_LOW_BALANCE_ALERT_USDT ? 'low' : 'ok';
      }
      return `• ${escapeHtml(formatProviderDisplayName(p.name))}: ${bal} (${status})`;
    }).join('\n');

    message =
      `🚨 <b>Reseller Float Low</b>\n\n` +
      `• Total Float: <b>${balanceLine}</b>\n` +
      `${providerLines}\n` +
      `• Alert threshold: $${config.RESELLER_LOW_BALANCE_ALERT_USDT.toFixed(2)}\n\n` +
      `Premium deliveries will fail until the float is topped up.`;
  } else {
    message =
      `🚨 <b>Reseller Float Low</b>\n\n` +
      `• Provider: <b>${escapeHtml(providerName)}</b>\n` +
      `• Balance: <b>${balanceLine}</b>\n` +
      `• Alert threshold: $${config.RESELLER_LOW_BALANCE_ALERT_USDT.toFixed(2)}\n\n` +
      `Premium deliveries will fail until the float is topped up.`;
  }

  for (const adminId of config.ADMIN_IDS) {
    try {
      await api.sendMessage(adminId, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err, adminId }, 'Failed to send low-float alert to admin');
    }
  }
}

export async function retryFailedResellerDeliveries(api?: Api<RawApi>): Promise<{ retried: number; fulfilled: number; failed: number }> {
  const provider = getResellerProvider();
  if (!provider) return { retried: 0, fulfilled: 0, failed: 0 };

  const leaseAcquired = tryAcquireLease('reseller:retry_sweeper', 280_000);
  if (!leaseAcquired) {
    logger.debug('Another instance holds the reseller retry sweeper lease');
    return { retried: 0, fulfilled: 0, failed: 0 };
  }

  try {
    const balance = await provider.getBalance();
    const config = getConfig();
    const threshold = config.RESELLER_LOW_BALANCE_ALERT_USDT;
    if (balance.balanceUsdt < threshold) {
      logger.warn({ provider: balance.provider, balanceUsdt: balance.balanceUsdt, threshold }, 'Reseller retry sweeper skipped: float below threshold');
      if (api) await notifyAdminsLowFloatFromResult(api, balance.provider, balance.balanceUsdt, balance.providers);
      return { retried: 0, fulfilled: 0, failed: 0 };
    }

    const db = getDatabase();
    const failedOrders = db.prepare(`
      SELECT * FROM orders
      WHERE status = 'delivery_failed'
        AND product_id = 'telegram_premium'
      ORDER BY created_at ASC
      LIMIT 25
    `).all() as Order[];

    let fulfilled = 0;
    let failed = 0;

    for (const order of failedOrders) {
      try {
        const outcome = await deliverWithReseller(order.id, 0, api);
        if (outcome.delivered) {
          fulfilled++;
          if (api) {
            const target = outcome.order.target_username || outcome.order.username || 'your account';
            const notifyText = `<b>Payment Confirmed — Order #${order.id}</b>\n\n` +
              `🎉 Your <b>Telegram Premium</b> has been activated on <b>@${escapeHtml(target)}</b>.\n\n` +
              `<i>Thank you for choosing Bighabesha Shop!</i>`;
            await api.sendMessage(order.user_id, notifyText, { parse_mode: 'HTML' }).catch(() => {});
          }
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        logger.error({ err, orderId: order.id }, 'Reseller retry sweeper error on order');
      }
    }

    logger.info({ retried: failedOrders.length, fulfilled, failed }, 'Reseller retry sweeper cycle completed');
    return { retried: failedOrders.length, fulfilled, failed };
  } catch (err) {
    logger.error({ err }, 'Reseller retry sweeper execution failed');
    return { retried: 0, fulfilled: 0, failed: 0 };
  }
}

let sweeperTimer: NodeJS.Timeout | null = null;

export function startResellerRetrySweeper(api?: any, intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  if (sweeperTimer) clearInterval(sweeperTimer);
  sweeperTimer = setInterval(() => {
    void retryFailedResellerDeliveries(api);
  }, intervalMs);
  if (sweeperTimer.unref) sweeperTimer.unref();
  return sweeperTimer;
}

export function stopResellerRetrySweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer);
    sweeperTimer = null;
  }
}

