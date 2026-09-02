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
} from './reseller/types.js';

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

    const fulfilled = updateOrderStatus(orderId, 'fulfilled', {
      reseller_tx_id: result.providerTxId || null,
      fulfillment_payload: `Telegram Premium ${months}M activated on @${targetUsername}`,
      fulfillment_proof: result.providerTxId ? `Provider tx ${result.providerTxId}` : null,
    }, { actorType: 'admin', actorId: String(adminId), note: `Delivered via ${provider.name}` });

    logger.info(
      { orderId, provider: provider.name, providerTxId: result.providerTxId, months },
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
    await notifyAdminsLowFloatFromResult(api, balance.provider, balance.balanceUsdt);
  }
  return { provider: balance.provider, balanceUsdt: balance.balanceUsdt };
}

async function notifyAdminsLowFloat(api: Api<RawApi>, err: InsufficientFloatError): Promise<void> {
  await notifyAdminsLowFloatFromResult(api, err.provider, err.balanceUsdt);
}

/** Broadcasts a low-float warning to every configured admin. */
export async function notifyAdminsLowFloatFromResult(
  api: Api<RawApi>,
  providerName: string,
  balanceUsdt: number | undefined
): Promise<void> {
  const config = getConfig();
  const balanceLine = balanceUsdt !== undefined ? `$${balanceUsdt.toFixed(2)} USDT` : 'unknown';
  const message =
    `🚨 <b>Reseller Float Low</b>\n\n` +
    `• Provider: <b>${escapeHtml(providerName)}</b>\n` +
    `• Balance: <b>${balanceLine}</b>\n` +
    `• Alert threshold: $${config.RESELLER_LOW_BALANCE_ALERT_USDT.toFixed(2)}\n\n` +
    `Premium deliveries will fail until the float is topped up.`;

  for (const adminId of config.ADMIN_IDS) {
    try {
      await api.sendMessage(adminId, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err, adminId }, 'Failed to send low-float alert to admin');
    }
  }
}
