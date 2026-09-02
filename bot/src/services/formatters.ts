import { escapeHtml } from '../utils/html.js';

export interface StatusBadge {
  label: string;
  badge: string;
  icon: string;
}

export interface PaymentRailInfo {
  label: string;
  code: string;
  icon: string;
}

/**
 * Formats ETB currency with standard comma separators.
 */
export function formatPriceETB(amount: number): string {
  return `${amount.toLocaleString('en-US')} ETB`;
}

/**
 * Standard brand header with clean aesthetic rule.
 */
export function formatBrandHeader(title: string, subtitle?: string): string {
  let header = `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n<b>${escapeHtml(title)}</b>\n`;
  if (subtitle) {
    header += `<i>${escapeHtml(subtitle)}</i>\n`;
  }
  return header + '\n';
}

/**
 * Clean section divider.
 */
export function formatSectionDivider(): string {
  return `\n────────────────────────────\n\n`;
}

/**
 * Formats a key-value row with bold label and code/formatted value.
 */
export function formatRow(label: string, value: string | number, isCode: boolean = false): string {
  const valStr = String(value);
  const formattedVal = isCode ? `<code>${escapeHtml(valStr)}</code>` : escapeHtml(valStr);
  return `• <b>${escapeHtml(label)}:</b> ${formattedVal}\n`;
}

/**
 * Formats a blockquote section for readable instructions.
 */
export function formatBlockquote(content: string): string {
  return `<blockquote>${content}</blockquote>`;
}

/**
 * Resolves standard order status badges with clean iconography.
 */
export function formatOrderStatus(status: string): StatusBadge {
  switch (status) {
    case 'fulfilled':
    case 'delivered':
      return { label: 'Delivered', badge: '✅ Delivered', icon: '✅' };
    case 'pending_approval':
      return { label: 'Under Review', badge: '⏳ Slip Under Review', icon: '⏳' };
    case 'pending_fulfillment':
    case 'processing':
      return { label: 'Processing', badge: '📦 Processing Delivery', icon: '📦' };
    case 'delivery_failed':
      return { label: 'Delivery Issue', badge: '⚠️ Delivery Retrying', icon: '⚠️' };
    case 'awaiting_payment':
      return { label: 'Awaiting Payment', badge: '💳 Awaiting Payment', icon: '💳' };
    case 'rejected':
      return { label: 'Rejected', badge: '❌ Payment Rejected', icon: '❌' };
    case 'refunded':
      return { label: 'Refunded', badge: '↩️ Refunded', icon: '↩️' };
    case 'cancelled':
      return { label: 'Cancelled', badge: '🚫 Cancelled', icon: '🚫' };
    default:
      return { label: status, badge: `[${status}]`, icon: '•' };
  }
}

/**
 * Formats payment rail display with icons.
 */
export function formatPaymentRail(rail: string): PaymentRailInfo {
  const r = (rail || '').toLowerCase();
  if (r === 'telebirr') return { label: 'Telebirr', code: 'TELEBIRR', icon: '📱' };
  if (r === 'cbe') return { label: 'CBE Bank', code: 'CBE', icon: '🏦' };
  if (r === 'abyssinia') return { label: 'Bank of Abyssinia', code: 'BOA', icon: '🏛' };
  if (r === 'stars') return { label: 'Telegram Stars (XTR)', code: 'STARS', icon: '⭐️' };
  if (r === 'wallet_pay' || r === 'wp') return { label: 'Wallet Pay', code: 'WALLET_PAY', icon: '🪙' };
  if (r === 'ton' || r === 'ton_connect') return { label: 'TON Connect', code: 'TON', icon: '💎' };
  if (r === 'chapa') return { label: 'Chapa Direct', code: 'CHAPA', icon: '💳' };
  return { label: (rail || 'OTHER').toUpperCase(), code: (rail || 'OTHER').toUpperCase(), icon: '💳' };
}

/**
 * Formats welcome message with brand styling.
 */
export function formatWelcomeMessage(): string {
  return (
    `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
    `💎 <b>Official Digital Goods & Subscription Store</b>\n\n` +
    `• <b>Gemini Pro (18 Months)</b> — Instant activation link with 2TB storage\n` +
    `• <b>Telegram Premium</b> — 3, 6, 12-month direct gifts to @username\n` +
    `• <b>Telegram Stars</b> — Flexible packages & custom amounts\n\n` +
    `<i>⚡ Automated instant delivery via Telebirr, CBE, Abyssinia, Stars & Crypto.</i>`
  );
}

/**
 * Formats manual bank payment instructions with copyable code.
 */
export function formatBankPaymentInstructions(options: {
  railTitle: string;
  accountNum: string;
  accountName: string;
  amountEtb: number;
  orderId: string;
}): string {
  const { railTitle, accountNum, accountName, amountEtb, orderId } = options;
  return (
    `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
    `🏦 <b>Payment via ${escapeHtml(railTitle)}</b>\n\n` +
    `Please transfer exactly <b>${formatPriceETB(amountEtb)}</b> to:\n\n` +
    `• <b>Account / Phone:</b> <code>${escapeHtml(accountNum)}</code> <i>(Tap to copy)</i>\n` +
    `• <b>Account Name:</b> <b>${escapeHtml(accountName)}</b>\n` +
    `• <b>Payment Reference:</b> <code>${escapeHtml(orderId)}</code>\n\n` +
    `<blockquote>📸 Take a screenshot of your transfer confirmation, then tap <b>[Upload Transfer Receipt]</b> below.</blockquote>`
  );
}

/**
 * Formats delivered digital key payload with instructions.
 */
export function formatDeliveryMessage(orderId: string, payload: string, instructions?: string): string {
  const defaultInst = '1. Ensure your VPN is active before opening the link.\n2. Open the link to complete activation on your Google account.\n3. Disconnect VPN once activation is confirmed.';
  const inst = instructions || defaultInst;

  return (
    `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
    `🎉 <b>Order Delivered Successfully!</b>\n\n` +
    `• <b>Order ID:</b> <code>${escapeHtml(orderId)}</code>\n` +
    `• <b>Status:</b> <b>DELIVERED</b>\n\n` +
    `🔑 <b>Activation Credential / Link:</b>\n` +
    `<code>${escapeHtml(payload)}</code>\n\n` +
    `📋 <b>Activation Instructions:</b>\n` +
    formatBlockquote(escapeHtml(inst)) +
    `\n\n<i>Thank you for choosing Bighabesha Shop.</i>`
  );
}

/**
 * Formats an order summary card for checkout confirmation.
 */
export function formatCheckoutSummary(options: {
  productName: string;
  orderId: string;
  amountEtb: number;
  discountEtb?: number;
  promoCode?: string | null;
  starsDue: number;
  usdAmount: number;
  tonAmount: number;
}): string {
  const { productName, orderId, amountEtb, discountEtb = 0, promoCode, starsDue, usdAmount, tonAmount } = options;
  const netAmount = Math.max(amountEtb - discountEtb, 1);

  let text = (
    `<b>━━━━━ ʙɪɢʜᴀʙᴇꜱʜᴀ ꜱʜᴏᴘ ━━━━━</b>\n` +
    `🛍 <b>Checkout Confirmation</b>\n\n` +
    `• <b>Product:</b> ${escapeHtml(productName)}\n` +
    `• <b>Order Reference:</b> <code>${escapeHtml(orderId)}</code>\n`
  );

  if (discountEtb > 0) {
    text += (
      `• <b>Original Price:</b> <s>${formatPriceETB(amountEtb)}</s>\n` +
      `• <b>Promo (${escapeHtml(promoCode || '')}):</b> <b>−${formatPriceETB(discountEtb)}</b>\n`
    );
  }

  text += (
    `• <b>Total Payable:</b> <b>${formatPriceETB(netAmount)}</b>\n\n` +
    `<b>Supported Payment Equivalents:</b>\n` +
    `• ⭐️ <b>Telegram Stars:</b> <code>${starsDue} XTR</code>\n` +
    `• 💎 <b>TON / USDT:</b> <code>$${usdAmount.toFixed(2)} USD</code> (~${tonAmount} TON)\n\n` +
    `<i>Select your payment method below:</i>`
  );

  return text;
}
