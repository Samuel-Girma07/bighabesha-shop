import { Bot, BotError, GrammyError } from 'grammy';
import { logger } from '../logger/index.js';
import { startHandler } from './handlers/start.js';
import { healthHandler, pingHandler } from './handlers/health.js';
import { renderCatalog, renderProductDetails, promptCustomStars } from './handlers/shop.js';
import { promptPhoneRegistration, handleContactMessage } from './handlers/registration.js';
import { renderProfile } from './handlers/profile.js';
import { renderSupport, renderHelp } from './handlers/support.js';
import {
  renderAdminMenu,
  renderAdminProducts,
  renderAdminStock,
  renderAdminRates,
  renderAdminSettings,
  promptEditVariantPrice,
  promptStockPaste,
  promptStockCSV,
  promptEditSetting,
} from './handlers/admin.js';
import {
  renderAdminOrdersQueue,
  renderAdminQueueOrderDetail,
  promptQueueProof,
  executeDirectFulfill,
  promptQueueRefund,
} from './handlers/admin_queue.js';
import {
  renderBroadcastTargetSelection,
  promptBroadcastContent,
  executeConfirmedBroadcast,
} from './handlers/broadcast.js';
import {
  initiateCheckout,
  handleStarsPayment,
  handleWalletPay,
  handleManualRail,
  promptReceiptUpload,
  performAdminApprove,
  promptAdminReject,
  renderPaymentRailSelection,
} from './handlers/checkout.js';
import { isUsernameRequired, hasPublicUsername, renderUsernameGate, handleGateRecheck } from './handlers/gate.js';
import { renderMyOrders, renderOrderDetail, renderLanguageMenu, handleSetLanguage } from './handlers/orders.js';
import { handleTextInput, handleDocumentInput, handlePhotoInput } from './handlers/input.js';
import { getOrderById, approveReceipt, updateOrderStatus } from '../services/orders.service.js';
import { getProductById, formatPriceETB } from '../services/catalog.service.js';
import { getSetting } from '../services/settings.service.js';
import { isUserRegistered } from '../services/users.service.js';
import { getConfig } from '../config/env.js';
import { t } from '../i18n/index.js';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Global request logging & 429 retry middleware
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    const fromId = ctx.from?.id;
    const text = ctx.message?.text || ctx.callbackQuery?.data;

    logger.debug({ updateId, fromId, text }, 'Incoming Telegram update');
    const start = Date.now();
    try {
      await next();
    } catch (err: any) {
      if (err instanceof GrammyError && err.error_code === 429) {
        const retryAfter = err.parameters?.retry_after || 1;
        logger.warn({ retryAfter }, `Hit Telegram 429 rate limit. Waiting ${retryAfter}s before resuming.`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        await next();
      } else {
        throw err;
      }
    }
    const duration = Date.now() - start;
    logger.debug({ updateId, duration }, 'Update handled successfully');
  });

  // Register Official Telegram Bot Slash Commands (Admin hidden from public)
  const defaultCommands = [
    { command: 'start', description: '🚀 Start shop & welcome menu' },
    { command: 'shop', description: '🛍 Browse products catalog' },
    { command: 'orders', description: '📦 View your order history' },
    { command: 'profile', description: '👤 View registered profile & phone' },
    { command: 'language', description: '🌐 Change language (English/Amharic)' },
    { command: 'support', description: '💬 Contact customer support (@Vweah)' },
    { command: 'help', description: '❓ Store FAQs and ordering guide' },
  ];

  bot.api.setMyCommands(defaultCommands).catch((err) => {
    logger.warn({ err: err.message }, 'Failed to set public slash commands list');
  });

  // Set scoped commands including /admin ONLY for admins
  const config = getConfig();
  for (const adminId of config.ADMIN_IDS) {
    bot.api.setMyCommands(
      [
        ...defaultCommands,
        { command: 'admin', description: '⚙️ Admin control panel' },
      ],
      { scope: { type: 'chat', chat_id: adminId } }
    ).catch(() => {});
  }

  // Slash Commands
  bot.command('start', startHandler);
  bot.command('shop', async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderCatalog(ctx);
  });
  bot.command('orders', async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderMyOrders(ctx);
  });
  bot.command('profile', async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderProfile(ctx);
  });
  bot.command('language', renderLanguageMenu);
  bot.command('support', renderSupport);
  bot.command('help', renderHelp);
  bot.command('admin', renderAdminMenu);
  bot.command('health', healthHandler);
  bot.command('ping', pingHandler);

  // Persistent Reply Keyboard Button Handlers (Hears exact button labels)
  bot.hears(/🛍 Browse Shop|🛍 ሱቅ አስስ/i, async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderCatalog(ctx);
  });

  bot.hears(/📦 My Orders|📦 የእኔ ትዕዛዞች/i, async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderMyOrders(ctx);
  });

  bot.hears(/👤 My Profile|👤 የእኔ መረጃ/i, async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderProfile(ctx);
  });

  bot.hears(/🌐 Language|🌐 ቋንቋ/i, renderLanguageMenu);
  bot.hears(/💬 Support|💬 ድጋፍ/i, renderSupport);

  // Contact Sharing Handler (Native Telegram button)
  bot.on('message:contact', async (ctx) => {
    await handleContactMessage(ctx);
  });

  // Dev simulation command for Wallet Pay
  bot.command('wp_simulate', async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply('Usage: `/wp_simulate <order_id>` (e.g. `/wp_simulate ORD-123456-ABC`)', { parse_mode: 'Markdown' });
      return;
    }

    const orderId = args;
    const order = getOrderById(orderId);
    if (!order) {
      await ctx.reply(`❌ Order \`${orderId}\` not found in database.`, { parse_mode: 'Markdown' });
      return;
    }

    if (order.status !== 'awaiting_payment' && order.status !== 'pending_approval') {
      await ctx.reply(`⚠️ Order \`${orderId}\` is currently in status: *${order.status}*. Simulation only applies to awaiting payment.`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      const { order: updated, autoDeliveredItem } = approveReceipt(order.id, ctx.from?.id || 0);

      await ctx.reply(`✅ *MockWalletPay Simulation Success!*\n\n• Order \`${order.id}\` marked as **${updated.status.toUpperCase()}**.\n• Rail: \`${updated.payment_rail.toUpperCase()}\`\n• Amount: *${formatPriceETB(updated.amount_etb)}*`, { parse_mode: 'Markdown' });

      if (autoDeliveredItem) {
        const rawTemplate = getSetting(
          'gemini_instructions',
          'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
        );
        const deliveryText = `🎉 *Payment Confirmed! Order #${order.id}*\n\n` +
          `Here is your activation link:\n🔗 ${autoDeliveredItem.payload}\n\n` +
          `*Instructions:*\n${rawTemplate}\n\n` +
          `_Thank you for choosing Bighabesha Shop!_`;

        await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'Markdown' }).catch(() => {});
      } else {
        const notifyText = `🎉 *Payment Received for Order #${order.id}!*\n\n` +
          `Your order has been queued for fulfillment to **@${order.username || 'your account'}**.\n` +
          `You will receive a confirmation once delivered!`;

        await ctx.api.sendMessage(order.user_id, notifyText, { parse_mode: 'Markdown' }).catch(() => {});
      }
    } catch (err: any) {
      await ctx.reply(`❌ Error simulating payment: ${err.message}`);
    }
  });

  // Telegram Stars Handlers
  bot.on('pre_checkout_query', async (ctx) => {
    const payload = ctx.preCheckoutQuery.invoice_payload;
    logger.info({ payload }, 'Received pre_checkout_query for Stars invoice');

    if (payload.startsWith('order_')) {
      const orderId = payload.replace('order_', '');
      const order = getOrderById(orderId);
      if (order && (order.status === 'awaiting_payment' || order.status === 'new')) {
        await ctx.answerPreCheckoutQuery(true);
        return;
      }
    }

    await ctx.answerPreCheckoutQuery(false, { error_message: 'Order expired or invalid.' });
  });

  bot.on('message:successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    logger.info({ payment }, 'Received successful_payment event');

    const payload = payment.invoice_payload;
    if (payload.startsWith('order_')) {
      const orderId = payload.replace('order_', '');
      const order = getOrderById(orderId);
      if (order) {
        try {
          const { order: updated, autoDeliveredItem } = approveReceipt(order.id, 0);
          updateOrderStatus(order.id, updated.status, { payment_ref: payment.telegram_payment_charge_id });

          if (autoDeliveredItem) {
            const rawTemplate = getSetting(
              'gemini_instructions',
              'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
            );
            const deliveryText = `🎉 *Stars Payment Confirmed! Order #${order.id}*\n\n` +
              `Here is your activation link:\n🔗 ${autoDeliveredItem.payload}\n\n` +
              `*Instructions:*\n${rawTemplate}\n\n` +
              `_Thank you for choosing Bighabesha Shop!_`;

            await ctx.reply(deliveryText, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply(
              `⭐️ *Payment Received (${payment.total_amount} Stars)!*\n\n` +
                `Order #${order.id} is now queued for delivery to **@${order.username || 'your account'}**.\n` +
                `You will receive an update shortly!`,
              { parse_mode: 'Markdown' }
            );
          }
        } catch (err) {
          logger.error({ err, orderId }, 'Error handling successful Stars payment');
        }
      }
    }
  });

  // Photo & Document Handlers for Stateful Input
  bot.on('message:photo', async (ctx, next) => {
    const handled = await handlePhotoInput(ctx);
    if (!handled) {
      await next();
    }
  });

  bot.on('message:document', async (ctx, next) => {
    const handled = await handleDocumentInput(ctx);
    if (!handled) {
      await next();
    }
  });

  bot.on('message:text', async (ctx, next) => {
    const handled = await handleTextInput(ctx);
    if (!handled) {
      await next();
    }
  });

  // Callback Query Router
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});

    if (data === 'nav_home') {
      await startHandler(ctx as any);
    } else if (data === 'nav_shop') {
      await renderCatalog(ctx);
    } else if (data === 'nav_orders') {
      await renderMyOrders(ctx);
    } else if (data === 'nav_profile') {
      await renderProfile(ctx);
    } else if (data === 'nav_support') {
      await renderSupport(ctx);
    } else if (data === 'action_update_phone') {
      await promptPhoneRegistration(ctx);
    } else if (data.startsWith('order_detail_')) {
      const orderId = data.replace('order_detail_', '');
      await renderOrderDetail(ctx, orderId);
    } else if (data.startsWith('resume_pay_')) {
      const orderId = data.replace('resume_pay_', '');
      const order = getOrderById(orderId);
      if (order) {
        const product = getProductById(order.product_id);
        await renderPaymentRailSelection(ctx, order, product ? product.name : 'Subscription');
      }
    } else if (data.startsWith('cancel_order_')) {
      const orderId = data.replace('cancel_order_', '');
      updateOrderStatus(orderId, 'cancelled');
      await ctx.reply(`🚫 Order \`${orderId}\` has been cancelled.`, { parse_mode: 'Markdown' });
      await renderMyOrders(ctx);
    } else if (data === 'nav_language') {
      await renderLanguageMenu(ctx);
    } else if (data.startsWith('set_lang_')) {
      const lang = data.replace('set_lang_', '');
      await handleSetLanguage(ctx, lang);
    } else if (data.startsWith('prod_')) {
      const productId = data.replace('prod_', '');
      await renderProductDetails(ctx, productId);
    } else if (data.startsWith('gate_recheck_')) {
      await handleGateRecheck(ctx, data);
    } else if (data.startsWith('buy_var_')) {
      const variantId = data.replace('buy_var_', '');
      let productId = 'gemini_pro_18m';

      if (variantId.startsWith('tg_prem_')) {
        productId = 'telegram_premium';
      } else if (variantId.startsWith('tg_stars_')) {
        productId = 'telegram_stars';
      }

      // Check username gate for Premium and Stars
      if (isUsernameRequired(productId) && !hasPublicUsername(ctx.from)) {
        await renderUsernameGate(ctx, productId, variantId);
      } else {
        await initiateCheckout(ctx, productId, variantId);
      }
    } else if (data.startsWith('buy_custom_stars_')) {
      const parts = data.replace('buy_custom_stars_', '').split('_');
      const stars = parseInt(parts[0], 10);
      const priceETB = parseInt(parts[1], 10);

      if (!hasPublicUsername(ctx.from)) {
        await renderUsernameGate(ctx, 'telegram_stars', undefined, stars, priceETB);
      } else {
        await initiateCheckout(ctx, 'telegram_stars', undefined, stars, priceETB);
      }
    } else if (data.startsWith('checkout_back_')) {
      const orderId = data.replace('checkout_back_', '');
      const order = getOrderById(orderId);
      if (order) {
        const product = getProductById(order.product_id);
        await renderPaymentRailSelection(ctx, order, product ? product.name : 'Subscription');
      }
    } else if (data.startsWith('pay_stars_')) {
      const orderId = data.replace('pay_stars_', '');
      await handleStarsPayment(ctx, orderId);
    } else if (data.startsWith('pay_wp_')) {
      const orderId = data.replace('pay_wp_', '');
      await handleWalletPay(ctx, orderId);
    } else if (data.startsWith('pay_manual_telebirr_')) {
      const orderId = data.replace('pay_manual_telebirr_', '');
      await handleManualRail(ctx, 'telebirr', orderId);
    } else if (data.startsWith('pay_manual_cbe_')) {
      const orderId = data.replace('pay_manual_cbe_', '');
      await handleManualRail(ctx, 'cbe', orderId);
    } else if (data.startsWith('pay_manual_abyssinia_')) {
      const orderId = data.replace('pay_manual_abyssinia_', '');
      await handleManualRail(ctx, 'abyssinia', orderId);
    } else if (data.startsWith('receipt_prompt_')) {
      const orderId = data.replace('receipt_prompt_', '');
      await promptReceiptUpload(ctx, orderId);
    } else if (data.startsWith('admin_approve_')) {
      const orderId = data.replace('admin_approve_', '');
      await performAdminApprove(ctx, orderId);
    } else if (data.startsWith('admin_reject_')) {
      const orderId = data.replace('admin_reject_', '');
      await promptAdminReject(ctx, orderId);
    } else if (data === 'stars_custom') {
      await promptCustomStars(ctx);
    } else if (data === 'action_sold_out') {
      await ctx.reply('🚨 *Sold Out*: This product is currently unavailable. Please check back soon or contact support.', { parse_mode: 'Markdown' });
    } else if (data === 'admin_menu') {
      await renderAdminMenu(ctx);
    } else if (data === 'admin_orders_queue') {
      await renderAdminOrdersQueue(ctx);
    } else if (data.startsWith('admin_queue_detail_')) {
      const orderId = data.replace('admin_queue_detail_', '');
      await renderAdminQueueOrderDetail(ctx, orderId);
    } else if (data.startsWith('queue_proof_prompt_')) {
      const orderId = data.replace('queue_proof_prompt_', '');
      await promptQueueProof(ctx, orderId);
    } else if (data.startsWith('queue_fulfill_direct_')) {
      const orderId = data.replace('queue_fulfill_direct_', '');
      await executeDirectFulfill(ctx, orderId);
    } else if (data.startsWith('queue_refund_prompt_')) {
      const orderId = data.replace('queue_refund_prompt_', '');
      await promptQueueRefund(ctx, orderId);
    } else if (data === 'admin_broadcast') {
      await renderBroadcastTargetSelection(ctx);
    } else if (data.startsWith('broadcast_select_')) {
      const targetLang = data.replace('broadcast_select_', '');
      await promptBroadcastContent(ctx, targetLang);
    } else if (data === 'broadcast_confirm_send') {
      await executeConfirmedBroadcast(ctx);
    } else if (data === 'admin_products') {
      await renderAdminProducts(ctx);
    } else if (data.startsWith('admin_edit_var_')) {
      const variantId = data.replace('admin_edit_var_', '');
      await promptEditVariantPrice(ctx, variantId);
    } else if (data === 'admin_stock') {
      await renderAdminStock(ctx);
    } else if (data.startsWith('admin_stock_paste_') || data.startsWith('admin_stock_add_')) {
      const productId = data.replace('admin_stock_paste_', '').replace('admin_stock_add_', '');
      await promptStockPaste(ctx, productId);
    } else if (data.startsWith('admin_stock_csv_')) {
      const productId = data.replace('admin_stock_csv_', '');
      await promptStockCSV(ctx, productId);
    } else if (data === 'admin_rates') {
      await renderAdminRates(ctx);
    } else if (data === 'admin_settings') {
      await renderAdminSettings(ctx);
    } else if (data.startsWith('admin_edit_setting_')) {
      const settingKey = data.replace('admin_edit_setting_', '');
      await promptEditSetting(ctx, settingKey);
    } else if (data.startsWith('admin_prod_')) {
      const productId = data.replace('admin_prod_', '');
      await renderProductDetails(ctx, productId);
    }
  });

  // Global error boundary
  bot.catch((err: BotError) => {
    const ctx = err.ctx;
    logger.error(
      {
        err: err.error,
        updateId: ctx.update.update_id,
        userId: ctx.from?.id,
      },
      'Error occurred while handling update'
    );
  });

  return bot;
}
