import { Context } from 'grammy';
import { getPhoneRegistrationKeyboard } from '../keyboards/menu.js';
import { setPendingAction, clearPendingAction } from '../session.js';
import { saveUserPhone, validatePhoneNumber, getUserById } from '../../services/users.service.js';
import { checkChannelMembership, promptChannelSubscription } from './onboarding.js';
import { startHandler } from './start.js';
import { logger } from '../../logger/index.js';

export async function promptPhoneRegistration(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = getUserById(userId);
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  setPendingAction(userId, {
    type: 'user_phone_registration' as any,
    data: {},
  });

  const text = isAmharic
    ? '<b>📱 የስልክ ቁጥር ማረጋገጫ</b>\n\n' +
      'የአካውንትዎን ደህንነት ለመጠበቅ፣ ትዕዛዞችዎን ለመከታተል እና ምርቶችን ወዲያውኑ ለመቀበል እባክዎ ስልክ ቁጥርዎን ያረጋግጡ።\n\n' +
      'ከታች <b>[ስልክ ቁጥር አጋራ]</b> የሚለውን ይጫኑ ወይም ስልክ ቁጥርዎን ይጻፉ (ለምሳሌ፦ <code>0911223344</code>):'
    : '<b>📱 Phone Number Verification</b>\n\n' +
      'To secure your account, track your orders, and enable instant product delivery, please verify your phone number.\n\n' +
      'Tap <b>[Share Phone Number]</b> below or enter your number (e.g. <code>0911223344</code>):';

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: getPhoneRegistrationKeyboard(lang),
  });
}

export async function handleContactMessage(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  const contact = ctx.message?.contact;
  if (!userId || !contact) return false;

  let rawPhone = contact.phone_number;
  if (!rawPhone.startsWith('+')) {
    rawPhone = `+${rawPhone}`;
  }

  const validation = validatePhoneNumber(rawPhone);
  const formattedPhone = validation.valid && validation.formatted ? validation.formatted : rawPhone;

  try {
    saveUserPhone(userId, formattedPhone);
    clearPendingAction(userId);

    // Step 3: Check channel membership
    const isMember = await checkChannelMembership(ctx, userId);
    if (!isMember) {
      await promptChannelSubscription(ctx);
      return true;
    }

    await startHandler(ctx);
    return true;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save contact phone');
    const user = getUserById(userId);
    const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
    await ctx.reply(lang === 'am' ? 'ስልክ ቁጥር መመዝገብ አልተቻለም። እባክዎ ቁጥሩን በእጅ ያስገቡ።' : 'Failed to register phone number. Please enter it manually.');
    return true;
  }
}

export async function handleManualPhoneText(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const user = getUserById(userId);
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  const validation = validatePhoneNumber(text);
  if (!validation.valid || !validation.formatted) {
    const errorMsg = isAmharic
      ? 'የተሳሳተ የስልክ ቁጥር ቅርጸት። እባክዎ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ (ለምሳሌ፦ 0911223344 ወይም 0711223344)።'
      : (validation.error || 'Invalid phone number format.');
    await ctx.reply(errorMsg, {
      reply_markup: getPhoneRegistrationKeyboard(lang),
    });
    return true;
  }

  try {
    saveUserPhone(userId, validation.formatted);
    clearPendingAction(userId);

    // Step 3: Check channel membership
    const isMember = await checkChannelMembership(ctx, userId);
    if (!isMember) {
      await promptChannelSubscription(ctx);
      return true;
    }

    await startHandler(ctx);
    return true;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save manual phone');
    await ctx.reply(isAmharic ? 'ስልክ ቁጥር መመዝገብ አልተቻለም። እባክዎ እንደገና ይሞክሩ።' : 'Failed to register phone number. Please try again.');
    return true;
  }
}

