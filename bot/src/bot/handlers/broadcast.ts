import { Context, InlineKeyboard } from 'grammy';
import { isAdmin } from './admin.js';
import { getBroadcastTargets, executeBroadcast } from '../../services/broadcast.service.js';
import { setPendingAction, getPendingAction, clearPendingAction } from '../session.js';
import { logger } from '../../logger/index.js';

let pendingBroadcastDraft: {
  text: string;
  photoFileId?: string;
  targetLang: string;
} | null = null;

export async function renderBroadcastTargetSelection(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) return;

  const totalAll = getBroadcastTargets('all').length;
  const totalEn = getBroadcastTargets('en').length;

  const text = '📢 *Broadcast Announcement Tool*\n\n' +
    'Select the target audience for your broadcast message:\n\n' +
    `• 🌐 *All Users:* \`${totalAll} recipients\`\n` +
    `• 🇬🇧 *English Users:* \`${totalEn} recipients\`\n\n` +
    `_After selecting, you will compose your message and preview it before sending._`;

  const keyboard = new InlineKeyboard()
    .text(`🌐 All Users (${totalAll})`, 'broadcast_select_all')
    .row()
    .text(`🇬🇧 English (${totalEn})`, 'broadcast_select_en')
    .row()
    .text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function promptBroadcastContent(ctx: Context, targetLang: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  setPendingAction(userId, {
    type: 'admin_edit_setting', // using state
    data: { action: 'compose_broadcast', targetLang },
  });

  const text = `📢 *Compose Broadcast Message*\n\n` +
    `Target: *${targetLang.toUpperCase()}*\n\n` +
    `Please send the broadcast **text message** or upload a **photo with a caption** in chat.\n\n` +
    `_You will see a confirmation preview before the message is sent._`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_broadcast');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

export async function previewBroadcastDraft(
  ctx: Context,
  messageText: string,
  photoFileId: string | undefined,
  targetLang: string
): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  pendingBroadcastDraft = {
    text: messageText,
    photoFileId,
    targetLang,
  };

  const count = getBroadcastTargets(targetLang).length;

  const summary = `🔍 *Broadcast Preview & Confirmation*\n\n` +
    `• *Target Audience:* ${targetLang.toUpperCase()}\n` +
    `• *Total Recipients:* ${count} users\n` +
    `• *Media Attached:* ${photoFileId ? 'Yes 📸' : 'No (Text Only)'}\n\n` +
    `👇 *Message Content Preview:*`;

  await ctx.reply(summary, { parse_mode: 'Markdown' });

  const keyboard = new InlineKeyboard()
    .text(`🚀 Send Broadcast to ${count} Users`, 'broadcast_confirm_send')
    .row()
    .text('❌ Cancel Broadcast', 'admin_broadcast');

  if (photoFileId) {
    await ctx.replyWithPhoto(photoFileId, {
      caption: messageText,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(messageText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

export async function executeConfirmedBroadcast(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !pendingBroadcastDraft) {
    await ctx.reply('No pending broadcast found.');
    return;
  }

  const { text, photoFileId, targetLang } = pendingBroadcastDraft;
  pendingBroadcastDraft = null;

  await ctx.reply('⏳ *Dispatching broadcast to users in background...*', { parse_mode: 'Markdown' });

  const result = await executeBroadcast(ctx.api, text, photoFileId, targetLang);

  await ctx.reply(
    `✅ *Broadcast Completed!*\n\n` +
      `• *Total Targets:* ${result.total}\n` +
      `• *Successfully Delivered:* ${result.sent} ✅\n` +
      `• *Failed / Blocked:* ${result.failed} ❌`,
    { parse_mode: 'Markdown' }
  );
}
