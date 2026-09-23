import { Context } from 'grammy';
import { getPendingAction, setPendingAction, clearPendingAction } from '../session.js';
import { formatPriceETB, updateVariantPrice, getProductById } from '../../services/catalog.service.js';
import { addStockLink, importStockCSV, getTotalStockCount } from '../../services/stock.service.js';
import { setSetting, getSetting } from '../../services/settings.service.js';
import { isCircuitBreakerSettingKey } from '../../services/receipt_verifier/constants.js';
import { isAdmin, renderAdminProducts, renderAdminRates, renderAdminSettings, renderAdminStock } from './admin.js';
import { submitReceipt, rejectReceipt, getOrderById, fulfillOrderWithProof, refundOrder, sanitizeUsername, InvalidUsernameError, Order } from '../../services/orders.service.js';
import { notifyAdminsNewReceipt, notifyAdminsVerificationFallback, initiateCheckout } from './checkout.js';
import { getUserById } from '../../services/users.service.js';
import { previewBroadcastDraft } from './broadcast.js';
import { renderAdminOrdersQueue } from './admin_queue.js';
import { escapeHtml, splitTelegramCaption, formatFulfillmentDeliveryMessage } from '../../utils/html.js';
import { logger, redactSecret } from '../../logger/index.js';
import { renderPaymentRailSelection } from './checkout.js';
import { getConfig } from '../../config/env.js';
import { isResellerEligible, triggerAutoResellerDelivery } from '../../services/reseller.service.js';
import type { VerificationResult, IReceiptOrchestrator } from '../../services/receipt_verifier/types.js';

const MAX_RECEIPT_BUFFER_SIZE_BYTES = 10 * 1024 * 1024;
/** Maximum consecutive unreadable SMS/text attempts before the order is routed to manual review. */
const MAX_RECEIPT_TEXT_ATTEMPTS = 3;

async function getOrchestrator(): Promise<IReceiptOrchestrator> {
  const { getReceiptOrchestrator } = await import('../../services/receipt_verifier/index.js');
  return getReceiptOrchestrator();
}

let textIngestionService: { ingestText(rawText: string): Promise<unknown> } | undefined;

/** Lazily-loaded ingestion service used for local (regex-only, no network) reference pre-validation. */
async function getTextIngestionService(): Promise<{ ingestText(rawText: string): Promise<unknown> }> {
  if (!textIngestionService) {
    const { ReceiptIngestionService } = await import('../../services/receipt_verifier/ingestion.service.js');
    textIngestionService = new ReceiptIngestionService();
  }
  return textIngestionService;
}


async function renderPaymentRailSelectionFor(ctx: Context, order: any, productName: string): Promise<void> {
  try {
    await renderPaymentRailSelection(ctx, order, productName);
  } catch {
    /* rail re-render is best-effort */
  }
}

/**
 * Photo/document intake is retired: buyers must send the bank confirmation SMS as text.
 * The receipt session stays armed (and attempts are NOT consumed) so the buyer can immediately
 * send the SMS instead.
 */
async function sendSmsOnlyGuidance(ctx: Context, userId: number): Promise<void> {
  const user = getUserById(userId);
  const isAmharic = user?.language_code === 'am' || ctx.from?.language_code?.startsWith('am');

  const guidanceMsg = isAmharic
    ? `📷 <b>ፎቶዎች / ስክሪንሾቶች ከእንግዲህ አይቀበሉም</b>\n\n` +
      `እባክዎ ከባንክ / ከቴሌብር የደረሰዎትን የማረጋገጫ <b>SMS</b> እዚህ አግብረው (forward) ወይም ቅድተው ይላኩ — ወይም የትራንዛክሽን ቁጥሩን ብቻ ይፃፉ።\n\n` +
      `ትራንዛክሽኑን በቀጥታ ከባንክ እናረጋግጣለን። ለመሰረዝ <b>/cancel</b> ይፃፉ።`
    : `📷 <b>Photos / screenshots are no longer accepted</b>\n\n` +
      `Please send the confirmation <b>SMS</b> you received from the bank / Telebirr — forward it or paste the full text here — or just type the transaction reference number.\n\n` +
      `We verify the transaction directly with the bank. Type <b>/cancel</b> to abort.`;

  await ctx.reply(guidanceMsg, { parse_mode: 'HTML' });
}

async function sendVerificationSuccessReply(
  ctx: Context,
  orderId: string,
  fallbackOrder: Order,
  result: VerificationResult
): Promise<void> {
  const verifiedOrder = getOrderById(orderId) || fallbackOrder;
  const verifiedAmount = result.bankPayload?.amountEtb || verifiedOrder.amount_etb;
  const railName = (result.bank || verifiedOrder.payment_rail || 'Bank').toUpperCase();
  const refCode = result.transactionReference || 'n/a';

  if (verifiedOrder.fulfillment_payload) {
    const rawTemplate = getSetting(
      'gemini_instructions',
      '1. Ensure your VPN is connected before opening the link.\n2. Click the link to complete activation on your Google account.\n3. Once activated, you may safely disconnect the VPN.'
    );
    const deliveryText =
      `🎉 <b>Payment Verified! (Order #${escapeHtml(verifiedOrder.id)})</b>\n\n` +
      `• <b>Verified:</b> ${formatPriceETB(verifiedAmount)} via <b>${escapeHtml(railName)}</b>\n` +
      `• <b>Reference:</b> <code>${escapeHtml(refCode)}</code>\n\n` +
      `🔑 <b>Activation Link:</b>\n<code>${escapeHtml(verifiedOrder.fulfillment_payload)}</code>\n\n` +
      `<b>Instructions:</b>\n${escapeHtml(rawTemplate)}\n\n` +
      `<i>Thank you for choosing Bighabesha Shop! 🇪🇹</i>`;

    await ctx.reply(deliveryText, { parse_mode: 'HTML' });
  } else {
    const prodName = getProductById(verifiedOrder.product_id)?.name || verifiedOrder.product_id;
    const buyerMsg =
      `🎉 <b>Payment Verified! (Order #${escapeHtml(verifiedOrder.id)})</b>\n\n` +
      `• <b>Verified:</b> ${formatPriceETB(verifiedAmount)} via <b>${escapeHtml(railName)}</b>\n` +
      `• <b>Reference:</b> <code>${escapeHtml(refCode)}</code>\n\n` +
      `Your <b>${escapeHtml(prodName)}</b> order has been queued for immediate delivery to <b>@${escapeHtml(verifiedOrder.target_username || verifiedOrder.username || 'your account')}</b>.\n` +
      `You will receive a notification as soon as it is completed! ⚡`;

    await ctx.reply(buyerMsg, { parse_mode: 'HTML' });
  }
}

function formatBuyerFailureReply(result: VerificationResult, order: Order): string {
  const failureCode = result.error?.code;
  const orderId = order.id;

  switch (failureCode) {
    case 'RECEIPT_ALREADY_USED':
      return (
        `⚠️ <b>Payment Verification Notice (Order #${escapeHtml(orderId)})</b>\n\n` +
        `This payment receipt / transaction reference has already been used for a previous order.\n\n` +
        `Our administrators have been notified with the transaction details for manual review. ` +
        `If you believe this is an error, please contact support.`
      );

    case 'BENEFICIARY_MISMATCH':
      return (
        `⚠️ <b>Payment Verification Notice (Order #${escapeHtml(orderId)})</b>\n\n` +
        `Automated verification detected that this transfer was sent to an account that does not match our official store accounts.\n\n` +
        `Our administrators have been notified and will verify the transfer details manually.`
      );

    case 'AMOUNT_MISMATCH': {
      const paidEtb = result.bankPayload?.amountEtb;
      const amountDetails = paidEtb
        ? `Transferred amount detected: <b>${formatPriceETB(paidEtb)}</b> (Order required: <b>${formatPriceETB(order.amount_etb)}</b>).\n\n`
        : `The transferred amount does not match the required order total (${formatPriceETB(order.amount_etb)}).\n\n`;
      return (
        `⚠️ <b>Payment Verification Notice (Order #${escapeHtml(orderId)})</b>\n\n` +
        amountDetails +
        `Our administrators have been notified for manual review.`
      );
    }

    case 'RECEIPT_EXPIRED':
      return (
        `⚠️ <b>Payment Verification Notice (Order #${escapeHtml(orderId)})</b>\n\n` +
        `The timestamp on this receipt appears to be outside the accepted transaction window.\n\n` +
        `Our administrators have been notified and will review your receipt manually.`
      );

    case 'QR_DECODE_FAILED':
      return (
        `⚠️ <b>Receipt Received — Manual Review Required (Order #${escapeHtml(orderId)})</b>\n\n` +
        `We could not automatically read the QR code on your receipt screenshot (it may be blurry, cropped, or not contain a valid bank QR).\n\n` +
        `Your receipt has been submitted to our administrators for manual review. You will receive an update shortly.`
      );

    case 'BANK_PORTAL_UNAVAILABLE':
    case 'PORTAL_GEOBLOCKED':
      return (
        `⚠️ <b>Receipt Received — Bank Portal Inactive (Order #${escapeHtml(orderId)})</b>\n\n` +
        `The bank confirmation service is temporarily unavailable or taking too long to respond.\n\n` +
        `Your receipt has been forwarded to our administrators for manual verification. You will be notified as soon as it is approved!`
      );

    default: {
      const detail = result.error?.detail || 'Verification could not be completed automatically.';
      return (
        `⚠️ <b>Receipt Received — Pending Manual Review (Order #${escapeHtml(orderId)})</b>\n\n` +
        `Automated verification could not confirm your transfer (${escapeHtml(detail)}).\n\n` +
        `Our administrators have been notified and will review your receipt shortly.`
      );
    }
  }
}

async function sendVerificationFallbackReply(
  ctx: Context,
  orderId: string,
  receiptRefOrFileId: string,
  note?: string,
  result?: VerificationResult
): Promise<void> {
  const updatedOrder = submitReceipt(orderId, receiptRefOrFileId, note);
  if (result) {
    const buyerMsg = formatBuyerFailureReply(result, updatedOrder);
    await ctx.reply(buyerMsg, { parse_mode: 'HTML' });
    await notifyAdminsVerificationFallback(ctx, updatedOrder, result, receiptRefOrFileId);
  } else {
    await ctx.reply(
      `✅ <b>Receipt Received! (Order #${escapeHtml(updatedOrder.id)})</b>\n\n` +
        `Thank you! Our administrators have been notified and will verify your transfer shortly.\n` +
        `You will receive a message with your subscription / coins as soon as it is approved.`,
      { parse_mode: 'HTML' }
    );
    await notifyAdminsNewReceipt(ctx, updatedOrder);
  }
}


export async function handleAdminInput(
  ctx: Context,
  session: { type: string; data?: Record<string, any> },
  text: string,
  userId: number
): Promise<boolean> {
  if (session.type === 'admin_refund_reason' || session.data?.action === 'refund_order') {
    if (!isAdmin(userId)) return true;
    clearPendingAction(userId);
    const orderId = session.data?.orderId;
    if (!orderId) {
      await ctx.reply('❌ No order ID found in session.');
      return true;
    }
    try {
      const order = refundOrder(orderId, userId, text);
      await ctx.reply(`↩️ <b>Order <code>${order.id}</code> marked as REFUNDED.</b>`, { parse_mode: 'HTML' });

      const config = getConfig();
      const buyerMsg = `↩️ <b>Order Refund Processed</b>\n\n` +
        `Your Order #${order.id} has been refunded.\n\n` +
        `• <b>Details / Note:</b> ${escapeHtml(text)}\n\n` +
        `If you have any questions, please contact our support: @${config.SUPPORT_USERNAME || 'Vweah'}`;

      await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'HTML' }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to send refund notice to buyer');
      });
      await renderAdminOrdersQueue(ctx);
    } catch (err: any) {
      await ctx.reply(`❌ Failed to refund order: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
    return true;
  }
  return false;
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

  // SMS / transaction-reference verification flow (photo & document uploads are no longer accepted)
  if (session.type === 'user_receipt_upload') {
    const { orderId } = session.data as { orderId: string };
    const attempts = Number(session.data?.attempts || 0);
    const targetOrder = getOrderById(orderId);
    if (!targetOrder || (targetOrder.user_id !== userId && !isAdmin(userId))) {
      clearPendingAction(userId);
      await ctx.reply('Order not found.');
      return true;
    }
    if (targetOrder.status !== 'awaiting_payment') {
      clearPendingAction(userId);
      await ctx.reply(`⚠️ Cannot submit receipt: order is already <b>${escapeHtml(targetOrder.status)}</b>.`, { parse_mode: 'HTML' });
      return true;
    }

    if (text === '/cancel' || text.toLowerCase() === 'cancel') {
      clearPendingAction(userId);
      await ctx.reply('❌ Receipt upload cancelled.');
      return true;
    }

    const user = getUserById(userId);
    const isAmharic = user?.language_code === 'am' || ctx.from?.language_code?.startsWith('am');

    // Local pre-validation (regex only — never calls the bank portal): can a transaction
    // reference be extracted from the submitted text at all?
    const ingestion = await getTextIngestionService();
    let canExtract = false;
    try {
      await ingestion.ingestText(text);
      canExtract = true;
    } catch {
      canExtract = false;
    }

    if (!canExtract) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= MAX_RECEIPT_TEXT_ATTEMPTS) {
        // Retries exhausted: route through the full pipeline so the failure is audited
        // and the order lands in the admin manual-review queue (never fails open).
        clearPendingAction(userId);
        try {
          const orchestrator = await getOrchestrator();
          const result = await orchestrator.processSubmission({
            orderId,
            userId,
            source: 'sms_forward',
            note: text.slice(0, 1000),
          });
          await sendVerificationFallbackReply(ctx, orderId, 'sms-text', text.slice(0, 200), result);
        } catch (err: unknown) {
          logger.error({ err, orderId }, 'Failed to route exhausted SMS attempt to manual review');
          await sendVerificationFallbackReply(ctx, orderId, 'sms-text', text.slice(0, 200));
        }
        return true;
      }

      // Keep the pending action armed with an incremented attempt counter.
      setPendingAction(userId, { type: 'user_receipt_upload', data: { orderId, attempts: nextAttempts } }, 15);

      const guidanceMsg = isAmharic
        ? `⚠️ <b>የትራንዛክሽን ቁጥር ማግኘት አልተቻለም</b>\n\n` +
          `እባክዎ ከቴሌብር / CBE የደረሰዎትን ትክክለኛ የማረጋገጫ <b>SMS</b> አግብረው (forward) ወይም ሙሉ ጽሑፉን ቅድተው ይላኩ፣ ወይም የትራንዛክሽን ቁጥሩን ብቻ ይፃፉ (ለምሳሌ፦ <code>FT26090123456789</code>)።\n\n` +
          `ሙከራ <b>${nextAttempts}</b> ከ <b>${MAX_RECEIPT_TEXT_ATTEMPTS}</b>። ለመሰረዝ <b>/cancel</b> ይፃፉ።`
        : `⚠️ <b>Could not find a transaction reference</b>\n\n` +
          `Please send the exact confirmation <b>SMS</b> you received from Telebirr / CBE — forward it or copy-paste the full text — or type only the transaction reference number (e.g. <code>FT26090123456789</code>).\n\n` +
          `Attempt <b>${nextAttempts}</b> of <b>${MAX_RECEIPT_TEXT_ATTEMPTS}</b>. Type <b>/cancel</b> to abort.`;

      await ctx.reply(guidanceMsg, { parse_mode: 'HTML' });
      return true;
    }

    // Reference extracted — verify against the bank portal via the orchestrator pipeline.
    clearPendingAction(userId);
    try {
      const orchestrator = await getOrchestrator();
      const result = await orchestrator.processSubmission({
        orderId,
        userId,
        source: 'sms_forward',
        note: text.slice(0, 1000),
      });

      if (result.success) {
        await sendVerificationSuccessReply(ctx, orderId, targetOrder, result);
        if (isResellerEligible(targetOrder) && ctx.api) {
          void triggerAutoResellerDelivery(targetOrder.id, ctx.api).catch((err) => {
            logger.error({ err, orderId: targetOrder.id }, 'Unhandled error in triggerAutoResellerDelivery for SMS receipt');
          });
        }
        return true;
      }

      await sendVerificationFallbackReply(
        ctx,
        orderId,
        result.extractedData?.normalizedReference || result.transactionReference || 'sms-text',
        text.slice(0, 200),
        result
      );
      return true;
    } catch (err: unknown) {
      logger.error({ err, orderId }, 'Failed to process submitted SMS receipt');
      try {
        await sendVerificationFallbackReply(ctx, orderId, 'sms-text', text.slice(0, 200));
      } catch {
        await ctx.reply(`❌ Could not submit receipt: ${escapeHtml(err instanceof Error ? err.message : String(err))}`, { parse_mode: 'HTML' });
      }
      return true;
    }
  }


  // Gift recipient @username entry (Premium checkout)
  if (session.type === 'user_gift_username') {
    const { productId, variantId } = session.data as { productId: string; variantId?: string | null };
    let recipient: string;
    try {
      recipient = sanitizeUsername(text);
    } catch (err) {
      if (err instanceof InvalidUsernameError) {
        // Keep the prompt armed so the buyer can correct the username.
        await ctx.reply(
          `❌ <b>Invalid username</b>\n\nTelegram usernames are 5–32 characters using letters, digits and underscores only.\n\n<i>Send a valid @username, or type <b>/cancel</b> to abort.</i>`,
          { parse_mode: 'HTML' }
        );
        setPendingAction(userId, { type: 'user_gift_username', data: { productId, variantId: variantId || null } }, 10);
        return true;
      }
      throw err;
    }

    clearPendingAction(userId);
    await ctx.reply(
      `🎁 <b>Gifting to @${escapeHtml(recipient)}</b>\n\nLoading your payment options...`,
      { parse_mode: 'HTML' }
    );
    await initiateCheckout(ctx, productId, variantId || undefined, recipient);
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

      await ctx.reply(`✅ <b>Order <code>${escapeHtml(order.id)}</code> fulfilled with completion note!</b>`, { parse_mode: 'HTML' });

      // Notify buyer
      if (order.fulfillment_payload) {
        const deliveryText = formatFulfillmentDeliveryMessage(order.id, order.fulfillment_payload);
        await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch((err) => {
          logger.error({ err, userId: order.user_id }, 'Failed to deliver payload to buyer');
        });
      } else {
        const buyerMsg = `🎉 <b>Your Order Has Been Fulfilled!</b>\n\n` +
          `Your <b>${escapeHtml(prodName)}</b> order (<code>#${escapeHtml(order.id)}</code>) has been delivered to <b>${order.username ? `@${escapeHtml(order.username)}` : 'your account'}</b>.\n\n` +
          `📝 <b>Fulfillment Note:</b> ${escapeHtml(text)}\n\n` +
          `Thank you for choosing Bighabesha Shop! 🇪🇹`;

        await ctx.api.sendMessage(order.user_id, buyerMsg, { parse_mode: 'HTML' }).catch((err) => {
          logger.error({ err, userId: order.user_id }, 'Failed to deliver fulfillment notice to buyer');
        });
      }
      await renderAdminOrdersQueue(ctx);
    } catch (err: any) {
      await ctx.reply(`❌ Fulfillment error: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
    return true;
  }

  if (session.type === 'admin_refund_reason' || session.data?.action === 'refund_order') {
    return await handleAdminInput(ctx, session, text, userId);
  }

  switch (session.type) {
    case 'admin_reject_reason': {
      if (!isAdmin(userId)) return false;
      const { orderId } = session.data as { orderId: string };
      const reason = text;

      clearPendingAction(userId);
      try {
        const order = rejectReceipt(orderId, userId, reason);
        await ctx.reply(`✅ Order <code>${escapeHtml(order.id)}</code> has been marked REJECTED.`, { parse_mode: 'HTML' });

        // Notify buyer
        const buyerMsg = `❌ <b>Payment Verification Failed</b>\n\n` +
          `Your payment receipt for Order #${escapeHtml(order.id)} was not accepted.\n\n` +
          `• <b>Reason:</b> ${escapeHtml(reason)}\n\n` +
          `If you believe this is a mistake or have questions, please reach out to our official support: @${escapeHtml(getConfig().SUPPORT_USERNAME || 'Vweah')}`;

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

      // Circuit breaker thresholds are cached in the live adapter instances; re-apply them so the
      // operator's change takes effect immediately instead of on the next process restart.
      if (isCircuitBreakerSettingKey(settingKey)) {
        const { refreshReceiptOrchestratorSettings } = await import('../../services/receipt_verifier/index.js');
        refreshReceiptOrchestratorSettings();
      }

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

      await ctx.reply(`✅ <b>Order <code>${escapeHtml(order.id)}</code> fulfilled with screenshot proof!</b>`, { parse_mode: 'HTML' });

      // Deliver photo proof to buyer
      const buyerCaption = `🎉 <b>Your Order Has Been Fulfilled!</b>\n\n` +
        `Your <b>${escapeHtml(prodName)}</b> order (<code>#${escapeHtml(order.id)}</code>) has been delivered to <b>${order.username ? `@${escapeHtml(order.username)}` : 'your account'}</b>.\n\n` +
        `🧾 <b>Proof attached above.</b>\n` +
        (caption ? `📝 <b>Note:</b> ${escapeHtml(caption)}\n\n` : '') +
        `Thank you for choosing Bighabesha Shop! 🇪🇹`;

      const { caption: photoCaption, overflow: photoOverflow } = splitTelegramCaption(buyerCaption, 1024);
      await ctx.api.sendPhoto(order.user_id, largestPhoto.file_id, {
        caption: photoCaption,
        parse_mode: 'HTML',
      }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to send photo proof to buyer');
      });
      if (photoOverflow) {
        await ctx.api.sendMessage(order.user_id, photoOverflow, { parse_mode: 'HTML' }).catch(() => {});
      }

      // If stock payload is attached, deliver activation link and instructions
      if (order.fulfillment_payload) {
        const deliveryText = formatFulfillmentDeliveryMessage(order.id, order.fulfillment_payload);
        await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch((err) => {
          logger.error({ err, userId: order.user_id }, 'Failed to deliver payload to buyer');
        });
      }

      await renderAdminOrdersQueue(ctx);
    } catch (err: any) {
      await ctx.reply(`❌ Fulfillment error: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
    return true;
  }

  if (session.type === 'user_receipt_upload') {
    const { orderId } = session.data as { orderId: string };
    const targetOrder = getOrderById(orderId);
    if (!targetOrder || (targetOrder.user_id !== userId && !isAdmin(userId))) {
      clearPendingAction(userId);
      await ctx.reply('Order not found.');
      return true;
    }
    if (targetOrder.status !== 'awaiting_payment') {
      clearPendingAction(userId);
      await ctx.reply(`⚠️ Cannot submit receipt: order is already <b>${escapeHtml(targetOrder.status)}</b>.`, { parse_mode: 'HTML' });
      return true;
    }
    // Photo intake retired — guide the buyer to send the confirmation SMS as text instead.
    // Session stays armed and attempts are not consumed.
    await sendSmsOnlyGuidance(ctx, userId);
    return true;
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
    const targetOrder = getOrderById(orderId);
    if (!targetOrder || (targetOrder.user_id !== userId && !isAdmin(userId))) {
      clearPendingAction(userId);
      await ctx.reply('Order not found.');
      return true;
    }
    if (targetOrder.status !== 'awaiting_payment') {
      clearPendingAction(userId);
      await ctx.reply(`⚠️ Cannot submit receipt: order is already <b>${escapeHtml(targetOrder.status)}</b>.`, { parse_mode: 'HTML' });
      return true;
    }
    // Document intake retired — guide the buyer to send the confirmation SMS as text instead.
    // Session stays armed and attempts are not consumed.
    await sendSmsOnlyGuidance(ctx, userId);
    return true;
  }

  if (session.data?.action === 'admin_fulfill_proof') {
    // Authorization gate: only configured administrators may fulfil orders.
    if (!isAdmin(userId)) return true;
    clearPendingAction(userId);
    const orderId = session.data.orderId;
    const caption = ctx.message?.caption;

    if (doc.file_size && doc.file_size > MAX_RECEIPT_BUFFER_SIZE_BYTES) {
      await ctx.reply(`❌ File too large (${(doc.file_size / 1024 / 1024).toFixed(1)} MB). Maximum allowed is 10 MB.`);
      return true;
    }

    try {
      const order = fulfillOrderWithProof(orderId, userId, { fileId: doc.file_id, text: caption || doc.file_name });
      const product = getProductById(order.product_id);
      const prodName = product ? product.name : order.product_id;

      await ctx.reply(`✅ <b>Order <code>${escapeHtml(order.id)}</code> fulfilled with document proof!</b>`, { parse_mode: 'HTML' });

      // Deliver document proof to buyer
      const buyerCaption = `🎉 <b>Your Order Has Been Fulfilled!</b>\n\n` +
        `Your <b>${escapeHtml(prodName)}</b> order (<code>#${escapeHtml(order.id)}</code>) has been delivered to <b>${order.username ? `@${escapeHtml(order.username)}` : 'your account'}</b>.\n\n` +
        `🧾 <b>Proof document attached above.</b>\n` +
        (caption ? `📝 <b>Note:</b> ${escapeHtml(caption)}\n\n` : '') +
        `Thank you for choosing Bighabesha Shop! 🇪🇹`;

      const { caption: docCaption, overflow: docOverflow } = splitTelegramCaption(buyerCaption, 1024);
      await ctx.api.sendDocument(order.user_id, doc.file_id, {
        caption: docCaption,
        parse_mode: 'HTML',
      }).catch((err) => {
        logger.error({ err, userId: order.user_id }, 'Failed to send document proof to buyer');
      });
      if (docOverflow) {
        await ctx.api.sendMessage(order.user_id, docOverflow, { parse_mode: 'HTML' }).catch(() => {});
      }

      // If stock payload is attached, deliver activation link and instructions
      if (order.fulfillment_payload) {
        const deliveryText = formatFulfillmentDeliveryMessage(order.id, order.fulfillment_payload);
        await ctx.api.sendMessage(order.user_id, deliveryText, { parse_mode: 'HTML' }).catch((err) => {
          logger.error({ err, userId: order.user_id }, 'Failed to deliver payload to buyer');
        });
      }

      await renderAdminOrdersQueue(ctx);
    } catch (err: any) {
      await ctx.reply(`❌ Fulfillment error: ${escapeHtml(err.message)}`, { parse_mode: 'HTML' });
    }
    return true;
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
    const response = await fetch(fileUrl, { signal: AbortSignal.timeout(15_000) });

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

