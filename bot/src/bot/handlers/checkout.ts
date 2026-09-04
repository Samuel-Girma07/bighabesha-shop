import { Context, InlineKeyboard, InputFile } from 'grammy';
import { getProductById, formatPriceETB } from '../../services/catalog.service.js';
import { getAvailableStockCount } from '../../services/stock.service.js';
import { resolveStoredReceiptPath } from '../../services/receipts.service.js';
import { createOrder, getOrderById, updateOrderMeta, updateOrderStatus, approveReceipt, PaymentRail, Order } from '../../services/orders.service.js';
import { isResellerEligible, deliverWithReseller, deliveryFailedKeyboard } from '../../services/reseller.service.js';
import { resolveOrderPrice, PricingError } from '../../services/pricing.service.js';
import { getSetting } from '../../services/settings.service.js';
import { setPendingAction } from '../session.js';
import { isAdmin } from './admin.js';
import { getConfig } from '../../config/env.js';
import { getDatabase } from '../../db/index.js';
import { getUserById } from '../../services/users.service.js';
import { escapeHtml } from '../../utils/html.js';
import { logger } from '../../logger/index.js';

const VALID_PAYMENT_RAILS: PaymentRail[] = ['wallet_pay', 'chapa', 'ton_connect', 'telebirr', 'cbe', 'abyssinia'];

export function isValidPaymentRail(rail: string): rail is PaymentRail {
  return (VALID_PAYMENT_RAILS as string[]).includes(rail);
}

/**
 * Universal safe message editor: handles both photo caption edits and text edits,
 * falling back gracefully to reply if Telegram rejects message in-place modification.
 */
export async function safeEditMessage(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  const parse_mode = 'HTML' as const;
  const reply_markup = keyboard;

  if (ctx.callbackQuery?.message) {
    const msg = ctx.callbackQuery.message;
    if (msg.photo || msg.video || msg.document || msg.audio) {
      try {
        await ctx.editMessageCaption({ caption: text, parse_mode, reply_markup });
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err: message }, 'Failed to editMessageCaption, attempting reply');
      }
    } else {
      try {
        await ctx.editMessageText(text, { parse_mode, reply_markup });
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err: message }, 'Failed to editMessageText, attempting reply');
      }
    }
  }

  await ctx.reply(text, { parse_mode, reply_markup });
}

export async function initiateCheckout(
  ctx: Context,
  productId: string,
  variantId?: string,
  // Present when the buyer has already chosen a gift recipient; otherwise derived from the buyer.
  targetUsername?: string | null
): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || null;
  if (!userId) return;

  const user = userId ? getUserById(userId) : null;
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  // Stock availability check: never begin checkout for sold-out stock products
  const product = getProductById(productId);
  if (product && product.type === 'stock') {
    const stock = getAvailableStockCount(productId);
    if (stock <= 0) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: isAmharic ? `⚠️ አልቋል፦ ${product.name} በአሁኑ ጊዜ በክምችት ውስጥ የለም።` : `⚠️ Sold Out: ${product.name} is currently out of stock.`,
          show_alert: true,
        }).catch(() => {});
      } else {
        await ctx.reply(
          isAmharic
            ? `⚠️ <b>አልቋል፦</b> <b>${escapeHtml(product.name)}</b> በአሁኑ ጊዜ አልቋል። እባክዎ በቅርቡ ተመልሰው ይመልከቱ!`
            : `⚠️ <b>Sold Out:</b> <b>${escapeHtml(product.name)}</b> is currently out of stock. Please check back soon!`,
          { parse_mode: 'HTML' }
        );
      }
      return;
    }
  }

  let amountETB = 0;
  let productName = '';

  // Authoritative server-side pricing — ignores any client-supplied amount.
  try {
    const resolved = resolveOrderPrice({
      productId,
      variantId: variantId || null,
    });
    amountETB = resolved.amountETB;
    productName = resolved.productName;
  } catch (err) {
    if (err instanceof PricingError) {
      logger.warn({ err, userId, productId, variantId }, 'Checkout blocked by pricing validation');
      await ctx.reply(`❌ ${escapeHtml(err.message)}`);
    } else {
      logger.error({ err, productId }, 'Unexpected error while resolving order price');
      await ctx.reply(isAmharic ? '❌ ክፍያ መጀመር አልተቻለም። እባክዎ እንደገና ይሞክሩ ወይም ድጋፍ ያነጋግሩ።' : '❌ Could not start checkout. Please try again or contact support.');
    }
    return;
  }

  // Idempotency: reuse existing uncompleted awaiting_payment order if created within 15 minutes
  const db = getDatabase();
  const existingOrder = db.prepare(`
    SELECT * FROM orders
    WHERE user_id = ?
      AND product_id = ?
      AND (variant_id = ? OR (variant_id IS NULL AND ? IS NULL))
      AND status = 'awaiting_payment'
      AND created_at > datetime('now', '-15 minutes')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, productId, variantId || null, variantId || null) as Order | undefined;

  let order: Order;
  if (existingOrder) {
    order = existingOrder;
    logger.info({ orderId: order.id, userId, productId }, 'Reusing active awaiting_payment order');

    // If the buyer chose a gift recipient, make sure the reused order carries it
    // (covers self→gift switches within the 15-minute reuse window).
    if (targetUsername != null && order.target_username !== targetUsername) {
      order = updateOrderStatus(order.id, order.status, { target_username: targetUsername });
    }
    if (order.payment_rail !== 'telebirr' && order.payment_rail !== 'cbe' && order.payment_rail !== 'abyssinia') {
      order = updateOrderStatus(order.id, order.status, { payment_rail: 'telebirr' });
    }
  } else {
    order = createOrder({
      userId,
      username,
      productId,
      variantId: variantId || null,
      amountETB,
      paymentRail: 'telebirr',
      quantity: 1,
      status: 'awaiting_payment',
      targetUsername: targetUsername ?? undefined,
    });
  }

  await renderPaymentRailSelection(ctx, order, productName);
}

export async function renderPaymentRailSelection(ctx: Context, order: Order, productName: string): Promise<void> {
  const userId = ctx.from?.id;
  const user = userId ? getUserById(userId) : null;
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  const discount = order.discount_etb || 0;
  const netAmount = Math.max(order.amount_etb - discount, 1);

  const text = isAmharic
    ? `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
      `🛍 <b>የክፍያ ማረጋገጫ እና ትዕዛዝ ማጠቃለያ</b>\n\n` +
      `• 📦 <b>ምርት፦</b> <b>${escapeHtml(productName)}</b>\n` +
      `• 🧾 <b>የትዕዛዝ ቁጥር፦</b> <code>${order.id}</code>\n` +
      (discount > 0 ? `• 🏷️ <b>ዋና ዋጋ፦</b> <s>${formatPriceETB(order.amount_etb)}</s>\n• 🎁 <b>የቅናሽ ኩፖን (${escapeHtml(order.promo_code || '')})፦</b> <b>−${formatPriceETB(discount)}</b>\n` : '') +
      `• 💰 <b>የሚከፈል ጠቅላላ፦</b> <code>${formatPriceETB(netAmount)}</code>\n\n` +
      `<i>👇 የሚመርጡትን የክፍያ ዘዴ ከታች ይምረጡ፡</i>`
    : `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
      `🛍 <b>Checkout & Payment Confirmation</b>\n\n` +
      `• 📦 <b>Product:</b> <b>${escapeHtml(productName)}</b>\n` +
      `• 🧾 <b>Order Ref:</b> <code>${order.id}</code>\n` +
      (discount > 0 ? `• 🏷️ <b>Original Price:</b> <s>${formatPriceETB(order.amount_etb)}</s>\n• 🎁 <b>Promo (${escapeHtml(order.promo_code || '')}):</b> <b>−${formatPriceETB(discount)}</b>\n` : '') +
      `• 💰 <b>Total Payable:</b> <code>${formatPriceETB(netAmount)}</code>\n\n` +
      `<i>👇 Select your preferred payment rail below:</i>`;

  const keyboard = new InlineKeyboard()
    .text(isAmharic ? `📱 ቴሌብር` : `📱 Telebirr`, `pay_manual_telebirr_${order.id}`)
    .text(isAmharic ? `🏦 የኢትዮጵያ ንግድ ባንክ (CBE)` : `🏦 CBE Bank`, `pay_manual_cbe_${order.id}`)
    .row()
    .text(isAmharic ? `🏛 አቢሲኒያ ባንክ` : `🏛 Bank of Abyssinia`, `pay_manual_abyssinia_${order.id}`)
    .text(isAmharic ? `🏷 የቅናሽ ኮድ${discount > 0 ? ' ✓' : ''}` : `🏷 Promo Code${discount > 0 ? ' ✓' : ''}`, `promo_prompt_${order.id}`)
    .row()
    .text(isAmharic ? '« ትዕዛዝ ሰርዝ' : '« Cancel Order', 'nav_shop');

  await safeEditMessage(ctx, text, keyboard);
}

/** Chapa hosted checkout (deprecated). */
export async function handleChapaPayment(ctx: Context, orderId: string): Promise<void> {
  await ctx.answerCallbackQuery({
    text: 'Card (Chapa) payments are discontinued. Please choose Telebirr, CBE Bank, or Bank of Abyssinia.',
    show_alert: true,
  }).catch(() => {});
  const order = getOrderById(orderId);
  if (order) {
    const product = getProductById(order.product_id);
    await renderPaymentRailSelection(ctx, order, product ? product.name : 'Subscription');
  }
}

/** TON Connect instructions (deprecated). */
export async function handleTonConnect(ctx: Context, orderId: string): Promise<void> {
  await ctx.answerCallbackQuery({
    text: 'TON Connect payments are discontinued. Please choose Telebirr, CBE Bank, or Bank of Abyssinia.',
    show_alert: true,
  }).catch(() => {});
  const order = getOrderById(orderId);
  if (order) {
    const product = getProductById(order.product_id);
    await renderPaymentRailSelection(ctx, order, product ? product.name : 'Subscription');
  }
}

/** Wallet Pay checkout (deprecated). */
export async function handleWalletPay(ctx: Context, orderId: string): Promise<void> {
  await ctx.answerCallbackQuery({
    text: 'Wallet Pay is discontinued. Please choose Telebirr, CBE Bank, or Bank of Abyssinia.',
    show_alert: true,
  }).catch(() => {});
  const order = getOrderById(orderId);
  if (order) {
    const product = getProductById(order.product_id);
    await renderPaymentRailSelection(ctx, order, product ? product.name : 'Subscription');
  }
}

export async function handleManualRail(ctx: Context, rail: 'telebirr' | 'cbe' | 'abyssinia', orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  const user = userId ? getUserById(userId) : null;
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply(isAmharic ? 'ትዕዛዙ አልተገኘም።' : 'Order not found.');
    return;
  }

  // Rail switch without status regression (receipts on pending_approval survive)
  updateOrderMeta(orderId, { payment_rail: rail });

  // Payment account details always come from admin-managed settings.
  // Placeholder defaults make an unconfigured store visibly incomplete
  // instead of silently showing someone else's (or stale) accounts.
  let railTitle = isAmharic ? 'ቴሌብር' : 'Telebirr';
  let accountNum = getSetting('telebirr_account', '0000000000');
  let accountName = getSetting('telebirr_name', 'Bighabesha Shop');

  if (rail === 'cbe') {
    railTitle = isAmharic ? 'የኢትዮጵያ ንግድ ባንክ (CBE)' : 'Commercial Bank of Ethiopia (CBE)';
    accountNum = getSetting('cbe_account', '0000000000000');
    accountName = getSetting('cbe_name', 'Bighabesha Shop');
  } else if (rail === 'abyssinia') {
    railTitle = isAmharic ? 'አቢሲኒያ ባንክ' : 'Bank of Abyssinia';
    accountNum = getSetting('abyssinia_account', '0000000000000');
    accountName = getSetting('abyssinia_name', 'Bighabesha Shop');
  }

  const discount = order.discount_etb || 0;
  const netAmount = Math.max(order.amount_etb - discount, 1);

  const text = isAmharic
    ? `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
      `🏦 <b>ክፍያ በ${escapeHtml(railTitle)}</b>\n\n` +
      `እባክዎ በትክክል <b>${formatPriceETB(netAmount)}</b> ወደሚከተለው ያስተላልፉ፡\n\n` +
      (discount > 0 ? `• 🏷️ <b>የተደረገ ቅናሽ፦</b> −${formatPriceETB(discount)} <i>(ዋና ዋጋ፦ <s>${formatPriceETB(order.amount_etb)}</s>)</i>\n` : '') +
      `• <b>የሂሳብ / ስልክ ቁጥር፦</b> <code>${escapeHtml(accountNum)}</code> <i>(ለመቅዳት ይጫኑ)</i>\n` +
      `• <b>የሂሳብ ስም፦</b> <b>${escapeHtml(accountName)}</b>\n` +
      `• <b>የትራንስፈር ማስታወሻ (Reason)፦</b> <code>${order.id}</code>\n\n` +
      `<blockquote>📸 የከፈሉበትን ደረሰኝ ስክሪንሾት በማንሳት ከታች <b>[የክፍያ ደረሰኝ ላክ]</b> የሚለውን ይጫኑ።</blockquote>`
    : `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
      `🏦 <b>Payment via ${escapeHtml(railTitle)}</b>\n\n` +
      `Please transfer exactly <b>${formatPriceETB(netAmount)}</b> to:\n\n` +
      (discount > 0 ? `• 🏷️ <b>Applied Discount:</b> −${formatPriceETB(discount)} <i>(Original: <s>${formatPriceETB(order.amount_etb)}</s>)</i>\n` : '') +
      `• <b>Account / Phone:</b> <code>${escapeHtml(accountNum)}</code> <i>(Tap to copy)</i>\n` +
      `• <b>Account Name:</b> <b>${escapeHtml(accountName)}</b>\n` +
      `• <b>Payment Reference:</b> <code>${order.id}</code>\n\n` +
      `<blockquote>📸 Take a screenshot of your transfer confirmation, then tap <b>[Upload Transfer Receipt]</b> below.</blockquote>`;

  const keyboard = new InlineKeyboard()
    .text(isAmharic ? '📸 የክፍያ ደረሰኝ ላክ' : '📸 Upload Transfer Receipt', `receipt_prompt_${order.id}`)
    .row()
    .text(isAmharic ? '« የክፍያ ዘዴ ቀይር' : '« Change Payment Method', `checkout_back_${order.id}`);

  await safeEditMessage(ctx, text, keyboard);
}

export async function promptReceiptUpload(ctx: Context, orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = userId ? getUserById(userId) : null;
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  const order = getOrderById(orderId);
  if (!order || order.user_id !== userId) {
    // Ownership check: never reveal or operate on foreign orders.
    await ctx.reply(isAmharic ? 'ትዕዛዙ አልተገኘም።' : 'Order not found.');
    return;
  }

  setPendingAction(userId, {
    type: 'user_receipt_upload',
    data: { orderId: order.id },
  });

  const text = isAmharic
    ? `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
      `📤 <b>የክፍያ ደረሰኝ መላኪያ — ትዕዛዝ <code>${order.id}</code></b>\n\n` +
      `እባክዎ የተላለፈበትን ማረጋገጫ ፎቶ / ስክሪንሾት / ዶክመንት በዚህ ቻት ውስጥ ይላኩ።\n\n` +
      `<i>አውቶሜትድ ሲስተማችን እና አድሚኖች ክፍያውን አረጋግጠው ትዕዛዝዎን በፍጥነት ይልካሉ።</i>`
    : `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
      `📤 <b>Upload Transfer Slip — Order <code>${order.id}</code></b>\n\n` +
      `Please send a photo / screenshot / document of your transaction confirmation in this chat.\n\n` +
      `<i>Our automated system and admins will verify your transfer and release your order promptly.</i>`;

  const keyboard = new InlineKeyboard().text(isAmharic ? '« ተመለስ' : '« Cancel', `pay_manual_${order.payment_rail}_${order.id}`);

  await safeEditMessage(ctx, text, keyboard);
}

export async function performAdminApprove(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId) return;

  // Authorization gate: only configured administrators may approve orders.
  if (!isAdmin(adminId)) {
    logger.warn({ adminId, orderId }, 'Non-admin attempted order approval via callback');
    return;
  }

  try {
    const { order, autoDeliveredItem } = approveReceipt(orderId, adminId);

    // B2B reseller pipeline: eligible Premium orders go straight to the provider.
    if (!autoDeliveredItem && isResellerEligible(order)) {
      await performResellerDelivery(ctx, order, adminId);
      return;
    }

    const adminUsername = ctx.from?.username ? `@${escapeHtml(ctx.from.username)}` : `Admin (${adminId})`;

    const statusText = `<b>Order <code>${order.id}</code> Approved by ${adminUsername}</b>\n` +
      `• Status: ${order.status.toUpperCase()}\n` +
      `• Amount: ${formatPriceETB(order.amount_etb)}`;

    if (ctx.callbackQuery?.message) {
      if (ctx.callbackQuery.message.photo) {
        await ctx.editMessageCaption({
          caption: statusText,
          parse_mode: 'HTML',
        }).catch(() => {});
      } else {
        await ctx.editMessageText(statusText, {
          parse_mode: 'HTML',
        }).catch(() => {});
      }
    }

    // Notify the buyer
    if (autoDeliveredItem) {
      const rawTemplate = getSetting(
        'gemini_instructions',
        'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
      );
      const deliveryText = `<b>Payment Confirmed — Order #${order.id}</b>\n\n` +
        `Activation Link:\n<code>${autoDeliveredItem.payload}</code>\n\n` +
        `<b>Instructions:</b>\n${rawTemplate}\n\n` +
        `<i>Thank you for choosing Bighabesha Shop.</i>`;

      await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to deliver payload to buyer');
      });
    } else {
      const notifyText = `<b>Payment Verified for Order #${order.id}</b>\n\n` +
        `Your order has been queued for fulfillment to <b>@${escapeHtml(order.username || 'your account')}</b>.\n` +
        `You will receive a notification once the transfer is completed.`;

      await ctx.api.sendMessage(order.user_id, notifyText, { parse_mode: 'HTML' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to notify buyer of approval');
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, orderId }, 'Error during admin approval');
    await ctx.reply(`Could not approve order: ${escapeHtml(message)}`);
  }
}

/**
 * Shared delivery path for reseller-eligible orders, used both on first
 * approval and on [Retry Delivery]. Renders the outcome in-place and notifies
 * the buyer of success or failure.
 */
async function performResellerDelivery(ctx: Context, order: Order, adminId: number): Promise<void> {
  const adminUsername = ctx.from?.username ? `@${escapeHtml(ctx.from.username)}` : `Admin (${adminId})`;
  const outcome = await deliverWithReseller(order.id, adminId, ctx.api);

  const statusText = outcome.delivered
    ? `<b>Order <code>${order.id}</code> Approved by ${adminUsername}</b>\n` +
      `• Status: FULFILLED\n` +
      `• Amount: ${formatPriceETB(order.amount_etb)}\n` +
      `• Delivered via <b>${escapeHtml(outcome.order.reseller_provider || 'reseller')}</b>` +
      (outcome.order.reseller_tx_id ? `\n• Provider Tx: <code>${escapeHtml(outcome.order.reseller_tx_id)}</code>` : '')
    : `<b>Order <code>${order.id}</code> — Delivery Failed</b>\n` +
      `• Approved by ${adminUsername}\n` +
      `• Amount: ${formatPriceETB(order.amount_etb)}\n` +
      `• Error: ${escapeHtml(outcome.error || 'Unknown')}`;

  const keyboard = outcome.delivered ? undefined : deliveryFailedKeyboard(order.id);

  if (ctx.callbackQuery?.message) {
    if (ctx.callbackQuery.message.photo) {
      await ctx.editMessageCaption({ caption: statusText, parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    } else {
      await ctx.editMessageText(statusText, { parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
    }
  }

  if (outcome.delivered) {
    const targetUsername = outcome.order.target_username || outcome.order.username || 'your account';
    const notifyText = `<b>Payment Confirmed — Order #${order.id}</b>\n\n` +
      `🎉 Your <b>Telegram Premium</b> has been activated on <b>@${escapeHtml(targetUsername)}</b>.\n\n` +
      `<i>Thank you for choosing Bighabesha Shop!</i>`;
    await ctx.api.sendMessage(order.user_id, notifyText, { parse_mode: 'HTML' }).catch((err) => {
      logger.error({ err, userId: order.user_id }, 'Failed to notify buyer of successful delivery');
    });
  } else {
    const notifyText = `<b>Payment Verified for Order #${order.id}</b>\n\n` +
      `Your order has been approved but delivery encountered a temporary issue.\n` +
      `Our team is resolving it — you will receive an update shortly.`;
    await ctx.api.sendMessage(order.user_id, notifyText, { parse_mode: 'HTML' }).catch((err) => {
      logger.error({ err, userId: order.user_id }, 'Failed to notify buyer of delivery failure');
    });
  }
}

/** Admin [Retry Delivery] callback for a delivery_failed reseller order. */
export async function handleRetryDelivery(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId) return;

  if (!isAdmin(adminId)) {
    logger.warn({ adminId, orderId }, 'Non-admin attempted delivery retry');
    return;
  }

  const order = getOrderById(orderId);
  if (!order) {
    await ctx.answerCallbackQuery({ text: 'Order not found.', show_alert: true });
    return;
  }

  if (order.status !== 'delivery_failed') {
    await ctx.answerCallbackQuery({ text: `Order is in status "${order.status}" — retry not applicable.`, show_alert: true });
    return;
  }

  if (!isResellerEligible(order)) {
    await ctx.answerCallbackQuery({ text: 'This order is not reseller-eligible.', show_alert: true });
    return;
  }

  await performResellerDelivery(ctx, order, adminId);
}

export const handleAdminRetryDelivery = handleRetryDelivery;

export async function promptAdminReject(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId) return;

  // Authorization gate: only configured administrators may reject orders.
  if (!isAdmin(adminId)) {
    logger.warn({ adminId, orderId }, 'Non-admin attempted order rejection via callback');
    return;
  }

  setPendingAction(adminId, {
    type: 'admin_reject_reason',
    data: { orderId },
  });

  const text = `<b>Rejecting Order <code>${orderId}</code></b>\n\n` +
    `Type the reason for rejecting this receipt in chat:\n\n` +
    `<i>This reason will be delivered to the buyer.</i>`;

  const keyboard = new InlineKeyboard().text('Cancel', 'admin_menu');

  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

export async function notifyAdminsNewReceipt(ctx: Context, order: Order): Promise<void> {
  const config = getConfig();
  const product = getProductById(order.product_id);
  const productName = product ? product.name : order.product_id;

  const caption = `<b>Receipt Pending Verification</b>\n\n` +
    `• Order ID: <code>${order.id}</code>\n` +
    `• Buyer: @${escapeHtml(order.username || 'unknown')} (ID: <code>${order.user_id}</code>)\n` +
    (order.target_username ? `• Target: @${escapeHtml(order.target_username)}\n` : '') +
    `• Product: ${escapeHtml(productName)}\n` +
    `• Amount: <b>${formatPriceETB(order.amount_etb)}</b>\n` +
    `• Rail: ${order.payment_rail.toUpperCase()}\n` +
    `• Note: ${escapeHtml(order.receipt_note || 'None')}\n\n` +
    `Review receipt and choose an action:`;

  const keyboard = new InlineKeyboard()
    .text('✅ Approve & Deliver', `admin_approve_${order.id}`)
    .text('Reject', `admin_reject_${order.id}`);

  for (const adminId of config.ADMIN_IDS) {
    let sentPhoto = false;
    if (order.receipt_file_id) {
      try {
        // Traversal-safe resolution: handles filename-only ids and legacy
        // absolute paths; returns null for anything outside the receipts dir.
        const diskReceipt = resolveStoredReceiptPath(order.receipt_file_id);
        if (diskReceipt) {
          await ctx.api.sendPhoto(adminId, new InputFile(diskReceipt), {
            caption,
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
          sentPhoto = true;
        } else {
          await ctx.api.sendPhoto(adminId, order.receipt_file_id, {
            caption,
            parse_mode: 'HTML',
            reply_markup: keyboard,
          });
          sentPhoto = true;
        }
      } catch (photoErr) {
        logger.warn({ err: photoErr, adminId, orderId: order.id }, 'Failed to send photo receipt, falling back to text');
      }
    }

    if (!sentPhoto) {
      try {
        await ctx.api.sendMessage(adminId, caption, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch (err) {
        logger.error({ err, adminId, orderId: order.id }, 'Failed to notify admin of new receipt via text fallback');
      }
    }
  }
}
