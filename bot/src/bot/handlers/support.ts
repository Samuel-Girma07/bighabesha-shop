import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';

export async function renderSupport(ctx: Context): Promise<void> {
  const config = getConfig();
  const supportHandle = config.SUPPORT_USERNAME || 'Vweah';

  const text = '💬 *Bighabesha Shop — Customer Support & Help*\n\n' +
    `Have questions about your order, activation links, or need assistance with bank transfers?\n\n` +
    `• *Official Support:* @${supportHandle}\n` +
    `• *Response Time:* Usually within 5–15 minutes\n` +
    `• *Available Rails:* Telebirr, CBE, Bank of Abyssinia, Telegram Stars & TON/USDT\n\n` +
    `_Tap the button below to start a direct chat with our support team:_`;

  const keyboard = new InlineKeyboard()
    .url('💬 Chat with Support (@Vweah)', `https://t.me/${supportHandle}`)
    .row()
    .text('🛍 Browse Shop', 'nav_shop')
    .text('📦 My Orders', 'nav_orders');

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
  const text = '❓ *Bighabesha Shop — Guide & Help Center*\n\n' +
    '*How to Order:*\n' +
    '1. Tap **🛍 Browse Shop** or use `/shop`.\n' +
    '2. Select your desired product:\n' +
    '   • *Gemini Pro (18 Months):* Instant link delivered directly in-chat.\n' +
    '   • *Telegram Premium (3/6/12m):* Gifted to your `@username` via Fragment.\n' +
    '   • *Telegram Stars:* Sent to your `@username` (packages or custom amounts).\n' +
    '3. Choose your payment method (Telebirr, CBE, Abyssinia, Stars, or Crypto).\n' +
    '4. For bank transfers, upload your receipt screenshot in chat.\n\n' +
    '*Commands List:*\n' +
    '• `/shop` — Browse products\n' +
    '• `/orders` — View your orders & activation links\n' +
    '• `/profile` — View registered phone number & details\n' +
    '• `/language` — Change language preference\n' +
    '• `/support` — Contact support\n' +
    '• `/help` — View this guide';

  const keyboard = new InlineKeyboard()
    .text('🛍 Start Shopping', 'nav_shop')
    .text('💬 Contact Support', 'nav_support');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}
