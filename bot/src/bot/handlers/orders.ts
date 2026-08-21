import { Context, InlineKeyboard } from 'grammy';
import { getOrdersByUserId, getOrderById, updateOrderStatus, Order } from '../../services/orders.service.js';
import { getProductById, formatPriceETB } from '../../services/catalog.service.js';
import { getSetting } from '../../services/settings.service.js';
import { getDatabase } from '../../db/index.js';
import { getConfig } from '../../config/env.js';
import { renderPaymentRailSelection } from './checkout.js';
import { t } from '../../i18n/index.js';

export function getStatusBadge(status: string): string {
  switch (status) {
    case 'fulfilled':
      return '✅ Delivered';
    case 'pending_fulfillment':
      return '⏳ Processing';
    case 'pending_approval':
      return '⏳ Verifying Receipt';
    case 'awaiting_payment':
      return '💳 Awaiting Payment';
    case 'rejected':
      return '❌ Rejected';
    case 'refunded':
      return '↩️ Refunded';
    case 'cancelled':
      return '🚫 Cancelled';
    default:
      return status;
  }
}

export async function renderMyOrders(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const orders = getOrdersByUserId(userId, 10);
  const keyboard = new InlineKeyboard();

  if (orders.length === 0) {
    const text = '📦 *My Orders*\n\n' +
      'You have not placed any orders yet.\n' +
      'Browse our catalog to order Gemini Pro subscriptions, Telegram Premium, or Telegram Stars!';

    keyboard.text('🛍 Browse Shop', 'nav_shop').row().text('« Back to Main Menu', 'nav_home');

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
    return;
  }

  let text = '📦 *Your Order History*\n\n' +
    'Tap an order below to view full details, activation links, or delivery proofs:\n\n';

  for (const order of orders) {
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;
    const badge = getStatusBadge(order.status);
    const dateStr = new Date(order.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    text += `• \`${order.id}\` — *${prodName}* (${formatPriceETB(order.amount_etb)})\n` +
      `   Status: ${badge} | _${dateStr}_\n\n`;

    keyboard.text(`📄 ${order.id} • ${badge}`, `order_detail_${order.id}`).row();
  }

  keyboard.text('🛍 Browse Shop', 'nav_shop').row().text('« Back to Main Menu', 'nav_home');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function renderOrderDetail(ctx: Context, orderId: string): Promise<void> {
  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found.');
    return;
  }

  const config = getConfig();
  const product = getProductById(order.product_id);
  const prodName = product ? product.name : order.product_id;
  const badge = getStatusBadge(order.status);
  const keyboard = new InlineKeyboard();

  let text = `📄 *Order Details — \`${order.id}\`*\n\n` +
    `• *Product:* ${prodName}\n` +
    `• *Amount:* *${formatPriceETB(order.amount_etb)}*\n` +
    `• *Payment Method:* ${order.payment_rail.toUpperCase()}\n` +
    `• *Status:* ${badge}\n` +
    `• *Date Placed:* ${new Date(order.created_at).toLocaleString('en-US')}\n`;

  if (order.status === 'fulfilled') {
    if (order.fulfillment_payload) {
      const instructions = getSetting(
        'gemini_instructions',
        'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
      );
      text += `\n🎉 *Activation Link / Payload:*\n` +
        `🔗 \`${order.fulfillment_payload}\`\n\n` +
        `*Instructions:*\n${instructions}\n`;
    }
    if (order.fulfillment_proof) {
      text += `\n🧾 *Fulfillment Proof:* ${order.fulfillment_proof}\n`;
    }
  } else if (order.status === 'pending_approval') {
    text += `\n⏳ *Status Update:* Your receipt has been received and is currently under review by our administration team.`;
  } else if (order.status === 'pending_fulfillment') {
    text += `\n⏳ *Status Update:* Payment confirmed! Our fulfillment team is processing your order for **@${order.username || 'your account'}**.`;
  } else if (order.status === 'awaiting_payment') {
    text += `\n💳 *Payment Pending:* This order has not been completed yet.`;
    keyboard.text('💳 Resume Payment', `resume_pay_${order.id}`).row();
    keyboard.text('🚫 Cancel Order', `cancel_order_${order.id}`).row();
  } else if (order.status === 'rejected') {
    text += `\n❌ *Rejection Reason:* ${order.rejection_reason || 'Payment verification failed'}\n` +
      `_If you have questions, please reach out to our support._`;
  }

  keyboard.text('« Back to Orders', 'nav_orders').row();
  keyboard.url('💬 Contact Support', `https://t.me/${config.SUPPORT_USERNAME}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function renderLanguageMenu(ctx: Context): Promise<void> {
  const text = '🌐 *Language Settings / ቋንቋ*\n\n' +
    'Choose your preferred language for the bot:\n\n' +
    '• 🇬🇧 *English* (Current)\n' +
    '• 🇪🇹 *Amharic (አማርኛ)* (Coming Soon)';

  const keyboard = new InlineKeyboard()
    .text('🇬🇧 English (Active)', 'set_lang_en')
    .row()
    .text('🇪🇹 አማርኛ (Amharic)', 'set_lang_am')
    .row()
    .text('« Back to Main Menu', 'nav_home');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function handleSetLanguage(ctx: Context, langCode: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (langCode === 'am') {
    await ctx.answerCallbackQuery({
      text: '🇪🇹 አማርኛ ትርጉም በቅርቡ ይለቀቃል! (Amharic translations coming soon in v1.5)',
      show_alert: true,
    });
    return;
  }

  try {
    const db = getDatabase();
    db.prepare('UPDATE users SET language_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'en',
      userId
    );
  } catch (err) {
    // ignore
  }

  await ctx.answerCallbackQuery({ text: '✅ Language set to English!' });
  await renderLanguageMenu(ctx);
}
