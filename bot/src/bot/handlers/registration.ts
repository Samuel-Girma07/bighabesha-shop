import { Context } from 'grammy';
import { getPhoneRegistrationKeyboard, getMainMenuKeyboard } from '../keyboards/menu.js';
import { setPendingAction, clearPendingAction } from '../session.js';
import { saveUserPhone, validatePhoneNumber } from '../../services/users.service.js';
import { renderCatalog } from './shop.js';
import { logger } from '../../logger/index.js';

export async function promptPhoneRegistration(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  setPendingAction(userId, {
    type: 'user_phone_registration' as any,
    data: {},
  });

  const text = '*Welcome to Bighabesha Shop*\n\n' +
    'To secure your orders and enable instant delivery, please verify your account with your mobile number.\n\n' +
    'Tap **[Share Phone Number]** below or enter your number (e.g. `0911223344`):';

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: getPhoneRegistrationKeyboard(),
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

    const confirmMsg = `*Account Verified Successfully*\n\n` +
      `• Phone Number: \`${formattedPhone}\`\n` +
      `• Name: ${ctx.from?.first_name || 'User'}\n\n` +
      `You have full access to Bighabesha Shop. Select an option from the menu below:`;

    await ctx.reply(confirmMsg, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(),
    });

    await renderCatalog(ctx);
    return true;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save contact phone');
    await ctx.reply('Failed to register phone number. Please enter it manually.');
    return true;
  }
}

export async function handleManualPhoneText(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const validation = validatePhoneNumber(text);
  if (!validation.valid || !validation.formatted) {
    await ctx.reply(validation.error || 'Invalid phone number format.', {
      reply_markup: getPhoneRegistrationKeyboard(),
    });
    return true;
  }

  try {
    saveUserPhone(userId, validation.formatted);
    clearPendingAction(userId);

    const confirmMsg = `*Account Verified Successfully*\n\n` +
      `• Phone Number: \`${validation.formatted}\`\n` +
      `• Name: ${ctx.from?.first_name || 'User'}\n\n` +
      `You have full access to Bighabesha Shop. Select an option from the menu below:`;

    await ctx.reply(confirmMsg, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(),
    });

    await renderCatalog(ctx);
    return true;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save manual phone');
    await ctx.reply('Failed to register phone number. Please try again.');
    return true;
  }
}
