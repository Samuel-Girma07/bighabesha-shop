import { Bot, BotError } from 'grammy';
import { logger } from '../logger/index.js';
import { startHandler } from './handlers/start.js';
import { healthHandler, pingHandler } from './handlers/health.js';
import { renderCatalog, renderProductDetails, promptCustomStars } from './handlers/shop.js';
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
import { handleTextInput, handleDocumentInput } from './handlers/input.js';
import { t } from '../i18n/index.js';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Global request logging middleware
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    const fromId = ctx.from?.id;
    const text = ctx.message?.text || ctx.callbackQuery?.data;

    logger.debug({ updateId, fromId, text }, 'Incoming Telegram update');
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    logger.debug({ updateId, duration }, 'Update handled successfully');
  });

  // Commands
  bot.command('start', startHandler);
  bot.command('admin', renderAdminMenu);
  bot.command('health', healthHandler);
  bot.command('ping', pingHandler);

  // Message & Document Handlers for Stateful Input
  bot.on('message:text', async (ctx, next) => {
    const handled = await handleTextInput(ctx);
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

  // Callback Query Router
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery().catch(() => {});

    if (data === 'nav_home') {
      await startHandler(ctx as any);
    } else if (data === 'nav_shop') {
      await renderCatalog(ctx);
    } else if (data === 'nav_orders') {
      await ctx.reply('📦 *My Orders*\n\nYou have no active or previous orders yet. Browse our catalog to place your first order!', { parse_mode: 'Markdown' });
    } else if (data === 'nav_language') {
      await ctx.reply(t('en', 'language.current'), { parse_mode: 'Markdown' });
    } else if (data.startsWith('prod_')) {
      const productId = data.replace('prod_', '');
      await renderProductDetails(ctx, productId);
    } else if (data === 'stars_custom') {
      await promptCustomStars(ctx);
    } else if (data === 'action_sold_out') {
      await ctx.reply('🚨 *Sold Out*: This product is currently unavailable. Please check back soon or contact support.', { parse_mode: 'Markdown' });
    } else if (data === 'admin_menu') {
      await renderAdminMenu(ctx);
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
