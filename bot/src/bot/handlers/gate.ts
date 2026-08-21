import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';
import { getDatabase } from '../../db/index.js';
import { logger } from '../../logger/index.js';
import { initiateCheckout } from './checkout.js';

export function isUsernameRequired(productId: string): boolean {
  return productId === 'telegram_premium' || productId === 'telegram_stars';
}

export function hasPublicUsername(user?: { username?: string | null }): boolean {
  return Boolean(user?.username && user.username.trim().length > 0);
}

export async function renderUsernameGate(
  ctx: Context,
  productId: string,
  variantId?: string,
  customStars?: number,
  customAmountETB?: number
): Promise<void> {
  const config = getConfig();

  const text = `⚠️ *Telegram Username Required*\n\n` +
    `To fulfill your **Telegram Premium** subscription or **Telegram Stars** delivery, your Telegram account must have a public **@username** set.\n\n` +
    `*How to set your username in 3 quick steps:*\n` +
    `1️⃣ Open Telegram **Settings**\n` +
    `2️⃣ Tap **Edit Profile** (or **My Account**) → **Username**\n` +
    `3️⃣ Type a unique public username and save\n\n` +
    `Once created, tap **[🔄 I created it — recheck]** below to continue your purchase:`;

  const recheckPayload = customStars && customAmountETB
    ? `gate_recheck_${productId}_custom_${customStars}_${customAmountETB}`
    : `gate_recheck_${productId}_${variantId || 'default'}`;

  const keyboard = new InlineKeyboard()
    .text('🔄 I created it — recheck', recheckPayload)
    .row()
    .url('💬 Contact Support', `https://t.me/${config.SUPPORT_USERNAME}`)
    .row()
    .text('« Cancel', 'nav_shop');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function handleGateRecheck(ctx: Context, dataPayload: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Re-query user details from Telegram API
  let currentUsername = ctx.from?.username;

  try {
    const chat = await ctx.api.getChat(userId);
    if ('username' in chat && chat.username) {
      currentUsername = chat.username;
    }
  } catch (err) {
    logger.warn({ err, userId }, 'Could not fetch live chat info during gate recheck');
  }

  if (!hasPublicUsername({ username: currentUsername })) {
    await ctx.answerCallbackQuery({
      text: '❌ No public @username found yet. Please set your username in Telegram Settings and try again!',
      show_alert: true,
    });
    return;
  }

  // Update user in DB
  try {
    const db = getDatabase();
    db.prepare('UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      currentUsername,
      userId
    );
  } catch (err) {
    logger.error({ err, userId }, 'Failed to update username after gate recheck');
  }

  await ctx.answerCallbackQuery({
    text: `✅ Username @${currentUsername} verified!`,
  });

  // Parse product and variant from recheck payload
  // e.g. "gate_recheck_telegram_stars_custom_500_1250" or "gate_recheck_telegram_premium_tg_prem_3m"
  const clean = dataPayload.replace('gate_recheck_', '');
  const parts = clean.split('_');

  if (clean.includes('_custom_')) {
    const [productId, , starsStr, amountStr] = parts;
    const stars = parseInt(starsStr, 10);
    const amount = parseInt(amountStr, 10);
    await initiateCheckout(ctx, productId, undefined, stars, amount);
  } else {
    const productId = parts[0] === 'telegram' ? `${parts[0]}_${parts[1]}` : parts[0];
    const variantId = parts.slice(productId.split('_').length).join('_');
    await initiateCheckout(ctx, productId, variantId);
  }
}
