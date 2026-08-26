import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';
import { escapeHtml } from '../../utils/html.js';

export async function renderSupport(ctx: Context): Promise<void> {
  const config = getConfig();
  const supportHandle = config.SUPPORT_USERNAME || 'Vweah';

  const text =
    '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
    '💬 <b>Official Customer Support Desk</b>\n\n' +
    '<blockquote>Need assistance with activation links, bank receipt verification, or custom requests?</blockquote>\n\n' +
    `• 👨‍💻 <b>Support Desk:</b> @${escapeHtml(supportHandle)}\n` +
    `• 💳 <b>Supported Rails:</b> Telebirr, CBE, Abyssinia, Telegram Stars & TON\n` +
    `• ⏰ <b>Operating Hours:</b> 24/7 Automated Dispatch & Live Agent Review\n\n` +
    `<i>👇 Tap below to start a direct message with an agent or return to the shop:</i>`;

  const keyboard = new InlineKeyboard()
    .url(`💬 Chat with Support (@${supportHandle})`, `https://t.me/${supportHandle}`)
    .row()
    .text('🛍️ Browse Shop', 'nav_shop')
    .text('📦 My Orders', 'nav_orders')
    .row()
    .text('« Main Menu', 'nav_home');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
}

export async function renderHelp(ctx: Context): Promise<void> {
  const text =
    '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
    '📖 <b>Help & Ordering Guide</b>\n\n' +
    '<blockquote>Everything you need to know about purchasing digital goods on Bighabesha Shop.</blockquote>\n\n' +
    '🛍️ <b>Product Catalog:</b>\n' +
    '• 🤖 <b>Gemini Pro (18 Months):</b> Instant single-use activation link with 2TB storage\n' +
    '• ⭐ <b>Telegram Premium (3/6/12m):</b> Direct Fragment gift to @username\n' +
    '• 🪙 <b>Telegram Stars:</b> Direct account top-up in preset packs or custom amounts\n\n' +
    '⚡ <b>Quick Ordering Steps:</b>\n' +
    '1. Tap <b>[Browse Shop]</b> or type <code>/shop</code>\n' +
    '2. Select your desired product and subscription duration\n' +
    '3. Choose your payment method (Telebirr, CBE, Abyssinia, Stars, TON)\n' +
    '4. Complete the transfer and upload your receipt screenshot\n\n' +
    '⌨️ <b>Quick Bot Commands:</b>\n' +
    '• <code>/shop</code> — Browse products & plans\n' +
    '• <code>/orders</code> — View active orders & credentials\n' +
    '• <code>/profile</code> — Account status & affiliate hub\n' +
    '• <code>/language</code> — English / አማርኛ\n' +
    '• <code>/support</code> — Customer support desk';

  const keyboard = new InlineKeyboard()
    .text('🛍️ Browse Shop', 'nav_shop')
    .text('💬 Contact Support', 'nav_support')
    .row()
    .text('« Main Menu', 'nav_home');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
}

