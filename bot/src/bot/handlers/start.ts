import { Context, InlineKeyboard } from 'grammy';
import { t } from '../../i18n/index.js';
import { getConfig } from '../../config/env.js';
import { isAdmin } from './admin.js';
import { upsertUser as dbUpsertUser, isUserRegistered, getUserById } from '../../services/users.service.js';
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
  const config = getConfig();
  const db = (getUserById as any);
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

  // If user is not yet registered with a phone number, prompt registration gate
  if (!isUserRegistered(from.id)) {
    await promptPhoneRegistration(ctx);
    return;
  }

  const language_code = user.language_code || 'en';
  const config = getConfig();
  const title = t(language_code, 'shop.title');
  const description = t(language_code, 'shop.description');

  const welcomeText = `👋 *Welcome to ${title}!* 🇪🇹\n\n` +
    `${description}\n\n` +
    `• 🤖 *Gemini Pro (18 Months):* Instant activation link with 2TB cloud storage.\n` +
    `• ⭐️ *Telegram Premium (3/6/12m):* Direct activation to your @username via Fragment.\n` +
    `• 🪙 *Telegram Stars:* Official coins for gifts, mini-apps & bots.\n\n` +
    `_Select an option below to browse products or manage your orders:_`;

  const keyboard = new InlineKeyboard()
    .text(t(language_code, 'menu.shop'), 'nav_shop')
    .text(t(language_code, 'menu.orders'), 'nav_orders')
    .row()
    .text('👤 My Profile', 'nav_profile')
    .text(t(language_code, 'menu.language'), 'nav_language')
    .row()
    .text('💬 Support (@Vweah)', 'nav_support');

  if (isAdmin(from.id)) {
    keyboard.row().text('⚙️ Admin Dashboard', 'admin_menu');
  }

  // Ensure persistent reply keyboard is attached
  await ctx.reply(welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(),
  });

  // Also send inline navigation card if needed
  if (ctx.callbackQuery) {
    await ctx.editMessageText(welcomeText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}
