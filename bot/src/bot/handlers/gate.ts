import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';
import { getDatabase } from '../../db/index.js';
import { logger } from '../../logger/index.js';
import { initiateCheckout, safeEditMessage } from './checkout.js';

export function isUsernameRequired(productId: string): boolean {
  return productId === 'telegram_premium';
}

export function hasPublicUsername(user?: { username?: string | null }): boolean {
  return Boolean(user?.username && user.username.trim().length > 0);
}

export async function renderUsernameGate(
  ctx: Context,
  productId: string,
  variantId?: string
): Promise<void> {
  const config = getConfig();

  const text =
    `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
    `👤 <b>Telegram Username Required</b>\n\n` +
    `<blockquote>To fulfill your <b>Telegram Premium</b> subscription via Fragment, your Telegram account must have a public <b>@username</b> set.</blockquote>\n\n` +
    `📋 <b>Quick Setup Steps:</b>\n` +
    `1. Open Telegram <b>Settings</b>\n` +
    `2. Tap <b>Edit Profile</b> (or <b>My Account</b>) → <b>Username</b>\n` +
    `3. Enter a public username and tap save\n\n` +
    `<i>👇 Once saved in your Telegram app, tap <b>[🔄 Recheck Profile]</b> below:</i>`;

  const recheckPayload = `gate_recheck_${productId}_${variantId || 'default'}`;

  const keyboard = new InlineKeyboard()
    .text('🔄 Recheck Profile', recheckPayload)
    .row()
    .url('💬 Contact Support', `https://t.me/${config.SUPPORT_USERNAME}`)
    .row()
    .text('« Back to Catalog', 'nav_shop');

  await safeEditMessage(ctx, text, keyboard);
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
  // e.g. "gate_recheck_telegram_premium_tg_prem_3m"
  const clean = dataPayload.replace('gate_recheck_', '');

  if (clean.startsWith('telegram_premium_')) {
    const variantId = clean.replace('telegram_premium_', '');
    await initiateCheckout(ctx, 'telegram_premium', variantId);
  } else {
    const parts = clean.split('_');
    const productId = parts[0] === 'telegram' ? `${parts[0]}_${parts[1]}` : parts[0];
    const variantId = parts.slice(productId.split('_').length).join('_');
    await initiateCheckout(ctx, productId, variantId);
  }
}
