import { Context, InlineKeyboard } from 'grammy';
import { getOrdersByUserId, getOrderById } from '../../services/orders.service.js';
import { getProductById, formatPriceETB } from '../../services/catalog.service.js';
import { getSetting } from '../../services/settings.service.js';
import { getUserById, saveUserLanguage } from '../../services/users.service.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';
import { escapeHtml } from '../../utils/html.js';
import { addStyledInlineButton } from '../keyboards/menu.js';

export function getStatusBadge(status: string, isAmharic = false): string {
  if (isAmharic) {
    switch (status) {
      case 'fulfilled':
        return 'ደርሷል';
      case 'pending_fulfillment':
      case 'processing':
        return 'በመላክ ላይ';
      case 'delivery_failed':
        return 'በድጋሚ በመላክ ላይ';
      case 'pending_approval':
        return 'በመረጋገጥ ላይ';
      case 'awaiting_payment':
        return 'ክፍያ በመጠባበቅ ላይ';
      case 'rejected':
        return 'ውድቅ ተደርጓል';
      case 'refunded':
        return 'ተመላሽ ተደርጓል';
      case 'cancelled':
        return 'ተሰርዟል';
      default:
        return status;
    }
  }
  switch (status) {
    case 'fulfilled':
      return 'Delivered';
    case 'pending_fulfillment':
    case 'processing':
      return 'Processing';
    case 'delivery_failed':
      return 'Delivery Retrying';
    case 'pending_approval':
      return 'Under Review';
    case 'awaiting_payment':
      return 'Awaiting Payment';
    case 'rejected':
      return 'Rejected';
    case 'refunded':
      return 'Refunded';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

export function getStatusEmoji(status: string): string {
  switch (status) {
    case 'fulfilled':
      return '🟢';
    case 'pending_fulfillment':
      return '⚡';
    case 'pending_approval':
      return '🟡';
    case 'awaiting_payment':
      return '💳';
    case 'rejected':
      return '🔴';
    case 'refunded':
      return '🔄';
    case 'cancelled':
      return '⚪';
    default:
      return '📦';
  }
}

export async function renderMyOrders(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = getUserById(userId);
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  const orders = getOrdersByUserId(userId, 10);
  const keyboard = new InlineKeyboard();

  if (orders.length === 0) {
    const text = isAmharic
      ? '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
        '📦 <b>የእኔ ትዕዛዞች</b>\n\n' +
        '<blockquote>እስካሁን ምንም ትዕዛዝ አልሰጡም።</blockquote>\n\n' +
        'ፈጣን አውቶሜትድ ማድረሻ ያላቸውን የGemini Pro ወይም የTelegram Premium ሰብስክሪፕሽኖች ለማዘዝ ሱቃችንን ይጎብኙ!'
      : '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
        '📦 <b>My Orders</b>\n\n' +
        '<blockquote>You have not placed any orders yet.</blockquote>\n\n' +
        'Browse our catalog to order Gemini Pro subscriptions or Telegram Premium with instant automated delivery!';

    addStyledInlineButton(keyboard, {
      text: isAmharic ? '🛍️ ሱቅ ይጎብኙ' : '🛍️ Browse Shop',
      callback_data: 'nav_shop',
      style: 'success',
    });
    addStyledInlineButton(keyboard, {
      text: isAmharic ? '🏠 ዋና ማውጫ' : '🏠 Main Menu',
      callback_data: 'nav_home',
      style: 'primary',
    });

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
    return;
  }

  let text = isAmharic
    ? '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
      '📦 <b>የትዕዛዝ ታሪክዎ</b>\n\n' +
      '<blockquote><i>የትዕዛዝ ሁኔታን፣ የደረሰኝ ዝርዝርን ወይም የማግበሪያ መረጃዎችን ለማየት ከታች አንዱን ትዕዛዝ ይምረጡ፡</i></blockquote>\n\n'
    : '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
      '📦 <b>Your Order History</b>\n\n' +
      '<blockquote><i>Select an order below to view live status, receipt details, or activation credentials:</i></blockquote>\n\n';

  for (const order of orders) {
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;
    const badge = getStatusBadge(order.status, isAmharic);
    const emoji = getStatusEmoji(order.status);
    const dateStr = new Date(order.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    text += `• <code>${order.id}</code> — <b>${escapeHtml(prodName)}</b>\n` +
      `   └ ${emoji} <b>[${badge}]</b> · <code>${formatPriceETB(order.amount_etb)}</code> · <i>${dateStr}</i>\n\n`;

    addStyledInlineButton(keyboard, {
      text: `${emoji} #${order.id} • ${badge}`,
      callback_data: `order_detail_${order.id}`,
      style: 'primary',
    }).row();
  }

  addStyledInlineButton(keyboard, {
    text: isAmharic ? '🛍️ ሱቅ ይጎብኙ' : '🛍️ Browse Shop',
    callback_data: 'nav_shop',
    style: 'success',
  });
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '🏠 ዋና ማውጫ' : '🏠 Main Menu',
    callback_data: 'nav_home',
    style: 'primary',
  }).row();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function renderOrderDetail(ctx: Context, orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  const user = userId ? getUserById(userId) : null;
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply(isAmharic ? 'ትዕዛዙ አልተገኘም።' : 'Order not found.');
    return;
  }

  const config = getConfig();
  const product = getProductById(order.product_id);
  const prodName = product ? product.name : order.product_id;
  const badge = getStatusBadge(order.status, isAmharic);
  const emoji = getStatusEmoji(order.status);
  const keyboard = new InlineKeyboard();

  let text = isAmharic
    ? `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
      `🧾 <b>የትዕዛዝ ዝርዝር — <code>${order.id}</code></b>\n\n` +
      `• 📦 <b>ምርት፦</b> <b>${escapeHtml(prodName)}</b>\n` +
      `• 💰 <b>የሚከፈል መጠን፦</b> <code>${formatPriceETB(order.amount_etb)}</code>\n` +
      `• 💳 <b>የክፍያ ዘዴ፦</b> <code>${order.payment_rail.toUpperCase()}</code>\n` +
      `• 📊 <b>ሁኔታ፦</b> ${emoji} <b>[${badge}]</b>\n` +
      `• 📅 <b>የታዘዘበት ቀን፦</b> <i>${new Date(order.created_at).toLocaleString('en-US')}</i>\n`
    : `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
      `🧾 <b>Order Details — <code>${order.id}</code></b>\n\n` +
      `• 📦 <b>Product:</b> <b>${escapeHtml(prodName)}</b>\n` +
      `• 💰 <b>Payable Amount:</b> <code>${formatPriceETB(order.amount_etb)}</code>\n` +
      `• 💳 <b>Payment Rail:</b> <code>${order.payment_rail.toUpperCase()}</code>\n` +
      `• 📊 <b>Status:</b> ${emoji} <b>[${badge}]</b>\n` +
      `• 📅 <b>Date Placed:</b> <i>${new Date(order.created_at).toLocaleString('en-US')}</i>\n`;

  if (order.status === 'fulfilled') {
    if (order.fulfillment_payload) {
      const instructions = getSetting(
        'gemini_instructions',
        isAmharic
          ? 'ክፍያ ከፈጸሙ በኋላ የአንድ ጊዜ ማግበሪያ ሊንክ ይሰጥዎታል።\n\n1. ሊንኩን ከመክፈትዎ በፊት ቪፒኤን መገናኘቱን ያረጋግጡ።\n2. በጉግል አካውንትዎ ማግበሩን ለማጠናቀቅ ሊንኩን ይጫኑ።\n3. አንዴ ከነቃ በኋላ ቪፒኤኑን ማጥፋት ይችላሉ።'
          : 'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
      );
      text += isAmharic
        ? `\n🔑 <b>የማግበሪያ ሊንክ፦</b>\n<code>${order.fulfillment_payload}</code>\n\n📋 <b>የማግበር መመሪያ፦</b>\n<blockquote>${escapeHtml(instructions)}</blockquote>\n`
        : `\n🔑 <b>Activation Link:</b>\n<code>${order.fulfillment_payload}</code>\n\n📋 <b>Activation Instructions:</b>\n<blockquote>${escapeHtml(instructions)}</blockquote>\n`;
    }
    if (order.fulfillment_proof) {
      text += isAmharic
        ? `\n🧾 <b>የማድረሻ ማረጋገጫ፦</b>\n<code>${escapeHtml(order.fulfillment_proof)}</code>\n`
        : `\n🧾 <b>Fulfillment Proof:</b>\n<code>${escapeHtml(order.fulfillment_proof)}</code>\n`;
    }
  } else if (order.status === 'pending_approval') {
    text += isAmharic
      ? `\n<blockquote>🟡 <b>የትዕዛዝ ሁኔታ፦ በመረጋገጥ ላይ</b>\nየከፈሉበት ደረሰኝ ደርሶናል፤ በአስተዳዳሪዎች እየተረጋገጠ ይገኛል።</blockquote>`
      : `\n<blockquote>🟡 <b>Status Update: Under Review</b>\nYour transfer slip has been received and is currently being verified by our administration team.</blockquote>`;
  } else if (order.status === 'pending_fulfillment') {
    text += isAmharic
      ? `\n<blockquote>⚡ <b>የትዕዛዝ ሁኔታ፦ በመላክ ላይ</b>\nክፍያው ተረጋግጧል! ምርቱን ወደ <b>@${escapeHtml(order.username || 'የእርስዎ አካውንት')}</b> በመላክ ላይ ነው።</blockquote>`
      : `\n<blockquote>⚡ <b>Status Update: Processing Fulfillment</b>\nPayment confirmed! Fulfillment is in progress for <b>@${escapeHtml(order.username || 'your account')}</b>.</blockquote>`;
  } else if (order.status === 'awaiting_payment') {
    text += isAmharic
      ? `\n<blockquote>💳 <b>የትዕዛዝ ሁኔታ፦ ክፍያ በመጠባበቅ ላይ</b>\nይህ ትዕዛዝ ክፍያ በመጠባበቅ ላይ ነው። ክፍያውን ለመቀጠል ወይም ደረሰኝ ለመላክ ከታች ይጫኑ።</blockquote>`
      : `\n<blockquote>💳 <b>Status Update: Awaiting Payment</b>\nThis order is waiting for payment confirmation. Tap below to resume payment or upload your transfer slip.</blockquote>`;
    addStyledInlineButton(keyboard, {
      text: isAmharic ? '💳 ክፍያ ቀጥል' : '💳 Resume Payment',
      callback_data: `resume_pay_${order.id}`,
      style: 'success',
    });
    addStyledInlineButton(keyboard, {
      text: isAmharic ? '🚫 ትዕዛዝ ሰርዝ' : '🚫 Cancel Order',
      callback_data: `cancel_order_${order.id}`,
      style: 'danger',
    }).row();
  } else if (order.status === 'rejected') {
    text += isAmharic
      ? `\n<blockquote>🔴 <b>የትዕዛዝ ሁኔታ፦ ውድቅ ተደርጓል</b>\n<b>ምክንያት፦</b> ${escapeHtml(order.rejection_reason || 'የክፍያ ማረጋገጫ አልተሳካም')}\n<i>ማንኛውም ጥያቄ ካለዎት እባክዎ ድጋፍ ያነጋግሩ።</i></blockquote>`
      : `\n<blockquote>🔴 <b>Status Update: Rejected</b>\n<b>Reason:</b> ${escapeHtml(order.rejection_reason || 'Payment verification failed')}\n<i>If you have questions, please contact support.</i></blockquote>`;
  } else if (order.status === 'refunded') {
    text += isAmharic
      ? `\n<blockquote>🔄 <b>የትዕዛዝ ሁኔታ፦ ተመላሽ ተደርጓል</b>\nይህ ትዕዛዝ ገንዘቡ ተመላሽ ተደርጓል።</blockquote>`
      : `\n<blockquote>🔄 <b>Status Update: Refunded</b>\nThis order was refunded to your payment method.</blockquote>`;
  } else if (order.status === 'cancelled') {
    text += isAmharic
      ? `\n<blockquote>⚪ <b>የትዕዛዝ ሁኔታ፦ ተሰርዟል</b>\nይህ ትዕዛዝ ተሰርዟል።</blockquote>`
      : `\n<blockquote>⚪ <b>Status Update: Cancelled</b>\nThis order was cancelled.</blockquote>`;
  }

  addStyledInlineButton(keyboard, {
    text: isAmharic ? '« ወደ ትዕዛዞች ተመለስ' : '« Back to Orders',
    callback_data: 'nav_orders',
    style: 'primary',
  });
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '💬 ድጋፍ ሰጪ ያነጋግሩ' : '💬 Contact Support',
    url: `https://t.me/${config.SUPPORT_USERNAME}`,
    style: 'primary',
  }).row();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function renderLanguageMenu(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const user = userId ? getUserById(userId) : null;
  const currentLang = user?.language_code || 'en';
  const isAmharic = currentLang === 'am';

  const text = isAmharic
    ? '<b>🌐 የቋንቋ ምርጫ / Language Settings</b>\n\n' +
      '<blockquote>ለመተግበሪያው የሚፈልጉትን ቋንቋ ይምረጡ:</blockquote>\n\n' +
      '• 🇪🇹 <b>አማርኛ</b> (አሁን እየሰራ ያለ)\n' +
      '• 🇬🇧 <b>English</b>'
    : '<b>🌐 Language Settings / የቋንቋ ምርጫ</b>\n\n' +
      '<blockquote>Choose your preferred language for the store interface:</blockquote>\n\n' +
      '• 🇬🇧 <b>English</b> (Active Default)\n' +
      '• 🇪🇹 <b>አማርኛ (Amharic)</b>';

  const keyboard = new InlineKeyboard();
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '🇬🇧 English' : '🇬🇧 English (Active)',
    callback_data: 'set_lang_en',
    style: isAmharic ? 'primary' : 'success',
  }).row();
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '🇪🇹 አማርኛ (አክቲቭ)' : '🇪🇹 አማርኛ (Amharic)',
    callback_data: 'set_lang_am',
    style: isAmharic ? 'success' : 'primary',
  }).row();
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '🏠 ዋና ማውጫ' : '🏠 Main Menu',
    callback_data: 'nav_home',
    style: 'primary',
  });

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function handleSetLanguage(ctx: Context, langCode: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const validLang = langCode === 'am' ? 'am' : 'en';

  try {
    saveUserLanguage(userId, validLang);
  } catch (err) {
    logger.error({ err, userId, langCode }, 'Failed to persist user language selection');
  }

  const feedbackText =
    validLang === 'am'
      ? '✅ ቋንቋው በተሳካ ሁኔታ ወደ አማርኛ ተቀይሯል።'
      : '✅ Language successfully set to English.';

  await ctx.answerCallbackQuery({
    text: feedbackText,
    show_alert: false,
  }).catch(() => {});

  await renderLanguageMenu(ctx);
}
