import { Bot } from 'grammy';
import { Order } from './orders.service.js';
import { logger } from '../logger/index.js';
import { escapeHtml, formatFulfillmentDeliveryMessage } from '../utils/html.js';

/**
 * Shared post-approval buyer notification for auto-settled rails
 * (wallet pay webhook, Chapa webhook, TON verification, background
 * reconciliation). Delivery is best-effort and never throws.
 */
export function notifyBuyerOfAutoApproval(
  bot: Bot,
  originalOrder: Order,
  _updatedOrder: Order,
  autoDeliveredItem: { payload: string } | null | undefined
): void {
  try {
    if (autoDeliveredItem) {
      const deliveryText = formatFulfillmentDeliveryMessage(originalOrder.id, autoDeliveredItem.payload);
      void bot.api.sendMessage(originalOrder.user_id, deliveryText, { parse_mode: 'HTML' }).catch(() => {});
    } else {
      const notifyText = `<b>Payment Verified for Order #${escapeHtml(originalOrder.id)}</b>\n\n` +
        `Your order has been verified and queued for fulfillment to <b>@${escapeHtml(originalOrder.username || 'your account')}</b>.`;
      void bot.api.sendMessage(originalOrder.user_id, notifyText, { parse_mode: 'HTML' }).catch(() => {});
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to notify buyer of auto approval');
  }
}
