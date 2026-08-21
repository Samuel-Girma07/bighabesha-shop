import { Context, InlineKeyboard } from 'grammy';
import { getPendingAction, clearPendingAction } from '../session.js';
import { validateCustomStarsAmount } from './shop.js';
import { formatPriceETB, updateVariantPrice, getVariantById } from '../../services/catalog.service.js';
import { addStockLink, importStockCSV, getTotalStockCount } from '../../services/stock.service.js';
import { setSetting } from '../../services/settings.service.js';
import { isAdmin, renderAdminProducts, renderAdminRates, renderAdminSettings, renderAdminStock } from './admin.js';
import { logger } from '../../logger/index.js';

export async function handleTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const session = getPendingAction(userId);
  if (!session) return false;

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  switch (session.type) {
    case 'stars_custom_amount': {
      const { minStars, maxStars, etbPerStar } = session.data as { minStars: number; maxStars: number; etbPerStar: number };
      const validation = validateCustomStarsAmount(text, minStars, maxStars);

      if (!validation.valid || !validation.stars) {
        await ctx.reply(`❌ ${validation.error || 'Invalid amount.'}\n\nPlease enter a whole number between ${minStars.toLocaleString()} and ${maxStars.toLocaleString()}:`);
        return true;
      }

      clearPendingAction(userId);
      const starsCount = validation.stars;
      const priceETB = Math.ceil(starsCount * etbPerStar);

      const confirmText = `🪙 *Custom Telegram Stars Order*\n\n` +
        `• *Quantity:* ${starsCount.toLocaleString()} Stars ⭐\n` +
        `• *Rate:* 1 ⭐ = ${etbPerStar} ETB\n` +
        `• *Total Price:* *${formatPriceETB(priceETB)}*\n\n` +
        `_Your Telegram username will be verified before payment._`;

      const keyboard = new InlineKeyboard()
        .text(`💳 Proceed to Payment (${formatPriceETB(priceETB)})`, `buy_custom_stars_${starsCount}_${priceETB}`)
        .row()
        .text('« Cancel', 'prod_telegram_stars');

      await ctx.reply(confirmText, { parse_mode: 'Markdown', reply_markup: keyboard });
      return true;
    }

    case 'admin_edit_variant_price': {
      if (!isAdmin(userId)) return false;
      const { variantId, name } = session.data as { variantId: string; name: string };
      const newPrice = parseInt(text.replace(/,/g, ''), 10);

      if (isNaN(newPrice) || newPrice < 0) {
        await ctx.reply('❌ Invalid price. Please enter a positive whole number in ETB:');
        return true;
      }

      clearPendingAction(userId);
      try {
        updateVariantPrice(variantId, newPrice);
        await ctx.reply(`✅ Successfully updated price for *${name}* to *${formatPriceETB(newPrice)}*!`, { parse_mode: 'Markdown' });
        await renderAdminProducts(ctx);
      } catch (err: any) {
        await ctx.reply(`❌ Failed to update price: ${err.message}`);
      }
      return true;
    }

    case 'admin_stock_single_paste': {
      if (!isAdmin(userId)) return false;
      const { productId } = session.data as { productId: string };
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

      if (lines.length === 0) {
        await ctx.reply('❌ No valid links provided. Please send at least one activation link:');
        return true;
      }

      clearPendingAction(userId);
      let added = 0;
      for (const link of lines) {
        try {
          addStockLink(productId, link);
          added++;
        } catch (err) {
          logger.error({ err, link }, 'Error inserting single link');
        }
      }

      const current = getTotalStockCount(productId);
      await ctx.reply(`✅ Added *${added}* activation links to stock!\n\n📦 *Available Unused:* ${current.available} links.`, { parse_mode: 'Markdown' });
      await renderAdminStock(ctx);
      return true;
    }

    case 'admin_stock_csv_paste': {
      if (!isAdmin(userId)) return false;
      const { productId } = session.data as { productId: string };

      clearPendingAction(userId);
      const res = importStockCSV(productId, text);
      const current = getTotalStockCount(productId);

      let msg = `✅ *CSV Stock Import Summary*\n\n` +
        `• Successfully Imported: *${res.imported}*\n` +
        `• Skipped: ${res.skipped}\n` +
        `• Available In Stock: *${current.available}*\n`;

      if (res.errors.length > 0) {
        msg += `\n⚠️ *Errors Encountered:*\n` + res.errors.slice(0, 5).join('\n');
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
      await renderAdminStock(ctx);
      return true;
    }

    case 'admin_edit_setting': {
      if (!isAdmin(userId)) return false;
      const { settingKey } = session.data as { settingKey: string };

      clearPendingAction(userId);
      setSetting(settingKey, text);
      await ctx.reply(`✅ Setting \`${settingKey}\` has been updated to: *${text}*`, { parse_mode: 'Markdown' });

      if (settingKey.startsWith('cbe') || settingKey.startsWith('telebirr') || settingKey.startsWith('abyssinia') || settingKey === 'low_stock_threshold') {
        await renderAdminSettings(ctx);
      } else {
        await renderAdminRates(ctx);
      }
      return true;
    }
  }

  return false;
}

export async function handleDocumentInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return false;

  const session = getPendingAction(userId);
  if (!session || session.type !== 'admin_stock_csv_paste') return false;

  const doc = ctx.message?.document;
  if (!doc) return false;

  const { productId } = session.data as { productId: string };

  try {
    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) {
      await ctx.reply('❌ Unable to download file from Telegram.');
      return true;
    }

    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const content = await response.text();

    clearPendingAction(userId);
    const res = importStockCSV(productId, content);
    const current = getTotalStockCount(productId);

    let msg = `✅ *CSV Stock Import Summary*\n\n` +
      `• Successfully Imported: *${res.imported}*\n` +
      `• Skipped: ${res.skipped}\n` +
      `• Available In Stock: *${current.available}*\n`;

    if (res.errors.length > 0) {
      msg += `\n⚠️ *Errors Encountered:*\n` + res.errors.slice(0, 5).join('\n');
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
    await renderAdminStock(ctx);
    return true;
  } catch (err: any) {
    logger.error({ err }, 'Failed to process document upload');
    await ctx.reply(`❌ Failed to process document: ${err.message}`);
    return true;
  }
}
