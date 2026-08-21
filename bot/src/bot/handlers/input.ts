import { Context, InlineKeyboard } from 'grammy';
import { getPendingAction, clearPendingAction } from '../session.js';
import { validateCustomStarsAmount } from './shop.js';
import { formatPriceETB, updateVariantPrice, getVariantById, getProductById } from '../../services/catalog.service.js';
import { addStockLink, importStockCSV, getTotalStockCount } from '../../services/stock.service.js';
import { setSetting } from '../../services/settings.service.js';
import { isAdmin, renderAdminProducts, renderAdminRates, renderAdminSettings, renderAdminStock } from './admin.js';
import { submitReceipt, rejectReceipt, getOrderById, fulfillOrderWithProof, refundOrder } from '../../services/orders.service.js';
import { notifyAdminsNewReceipt } from './checkout.js';
import { previewBroadcastDraft } from './broadcast.js';
import { renderAdminOrdersQueue } from './admin_queue.js';
import { logger } from '../../logger/index.js';

export async function handleTextInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const session = getPendingAction(userId);
  if (!session) return false;

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  if (session.type === ('user_phone_registration' as any)) {
    const { handleManualPhoneText } = await import('./registration.js');
    return await handleManualPhoneText(ctx, text);
  }

  // Handle actions with data.action tags
  if (session.data?.action === 'compose_broadcast') {
    clearPendingAction(userId);
    const targetLang = session.data.targetLang || 'all';
    await previewBroadcastDraft(ctx, text, undefined, targetLang);
    return true;
  }

  if (session.data?.action === 'admin_fulfill_proof') {
    clearPendingAction(userId);
    const orderId = session.data.orderId;
    const order = fulfillOrderWithProof(orderId, userId, { text });
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;

    await ctx.reply(`✅ *Order \`${order.id}\` fulfilled with completion note!*`, { parse_mode: 'Markdown' });

    // Notify buyer
    const buyerMsg = `🎉 *Your Order Has Been Fulfilled!*\n\n` +
      `Your **${prodName}** order (\`#${order.id}\`) has been delivered to **@${order.username || 'your account'}**.\n\n` +
      `📝 *Fulfillment Note:* ${text}\n\n` +
      `Thank you for choosing Bighabesha Shop! 🇪🇹`;

    await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'Markdown' }).catch(() => {});
    await renderAdminOrdersQueue(ctx);
    return true;
  }

  if (session.data?.action === 'refund_order') {
    clearPendingAction(userId);
    const orderId = session.data.orderId;
    const order = refundOrder(orderId, userId, text);

    await ctx.reply(`↩️ *Order \`${order.id}\` marked as REFUNDED.*`, { parse_mode: 'Markdown' });

    // Notify buyer
    const buyerMsg = `↩️ *Order Refund Processed*\n\n` +
      `Your order \`#${order.id}\` has been refunded.\n\n` +
      `• *Details:* ${text}\n\n` +
      `If you have any questions, please contact our support: @Vweah`;

    await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'Markdown' }).catch(() => {});
    await renderAdminOrdersQueue(ctx);
    return true;
  }

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
        `_Proceed to select your payment rail:_`;

      const keyboard = new InlineKeyboard()
        .text(`💳 Proceed to Payment (${formatPriceETB(priceETB)})`, `buy_custom_stars_${starsCount}_${priceETB}`)
        .row()
        .text('« Cancel', 'prod_telegram_stars');

      await ctx.reply(confirmText, { parse_mode: 'Markdown', reply_markup: keyboard });
      return true;
    }

    case 'admin_reject_reason': {
      if (!isAdmin(userId)) return false;
      const { orderId } = session.data as { orderId: string };
      const reason = text;

      clearPendingAction(userId);
      try {
        const order = rejectReceipt(orderId, userId, reason);
        await ctx.reply(`✅ Order \`${order.id}\` has been marked REJECTED.`, { parse_mode: 'Markdown' });

        // Notify buyer
        const buyerMsg = `❌ *Payment Verification Failed*\n\n` +
          `Your payment receipt for Order #${order.id} was not accepted.\n\n` +
          `• *Reason:* ${reason}\n\n` +
          `If you believe this is a mistake or have questions, please reach out to our official support: @Vweah`;

        await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'Markdown' }).catch((err) => {
          logger.error({ err, userId: order.user_id }, 'Failed to send rejection to buyer');
        });
      } catch (err: any) {
        await ctx.reply(`❌ Failed to reject order: ${err.message}`);
      }
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

export async function handlePhotoInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const session = getPendingAction(userId);
  if (!session) return false;

  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) return false;

  const largestPhoto = photos[photos.length - 1];
  const caption = ctx.message?.caption;

  if (session.data?.action === 'compose_broadcast') {
    clearPendingAction(userId);
    const targetLang = session.data.targetLang || 'all';
    await previewBroadcastDraft(ctx, caption || '', largestPhoto.file_id, targetLang);
    return true;
  }

  if (session.data?.action === 'admin_fulfill_proof') {
    clearPendingAction(userId);
    const orderId = session.data.orderId;
    const order = fulfillOrderWithProof(orderId, userId, { fileId: largestPhoto.file_id, text: caption });
    const product = getProductById(order.product_id);
    const prodName = product ? product.name : order.product_id;

    await ctx.reply(`✅ *Order \`${order.id}\` fulfilled with screenshot proof!*`, { parse_mode: 'Markdown' });

    // Deliver photo proof to buyer
    const buyerCaption = `🎉 *Your Order Has Been Fulfilled!*\n\n` +
      `Your **${prodName}** order (\`#${order.id}\`) has been delivered to **@${order.username || 'your account'}**.\n\n` +
      `🧾 *Proof attached above.*\n` +
      (caption ? `📝 *Note:* ${caption}\n\n` : '') +
      `Thank you for choosing Bighabesha Shop! 🇪🇹`;

    await ctx.api.sendPhoto(order.user_id, largestPhoto.file_id, {
      caption: buyerCaption,
      parse_mode: 'Markdown',
    }).catch(() => {});

    await renderAdminOrdersQueue(ctx);
    return true;
  }

  if (session.type === 'user_receipt_upload') {
    const { orderId } = session.data as { orderId: string };
    clearPendingAction(userId);
    try {
      const updatedOrder = submitReceipt(orderId, largestPhoto.file_id, caption);

      await ctx.reply(
        `✅ *Receipt Received! (Order #${updatedOrder.id})*\n\n` +
          `Thank you! Our administrators have been notified and will verify your transfer shortly.\n` +
          `You will receive a message with your subscription / coins as soon as it is approved.`,
        { parse_mode: 'Markdown' }
      );

      // Notify admins
      await notifyAdminsNewReceipt(ctx, updatedOrder);
      return true;
    } catch (err: any) {
      logger.error({ err, orderId }, 'Failed to process submitted receipt');
      await ctx.reply(`❌ Could not submit receipt: ${err.message}`);
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
