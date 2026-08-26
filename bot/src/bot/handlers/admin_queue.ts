import { Context, InlineKeyboard } from 'grammy';
import { isAdmin } from './admin.js';
import { getFulfillmentQueue, getOrderById, fulfillOrderWithProof, refundOrder } from '../../services/orders.service.js';
import { getProductById, formatPriceETB } from '../../services/catalog.service.js';
import { getSetting } from '../../services/settings.service.js';
import { setPendingAction } from '../session.js';
import { escapeHtml } from '../../utils/html.js';
import { logger } from '../../logger/index.js';

export async function renderAdminOrdersQueue(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) return;

  const queue = getFulfillmentQueue();
  const keyboard = new InlineKeyboard();

  if (queue.length === 0) {
    const text = '<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n' +
      '📋 <b>Fulfillment Queue — Empty</b>\n\n' +
      '✅ Great job! There are no pending orders waiting for fulfillment.';

    keyboard.text('« Back to Admin Menu', 'admin_menu');

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
    return;
  }

  let text = `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
    `📋 <b>Fulfillment Queue (${queue.length} Pending)</b>\n\n` +
    `<i>Sorted oldest-first (FIFO) for Fragment & Telegram fulfillment:</i>\n\n`;

  for (let i = 0; i < queue.length; i++) {
    const order = queue[i];
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;
    const timeAgoMin = Math.round((Date.now() - new Date(order.created_at).getTime()) / 60000);

    text += `<b>${i + 1}. <code>${order.id}</code></b> — ${escapeHtml(prodName)}\n` +
      `   • Buyer: @${escapeHtml(order.username || 'unknown')} (ID: <code>${order.user_id}</code>)\n` +
      `   • Amount: <b>${formatPriceETB(order.amount_etb)}</b> (${order.payment_rail.toUpperCase()})\n` +
      `   • Waiting: <i>${timeAgoMin} min ago</i>\n\n`;

    keyboard.text(`⚡ #${i + 1} ${order.id} (@${order.username || 'user'})`, `admin_queue_detail_${order.id}`).row();
  }

  keyboard.text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function renderAdminQueueOrderDetail(ctx: Context, orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) return;

  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found in database.');
    return;
  }

  const product = getProductById(order.product_id);
  const prodName = product ? product.name : order.product_id;

  const text = `⚡ <b>Fulfill Order — <code>${order.id}</code></b>\n\n` +
    `• <b>Product:</b> ${escapeHtml(prodName)}\n` +
    `• <b>Quantity/Variant:</b> ${order.quantity} item(s)\n` +
    `• <b>Target Username:</b> <b>@${escapeHtml(order.username || 'MISSING_USERNAME')}</b>\n` +
    `• <b>Buyer User ID:</b> <code>${order.user_id}</code>\n` +
    `• <b>Total Paid:</b> <b>${formatPriceETB(order.amount_etb)}</b>\n` +
    `• <b>Payment Rail:</b> ${order.payment_rail.toUpperCase()}\n` +
    `• <b>Current Status:</b> <code>${order.status.toUpperCase()}</code>\n\n` +
    `<i>Fulfill the order via Fragment (https://fragment.com) to @${escapeHtml(order.username || 'user')}, then choose an action below:</i>`;

  const keyboard = new InlineKeyboard()
    .text('📸 Upload Proof Screenshot & Fulfill', `queue_proof_prompt_${order.id}`)
    .row()
    .text('✅ Instant Fulfill (No Proof)', `queue_fulfill_direct_${order.id}`)
    .row()
    .text('↩️ Refund Order', `queue_refund_prompt_${order.id}`)
    .text('❌ Reject Order', `admin_reject_${order.id}`)
    .row()
    .text('« Back to Queue', 'admin_orders_queue');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function promptQueueProof(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!isAdmin(adminId) || !adminId) return;

  setPendingAction(adminId, {
    type: 'admin_edit_variant_price', // reused or specific
    data: { action: 'admin_fulfill_proof', orderId },
  });

  const text = `📸 <b>Fulfillment Proof for Order <code>${orderId}</code></b>\n\n` +
    `Please send a screenshot/photo of the completed Fragment transaction or type a completion note in chat.\n\n` +
    `<i>This proof will be delivered directly to the buyer as receipt of delivery.</i>`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', `admin_queue_detail_${orderId}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function executeDirectFulfill(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!isAdmin(adminId) || !adminId) return;

  try {
    const order = fulfillOrderWithProof(orderId, adminId);
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;

    await ctx.reply(`✅ <b>Order <code>${order.id}</code> successfully marked as FULFILLED!</b>`, { parse_mode: 'HTML' });

    // Deliver notification to buyer
    if (order.fulfillment_payload) {
      const rawTemplate = getSetting(
        'gemini_instructions',
        '1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
      );
      const deliveryText = `<b>Payment Confirmed — Order #${order.id}</b>\n\n` +
        `Activation Link:\n<code>${order.fulfillment_payload}</code>\n\n` +
        `<b>Instructions:</b>\n${rawTemplate}\n\n` +
        `<i>Thank you for choosing Bighabesha Shop.</i>`;

      await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to deliver payload to buyer');
      });
    } else {
      const buyerMsg = `🎉 <b>Your Order Has Been Fulfilled!</b>\n\n` +
        `Your <b>${escapeHtml(prodName)}</b> order (<code>#${order.id}</code>) has been successfully delivered to <b>@${escapeHtml(order.username || 'your account')}</b> via official Telegram rails.\n\n` +
        `Thank you for choosing Bighabesha Shop! 🇪🇹`;

      await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'HTML' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to deliver fulfillment notice to buyer');
      });
    }

    await renderAdminOrdersQueue(ctx);
  } catch (err: any) {
    logger.error({ err, orderId }, 'Failed to directly fulfill order');
    await ctx.reply(`❌ Fulfillment error: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
  }
}

export async function promptQueueRefund(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!isAdmin(adminId) || !adminId) return;

  setPendingAction(adminId, {
    type: 'admin_reject_reason', // reused
    data: { action: 'refund_order', orderId },
  });

  const text = `↩️ <b>Refund Order <code>${orderId}</code></b>\n\n` +
    `Please type the refund notes / transaction reference in chat:\n\n` +
    `<i>The buyer will be notified that their order has been refunded.</i>`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', `admin_queue_detail_${orderId}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

