import { Context, InlineKeyboard } from 'grammy';
import { getUserById, saveUserLanguage, isUserRegistered } from '../../services/users.service.js';
import { promptPhoneRegistration } from './registration.js';
import { startHandler } from './start.js';
import { logger } from '../../logger/index.js';

export const REQUIRED_CHANNEL_USERNAME = '@bighabesha_softwares';
export const REQUIRED_CHANNEL_LINK = 'https://t.me/bighabesha_softwares';

/**
 * Checks whether a user has joined the official channel.
 */
export async function checkChannelMembership(ctx: Context, userId: number): Promise<boolean> {
  try {
    const member = await ctx.api.getChatMember(REQUIRED_CHANNEL_USERNAME, userId);
    const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
    return validStatuses.includes(member.status);
  } catch (err: any) {
    logger.warn({ err: err?.message || err, userId }, 'Channel membership query returned non-member or error');
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
  const text =
    `<b>📢 Join Our Official Channel</b>\n\n` +
    `To access BigHabesha Shop, exclusive drops, and order tracking, please join our official Telegram channel:\n\n` +
    `👉 <b>${REQUIRED_CHANNEL_USERNAME}</b>\n\n` +
    `<i>After joining, tap the button below to verify and enter the shop:</i>`;

  const keyboard = new InlineKeyboard()
    .url('📢 Join Channel', REQUIRED_CHANNEL_LINK)
    .row()
    .text('🔄 I Have Joined / አረጋግጥ', 'onboard_check_channel');

  if (ctx.callbackQuery) {
    try {
      if (alertUser) {
        await ctx.answerCallbackQuery({
          text: '⚠️ You have not joined @bighabesha_softwares yet. Please join the channel first!',
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

  // Fully onboarded: show welcome
  await startHandler(ctx);
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

  await startHandler(ctx);
}
