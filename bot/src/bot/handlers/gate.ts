import { Context, InlineKeyboard } from 'grammy';
import { getConfig } from '../../config/env.js';
import { getDatabase } from '../../db/index.js';
import { logger } from '../../logger/index.js';
import { setPendingAction } from '../session.js';
import { initiateCheckout, safeEditMessage } from './checkout.js';

import { isValidUsername } from '../../services/orders.service.js';

export function isUsernameRequired(productId: string): boolean {
  return productId === 'telegram_premium';
}

export function hasPublicUsername(user?: { username?: string | null }): boolean {
  return Boolean(user?.username && user.username.trim().length > 0);
}

/** Alias for username validation matching the Telegram handle specification. */
export const isValidTelegramUsername = isValidUsername;

export async function renderUsernameGate(
  ctx: Context,
  productId: string,
  variantId?: string
): Promise<void> {
  const config = getConfig();

  const text =
    `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
    `👤 <b>Telegram Username Required</b>\n\n` +
    `<blockquote>To activate your <b>Telegram Premium</b> subscription, the target Telegram account must have a public <b>@username</b>.</blockquote>\n\n` +
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
  const { productId, variantId } = parseProductAndVariant(clean);

  // Once the username requirement is satisfied, offer recipient selection.
  await renderRecipientSelection(ctx, productId, variantId);
}

/**
 * Recipient chooser shown after the username gate is satisfied. Lets the buyer
 * activate Premium on their own account or gift it to another @username.
 */
export async function renderRecipientSelection(
  ctx: Context,
  productId: string,
  variantId?: string
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const ownUsername = ctx.from?.username?.trim().replace(/^@+/, '').toLowerCase() || null;
  const variantSuffix = variantId || 'default';

  const text =
    `<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n` +
    `🎯 <b>Who is this Premium for?</b>\n\n` +
    `Choose the account that should receive the <b>Telegram Premium</b> activation.`;

  const keyboard = new InlineKeyboard();
  if (ownUsername) {
    keyboard
      .text(`👤 My Account (@${ownUsername})`, `recipient_self_${productId}_${variantSuffix}`)
      .row();
  }
  keyboard
    .text('🎁 Gift to Another User', `recipient_gift_${productId}_${variantSuffix}`)
    .row()
    .text('« Back to Catalog', 'nav_shop');

  await safeEditMessage(ctx, text, keyboard);
}

/** Handles [👤 My Account] — proceeds to checkout targeting the buyer's own username. */
export async function handleRecipientSelf(ctx: Context, dataPayload: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const ownUsername = ctx.from?.username?.trim().replace(/^@+/, '').toLowerCase();
  if (!ownUsername) {
    await ctx.answerCallbackQuery({ text: '❌ No public @username found. Set one in Telegram Settings first.', show_alert: true });
    return;
  }

  const { productId, variantId } = parseRecipientPayload(dataPayload);
  await ctx.answerCallbackQuery({ text: `👤 Activating on @${ownUsername}` });
  await initiateCheckout(ctx, productId, variantId, ownUsername);
}

/** Handles [🎁 Gift to Another User] — arms a pending text prompt for the recipient. */
export async function handleRecipientGift(ctx: Context, dataPayload: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const { productId, variantId } = parseRecipientPayload(dataPayload);
  setPendingAction(
    userId,
    { type: 'user_gift_username', data: { productId, variantId: variantId || null } },
    10
  );

  await safeEditMessage(
    ctx,
    `🎁 <b>Gift Premium</b>\n\nSend the recipient's public <b>@username</b> in your next message.\n\n<i>Example: <code>@john_doe</code> or <code>john_doe</code></i>\n<i>Type <b>/cancel</b> to abort.</i>`,
    new InlineKeyboard().text('« Back to Catalog', 'nav_shop')
  );
}

/** Helper to parse productId and variantId from callback payload suffix */
function parseProductAndVariant(raw: string): { productId: string; variantId?: string } {
  if (raw.startsWith('telegram_premium_')) {
    const variantId = raw.replace('telegram_premium_', '');
    return { productId: 'telegram_premium', variantId: variantId === 'default' ? undefined : variantId };
  }
  const parts = raw.split('_');
  const productId = parts[0] === 'telegram' ? `${parts[0]}_${parts[1]}` : parts[0];
  const variantId = parts.slice(productId.split('_').length).join('_');
  return { productId, variantId: variantId && variantId !== 'default' ? variantId : undefined };
}

/** Splits a "recipient_{self,gift}_{productId}_{variantId}" callback payload. */
export function parseRecipientPayload(dataPayload: string): { productId: string; variantId?: string } {
  const clean = dataPayload.replace(/^recipient_(self|gift)_/, '');
  return parseProductAndVariant(clean);
}
