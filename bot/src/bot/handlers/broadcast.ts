import { Context, InlineKeyboard } from 'grammy';
import { isAdmin } from './admin.js';
import { getBroadcastTargets, executeBroadcast } from '../../services/broadcast.service.js';
import { setPendingAction, getPendingAction, clearPendingAction } from '../session.js';
import { getDatabase } from '../../db/index.js';
import { escapeHtml } from '../../utils/html.js';
import { logger } from '../../logger/index.js';

export async function renderBroadcastTargetSelection(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) return;

  const totalAll = getBroadcastTargets('all').length;
  const totalEn = getBroadcastTargets('en').length;

  const text = '📢 <b>Broadcast Announcement Tool</b>\n\n' +
    'Select the target audience for your broadcast message:\n\n' +
    `• 🌐 <b>All Users:</b> <code>${totalAll} recipients</code>\n` +
    `• 🇬🇧 <b>English Users:</b> <code>${totalEn} recipients</code>\n\n` +
    `<i>After selecting, you will compose your message and preview it before sending.</i>`;

  const keyboard = new InlineKeyboard()
    .text(`🌐 All Users (${totalAll})`, 'broadcast_select_all')
    .row()
    .text(`🇬🇧 English (${totalEn})`, 'broadcast_select_en')
    .row()
    .text('« Back to Admin Menu', 'admin_menu');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

export async function promptBroadcastContent(ctx: Context, targetLang: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) return;

  setPendingAction(userId, {
    type: 'admin_edit_setting', // using state
    data: { action: 'compose_broadcast', targetLang },
  });

  const text = `📢 <b>Compose Broadcast Message</b>\n\n` +
    `Target: <b>${targetLang.toUpperCase()}</b>\n\n` +
    `Please send the broadcast <b>text message</b> or upload a <b>photo with a caption</b> in chat.\n\n` +
    `<i>You will see a confirmation preview before the message is sent.</i>`;

  const keyboard = new InlineKeyboard().text('❌ Cancel', 'admin_broadcast');

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
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

  const db = getDatabase();
  db.prepare(`
    INSERT INTO broadcast_drafts (admin_id, text, photo_file_id, target_lang, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(admin_id) DO UPDATE SET
      text = excluded.text,
      photo_file_id = excluded.photo_file_id,
      target_lang = excluded.target_lang,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, messageText, photoFileId || null, targetLang);

  const count = getBroadcastTargets(targetLang).length;

  const summary = `🔍 <b>Broadcast Preview & Confirmation</b>\n\n` +
    `• <b>Target Audience:</b> ${targetLang.toUpperCase()}\n` +
    `• <b>Total Recipients:</b> ${count} users\n` +
    `• <b>Media Attached:</b> ${photoFileId ? 'Yes 📸' : 'No (Text Only)'}\n\n` +
    `👇 <b>Message Content Preview:</b>`;

  await ctx.reply(summary, { parse_mode: 'HTML' });

  const keyboard = new InlineKeyboard()
    .text(`🚀 Send Broadcast to ${count} Users`, 'broadcast_confirm_send')
    .row()
    .text('❌ Cancel Broadcast', 'admin_broadcast');

  if (photoFileId) {
    await ctx.replyWithPhoto(photoFileId, {
      caption: messageText,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(messageText, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
}

export async function executeConfirmedBroadcast(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId) || !userId) {
    await ctx.reply('No pending broadcast found.');
    return;
  }

  const db = getDatabase();
  const draft = db.prepare('SELECT admin_id, text, photo_file_id, target_lang FROM broadcast_drafts WHERE admin_id = ?').get(userId) as {
    admin_id: number;
    text: string;
    photo_file_id: string | null;
    target_lang: string;
  } | undefined;

  if (!draft) {
    await ctx.reply('No pending broadcast found.');
    return;
  }

  db.prepare('DELETE FROM broadcast_drafts WHERE admin_id = ?').run(userId);

  await ctx.reply('⏳ <b>Dispatching broadcast to users in background...</b>', { parse_mode: 'HTML' });

  const result = await executeBroadcast(ctx.api, draft.text, draft.photo_file_id || undefined, draft.target_lang);

  await ctx.reply(
    `✅ <b>Broadcast Completed!</b>\n\n` +
      `• <b>Total Targets:</b> ${result.total}\n` +
      `• <b>Successfully Delivered:</b> ${result.sent} ✅\n` +
      `• <b>Failed / Blocked:</b> ${result.failed} ❌`,
    { parse_mode: 'HTML' }
  );
}


