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
  const webAppUrl = config.WEBAPP_URL || 'https://capabilities-aims-modular-reward.trycloudflare.com';

  const welcomeHtml = `<b>Bighabesha Shop — Official Digital Store</b>\n\n` +
    `• <b>Gemini Pro (18 Months)</b> — Instant link delivery with 2TB storage\n` +
    `• <b>Telegram Premium</b> — 3, 6, 12-month Fragment gifts\n` +
    `• <b>Telegram Stars</b> — Packages & custom coin quantities\n\n` +
    `<i>Instant automated verification via Telebirr, CBE, Abyssinia, Stars & Crypto.</i>`;

  const keyboard = new InlineKeyboard()
    .webApp('Open Web App Store', webAppUrl)
    .row()
    .text(t(language_code, 'menu.shop'), 'nav_shop')
    .text(t(language_code, 'menu.orders'), 'nav_orders')
    .row()
    .text('My Profile', 'nav_profile')
    .text(t(language_code, 'menu.language'), 'nav_language')
    .row()
    .text('Contact Support', 'nav_support');

  if (isAdmin(from.id)) {
    keyboard.row().text('Admin Panel', 'admin_menu');
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
