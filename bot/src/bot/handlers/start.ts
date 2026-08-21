import { Context, InlineKeyboard } from 'grammy';
import { t } from '../../i18n/index.js';
import { getConfig } from '../../config/env.js';
import { isAdmin } from './admin.js';
import { upsertUser as dbUpsertUser, isUserRegistered } from '../../services/users.service.js';
import { promptPhoneRegistration } from './registration.js';
import { getMainMenuKeyboard } from '../keyboards/menu.js';

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

  const welcomeText = `*Welcome to Bighabesha Shop*\n\n` +
    `Official digital store for Gemini Pro, Telegram Premium, and Telegram Stars.\n\n` +
    `• *Gemini Pro (18 Months)* — Automated link delivery with 2TB storage\n` +
    `• *Telegram Premium* — 3, 6, 12-month Fragment gifts\n` +
    `• *Telegram Stars* — Packages & custom coin quantities\n\n` +
    `Select an option below:`;

  const keyboard = new InlineKeyboard()
    .webApp('Open Web Shop', webAppUrl)
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

  await ctx.reply(welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(),
  });

  if (ctx.callbackQuery) {
    await ctx.editMessageText(welcomeText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}
