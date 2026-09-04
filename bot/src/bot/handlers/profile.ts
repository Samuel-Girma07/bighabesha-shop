import { Context, InlineKeyboard } from 'grammy';
import { getUserById } from '../../services/users.service.js';
import { getOrdersByUserId } from '../../services/orders.service.js';
import { escapeHtml } from '../../utils/html.js';
import { getReferralSummary } from '../../services/referral.service.js';
import { getUserStats } from '../../services/loyalty.service.js';
import { addStyledInlineButton } from '../keyboards/menu.js';

export async function renderProfile(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = getUserById(userId);
  const lang = user?.language_code || (ctx.from?.language_code?.startsWith('am') ? 'am' : 'en');
  const isAmharic = lang === 'am';

  const orders = getOrdersByUserId(userId);
  const referral = getReferralSummary(userId);
  const stats = getUserStats(userId);

  const phoneDisplay = user?.phone_number
    ? (isAmharic ? `<code>${escapeHtml(user.phone_number)}</code> (የተረጋገጠ)` : `<code>${escapeHtml(user.phone_number)}</code> (Verified)`)
    : (isAmharic ? '<i>ያልተመዘገበ</i>' : '<i>Not registered</i>');
  const usernameDisplay = ctx.from?.username
    ? `@${escapeHtml(ctx.from.username)}`
    : (isAmharic ? '<i>ይፋዊ ዩዘርኔም የለም</i>' : '<i>No public username</i>');
  const tierBadge = isAmharic
    ? (stats.tier === 'gold' ? '🥇 ወርቅ (Gold)' : stats.tier === 'silver' ? '🥈 ብር (Silver)' : '🥉 ነሐስ (Bronze)')
    : (stats.tier === 'gold' ? '🥇 Gold' : stats.tier === 'silver' ? '🥈 Silver' : '🥉 Bronze');

  const text = isAmharic
    ? '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
      '👤 <b>የደንበኛ መረጃ እና የደረጃ ሁኔታ</b>\n\n' +
      `• <b>ሙሉ ስም፦</b> ${escapeHtml(ctx.from?.first_name || 'ተጠቃሚ')}\n` +
      `• <b>ዩዘርኔም፦</b> ${usernameDisplay}\n` +
      `• <b>የተጠቃሚ መለያ (ID)፦</b> <code>${userId}</code>\n` +
      `• <b>የተረጋገጠ ስልክ፦</b> ${phoneDisplay}\n` +
      `• <b>ጠቅላላ ትዕዛዞች፦</b> <b>${orders.length}</b>\n` +
      `• <b>የደረጃ ደረጃ፦</b> <b>${tierBadge}</b> (${(stats.lifetime_etb || 0).toLocaleString('en-US')} ETB ጠቅላላ ግዢ)\n\n` +
      `🎁 <b>የሪፈራል እና ኮሚሽን ማዕከል</b>\n` +
      `• <b>የእርስዎ የሪፈራል ኮድ፦</b> <code>${escapeHtml(referral.code)}</code>\n` +
      `• <b>የኮሚሽን ተመን፦</b> <b>${referral.commissionRatePct}%</b> በእያንዳንዱ ትዕዛዝ\n` +
      `• <b>የተጋበዙ ደንበኞች፦</b> <b>${referral.referredUsers}</b>\n` +
      `• <b>ያለዎት ቀሪ ሂሳብ፦</b> <b>${referral.balanceEtb.toLocaleString('en-US')} ETB</b>\n\n` +
      `<blockquote>🔗 <b>የእርስዎ የግል ሪፈራል ሊንክ፦</b>\n<code>https://t.me/Bighabesha_shopBot?start=ref_${escapeHtml(referral.code)}</code></blockquote>`
    : '<b>✨ ━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━ ✨</b>\n\n' +
      '👤 <b>Customer Profile & Loyalty Status</b>\n\n' +
      `• <b>Full Name:</b> ${escapeHtml(ctx.from?.first_name || 'User')}\n` +
      `• <b>Username:</b> ${usernameDisplay}\n` +
      `• <b>User ID:</b> <code>${userId}</code>\n` +
      `• <b>Verified Mobile:</b> ${phoneDisplay}\n` +
      `• <b>Total Lifetime Orders:</b> <b>${orders.length}</b>\n` +
      `• <b>Loyalty Level:</b> <b>${tierBadge}</b> (${(stats.lifetime_etb || 0).toLocaleString('en-US')} ETB volume)\n\n` +
      `🎁 <b>Affiliate & Referral Hub</b>\n` +
      `• <b>Your Referral Code:</b> <code>${escapeHtml(referral.code)}</code>\n` +
      `• <b>Commission Rate:</b> <b>${referral.commissionRatePct}%</b> per completed order\n` +
      `• <b>Referred Buyers:</b> <b>${referral.referredUsers}</b>\n` +
      `• <b>Available Balance:</b> <b>${referral.balanceEtb.toLocaleString('en-US')} ETB</b>\n\n` +
      `<blockquote>🔗 <b>Your Personal Referral Link:</b>\n<code>https://t.me/Bighabesha_shopBot?start=ref_${escapeHtml(referral.code)}</code></blockquote>`;

  const keyboard = new InlineKeyboard();
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '📱 ስልክ ቁጥር ቀይር' : '📱 Update Phone',
    callback_data: 'action_update_phone',
    style: 'primary',
  });
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '📦 የእኔ ትዕዛዞች' : '📦 My Orders',
    callback_data: 'nav_orders',
    style: 'primary',
  }).row();

  addStyledInlineButton(keyboard, {
    text: isAmharic ? '🌐 ቋንቋ ቀይር' : '🌐 Change Language',
    callback_data: 'nav_language',
    style: 'primary',
  });
  addStyledInlineButton(keyboard, {
    text: isAmharic ? '🏠 ዋና ማውጫ' : '🏠 Main Menu',
    callback_data: 'nav_home',
    style: 'primary',
  });

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }
}

