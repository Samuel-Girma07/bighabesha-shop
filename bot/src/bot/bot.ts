import { Bot, BotError, GrammyError } from 'grammy';
import { logger } from '../logger/index.js';
import { startHandler } from './handlers/start.js';
import { healthHandler, pingHandler } from './handlers/health.js';
import { renderCatalog, renderProductDetails } from './handlers/shop.js';
import { promptPhoneRegistration, handleContactMessage } from './handlers/registration.js';
import { handleOnboardingLanguage, handleOnboardingChannelCheck } from './handlers/onboarding.js';
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
  renderResellerBalance,
  isAdmin,
} from './handlers/admin.js';
import {
  renderAdminOrdersQueue,
  renderAdminQueueOrderDetail,
  promptQueueProof,
  executeDirectFulfill,
  promptQueueRefund,
  handleAdminQueueResellerDeliver,
} from './handlers/admin_queue.js';
import {
  renderBroadcastTargetSelection,
  promptBroadcastContent,
  executeConfirmedBroadcast,
} from './handlers/broadcast.js';
import {
  initiateCheckout,
  handleManualRail,
  promptReceiptUpload,
  performAdminApprove,
  promptAdminReject,
  handleRetryDelivery,
  renderPaymentRailSelection,
} from './handlers/checkout.js';
import { isUsernameRequired, hasPublicUsername, renderUsernameGate, handleGateRecheck, renderRecipientSelection, handleRecipientSelf, handleRecipientGift } from './handlers/gate.js';
import { renderMyOrders, renderOrderDetail, renderLanguageMenu, handleSetLanguage } from './handlers/orders.js';
import { inlineQueryHandler } from './handlers/inline_query.js';
import { handleTextInput, handleDocumentInput, handlePhotoInput } from './handlers/input.js';
import { getOrderById, approveReceipt, updateOrderStatus } from '../services/orders.service.js';
import { findThreadByTopic, insertSupportMessage, SUPPORT_MAX_MESSAGE_LENGTH } from '../services/support.service.js';
import { setPendingAction } from './session.js';
import { getProductById, formatPriceETB } from '../services/catalog.service.js';
import { getSetting } from '../services/settings.service.js';
import { isUserRegistered } from '../services/users.service.js';
import { getConfig } from '../config/env.js';
import { escapeHtml } from '../utils/html.js';
import { previewUserText } from '../logger/index.js';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // In test environment, short-circuit API calls with mock responses to prevent slow outbound network requests
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test' || token.startsWith('123456')) {
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'createInvoiceLink') {
        return `https://t.me/$invoice_${Date.now()}` as any;
      }
      if (method === 'sendMessage' || method === 'sendPhoto' || method === 'editMessageCaption') {
        return {
          message_id: Math.floor(Math.random() * 100000) + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: (payload as any)?.chat_id ?? 1, type: 'private' },
        } as any;
      }
      if (method === 'getChat') {
        return {
          id: (payload as any)?.chat_id ?? 1,
          type: 'private',
          username: 'testhabesha',
          first_name: 'Tester',
        } as any;
      }
      if (method === 'createForumTopic') {
        return { message_thread_id: 101, name: (payload as any)?.name ?? 'Support' } as any;
      }
      if (method === 'setChatMenuButton' || method === 'answerInlineQuery' || method === 'deleteMessage') {
        return true as any;
      }
      try {
        return await prev(method, payload, signal);
      } catch {
        return true as any;
      }
    });
  }

  // API rate limit 429 retry transformer
  bot.api.config.use(async (prev, method, payload, signal) => {
    try {
      return await prev(method, payload, signal);
    } catch (err: any) {
      if (err instanceof GrammyError && err.error_code === 429) {
        const retryAfter = err.parameters?.retry_after || 1;
        logger.warn({ retryAfter, method }, `Hit Telegram API 429 rate limit. Waiting ${retryAfter}s before retrying.`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return await prev(method, payload, signal);
      }
      throw err;
    }
  });

  // Global request logging middleware
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    const fromId = ctx.from?.id;
    const text = ctx.message?.text || ctx.callbackQuery?.data;

    logger.debug(
      {
        updateId,
        fromId,
        // Privacy: never log raw user message content — preview only.
        text: previewUserText(text),
      },
      'Incoming Telegram update'
    );
    const start = Date.now();
    try {
      await next();
    } finally {
      const duration = Date.now() - start;
      logger.debug({ updateId, duration }, 'Update handled');
    }
  });

  // In-app support bridge: admin replies inside forum topics are routed
  // back to the buyer's Mini App chat. Registered before stateful input
  // handlers; non-matching messages pass through untouched.
  const supportGroupId = getConfig().SUPPORT_GROUP_ID;
  if (supportGroupId) {
    bot.on('message', async (ctx, next) => {
      const msg = ctx.message;
      if (!msg || ctx.chat?.id !== supportGroupId || !msg.is_topic_message) return next();
      const thread = findThreadByTopic(msg.message_thread_id as number);
      if (!thread) return next();
      const body = msg.text ?? msg.caption;
      if (!body) return next();

      insertSupportMessage(thread.id, 'admin', body.slice(0, SUPPORT_MAX_MESSAGE_LENGTH), msg.message_id);
      await ctx.api.sendMessage(
        thread.user_id,
        `💬 <b>Support:</b>\n\n${escapeHtml(body.slice(0, SUPPORT_MAX_MESSAGE_LENGTH))}`,
        { parse_mode: 'HTML' }
      ).catch((err) => logger.error({ err }, 'Failed relaying support reply to user'));
      // Consumed: do not run further handlers for topic replies.
    });
  }

  // Register Official Telegram Bot Slash Commands (Admin hidden from public)
  const defaultCommands = [
    { command: 'start', description: 'Start shop and welcome menu' },
    { command: 'shop', description: 'Browse products catalog' },
    { command: 'orders', description: 'View order history' },
    { command: 'profile', description: 'View profile and registered phone' },
    { command: 'language', description: 'Change language (English / Amharic)' },
    { command: 'support', description: 'Contact customer support' },
    { command: 'help', description: 'Store guide and FAQs' },
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
        { command: 'admin', description: 'Admin control panel' },
      ],
      { scope: { type: 'chat', chat_id: adminId } }
    ).catch(() => {});
  }

  // Configure Telegram Menu Button to open Web App directly
  if (config.WEBAPP_URL) {
    bot.api.setChatMenuButton({
      menu_button: {
        type: 'web_app',
        text: 'Store',
        web_app: {
          url: config.WEBAPP_URL,
        },
      },
    }).catch((err) => {
      logger.warn({ err: err.message }, 'Failed to set Telegram chat menu button');
    });
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
  bot.hears(/Main Menu|Home|ዋና ማውጫ/i, async (ctx) => {
    await startHandler(ctx);
  });

  bot.hears(/My Account|My Profile|Profile|መረጃ/i, async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderProfile(ctx);
  });

  bot.hears(/Browse Shop|Shop|ሱቅ/i, async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderCatalog(ctx);
  });

  bot.hears(/My Orders|Orders|ትዕዛዞች/i, async (ctx) => {
    if (ctx.from && !isUserRegistered(ctx.from.id)) {
      await promptPhoneRegistration(ctx);
      return;
    }
    await renderMyOrders(ctx);
  });

  bot.hears(/Language|ቋንቋ/i, renderLanguageMenu);
  bot.hears(/Support|ድጋፍ/i, renderSupport);

  // Contact Sharing Handler (Native Telegram button)
  bot.on('message:contact', async (ctx) => {
    await handleContactMessage(ctx);
  });

  // Telegram Inline Mode Query Handler (@Bighabesha_shopBot)
  bot.on('inline_query', inlineQueryHandler);

  // Dev simulation command for Wallet Pay (ADMIN-ONLY, MOCK-MODE ONLY)
  bot.command('wp_simulate', async (ctx) => {
    const config = getConfig();

    // Silent no-op for non-admins (do not reveal the command exists).
    if (!isAdmin(ctx.from?.id)) {
      return;
    }

    // Hard-disabled in live mode regardless of caller.
    if (config.WALLET_PAY_MODE === 'live') {
      logger.warn({ adminId: ctx.from?.id }, 'Blocked /wp_simulate attempt while WALLET_PAY_MODE=live');
      await ctx.reply('⚠️ <b>/wp_simulate is disabled</b> while the system runs with live Wallet Pay.', { parse_mode: 'HTML' });
      return;
    }

    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply('Usage: <code>/wp_simulate &lt;order_id&gt;</code> (e.g. <code>/wp_simulate ORD-123456-ABC</code>)', { parse_mode: 'HTML' });
      return;
    }

    const orderId = args;
    const order = getOrderById(orderId);
    if (!order) {
      await ctx.reply(`❌ Order <code>${escapeHtml(orderId)}</code> not found in database.`, { parse_mode: 'HTML' });
      return;
    }

    if (order.status !== 'awaiting_payment' && order.status !== 'pending_approval') {
      await ctx.reply(`⚠️ Order <code>${escapeHtml(orderId)}</code> is currently in status: <b>${escapeHtml(order.status)}</b>. Simulation only applies to awaiting payment.`, { parse_mode: 'HTML' });
      return;
    }

    try {
      const { order: updated, autoDeliveredItem } = approveReceipt(order.id, ctx.from?.id || 0);

      await ctx.reply(`✅ <b>MockWalletPay Simulation Success!</b>\n\n• Order <code>${order.id}</code> marked as <b>${updated.status.toUpperCase()}</b>.\n• Rail: <code>${updated.payment_rail.toUpperCase()}</code>\n• Amount: <b>${formatPriceETB(updated.amount_etb)}</b>`, { parse_mode: 'HTML' });

      if (autoDeliveredItem) {
        const rawTemplate = getSetting(
          'gemini_instructions',
          'After payment, you will receive a one-time activation link.\n\n1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
        );
        const deliveryText = `🎉 <b>Payment Confirmed! Order #${order.id}</b>\n\n` +
          `Here is your activation link:\n🔗 <code>${autoDeliveredItem.payload}</code>\n\n` +
          `<b>Instructions:</b>\n${rawTemplate}\n\n` +
          `<i>Thank you for choosing Bighabesha Shop!</i>`;

        await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch(() => {});
      } else {
        const notifyText = `🎉 <b>Payment Received for Order #${order.id}!</b>\n\n` +
          `Your order has been queued for fulfillment to <b>@${escapeHtml(order.username || 'your account')}</b>.\n` +
          `You will receive a confirmation once delivered!`;

        await ctx.api.sendMessage(order.user_id, notifyText, { parse_mode: 'HTML' }).catch(() => {});
      }
    } catch (err: any) {
      await ctx.reply(`❌ Error simulating payment: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
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
    const userId = ctx.from?.id;
    await ctx.answerCallbackQuery().catch(() => {});

    // Enforce phone registration on purchase & catalog interactions
    const isPurchaseAction =
      data.startsWith('prod_') ||
      data.startsWith('buy_var_') ||
      data.startsWith('pay_');

    if (isPurchaseAction && userId && !isUserRegistered(userId)) {
      await promptPhoneRegistration(ctx);
      return;
    }

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
      const order = getOrderById(orderId);

      // Ownership check: users may only cancel their own orders (IDOR guard).
      if (!order || order.user_id !== userId) {
        await ctx.reply('Order not found.');
      } else if (['fulfilled', 'refunded', 'rejected', 'cancelled'].includes(order.status)) {
        await ctx.reply(`⚠️ Order <code>${escapeHtml(orderId)}</code> is already <b>${escapeHtml(order.status)}</b> and cannot be cancelled.`, { parse_mode: 'HTML' });
      } else {
        updateOrderStatus(orderId, 'cancelled');
        await ctx.reply(`🚫 Order <code>${escapeHtml(orderId)}</code> has been cancelled.`, { parse_mode: 'HTML' });
        await renderMyOrders(ctx);
      }
    } else if (data === 'onboard_lang_en') {
      await handleOnboardingLanguage(ctx, 'en');
    } else if (data === 'onboard_lang_am') {
      await handleOnboardingLanguage(ctx, 'am');
    } else if (data === 'onboard_check_channel') {
      await handleOnboardingChannelCheck(ctx);
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
    } else if (data.startsWith('recipient_self_')) {
      await handleRecipientSelf(ctx, data);
    } else if (data.startsWith('recipient_gift_')) {
      await handleRecipientGift(ctx, data);
    } else if (data.startsWith('buy_var_')) {
      const variantId = data.replace('buy_var_', '');
      let productId = 'gemini_pro_18m';

      if (variantId.startsWith('tg_prem_')) {
        productId = 'telegram_premium';
      }

      // Check username gate for Premium
      if (isUsernameRequired(productId) && !hasPublicUsername(ctx.from)) {
        await renderUsernameGate(ctx, productId, variantId);
      } else if (isUsernameRequired(productId)) {
        // Username present — let the buyer pick self vs. gift recipient.
        await renderRecipientSelection(ctx, productId, variantId);
      } else {
        await initiateCheckout(ctx, productId, variantId);
      }
    } else if (data.startsWith('checkout_back_')) {
      const orderId = data.replace('checkout_back_', '');
      const order = getOrderById(orderId);
      if (order) {
        const product = getProductById(order.product_id);
        await renderPaymentRailSelection(ctx, order, product ? product.name : 'Subscription');
      }
    } else if (
      data.startsWith('rail_chapa') ||
      data.startsWith('pay_chapa_') ||
      data.startsWith('rail_wallet_pay') ||
      data.startsWith('pay_wp_') ||
      data.startsWith('rail_ton_connect') ||
      data.startsWith('pay_ton_')
    ) {
      await ctx.answerCallbackQuery({
        text: 'This payment method has been discontinued. Please choose Telebirr, CBE Bank, or Bank of Abyssinia.',
        show_alert: true,
      });
      const orderId = data.split('_').pop();
      if (orderId && orderId.startsWith('ORD-')) {
        const order = getOrderById(orderId);
        if (order) {
          const product = getProductById(order.product_id);
          await renderPaymentRailSelection(ctx, order, product ? product.name : 'Subscription');
        }
      }
    } else if (data.startsWith('promo_prompt_')) {
      const orderId = data.replace('promo_prompt_', '');
      const userId = ctx.from?.id;
      if (userId) {
        setPendingAction(userId, { type: 'promo_entry', data: { orderId } });
        await ctx.reply(
          `🏷 <b>Enter Promo Code</b>\n\nSend the code for order <code>${escapeHtml(orderId)}</code> in your next message.\n<i>Example: WELCOME10</i>`,
          { parse_mode: 'HTML' }
        );
      }
    } else if (data.startsWith('sms_verify_')) {
      const orderId = data.replace('sms_verify_', '');
      const userId = ctx.from?.id;
      if (userId) {
        setPendingAction(userId, { type: 'user_sms_forward', data: { orderId } });
        await ctx.reply(
          `📱 <b>CBE SMS Verification</b>\n\nForward the CBE debit SMS for order <code>${escapeHtml(orderId)}</code> in your next message.\n\n` +
          `<i>We match the amount automatically — an administrator still verifies every payment.</i>`,
          { parse_mode: 'HTML' }
        );
      }
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
    } else if (data.startsWith('admin_retry_delivery_')) {
      const orderId = data.replace('admin_retry_delivery_', '');
      await handleRetryDelivery(ctx, orderId);
    } else if (data.startsWith('admin_refund_')) {
      const orderId = data.replace('admin_refund_', '');
      await promptQueueRefund(ctx, orderId);
    } else if (data === 'action_sold_out') {
      await ctx.reply('🚨 <b>Sold Out</b>: This product is currently unavailable. Please check back soon or contact support.', { parse_mode: 'HTML' });
    } else if (data === 'admin_menu') {
      await renderAdminMenu(ctx);
    } else if (data === 'admin_orders_queue') {
      await renderAdminOrdersQueue(ctx);
    } else if (data.startsWith('admin_queue_detail_')) {
      const orderId = data.replace('admin_queue_detail_', '');
      await renderAdminQueueOrderDetail(ctx, orderId);
    } else if (data.startsWith('admin_queue_reseller_deliver_')) {
      const orderId = data.replace('admin_queue_reseller_deliver_', '');
      await handleAdminQueueResellerDeliver(ctx, orderId);
    } else if (data.startsWith('admin_reseller_deliver_')) {
      const orderId = data.replace('admin_reseller_deliver_', '');
      await handleAdminQueueResellerDeliver(ctx, orderId);
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
    } else if (data === 'admin_reseller_balance') {
      await renderResellerBalance(ctx);
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
