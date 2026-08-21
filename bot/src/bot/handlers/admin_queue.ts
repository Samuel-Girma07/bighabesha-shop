import { Context, InlineKeyboard } from 'grammy';
import { isAdmin } from './admin.js';
import { getFulfillmentQueue, getOrderById, fulfillOrderWithProof, refundOrder } from '../../services/orders.service.js';
import { getProductById, formatPriceETB } from '../../services/catalog.service.js';
import { setPendingAction } from '../session.js';
import { logger } from '../../logger/index.js';

export async function renderAdminOrdersQueue(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) return;

  const queue = getFulfillmentQueue();
  const keyboard = new InlineKeyboard();

  if (queue.length === 0) {
    const text = '📋 *Fulfillment Queue — Empty*\n\n' +
      '✅ Great job! There are no pending orders waiting for fulfillment.';

    keyboard.text('« Back to Admin Menu', 'admin_menu');

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    return;
  }

  let text = `📋 *Fulfillment Queue (${queue.length} Pending)*\n\n` +
    `_Sorted oldest-first (FIFO) for Fragment & Telegram fulfillment:_\n\n`;

  for (let i = 0; i < queue.length; i++) {
    const order = queue[i];
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;
    const timeAgoMin = Math.round((Date.now() - new Date(order.created_at).getTime()) / 60000);

    text += `*${i + 1}. \`${order.id}\`* — ${prodName}\n` +
      `   • Buyer: @${order.username || 'unknown'} (ID: \`${order.user_id}\`)\n` +
      `   • Amount: *${formatPriceETB(order.amount_etb)}* (${order.payment_rail.toUpperCase()})\n` +
      `   • Waiting: _${timeAgoMin} min ago_\n\n`;

    keyboard.text(`⚡ #${i + 1} ${order.id} (@${order.username || 'user'})`, `admin_queue_detail_${order.id}`).row();
  }

  keyboard.text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
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

  const text = `⚡ *Fulfill Order — \`${order.id}\`*\n\n` +
    `• *Product:* ${prodName}\n` +
    `• *Quantity/Variant:* ${order.quantity} item(s)\n` +
    `• *Target Username:* **@${order.username || 'MISSING_USERNAME'}**\n` +
    `• *Buyer User ID:* \`${order.user_id}\`\n` +
    `• *Total Paid:* *${formatPriceETB(order.amount_etb)}*\n` +
    `• *Payment Rail:* ${order.payment_rail.toUpperCase()}\n` +
    `• *Current Status:* \`${order.status.toUpperCase()}\`\n\n` +
    `_Fulfill the order via Fragment (https://fragment.com) to @${order.username || 'user'}, then choose an action below:_`;

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
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function promptQueueProof(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!isAdmin(adminId) || !adminId) return;

  setPendingAction(adminId, {
    type: 'admin_edit_variant_price', // reused or specific
    data: { action: 'admin_fulfill_proof', orderId },
  });

  const text = `📸 *Fulfillment Proof for Order \`${orderId}\`*\n\n` +
    `Please send a screenshot/photo of the completed Fragment transaction or type a completion note in chat.\n\n` +
    `_This proof will be delivered directly to the buyer as receipt of delivery._`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', `admin_queue_detail_${orderId}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function executeDirectFulfill(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!isAdmin(adminId) || !adminId) return;

  try {
    const order = fulfillOrderWithProof(orderId, adminId);
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;

    await ctx.reply(`✅ *Order \`${order.id}\` successfully marked as FULFILLED!*`, { parse_mode: 'Markdown' });

    // Deliver notification to buyer
    const buyerMsg = `🎉 *Your Order Has Been Fulfilled!*\n\n` +
      `Your **${prodName}** order (\`#${order.id}\`) has been successfully delivered to **@${order.username || 'your account'}** via official Telegram rails.\n\n` +
      `Thank you for choosing Bighabesha Shop! 🇪🇹`;

    await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'Markdown' }).catch((err) => {
      logger.error({ err, userId: order.user_id }, 'Failed to deliver fulfillment notice to buyer');
    });

    await renderAdminOrdersQueue(ctx);
  } catch (err: any) {
    logger.error({ err, orderId }, 'Failed to directly fulfill order');
    await ctx.reply(`❌ Fulfillment error: ${err.message}`);
  }
}

export async function promptQueueRefund(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!isAdmin(adminId) || !adminId) return;

  setPendingAction(adminId, {
    type: 'admin_reject_reason', // reused
    data: { action: 'refund_order', orderId },
  });

  const text = `↩️ *Refund Order \`${orderId}\`*\n\n` +
    `Please type the refund notes / transaction reference in chat:\n\n` +
    `_The buyer will be notified that their order has been refunded._`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', `admin_queue_detail_${orderId}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}
