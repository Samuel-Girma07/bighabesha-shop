import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';

export async function renderSupport(ctx: Context): Promise<void> {
  const config = getConfig();
  const supportHandle = config.SUPPORT_USERNAME || 'Vweah';

  const text = '*Bighabesha Shop — Customer Support*\n\n' +
    `Need assistance with an activation link, payment confirmation, or custom star order?\n\n` +
    `• Support Agent: @${supportHandle}\n` +
    `• Available Rails: Telebirr, CBE, Bank of Abyssinia, Telegram Stars & TON/USDT\n\n` +
    `_Tap below to open a direct chat with support:_`;

  const keyboard = new InlineKeyboard()
    .url(`Chat with Support (@${supportHandle})`, `https://t.me/${supportHandle}`)
    .row()
    .text('Browse Shop', 'nav_shop')
    .text('My Orders', 'nav_orders');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

export async function renderHelp(ctx: Context): Promise<void> {
  const text = '*Bighabesha Shop — Help & Ordering Guide*\n\n' +
    '*Product Summary:*\n' +
    '• *Gemini Pro (18 Months):* Single-use activation link delivered in-chat.\n' +
    '• *Telegram Premium (3/6/12m):* Direct gift to your @username via Fragment.\n' +
    '• *Telegram Stars:* Sent to your @username in packages or custom quantities.\n\n' +
    '*How to Order:*\n' +
    '1. Use `/shop` or tap **[Browse Shop]**.\n' +
    '2. Select your plan or star amount.\n' +
    '3. Choose your payment method and complete transfer.\n' +
    '4. Attach your receipt photo for automated verification.\n\n' +
    '*Commands:*\n' +
    '• `/shop` — Products catalog\n' +
    '• `/orders` — Order history & links\n' +
    '• `/profile` — Account profile\n' +
    '• `/language` — Language switch\n' +
    '• `/support` — Customer support';

  const keyboard = new InlineKeyboard()
    .text('Browse Shop', 'nav_shop')
    .text('Contact Support', 'nav_support');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}
