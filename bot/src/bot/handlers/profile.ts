import { Context, InlineKeyboard } from 'grammy';
import { getUserById } from '../../services/users.service.js';
import { getOrdersByUserId } from '../../services/orders.service.js';
import { getMainMenuKeyboard } from '../keyboards/menu.js';

export async function renderProfile(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = getUserById(userId);
  const orders = getOrdersByUserId(userId);

  const phoneDisplay = user?.phone_number ? `\`${user.phone_number}\` ✅` : '⚠️ _Not registered_';
  const usernameDisplay = ctx.from?.username ? `@${ctx.from.username}` : '_No public username_';

  const text = '👤 *My Account Profile*\n\n' +
    `• *Name:* ${ctx.from?.first_name || 'User'}\n` +
    `• *Username:* ${usernameDisplay}\n` +
    `• *Telegram ID:* \`${userId}\`\n` +
    `• *Verified Phone:* ${phoneDisplay}\n` +
    `• *Total Orders Placed:* ${orders.length}\n` +
    `• *Language:* ${user?.language_code === 'am' ? '🇪🇹 አማርኛ' : '🇬🇧 English'}\n\n` +
    `_Your phone number is safely linked to your digital orders and subscriptions._`;

  const keyboard = new InlineKeyboard()
    .text('📱 Update Phone Number', 'action_update_phone')
    .row()
    .text('📦 View My Orders', 'nav_orders')
    .text('🌐 Change Language', 'nav_language');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}
