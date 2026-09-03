import { Context, InlineKeyboard } from 'grammy';
import { isAdmin } from './admin.js';
import { getFulfillmentQueue, getOrderById, fulfillOrderWithProof } from '../../services/orders.service.js';
import { getProductById, formatPriceETB } from '../../services/catalog.service.js';
import { getSetting } from '../../services/settings.service.js';
import { setPendingAction } from '../session.js';
import { escapeHtml } from '../../utils/html.js';
import { logger } from '../../logger/index.js';
import { isResellerEligible, deliverWithReseller } from '../../services/reseller.service.js';

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
    `<i>Sorted oldest-first (FIFO) for manual & Telegram fulfillment:</i>\n\n`;

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

  const target = order.target_username || order.username || 'MISSING_USERNAME';
  const text = `⚡ <b>Fulfill Order — <code>${order.id}</code></b>\n\n` +
    `• <b>Product:</b> ${escapeHtml(prodName)}\n` +
    `• <b>Quantity/Variant:</b> ${order.quantity} item(s)\n` +
    `• <b>Target Username:</b> <b>@${escapeHtml(target)}</b>\n` +
    `• <b>Buyer User ID:</b> <code>${order.user_id}</code>\n` +
    `• <b>Total Paid:</b> <b>${formatPriceETB(order.amount_etb)}</b>\n` +
    `• <b>Payment Rail:</b> ${order.payment_rail.toUpperCase()}\n` +
    `• <b>Current Status:</b> <code>${order.status.toUpperCase()}</code>\n\n` +
    `<i>Complete fulfillment to @${escapeHtml(target)}, then choose an action below:</i>`;

  const eligible = isResellerEligible(order);
  const keyboard = new InlineKeyboard();

  if (eligible) {
    keyboard.text('⚡ Deliver via Reseller', `admin_queue_reseller_deliver_${order.id}`).row();
  }

  keyboard.text('📸 Upload Proof Screenshot & Fulfill', `queue_proof_prompt_${order.id}`).row();

  if (!eligible) {
    keyboard.text('✅ Instant Fulfill (No Proof)', `queue_fulfill_direct_${order.id}`).row();
  }

  keyboard
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
    `Please send a screenshot/photo of the completed fulfillment transaction or type a completion note in chat.\n\n` +
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
    type: 'admin_refund_reason',
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

export async function handleAdminQueueResellerDeliver(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId || !isAdmin(adminId)) {
    logger.warn({ adminId, orderId }, 'Unauthorized reseller deliver attempt');
    return;
  }

  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found in database.');
    return;
  }

  if (!isResellerEligible(order)) {
    await ctx.reply('⚠️ Order is not eligible for reseller fulfillment.');
    return;
  }

  const adminUsername = ctx.from?.username ? `@${escapeHtml(ctx.from.username)}` : `Admin (${adminId})`;

  try {
    const outcome = await deliverWithReseller(order.id, adminId, ctx.api);

    if (outcome.delivered) {
      const targetUsername = outcome.order.target_username || outcome.order.username || 'your account';
      const successText = `⚡ <b>Reseller Delivery Succeeded!</b>\n\n` +
        `• <b>Order:</b> <code>${order.id}</code>\n` +
        `• <b>Status:</b> FULFILLED\n` +
        `• <b>Target:</b> @${escapeHtml(targetUsername)}\n` +
        `• <b>Provider:</b> <b>${escapeHtml(outcome.order.reseller_provider || 'reseller')}</b>` +
        (outcome.order.reseller_tx_id ? `\n• <b>Provider Tx:</b> <code>${escapeHtml(outcome.order.reseller_tx_id)}</code>` : '') +
        `\n• <b>Delivered by:</b> ${adminUsername}`;

      const notifyText = `<b>Payment Confirmed — Order #${order.id}</b>\n\n` +
        `🎉 Your <b>Telegram Premium</b> has been activated on <b>@${escapeHtml(targetUsername)}</b>.\n\n` +
        `<i>Thank you for choosing Bighabesha Shop!</i>`;

      await ctx.api.sendMessage(order.user_id, notifyText, { parse_mode: 'HTML' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to notify buyer of reseller delivery');
      });

      const keyboard = new InlineKeyboard().text('« Back to Queue', 'admin_orders_queue');
      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(successText, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
      } else {
        await ctx.reply(successText, { parse_mode: 'HTML', reply_markup: keyboard });
      }
    } else {
      const failText = `❌ <b>Reseller Delivery Failed</b>\n\n` +
        `• <b>Order:</b> <code>${order.id}</code>\n` +
        `• <b>Status:</b> DELIVERY_FAILED\n` +
        `• <b>Error:</b> ${escapeHtml(outcome.error || 'Unknown error')}\n\n` +
        `<i>The order remains queued under DELIVERY_FAILED status. You may retry or refund.</i>`;

      const notifyBuyer = `<b>Payment Verified for Order #${order.id}</b>\n\n` +
        `Your order has been approved but delivery encountered a temporary issue.\n` +
        `Our team is resolving it — you will receive an update shortly.`;

      await ctx.api.sendMessage(order.user_id, notifyBuyer, { parse_mode: 'HTML' }).catch(() => {});

      const keyboard = new InlineKeyboard()
        .text('⚡ Retry via Reseller', `admin_queue_reseller_deliver_${order.id}`)
        .row()
        .text('📸 Upload Proof Screenshot & Fulfill', `queue_proof_prompt_${order.id}`)
        .row()
        .text('↩️ Refund Order', `queue_refund_prompt_${order.id}`)
        .row()
        .text('« Back to Queue', 'admin_orders_queue');

      if (ctx.callbackQuery?.message) {
        await ctx.editMessageText(failText, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
      } else {
        await ctx.reply(failText, { parse_mode: 'HTML', reply_markup: keyboard });
      }
    }
  } catch (err: any) {
    logger.error({ err, orderId }, 'Unexpected exception during reseller delivery');
    await ctx.reply(`❌ Reseller delivery exception: ${escapeHtml(err.message)}`);
  }
}


