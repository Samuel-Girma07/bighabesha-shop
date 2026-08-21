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

  const text = '👋 *Welcome to Bighabesha Shop!* 🇪🇹\n\n' +
    'To get started and protect your digital orders, please verify your account by sharing your phone number.\n\n' +
    '👇 Tap the **📱 Share Phone Number** button below, or simply type your mobile number (e.g. `0911223344` or `0711223344`):';

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

    const confirmMsg = `✅ *Account Registered Successfully!*\n\n` +
      `• *Verified Phone:* \`${formattedPhone}\`\n` +
      `• *Account Name:* ${ctx.from?.first_name || 'User'}\n\n` +
      `You now have full access to Bighabesha Shop. Use the menu buttons below to start shopping! 🛍`;

    await ctx.reply(confirmMsg, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(),
    });

    // Directly open the catalog
    await renderCatalog(ctx);
    return true;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save contact phone');
    await ctx.reply('❌ Failed to register phone number. Please try typing it manually.');
    return true;
  }
}

export async function handleManualPhoneText(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const validation = validatePhoneNumber(text);
  if (!validation.valid || !validation.formatted) {
    await ctx.reply(`❌ ${validation.error || 'Invalid phone format.'}`, {
      reply_markup: getPhoneRegistrationKeyboard(),
    });
    return true;
  }

  try {
    saveUserPhone(userId, validation.formatted);
    clearPendingAction(userId);

    const confirmMsg = `✅ *Account Registered Successfully!*\n\n` +
      `• *Verified Phone:* \`${validation.formatted}\`\n` +
      `• *Account Name:* ${ctx.from?.first_name || 'User'}\n\n` +
      `You now have full access to Bighabesha Shop. Use the menu buttons below to start shopping! 🛍`;

    await ctx.reply(confirmMsg, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(),
    });

    // Directly open the catalog
    await renderCatalog(ctx);
    return true;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save manual phone');
    await ctx.reply('❌ Failed to register phone number. Please try again.');
    return true;
  }
}
