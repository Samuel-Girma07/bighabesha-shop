import { Context, InlineKeyboard } from 'grammy';
import { saveUserLanguage, isUserRegistered } from '../../services/users.service.js';
import { promptPhoneRegistration } from './registration.js';
import { startHandler } from './start.js';
import { logger } from '../../logger/index.js';

import { getConfig } from '../../config/env.js';

export function getRequiredChannelUsername(): string {
  try {
    return getConfig().REQUIRED_CHANNEL_USERNAME || '@bighabesha_softwares';
  } catch {
    return '@bighabesha_softwares';
  }
}

export function getRequiredChannelLink(): string {
  try {
    return getConfig().REQUIRED_CHANNEL_LINK || 'https://t.me/bighabesha_softwares';
  } catch {
    return 'https://t.me/bighabesha_softwares';
  }
}

export const REQUIRED_CHANNEL_USERNAME = '@bighabesha_softwares';
export const REQUIRED_CHANNEL_LINK = 'https://t.me/bighabesha_softwares';

// In-memory cache for channel membership verification (TTL 60s)
const membershipCache = new Map<number, { isMember: boolean; expiresAt: number }>();
let lastAdminWarningTime = 0;
let channelAdminInaccessibleUntil = 0;
const ADMIN_WARN_THROTTLE_MS = 5 * 60 * 1000; // Log warning at most once every 5 minutes

/**
 * Checks whether a user has joined the official channel.
 * Uses a short 60s memory cache to avoid duplicate API calls across handlers
 * and throttles non-admin warnings.
 */
export async function checkChannelMembership(ctx: Context, userId: number): Promise<boolean> {
  try {
    const config = getConfig();
    if (config.FORCE_SUBSCRIBE === false) {
      return true;
    }
  } catch {}

  const now = Date.now();

  // If we already detected the bot is not an admin in the channel recently,
  // fail-open immediately without hammering Telegram API on every button click.
  if (now < channelAdminInaccessibleUntil) {
    return true;
  }

  // Check 60s memory cache for user
  const cached = membershipCache.get(userId);
  if (cached && now < cached.expiresAt) {
    return cached.isMember;
  }

  const channel = getRequiredChannelUsername();

  try {
    const member = await ctx.api.getChatMember(channel, userId);
    const validStatuses = ['creator', 'administrator', 'member', 'restricted'];

    if (member.status === 'left' || member.status === 'kicked') {
      membershipCache.set(userId, { isMember: false, expiresAt: now + 60_000 });
      return false;
    }

    const isMember = validStatuses.includes(member.status);
    membershipCache.set(userId, { isMember, expiresAt: now + 60_000 });
    return isMember;
  } catch (err: unknown) {
    const errMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err && 'description' in err
          ? String((err as { description: unknown }).description)
          : String(err);

    // If Telegram blocks the query because the bot is not an administrator in the channel:
    // e.g. "Bad Request: member list is inaccessible" or "Bad Request: chat not found"
    if (
      errMsg.includes('member list is inaccessible') ||
      errMsg.includes('chat not found') ||
      errMsg.includes('bot is not a member') ||
      errMsg.includes('CHAT_ADMIN_REQUIRED')
    ) {
      // Cooldown API requests for 5 minutes when not admin
      channelAdminInaccessibleUntil = now + ADMIN_WARN_THROTTLE_MS;

      // Throttle warning log to once every 5 minutes
      if (now - lastAdminWarningTime > ADMIN_WARN_THROTTLE_MS) {
        lastAdminWarningTime = now;
        logger.warn(
          { err: errMsg, userId, channel },
          '⚠️ [Channel Gate] Bot is not an administrator in the channel. Telegram blocks getChatMember unless the bot is an admin. Auto-allowing user to prevent lockout. Please add the bot as an administrator to the channel!'
        );
      }
      return true;
    }

    logger.warn({ err: errMsg, userId, channel }, 'Channel membership query returned error');
    return false;
  }
}

/**
 * Step 1: Language selection prompt for new onboarding users.
 */
export async function promptLanguageSelection(ctx: Context): Promise<void> {
  const text =
    `<b>✨ Welcome to BigHabesha Shop! ✨</b>\n\n` +
    `<blockquote>💎 Ethiopia's Premier Digital Goods & AI Subscriptions</blockquote>\n\n` +
    `Please select your preferred language to get started:\n` +
    `<i>እባክዎ የሚመርጡትን ቋንቋ ይምረጡ፡</i>`;

  const keyboard = new InlineKeyboard()
    .text('🇬🇧 English', 'onboard_lang_en')
    .text('🇪🇹 አማርኛ', 'onboard_lang_am');

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
      return;
    } catch {
      // Fall through to reply
    }
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

/**
 * Step 3: Channel subscription gate prompt.
 */
export async function promptChannelSubscription(ctx: Context, alertUser = false): Promise<void> {
  const channel = getRequiredChannelUsername();
  const channelLink = getRequiredChannelLink();

  const text =
    `<b>📢 Join Our Official Channel</b>\n\n` +
    `To access BigHabesha Shop, exclusive drops, and order tracking, please join our official Telegram channel:\n\n` +
    `👉 <b>${channel}</b>\n\n` +
    `<i>After joining, tap the button below to verify and enter the shop:</i>`;

  const keyboard = new InlineKeyboard()
    .url('📢 Join Channel', channelLink)
    .row()
    .text('🔄 I Have Joined / አረጋግጥ', 'onboard_check_channel');

  if (ctx.callbackQuery) {
    try {
      if (alertUser) {
        await ctx.answerCallbackQuery({
          text: `⚠️ You have not joined ${channel} yet. Please join the channel first!`,
          show_alert: true,
        }).catch(() => {});
      }
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
      return;
    } catch {
      // Fall through
    }
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

/**
 * Handles language selection callback during onboarding.
 */
export async function handleOnboardingLanguage(ctx: Context, lang: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  saveUserLanguage(userId, lang === 'am' ? 'am' : 'en');
  await ctx.answerCallbackQuery({
    text: lang === 'am' ? 'ቋንቋው ወደ አማርኛ ተቀይሯል' : 'Language set to English',
  }).catch(() => {});

  // Next: Check if phone registration is needed
  if (!isUserRegistered(userId)) {
    await promptPhoneRegistration(ctx);
    return;
  }

  // Next: Check channel membership
  const isMember = await checkChannelMembership(ctx, userId);
  if (!isMember) {
    await promptChannelSubscription(ctx);
    return;
  }

  // Fully onboarded: show welcome (skip duplicate channel check)
  await startHandler(ctx, { skipChannelCheck: true });
}

/**
 * Handles the "I Have Joined" verification callback.
 */
export async function handleOnboardingChannelCheck(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const isMember = await checkChannelMembership(ctx, userId);
  if (!isMember) {
    await promptChannelSubscription(ctx, true);
    return;
  }

  await ctx.answerCallbackQuery({
    text: '✅ Membership verified! Welcome to BigHabesha Shop.',
  }).catch(() => {});

  // Next check if phone is registered
  if (!isUserRegistered(userId)) {
    await promptPhoneRegistration(ctx);
    return;
  }

  await startHandler(ctx, { skipChannelCheck: true });
}
