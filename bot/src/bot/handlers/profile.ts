import { Context, InlineKeyboard } from 'grammy';
import { getUserById } from '../../services/users.service.js';
import { getOrdersByUserId } from '../../services/orders.service.js';

export async function renderProfile(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = getUserById(userId);
  const orders = getOrdersByUserId(userId);

  const phoneDisplay = user?.phone_number ? `\`${user.phone_number}\` (Verified)` : '_Not registered_';
  const usernameDisplay = ctx.from?.username ? `@${ctx.from.username}` : '_No public username_';

  const text = '*Account Profile*\n\n' +
    `• Name: ${ctx.from?.first_name || 'User'}\n` +
    `• Username: ${usernameDisplay}\n` +
    `• User ID: \`${userId}\`\n` +
    `• Phone: ${phoneDisplay}\n` +
    `• Total Orders: ${orders.length}\n` +
    `• Language: ${user?.language_code === 'am' ? 'አማርኛ' : 'English'}\n\n` +
    `_Your account details are securely linked to your orders._`;

  const keyboard = new InlineKeyboard()
    .text('Update Phone Number', 'action_update_phone')
    .row()
    .text('View Orders', 'nav_orders')
    .text('Change Language', 'nav_language');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}
