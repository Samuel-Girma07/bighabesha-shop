import { Context, InlineKeyboard } from 'grammy';
import { getPendingAction, clearPendingAction } from '../session.js';
import { validateCustomStarsAmount } from './shop.js';
import { formatPriceETB, updateVariantPrice, getVariantById, getProductById } from '../../services/catalog.service.js';
import { addStockLink, importStockCSV, getTotalStockCount } from '../../services/stock.service.js';
import { setSetting, getSetting } from '../../services/settings.service.js';
import { isAdmin, renderAdminProducts, renderAdminRates, renderAdminSettings, renderAdminStock } from './admin.js';
import { submitReceipt, rejectReceipt, getOrderById, fulfillOrderWithProof, refundOrder } from '../../services/orders.service.js';
import { notifyAdminsNewReceipt } from './checkout.js';
import { previewBroadcastDraft } from './broadcast.js';
import { renderAdminOrdersQueue } from './admin_queue.js';
import { escapeHtml } from '../../utils/html.js';
import { logger, redactSecret } from '../../logger/index.js';
import { parseBankSms, matchSmsToOrders } from '../../services/sms_parser.service.js';
import { getDatabase } from '../../db/index.js';
import { renderPaymentRailSelection } from './checkout.js';

async function renderPaymentRailSelectionFor(ctx: Context, order: any, productName: string): Promise<void> {
  try {
    await renderPaymentRailSelection(ctx, order, productName);
  } catch {
    /* rail re-render is best-effort */
  }
}

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

  // Promo code entry (bot rail-screen flow)
  if (session.type === 'promo_entry') {
    clearPendingAction(userId);
    const { orderId } = session.data as { orderId: string };
    try {
      const { applyPromoToOrder } = await import('../../services/promo.service.js');
      const result = applyPromoToOrder(orderId, userId, text);
      const net = Math.max(result.order.amount_etb - result.discountEtb, 1);
      await ctx.reply(
        `✅ <b>Promo applied!</b>\n\nCode: <code>${escapeHtml(String(text).trim().toUpperCase())}</code>\nDiscount: <b>−${escapeHtml(String(result.discountEtb.toLocaleString('en-US')))} ETB</b>\nNew total: <b>${escapeHtml(net.toLocaleString('en-US'))} ETB</b>\n\nTap your payment method below to continue.`,
        { parse_mode: 'HTML' }
      );
      const order = getOrderById(orderId);
      if (order) {
        const product = getProductById(order.product_id);
        await renderPaymentRailSelectionFor(ctx, order, product ? product.name : 'Subscription');
      }
    } catch (err: any) {
      await ctx.reply(`❌ ${escapeHtml(err?.message || 'Promo code could not be applied.')}`);
      const order = getOrderById(orderId);
      if (order) {
        const product = getProductById(order.product_id);
        await renderPaymentRailSelectionFor(ctx, order, product ? product.name : 'Subscription');
      }
    }
    return true;
  }

  // CBE SMS verification flow
  if (session.type === 'user_sms_forward') {
    clearPendingAction(userId);
    const { orderId } = session.data as { orderId: string };
    const parsed = parseBankSms(text);

    if (!parsed || parsed.direction !== 'debit') {
      await ctx.reply(
        `❌ That doesn't look like a CBE debit SMS.\n\nPlease forward the exact bank confirmation message, or upload a receipt screenshot instead.`,
        { parse_mode: 'HTML' }
      );
      return true;
    }

    const db = getDatabase();
    const match = matchSmsToOrders(db, userId, parsed);
    const order = getOrderById(orderId);
    const targetOrderId = match.matched ? match.orderId! : orderId;

    db.prepare(
      'INSERT INTO receipt_evidence (order_id, user_id, source, raw_text, amount_etb, reference, matched) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(targetOrderId, userId, 'sms', text.slice(0, 500), parsed.amountEtb, parsed.reference || null, match.matched ? 1 : 0);

    if (!order || order.user_id !== userId) {
      await ctx.reply('Order not found.');
      return true;
    }

    if (!match.matched) {
      const reason = match.reason === 'ambiguous' ? 'multiple orders match this amount.' : 'no open order matches this amount.';
      await ctx.reply(
        `⚠️ SMS received but ${reason}\n\nPlease double-check the amount, or upload your receipt screenshot for manual review.`,
        { parse_mode: 'HTML' }
      );
      return true;
    }

    // Matched: attach evidence as the receipt and route to admin approval.
    const updatedOrder = submitReceipt(targetOrderId, `sms:${parsed.reference || Date.now()}`, `CBE SMS ref: ${parsed.reference || 'n/a'} — amount ${parsed.amountEtb} ETB`);
    await ctx.reply(
      `✅ <b>SMS matched!</b>\n\nAmount: <b>${escapeHtml(parsed.amountEtb.toLocaleString('en-US'))} ETB</b>\nReference: <code>${escapeHtml(parsed.reference || 'n/a')}</code>\n\nAn administrator will give it a final check shortly.`,
      { parse_mode: 'HTML' }
    );

    try {
      const enriched = {
        ...updatedOrder,
        receipt_note: `[CBE SMS MATCH ✓] Amount: ${parsed.amountEtb} ETB | Ref: ${parsed.reference || 'n/a'}\n${updatedOrder.receipt_note ?? ''}`,
      };
      await notifyAdminsNewReceipt(ctx, enriched);
    } catch (err) {
      logger.warn({ err }, 'Failed notifying admins of matched SMS');
    }
    return true;
  }

  // Handle actions with data.action tags
  if (session.data?.action === 'compose_broadcast') {
    // Defense-in-depth: broadcast composition is admin-only.
    if (!isAdmin(userId)) return true;
    clearPendingAction(userId);
    const targetLang = session.data.targetLang || 'all';
    await previewBroadcastDraft(ctx, text, undefined, targetLang);
    return true;
  }

  if (session.data?.action === 'admin_fulfill_proof') {
    // Authorization gate: only configured administrators may fulfil orders.
    if (!isAdmin(userId)) return true;
    clearPendingAction(userId);
    const orderId = session.data.orderId;
    try {
      const order = fulfillOrderWithProof(orderId, userId, { text });
      const product = getProductById(order.product_id);
      const prodName = product ? product.name : order.product_id;

      await ctx.reply(`✅ <b>Order <code>${order.id}</code> fulfilled with completion note!</b>`, { parse_mode: 'HTML' });

      // Notify buyer
      if (order.fulfillment_payload) {
        const rawTemplate = getSetting(
          'gemini_instructions',
          '1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
        );
        const deliveryText = `<b>Payment Confirmed — Order #${order.id}</b>\n\n` +
          `Activation Link:\n<code>${order.fulfillment_payload}</code>\n\n` +
          `<b>Instructions:</b>\n${rawTemplate}\n\n` +
          `<i>Thank you for choosing Bighabesha Shop.</i>`;

        await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch(() => {});
      } else {
        const buyerMsg = `🎉 <b>Your Order Has Been Fulfilled!</b>\n\n` +
          `Your <b>${escapeHtml(prodName)}</b> order (<code>#${order.id}</code>) has been delivered to <b>@${escapeHtml(order.username || 'your account')}</b>.\n\n` +
          `📝 <b>Fulfillment Note:</b> ${escapeHtml(text)}\n\n` +
          `Thank you for choosing Bighabesha Shop! 🇪🇹`;

        await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'HTML' }).catch(() => {});
      }
      await renderAdminOrdersQueue(ctx);
    } catch (err: any) {
      await ctx.reply(`❌ Fulfillment error: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
    return true;
  }

  if (session.data?.action === 'refund_order') {
    // Authorization gate: only configured administrators may refund orders.
    if (!isAdmin(userId)) return true;
    clearPendingAction(userId);
    const orderId = session.data.orderId;
    const order = refundOrder(orderId, userId, text);

    await ctx.reply(`↩️ <b>Order <code>${order.id}</code> marked as REFUNDED.</b>`, { parse_mode: 'HTML' });

    // Notify buyer
    const buyerMsg = `↩️ <b>Order Refund Processed</b>\n\n` +
      `Your order <code>#${order.id}</code> has been refunded.\n\n` +
      `• <b>Details:</b> ${escapeHtml(text)}\n\n` +
      `If you have any questions, please contact our support: @Vweah`;

    await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'HTML' }).catch(() => {});
    await renderAdminOrdersQueue(ctx);
    return true;
  }

  switch (session.type) {
    case 'stars_custom_amount': {
      const { minStars, maxStars, etbPerStar } = session.data as { minStars: number; maxStars: number; etbPerStar: number };
      const validation = validateCustomStarsAmount(text, minStars, maxStars);

      if (!validation.valid || !validation.stars) {
        await ctx.reply(`❌ ${escapeHtml(validation.error || 'Invalid amount.')}\n\nPlease enter a whole number between ${minStars.toLocaleString()} and ${maxStars.toLocaleString()}:`);
        return true;
      }

      clearPendingAction(userId);
      const starsCount = validation.stars;
      const priceETB = Math.ceil(starsCount * etbPerStar);

      const confirmText = `🪙 <b>Custom Telegram Stars Order</b>\n\n` +
        `• <b>Quantity:</b> ${starsCount.toLocaleString()} Stars ⭐\n` +
        `• <b>Rate:</b> 1 ⭐ = ${etbPerStar} ETB\n` +
        `• <b>Total Price:</b> <b>${formatPriceETB(priceETB)}</b>\n\n` +
        `<i>Proceed to select your payment rail:</i>`;

      const keyboard = new InlineKeyboard()
        .text(`💳 Proceed to Payment (${formatPriceETB(priceETB)})`, `buy_custom_stars_${starsCount}_${priceETB}`)
        .row()
        .text('« Cancel', 'prod_telegram_stars');

      await ctx.reply(confirmText, { parse_mode: 'HTML', reply_markup: keyboard });
      return true;
    }

    case 'admin_reject_reason': {
      if (!isAdmin(userId)) return false;
      const { orderId } = session.data as { orderId: string };
      const reason = text;

      clearPendingAction(userId);
      try {
        const order = rejectReceipt(orderId, userId, reason);
        await ctx.reply(`✅ Order <code>${order.id}</code> has been marked REJECTED.`, { parse_mode: 'HTML' });

        // Notify buyer
        const buyerMsg = `❌ <b>Payment Verification Failed</b>\n\n` +
          `Your payment receipt for Order #${order.id} was not accepted.\n\n` +
          `• <b>Reason:</b> ${escapeHtml(reason)}\n\n` +
          `If you believe this is a mistake or have questions, please reach out to our official support: @Vweah`;

        await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'HTML' }).catch((err) => {
          logger.error({ err, userId: order.user_id }, 'Failed to send rejection to buyer');
        });
      } catch (err: any) {
        await ctx.reply(`❌ Failed to reject order: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
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
        await ctx.reply(`✅ Successfully updated price for <b>${escapeHtml(name)}</b> to <b>${formatPriceETB(newPrice)}</b>!`, { parse_mode: 'HTML' });
        await renderAdminProducts(ctx);
      } catch (err: any) {
        await ctx.reply(`❌ Failed to update price: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
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
          logger.error({ err, link: redactSecret(link) }, 'Error inserting single link');
        }
      }

      const current = getTotalStockCount(productId);
      await ctx.reply(`✅ Added <b>${added}</b> activation links to stock!\n\n📦 <b>Available Unused:</b> ${current.available} links.`, { parse_mode: 'HTML' });
      await renderAdminStock(ctx);
      return true;
    }

    case 'admin_stock_csv_paste': {
      if (!isAdmin(userId)) return false;
      const { productId } = session.data as { productId: string };

      clearPendingAction(userId);
      const res = importStockCSV(productId, text);
      const current = getTotalStockCount(productId);

      let msg = `✅ <b>CSV Stock Import Summary</b>\n\n` +
        `• Successfully Imported: <b>${res.imported}</b>\n` +
        `• Skipped: ${res.skipped}\n` +
        `• Available In Stock: <b>${current.available}</b>\n`;

      if (res.errors.length > 0) {
        msg += `\n⚠️ <b>Errors Encountered:</b>\n` + res.errors.slice(0, 5).map(e => escapeHtml(e)).join('\n');
      }

      await ctx.reply(msg, { parse_mode: 'HTML' });
      await renderAdminStock(ctx);
      return true;
    }

    case 'admin_edit_setting': {
      if (!isAdmin(userId)) return false;
      const { settingKey } = session.data as { settingKey: string };

      clearPendingAction(userId);
      setSetting(settingKey, text);
      await ctx.reply(`✅ Setting <code>${escapeHtml(settingKey)}</code> has been updated to: <b>${escapeHtml(text)}</b>`, { parse_mode: 'HTML' });

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
    // Defense-in-depth: broadcast composition is admin-only.
    if (!isAdmin(ctx.from?.id)) return true;
    clearPendingAction(userId);
    const targetLang = session.data.targetLang || 'all';
    await previewBroadcastDraft(ctx, caption || '', largestPhoto.file_id, targetLang);
    return true;
  }

  if (session.data?.action === 'admin_fulfill_proof') {
    // Authorization gate: only configured administrators may fulfil orders.
    if (!isAdmin(userId)) return true;
    clearPendingAction(userId);
    const orderId = session.data.orderId;
    try {
      const order = fulfillOrderWithProof(orderId, userId, { fileId: largestPhoto.file_id, text: caption });
      const product = getProductById(order.product_id);
      const prodName = product ? product.name : order.product_id;

      await ctx.reply(`✅ <b>Order <code>${order.id}</code> fulfilled with screenshot proof!</b>`, { parse_mode: 'HTML' });

      // Deliver photo proof to buyer
      const buyerCaption = `🎉 <b>Your Order Has Been Fulfilled!</b>\n\n` +
        `Your <b>${escapeHtml(prodName)}</b> order (<code>#${order.id}</code>) has been delivered to <b>@${escapeHtml(order.username || 'your account')}</b>.\n\n` +
        `🧾 <b>Proof attached above.</b>\n` +
        (caption ? `📝 <b>Note:</b> ${escapeHtml(caption)}\n\n` : '') +
        `Thank you for choosing Bighabesha Shop! 🇪🇹`;

      await ctx.api.sendPhoto(order.user_id, largestPhoto.file_id, {
        caption: buyerCaption,
        parse_mode: 'HTML',
      }).catch(() => {});

      await renderAdminOrdersQueue(ctx);
    } catch (err: any) {
      await ctx.reply(`❌ Fulfillment error: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
    return true;
  }

  if (session.type === 'user_receipt_upload') {
    const { orderId } = session.data as { orderId: string };
    // Ownership re-check: the session may reference an order that is not the
    // user's own (e.g. crafted callback). Never accept foreign receipts.
    const targetOrder = getOrderById(orderId);
    if (!targetOrder || targetOrder.user_id !== userId) {
      clearPendingAction(userId);
      await ctx.reply('Order not found.');
      return true;
    }
    clearPendingAction(userId);
    try {
      const updatedOrder = submitReceipt(orderId, largestPhoto.file_id, caption);

      await ctx.reply(
        `✅ <b>Receipt Received! (Order #${updatedOrder.id})</b>\n\n` +
          `Thank you! Our administrators have been notified and will verify your transfer shortly.\n` +
          `You will receive a message with your subscription / coins as soon as it is approved.`,
        { parse_mode: 'HTML' }
      );

      // Notify admins
      await notifyAdminsNewReceipt(ctx, updatedOrder);
      return true;
    } catch (err: any) {
      logger.error({ err, orderId }, 'Failed to process submitted receipt');
      await ctx.reply(`❌ Could not submit receipt: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      return true;
    }
  }

  return false;
}

export async function handleDocumentInput(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const session = getPendingAction(userId);
  if (!session) return false;

  const doc = ctx.message?.document;
  if (!doc) return false;

  // Process user bank receipt document uploads
  if (session.type === 'user_receipt_upload') {
    const { orderId } = session.data as { orderId: string };
    // Ownership re-check: never accept receipts for foreign orders.
    const targetOrder = getOrderById(orderId);
    if (!targetOrder || targetOrder.user_id !== userId) {
      clearPendingAction(userId);
      await ctx.reply('Order not found.');
      return true;
    }
    clearPendingAction(userId);
    try {
      const caption = ctx.message?.caption;
      const updatedOrder = submitReceipt(orderId, doc.file_id, caption);

      await ctx.reply(
        `✅ <b>Receipt Received! (Order #${updatedOrder.id})</b>\n\n` +
          `Thank you! Our administrators have been notified and will verify your transfer shortly.\n` +
          `You will receive a message with your subscription / coins as soon as it is approved.`,
        { parse_mode: 'HTML' }
      );

      // Notify admins
      await notifyAdminsNewReceipt(ctx, updatedOrder);
      return true;
    } catch (err: any) {
      logger.error({ err, orderId }, 'Failed to process submitted document receipt');
      await ctx.reply(`❌ Could not submit receipt: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
      return true;
    }
  }

  if (!isAdmin(userId)) return false;

  if (session.type !== 'admin_stock_csv_paste') return false;

  const { productId } = session.data as { productId: string };

  // Hard cap on remote file size BEFORE downloading into memory (DoS guard).
  const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB
  if (doc.file_size && doc.file_size > MAX_CSV_BYTES) {
    clearPendingAction(userId);
    await ctx.reply(
      `❌ File too large (${(doc.file_size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is 5 MB.\n` +
        `Split your stock list into smaller files and try again.`
    );
    return true;
  }

  try {
    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) {
      await ctx.reply('❌ Unable to download file from Telegram.');
      return true;
    }

    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const response = await fetch(fileUrl);

    // Defense-in-depth: also enforce the cap against the actual response
    // size, since Telegram's metadata can be missing or stale.
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_CSV_BYTES) {
      clearPendingAction(userId);
      await ctx.reply('❌ Downloaded file exceeds the 5 MB limit. Split your list into smaller files.');
      return true;
    }

    const content = await response.text();
    if (Buffer.byteLength(content, 'utf-8') > MAX_CSV_BYTES) {
      clearPendingAction(userId);
      await ctx.reply('❌ Downloaded content exceeds the 5 MB limit. Split your list into smaller files.');
      return true;
    }

    clearPendingAction(userId);
    const res = importStockCSV(productId, content);
    const current = getTotalStockCount(productId);

    let msg = `✅ <b>CSV Stock Import Summary</b>\n\n` +
      `• Successfully Imported: <b>${res.imported}</b>\n` +
      `• Skipped: ${res.skipped}\n` +
      `• Available In Stock: <b>${current.available}</b>\n`;

    if (res.errors.length > 0) {
      msg += `\n⚠️ <b>Errors Encountered:</b>\n` + res.errors.slice(0, 5).map(e => escapeHtml(e)).join('\n');
    }

    await ctx.reply(msg, { parse_mode: 'HTML' });
    await renderAdminStock(ctx);
    return true;
  } catch (err: any) {
    logger.error({ err }, 'Failed to process document upload');
    await ctx.reply(`❌ Failed to process document: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    return true;
  }
}

