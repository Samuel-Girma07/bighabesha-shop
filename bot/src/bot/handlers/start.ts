import { Context, InlineKeyboard, InputFile } from 'grammy';
import { t } from '../../i18n/index.js';
import { getConfig } from '../../config/env.js';
import { isAdmin } from './admin.js';
import { upsertUser as dbUpsertUser, isUserRegistered } from '../../services/users.service.js';
import { promptPhoneRegistration } from './registration.js';
import { getMainMenuKeyboard } from '../keyboards/menu.js';
import { getBannerPngPath } from '../../services/banner_generator.service.js';
import { logger } from '../../logger/index.js';

export function upsertUser(user: {
  id: number;
  username?: string | null;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}): { id: number; username: string | null; language_code: string; is_admin: boolean } {
  dbUpsertUser(user);
  const is_admin = isAdmin(user.id);
  return {
    id: user.id,
    username: user.username || null,
    language_code: user.language_code || 'en',
    is_admin,
  };
}

export async function startHandler(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const payload = String(ctx.match || '').trim();

  const user = upsertUser({
    id: from.id,
    username: from.username || null,
    first_name: from.first_name || 'User',
    language_code: from.language_code?.startsWith('am') ? 'am' : 'en',
  });

  if (!isUserRegistered(from.id)) {
    await promptPhoneRegistration(ctx);
    return;
  }

  const language_code = user.language_code || 'en';
  const config = getConfig();

  // Referral attribution: /start ref_<CODE>. Runs AFTER the user row exists;
  // only brand-new buyers (no purchases, no prior referrer) can be attributed.
  if (payload.startsWith('ref_')) {
    try {
      const { attributeReferral } = await import('../../services/referral.service.js');
      attributeReferral(from.id, payload);
    } catch (err) {
      logger.warn({ err }, 'Referral attribution failed');
    }
  }

  // No ephemeral fallback URLs: if WEBAPP_URL is not configured, we simply
  // omit the WebApp menu button instead of pointing users at a dead tunnel.
  const webAppUrl = config.WEBAPP_URL;

  const welcomeHtml =
    `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
    `<blockquote>💎 <b>Ethiopia's Premier Digital Goods & AI Subscriptions</b></blockquote>\n\n` +
    `⚡ <b>Featured Products & Instant Activation:</b>\n` +
    `• 🤖 <b>Gemini Pro (18 Months)</b> — <code>2 TB Storage</code> · One-Click Link\n` +
    `• ⭐ <b>Telegram Premium</b> — <code>3, 6, 12 Months</code> · Direct Gift\n\n` +
    `<blockquote>💳 <b>Accepted Payment Rails:</b>\n` +
    `Telebirr · CBE Birr · Bank of Abyssinia · TON / USDT</blockquote>\n\n` +
    `<i>👇 Choose an option below or open the Web App to get started:</i>`;

  const keyboard = new InlineKeyboard();

  if (webAppUrl) {
    keyboard.webApp('🚀 Open Web App Store', webAppUrl).row();
    try {
      void ctx.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: '🛍️ Open Shop',
          web_app: { url: webAppUrl },
        },
      });
    } catch {
      // Non-critical: menu button update fails gracefully if chat is restricted
    }
  }

  keyboard
    .text(`🛍️ ${t(language_code, 'menu.shop')}`, 'nav_shop')
    .text(`📦 ${t(language_code, 'menu.orders')}`, 'nav_orders')
    .row()
    .text('👤 My Profile', 'nav_profile')
    .text(`🌐 ${t(language_code, 'menu.language')}`, 'nav_language')
    .row()
    .text(`💬 ${t(language_code, 'menu.support')}`, 'nav_support');

  if (isAdmin(from.id)) {
    keyboard.row().text('⚡ Admin Panel', 'admin_menu');
  }

  if (ctx.callbackQuery) {
    try {
      if (ctx.callbackQuery.message?.photo) {
        await ctx.editMessageCaption({
          caption: welcomeHtml,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } else {
        await ctx.editMessageText(welcomeHtml, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      }
    } catch {
      await ctx.reply(welcomeHtml, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }
  } else {
    try {
      const bannerPath = getBannerPngPath('welcome');
      await ctx.replyWithPhoto(new InputFile(bannerPath), {
        caption: welcomeHtml,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      logger.warn({ err }, 'Could not send welcome banner photo, falling back to text');
      await ctx.reply(welcomeHtml, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }

    // Also send the persistent keyboard
    await ctx.reply('Use the quick menu below at any time:', {
      reply_markup: getMainMenuKeyboard(),
    });
  }
}
