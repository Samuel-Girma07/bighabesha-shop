import { Context, InlineKeyboard, InputFile } from 'grammy';
import { getProductById, formatPriceETB } from '../../services/catalog.service.js';
import { resolveStoredReceiptPath } from '../../services/receipts.service.js';
import { createOrder, getOrderById, updateOrderMeta, updateOrderStatus, submitReceipt, approveReceipt, rejectReceipt, PaymentRail, Order } from '../../services/orders.service.js';
import { resolveOrderPrice, PricingError } from '../../services/pricing.service.js';
import { calculateStarsDue, calculateCryptoQuote, fetchCoinGeckoPrices } from '../../services/rate_engine.service.js';
import { getSetting, getNumericSetting } from '../../services/settings.service.js';
import { getWalletPayAdapter } from '../../services/payments/index.js';
import { isChapaEnabled, chapaInitialize } from '../../services/payments/chapa.js';
import { isTonConnectEnabled } from '../../services/payments/ton.service.js';
import { setPendingAction } from '../session.js';
import { isAdmin } from './admin.js';
import { getConfig } from '../../config/env.js';
import { getDatabase } from '../../db/index.js';
import { escapeHtml } from '../../utils/html.js';
import { logger } from '../../logger/index.js';
import { t } from '../../i18n/index.js';

const VALID_PAYMENT_RAILS: PaymentRail[] = ['stars', 'wallet_pay', 'telebirr', 'cbe', 'abyssinia'];

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
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed to editMessageCaption, attempting reply');
      }
    } else {
      try {
        await ctx.editMessageText(text, { parse_mode, reply_markup });
        return;
      } catch (err: any) {
        logger.warn({ err: err?.message }, 'Failed to editMessageText, attempting reply');
      }
    }
  }

  await ctx.reply(text, { parse_mode, reply_markup });
}

export async function initiateCheckout(
  ctx: Context,
  productId: string,
  variantId?: string,
  customStars?: number,
  // Deprecated: retained for call-site compatibility. The price is ALWAYS
  // recomputed server-side; this argument is never trusted.
  _customAmountETB?: number
): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || null;
  if (!userId) return;

  let amountETB = 0;
  let productName = '';

  // Authoritative server-side pricing — ignores any client-supplied amount.
  try {
    const resolved = resolveOrderPrice({
      productId,
      variantId: variantId || null,
      customStars: customStars || null,
    });
    amountETB = resolved.amountETB;
    productName = resolved.productName;
  } catch (err) {
    if (err instanceof PricingError) {
      logger.warn({ err, userId, productId, variantId, customStars }, 'Checkout blocked by pricing validation');
      await ctx.reply(`❌ ${escapeHtml(err.message)}`);
    } else {
      logger.error({ err, productId }, 'Unexpected error while resolving order price');
      await ctx.reply('❌ Could not start checkout. Please try again or contact support.');
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
  } else {
    order = createOrder({
      userId,
      username,
      productId,
      variantId: variantId || null,
      amountETB,
      paymentRail: 'stars',
      quantity: customStars || 1,
      status: 'awaiting_payment',
    });
  }

  await renderPaymentRailSelection(ctx, order, productName);
}

export async function renderPaymentRailSelection(ctx: Context, order: Order, productName: string): Promise<void> {
  const discount = order.discount_etb || 0;
  const netAmount = Math.max(order.amount_etb - discount, 1);
  const starsDue = calculateStarsDue(netAmount);
  const { tonUsd } = await fetchCoinGeckoPrices();
  const { cryptoAmount: tonAmount, usdAmountWithMargin } = calculateCryptoQuote(netAmount, tonUsd);

  const text =
    `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
    `🛍 <b>Checkout & Payment Confirmation</b>\n\n` +
    `• 📦 <b>Product:</b> <b>${escapeHtml(productName)}</b>\n` +
    `• 🧾 <b>Order Ref:</b> <code>${order.id}</code>\n` +
    (discount > 0 ? `• 🏷️ <b>Original Price:</b> <s>${formatPriceETB(order.amount_etb)}</s>\n• 🎁 <b>Promo (${escapeHtml(order.promo_code || '')}):</b> <b>−${formatPriceETB(discount)}</b>\n` : '') +
    `• 💰 <b>Total Payable:</b> <code>${formatPriceETB(netAmount)}</code>\n\n` +
    `<blockquote>⚡ <b>Automated Digital & Crypto Quotes:</b>\n` +
    `• ⭐️ Telegram Stars: <code>${starsDue} XTR</code>\n` +
    `• 💎 TON / USDT: <code>$${usdAmountWithMargin.toFixed(2)} USD</code> (~${tonAmount} TON)</blockquote>\n\n` +
    `<i>👇 Select your preferred payment rail below:</i>`;

  const keyboard = new InlineKeyboard()
    .text(`⭐️ Pay with Stars (${starsDue} XTR)`, `pay_stars_${order.id}`)
    .row()
    .text(`🪙 Pay with Crypto (TON / USDT)`, `pay_wp_${order.id}`)
    .row();

  if (isChapaEnabled()) {
    keyboard.text(`💳 Card / Telebirr / CBE Birr (Chapa)`, `pay_chapa_${order.id}`).row();
  }
  if (isTonConnectEnabled()) {
    keyboard.text(`💎 Pay via TON Wallet (Connect)`, `pay_ton_${order.id}`).row();
  }

  keyboard
    .text(`📱 Telebirr`, `pay_manual_telebirr_${order.id}`)
    .text(`🏦 CBE Bank`, `pay_manual_cbe_${order.id}`)
    .row()
    .text(`🏛 Bank of Abyssinia`, `pay_manual_abyssinia_${order.id}`)
    .text(`🏷 Promo Code${discount > 0 ? ' ✓' : ''}`, `promo_prompt_${order.id}`)
    .row()
    .text('« Cancel Order', 'nav_shop');

  await safeEditMessage(ctx, text, keyboard);
}

/** Chapa hosted checkout for an existing awaiting-payment order. */
export async function handleChapaPayment(ctx: Context, orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const order = getOrderById(orderId);
  if (!order || order.user_id !== userId) {
    await ctx.reply('Order not found.');
    return;
  }

  try {
    updateOrderMeta(orderId, { payment_rail: 'chapa' });
    const netAmountEtb = Math.max(order.amount_etb - (order.discount_etb || 0), 1);
    const init = await chapaInitialize({
      txRef: order.id,
      amountEtb: netAmountEtb,
      buyerName: ctx.from?.first_name,
      buyerPhone: null,
      returnUrl: `${getConfig().WEBAPP_URL || ''}/orders`,
    });
    updateOrderStatus(orderId, order.status, { payment_ref: init.providerRef });

    const keyboard = new InlineKeyboard()
      .url('Open Secure Checkout', init.payUrl)
      .row()
      .text('« Change Payment Method', `checkout_back_${order.id}`);

    const text = `<b>Chapa Secure Checkout</b>\n\n` +
      `• Order ID: <code>${order.id}</code>\n` +
      `• Amount: <b>${formatPriceETB(netAmountEtb)}</b>\n\n` +
      `Card, Telebirr, CBE Birr and more are supported.\n` +
      `<i>Your order confirms automatically once payment completes.</i>`;

    await safeEditMessage(ctx, text, keyboard);
  } catch (err: any) {
    logger.error({ err, orderId }, 'Chapa payment failed');
    await ctx.reply(`❌ Payment provider unavailable: ${escapeHtml(err?.message || 'try another method.')}`);
  }
}

/** TON Connect instructions for an existing awaiting-payment order. */
export async function handleTonConnect(ctx: Context, orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const order = getOrderById(orderId);
  if (!order || order.user_id !== userId) {
    await ctx.reply('Order not found.');
    return;
  }

  updateOrderMeta(orderId, { payment_rail: 'ton_connect' });
  const netAmountEtb = Math.max(order.amount_etb - (order.discount_etb || 0), 1);
  const { tonUsd } = await fetchCoinGeckoPrices();
  const { cryptoAmount } = calculateCryptoQuote(netAmountEtb, tonUsd);

  const text = `<b>Pay with TON Wallet</b>\n\n` +
    `• Order ID (memo): <code>${order.id}</code>\n` +
    `• Amount: <code>${cryptoAmount} TON</code>\n\n` +
    `Open the Mini App store, tap <b>“Pay with TON”</b>, approve the transaction in your connected wallet.\n` +
    `<i>The exact memo is required for automatic on-chain matching.</i>\n\n` +
    `Your order confirms automatically after 1 network confirmation.`;

  const keyboard = new InlineKeyboard()
    .webApp('Open Mini App to Pay', getConfig().WEBAPP_URL || 'https://t.me')
    .row()
    .text('« Change Payment Method', `checkout_back_${order.id}`);

  await safeEditMessage(ctx, text, keyboard);
}

export async function handleStarsPayment(ctx: Context, orderId: string): Promise<void> {
  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found.');
    return;
  }

  const product = getProductById(order.product_id);
  const productName = product ? product.name : 'Subscription';
  const starsDue = calculateStarsDue(order.amount_etb);

  // Rail switch: NEVER regress the order status — a pending_approval order
  // keeps its receipt; only the payment rail metadata changes.
  updateOrderMeta(orderId, { payment_rail: 'stars' });

  try {
    await ctx.replyWithInvoice(
      `Bighabesha Shop: ${productName}`,
      `Order #${order.id} — Instant automated fulfillment upon payment verification.`,
      `order_${order.id}`,
      'XTR',
      [{ label: productName, amount: starsDue }]
    );
  } catch (err) {
    logger.error({ err, orderId }, 'Failed to send Telegram Stars invoice');
    await ctx.reply('Failed to generate Telegram Stars invoice. Please select another payment method.');
  }
}

export async function handleWalletPay(ctx: Context, orderId: string): Promise<void> {
  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found.');
    return;
  }

  const product = getProductById(order.product_id);
  const productName = product ? product.name : 'Subscription';

  // Rail switch without status regression (receipts on pending_approval survive)
  updateOrderMeta(orderId, { payment_rail: 'wallet_pay' });

  const adapter = getWalletPayAdapter();
  const payment = await adapter.createPayment({
    orderId: order.id,
    userId: order.user_id,
    amountETB: order.amount_etb,
    productName,
    currency: 'TON',
  });

  // Persist the provider payment reference and quoted crypto amount at
  // creation time — reconciliation and webhook verification rely on them.
  updateOrderMeta(orderId, {
    payment_ref: payment.paymentRef || null,
    crypto_amount: payment.cryptoAmount ?? null,
    crypto_currency: payment.cryptoCurrency ?? null,
  });

  const config = getConfig();
  const isMock = config.WALLET_PAY_MODE === 'mock';

  let text = `<b>Wallet Pay (TON / USDT)</b>\n\n` +
    `• Order ID: <code>${order.id}</code>\n` +
    `• Amount: <code>${payment.cryptoAmount} ${payment.cryptoCurrency}</code>\n` +
    `• Status: Awaiting Payment\n\n` +
    `Tap below to open Telegram Wallet:`;

  if (isMock) {
    text += `\n\n<i>Dev Simulation Mode:</i> Use <code>/wp_simulate ${order.id}</code> to simulate payment.`;
  }

  const keyboard = new InlineKeyboard();
  if (payment.payUrl) {
    keyboard.url('Open Wallet Pay', payment.payUrl).row();
  }
  keyboard.text('« Change Payment Method', `checkout_back_${order.id}`);

  await safeEditMessage(ctx, text, keyboard);
}

export async function handleManualRail(ctx: Context, rail: 'telebirr' | 'cbe' | 'abyssinia', orderId: string): Promise<void> {
  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found.');
    return;
  }

  // Rail switch without status regression (receipts on pending_approval survive)
  updateOrderMeta(orderId, { payment_rail: rail });

  // Payment account details always come from admin-managed settings.
  // Placeholder defaults make an unconfigured store visibly incomplete
  // instead of silently showing someone else's (or stale) accounts.
  let railTitle = 'Telebirr';
  let accountNum = getSetting('telebirr_account', '0000000000');
  let accountName = getSetting('telebirr_name', 'Bighabesha Shop');

  if (rail === 'cbe') {
    railTitle = 'Commercial Bank of Ethiopia (CBE)';
    accountNum = getSetting('cbe_account', '0000000000000');
    accountName = getSetting('cbe_name', 'Bighabesha Shop');
  } else if (rail === 'abyssinia') {
    railTitle = 'Bank of Abyssinia';
    accountNum = getSetting('abyssinia_account', '0000000000000');
    accountName = getSetting('abyssinia_name', 'Bighabesha Shop');
  }

  const text = `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
    `🏦 <b>Payment via ${escapeHtml(railTitle)}</b>\n\n` +
    `Please transfer exactly <b>${formatPriceETB(order.amount_etb)}</b> to:\n\n` +
    `• <b>Account / Phone:</b> <code>${escapeHtml(accountNum)}</code> <i>(Tap to copy)</i>\n` +
    `• <b>Account Name:</b> <b>${escapeHtml(accountName)}</b>\n` +
    `• <b>Payment Reference:</b> <code>${order.id}</code>\n\n` +
    `<blockquote>📸 Take a screenshot of your transfer confirmation, then tap <b>[Upload Transfer Receipt]</b> below.</blockquote>`;

  const keyboard = new InlineKeyboard()
    .text('📸 Upload Transfer Receipt', `receipt_prompt_${order.id}`)
    .row()
    .text('« Change Payment Method', `checkout_back_${order.id}`);

  await safeEditMessage(ctx, text, keyboard);
}

export async function promptReceiptUpload(ctx: Context, orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const order = getOrderById(orderId);
  if (!order || order.user_id !== userId) {
    // Ownership check: never reveal or operate on foreign orders.
    await ctx.reply('Order not found.');
    return;
  }

  setPendingAction(userId, {
    type: 'user_receipt_upload',
    data: { orderId: order.id },
  });

  const text = `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
    `📤 <b>Upload Transfer Slip — Order <code>${order.id}</code></b>\n\n` +
    `Please send a photo / screenshot / document of your transaction confirmation in this chat.\n\n` +
    `<i>Our automated system and admins will verify your transfer and release your order promptly.</i>`;

  const keyboard = new InlineKeyboard().text('« Cancel', `pay_manual_${order.payment_rail}_${order.id}`);

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
  } catch (err: any) {
    logger.error({ err, orderId }, 'Error during admin approval');
    await ctx.reply(`Could not approve order: ${escapeHtml(err.message)}`);
  }
}

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
    `• Product: ${escapeHtml(productName)}\n` +
    `• Amount: <b>${formatPriceETB(order.amount_etb)}</b>\n` +
    `• Rail: ${order.payment_rail.toUpperCase()}\n` +
    `• Note: ${escapeHtml(order.receipt_note || 'None')}\n\n` +
    `Review receipt and choose an action:`;

  const keyboard = new InlineKeyboard()
    .text('Approve Receipt', `admin_approve_${order.id}`)
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
