import { Context, InlineKeyboard } from 'grammy';
import { getProductById, getVariantById, formatPriceETB } from '../../services/catalog.service.js';
import { createOrder, getOrderById, updateOrderStatus, submitReceipt, approveReceipt, rejectReceipt, PaymentRail, Order } from '../../services/orders.service.js';
import { calculateStarsDue, calculateCryptoQuote, fetchCoinGeckoPrices } from '../../services/rate_engine.service.js';
import { getSetting, getNumericSetting } from '../../services/settings.service.js';
import { getWalletPayAdapter } from '../../services/payments/index.js';
import { setPendingAction } from '../session.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';
import { t } from '../../i18n/index.js';

export async function initiateCheckout(
  ctx: Context,
  productId: string,
  variantId?: string,
  customStars?: number,
  customAmountETB?: number
): Promise<void> {
  const userId = ctx.from?.id;
  const username = ctx.from?.username || null;
  if (!userId) return;

  const product = getProductById(productId);
  if (!product) {
    await ctx.reply('Product not found.');
    return;
  }

  let amountETB = 0;
  let productName = product.name;

  if (variantId) {
    const variant = getVariantById(variantId);
    if (!variant) {
      await ctx.reply('Variant not found.');
      return;
    }
    amountETB = variant.price_etb;
    productName = `${product.name} (${variant.name})`;
  } else if (customAmountETB && customStars) {
    amountETB = customAmountETB;
    productName = `${customStars.toLocaleString()} Telegram Stars`;
  } else {
    await ctx.reply('Invalid order parameters.');
    return;
  }

  const order = createOrder({
    userId,
    username,
    productId,
    variantId: variantId || null,
    amountETB,
    paymentRail: 'stars',
    quantity: customStars || 1,
    status: 'awaiting_payment',
  });

  await renderPaymentRailSelection(ctx, order, productName);
}

export async function renderPaymentRailSelection(ctx: Context, order: Order, productName: string): Promise<void> {
  const starsDue = calculateStarsDue(order.amount_etb);
  const { tonUsd } = await fetchCoinGeckoPrices();
  const { cryptoAmount: tonAmount, usdAmountWithMargin } = calculateCryptoQuote(order.amount_etb, tonUsd);

  const text = `*Checkout Confirmation*\n\n` +
    `• Product: ${productName}\n` +
    `• Order ID: \`${order.id}\`\n` +
    `• Total Price: *${formatPriceETB(order.amount_etb)}*\n\n` +
    `• Telegram Stars: \`${starsDue} XTR\`\n` +
    `• TON / USDT: \`$${usdAmountWithMargin.toFixed(2)} USD\` (~${tonAmount} TON)\n\n` +
    `Select your payment method:`;

  const keyboard = new InlineKeyboard()
    .text(`Telegram Stars (${starsDue} Stars)`, `pay_stars_${order.id}`)
    .row()
    .text(`Wallet Pay (TON / USDT)`, `pay_wp_${order.id}`)
    .row()
    .text(`Telebirr`, `pay_manual_telebirr_${order.id}`)
    .text(`CBE Bank`, `pay_manual_cbe_${order.id}`)
    .row()
    .text(`Bank of Abyssinia`, `pay_manual_abyssinia_${order.id}`)
    .row()
    .text('« Cancel Order', 'nav_shop');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
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

  updateOrderStatus(orderId, 'awaiting_payment', { payment_rail: 'stars' });

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

  updateOrderStatus(orderId, 'awaiting_payment', { payment_rail: 'wallet_pay' });

  const adapter = getWalletPayAdapter();
  const payment = await adapter.createPayment({
    orderId: order.id,
    userId: order.user_id,
    amountETB: order.amount_etb,
    productName,
    currency: 'TON',
  });

  const config = getConfig();
  const isMock = config.WALLET_PAY_MODE === 'mock';

  let text = `*Wallet Pay (TON / USDT)*\n\n` +
    `• Order ID: \`${order.id}\`\n` +
    `• Amount: \`${payment.cryptoAmount} ${payment.cryptoCurrency}\`\n` +
    `• Status: Awaiting Payment\n\n` +
    `Tap below to open Telegram Wallet:`;

  if (isMock) {
    text += `\n\n_Dev Simulation Mode:_ Use \`/wp_simulate ${order.id}\` to simulate payment.`;
  }

  const keyboard = new InlineKeyboard();
  if (payment.payUrl) {
    keyboard.url('Open Wallet Pay', payment.payUrl).row();
  }
  keyboard.text('« Change Payment Method', `checkout_back_${order.id}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function handleManualRail(ctx: Context, rail: 'telebirr' | 'cbe' | 'abyssinia', orderId: string): Promise<void> {
  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found.');
    return;
  }

  updateOrderStatus(orderId, 'awaiting_payment', { payment_rail: rail });

  let railTitle = 'Telebirr';
  let accountNum = getSetting('telebirr_account', '0965579045');
  let accountName = getSetting('telebirr_name', 'Bighabesha Shop');

  if (rail === 'cbe') {
    railTitle = 'Commercial Bank of Ethiopia (CBE)';
    accountNum = getSetting('cbe_account', '1000510711258');
    accountName = getSetting('cbe_name', 'Bighabesha Shop');
  } else if (rail === 'abyssinia') {
    railTitle = 'Bank of Abyssinia';
    accountNum = getSetting('abyssinia_account', 'Abyssinia Bank Account');
    accountName = getSetting('abyssinia_name', 'Bighabesha Shop');
  }

  const text = `*Payment via ${railTitle}*\n\n` +
    `Please transfer exactly *${formatPriceETB(order.amount_etb)}* to:\n\n` +
    `• Account / Phone: \`${accountNum}\`\n` +
    `• Account Name: *${accountName}*\n` +
    `• Reference: \`${order.id}\`\n\n` +
    `Take a screenshot of your transfer confirmation, then tap **[Upload Transfer Receipt]** below:`;

  const keyboard = new InlineKeyboard()
    .text('Upload Transfer Receipt', `receipt_prompt_${order.id}`)
    .row()
    .text('« Change Payment Method', `checkout_back_${order.id}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function promptReceiptUpload(ctx: Context, orderId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const order = getOrderById(orderId);
  if (!order) {
    await ctx.reply('Order not found.');
    return;
  }

  setPendingAction(userId, {
    type: 'user_receipt_upload',
    data: { orderId: order.id },
  });

  const text = `*Upload Payment Receipt for Order \`${order.id}\`*\n\n` +
    `Please send a photo / screenshot of your transaction confirmation in this chat.`;

  const keyboard = new InlineKeyboard().text('Cancel', `pay_manual_${order.payment_rail}_${order.id}`);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function performAdminApprove(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId) return;

  try {
    const { order, autoDeliveredItem } = approveReceipt(orderId, adminId);
    const adminUsername = ctx.from?.username ? `@${ctx.from.username}` : `Admin (${adminId})`;

    const statusText = `*Order \`${order.id}\` Approved by ${adminUsername}*\n` +
      `• Status: ${order.status.toUpperCase()}\n` +
      `• Amount: ${formatPriceETB(order.amount_etb)}`;

    if (ctx.callbackQuery?.message) {
      if (ctx.callbackQuery.message.photo) {
        await ctx.editMessageCaption({
          caption: statusText,
          parse_mode: 'Markdown',
        }).catch(() => {});
      } else {
        await ctx.editMessageText(statusText, {
          parse_mode: 'Markdown',
        }).catch(() => {});
      }
    }

    // Notify the buyer
    if (autoDeliveredItem) {
      const rawTemplate = getSetting(
        'gemini_instructions',
        'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
      );
      const deliveryText = `*Payment Confirmed — Order #${order.id}*\n\n` +
        `Activation Link:\n${autoDeliveredItem.payload}\n\n` +
        `*Instructions:*\n${rawTemplate}\n\n` +
        `_Thank you for choosing Bighabesha Shop._`;

      await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'Markdown' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to deliver payload to buyer');
      });
    } else {
      const notifyText = `*Payment Verified for Order #${order.id}*\n\n` +
        `Your order has been queued for fulfillment to **@${order.username || 'your account'}**.\n` +
        `You will receive a notification once the transfer is completed.`;

      await ctx.api.sendMessage(order.user_id, notifyText, { parse_mode: 'Markdown' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to notify buyer of approval');
      });
    }
  } catch (err: any) {
    logger.error({ err, orderId }, 'Error during admin approval');
    await ctx.reply(`Could not approve order: ${err.message}`);
  }
}

export async function promptAdminReject(ctx: Context, orderId: string): Promise<void> {
  const adminId = ctx.from?.id;
  if (!adminId) return;

  setPendingAction(adminId, {
    type: 'admin_reject_reason',
    data: { orderId },
  });

  const text = `*Rejecting Order \`${orderId}\`*\n\n` +
    `Type the reason for rejecting this receipt in chat:\n\n` +
    `_This reason will be delivered to the buyer._`;

  const keyboard = new InlineKeyboard().text('Cancel', 'admin_menu');

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

export async function notifyAdminsNewReceipt(ctx: Context, order: Order): Promise<void> {
  const config = getConfig();
  const product = getProductById(order.product_id);
  const productName = product ? product.name : order.product_id;

  const caption = `*Receipt Pending Verification*\n\n` +
    `• Order ID: \`${order.id}\`\n` +
    `• Buyer: @${order.username || 'unknown'} (ID: \`${order.user_id}\`)\n` +
    `• Product: ${productName}\n` +
    `• Amount: *${formatPriceETB(order.amount_etb)}*\n` +
    `• Rail: ${order.payment_rail.toUpperCase()}\n` +
    `• Note: ${order.receipt_note || 'None'}\n\n` +
    `Review receipt and choose an action:`;

  const keyboard = new InlineKeyboard()
    .text('Approve Receipt', `admin_approve_${order.id}`)
    .text('Reject', `admin_reject_${order.id}`);

  for (const adminId of config.ADMIN_IDS) {
    try {
      if (order.receipt_file_id) {
        await ctx.api.sendPhoto(adminId, order.receipt_file_id, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } else {
        await ctx.api.sendMessage(adminId, caption, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      }
    } catch (err) {
      logger.error({ err, adminId, orderId: order.id }, 'Failed to notify admin of new receipt');
    }
  }
}
