import { Bot } from 'grammy';
import { Order } from './orders.service.js';
import { getSetting } from './settings.service.js';
import { logger } from '../logger/index.js';

const DEFAULT_GEMINI_INSTRUCTIONS =
  '1. Ensure your VPN is connected before opening the link.\n' +
  '2. Click the link to complete activation on your Google account.\n' +
  '3. Once activated, you may safely disconnect the VPN.';

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
      const rawTemplate = getSetting('gemini_instructions', DEFAULT_GEMINI_INSTRUCTIONS);
      const deliveryText = `<b>Payment Confirmed — Order #${originalOrder.id}</b>\n\n` +
        `Activation Link:\n<code>${autoDeliveredItem.payload}</code>\n\n` +
        `<b>Instructions:</b>\n${rawTemplate}\n\n<i>Thank you for choosing Bighabesha Shop.</i>`;
      void bot.api.sendMessage(originalOrder.user_id, deliveryText, { parse_mode: 'HTML' }).catch(() => {});
    } else {
      const notifyText = `<b>Payment Verified for Order #${originalOrder.id}</b>\n\n` +
        `Your order has been verified and queued for fulfillment to <b>@${originalOrder.username || 'your account'}</b>.`;
      void bot.api.sendMessage(originalOrder.user_id, notifyText, { parse_mode: 'HTML' }).catch(() => {});
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to notify buyer of auto approval');
  }
}
