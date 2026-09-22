import crypto from 'crypto';
import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import { allocateStock } from './stock.service.js';
import { getProductById } from './catalog.service.js';
import { assertPositiveIntegerETB, PricingError } from './pricing.service.js';
import { getNumericSetting } from './settings.service.js';
import { adjustUserStats } from './loyalty.service.js';
import { redeemPromoInTx, releasePromoRedemption } from './promo.service.js';
import { invalidate } from './cache.service.js';
import { parseBankSms } from './sms_parser.service.js';
import {
  getLatestEvidenceForOrder,
  checkAntiReplay,
  markEvidenceMatchedInTx,
} from '../db/receipt_evidence.dao.js';
import {
  SupportedBank,
  ReceiptAlreadyUsedError,
} from './receipt_verifier/types.js';
import type { SecurityPillarEvaluation } from './receipt_verifier/types.js';
import {
  DEFAULT_RECENCY_BEFORE_MINUTES,
  DEFAULT_RECENCY_AFTER_MINUTES,
} from './receipt_verifier/constants.js';

export type ActivePaymentRail = 'telebirr' | 'cbe' | 'abyssinia';
export type PaymentRail = ActivePaymentRail | 'chapa' | 'wallet_pay' | 'ton_connect';
export const ACTIVE_PAYMENT_RAILS: ActivePaymentRail[] = ['telebirr', 'cbe', 'abyssinia'];

export function isActivePaymentRail(rail: string): rail is ActivePaymentRail {
  return (ACTIVE_PAYMENT_RAILS as string[]).includes(rail);
}
export type OrderStatus =
  | 'new'
  | 'awaiting_payment'
  | 'pending_approval'
  | 'pending_fulfillment'
  | 'processing'
  | 'delivery_failed'
  | 'fulfilled'
  | 'rejected'
  | 'refunded'
  | 'cancelled';

/** Telegram Premium term lengths, validated at the reseller boundary. */
export type PremiumMonths = 3 | 6 | 12;

export interface Order {
  id: string;
  user_id: number;
  username: string | null;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  amount_etb: number;
  discount_etb: number;
  promo_code: string | null;
  payment_rail: PaymentRail;
  payment_ref: string | null;
  crypto_amount: number | null;
  crypto_currency: string | null;
  reminded_at: string | null;
  cost_basis_usd: number | null;
  fx_rate_at_sale: number | null;
  status: OrderStatus;
  receipt_file_id: string | null;
  receipt_note: string | null;
  fulfillment_payload: string | null;
  fulfillment_proof: string | null;
  rejection_reason: string | null;
  admin_notes: string | null;
  // B2B reseller fulfillment (Telegram Premium pipeline, nullable for non-Premium orders)
  target_username: string | null;
  reseller_provider: string | null;
  reseller_tx_id: string | null;
  reseller_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderEvent {
  id: number;
  order_id: string;
  from_status: string | null;
  to_status: string;
  actor_type: string;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface CreateOrderInput {
  userId: number;
  username?: string | null;
  productId: string;
  variantId?: string | null;
  quantity?: number;
  amountETB: number;
  paymentRail: PaymentRail;
  paymentRef?: string | null;
  status?: OrderStatus;
  /** Optional promo code — validated and atomically redeemed with the order. */
  promoCode?: string | null;
  /** Public Telegram @username that will receive a Premium subscription. */
  targetUsername?: string | null;
}

export function generateOrderId(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  // 48 bits of CSPRNG entropy (~281T combinations per second-tick): collisions
  // are vanishingly unlikely, and createOrder() retries on the residual case.
  const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `ORD-${timestamp}-${rand}`;
}

/**
 * Strict order state machine. Transitions NOT listed here are illegal and
 * throw an InvalidOrderTransitionError — protecting receipts, fulfillment
 * records, and financial invariants from silent regressions.
 *
 * Key guarantees:
 *  - pending_approval NEVER regresses to awaiting_payment (receipts survive)
 *  - fulfilled orders can only be refunded
 *  - cancelled and refunded are terminal
 *  - rejected orders may return to pending_approval when the buyer re-uploads
 *  - 010 adds the B2B reseller pipeline: pending_approval → processing →
 *    fulfilled | delivery_failed, with delivery_failed retrying to processing
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['new', 'awaiting_payment', 'pending_approval', 'pending_fulfillment', 'processing', 'fulfilled', 'cancelled'],
  awaiting_payment: ['awaiting_payment', 'pending_approval', 'pending_fulfillment', 'processing', 'fulfilled', 'cancelled'],
  pending_approval: ['pending_approval', 'pending_fulfillment', 'processing', 'fulfilled', 'rejected', 'refunded'],
  // reseller pipeline: brackets the outbound provider call
  processing: ['processing', 'fulfilled', 'delivery_failed'],
  delivery_failed: ['delivery_failed', 'processing', 'rejected', 'refunded'],
  fulfilled: ['fulfilled', 'refunded'],
  rejected: ['rejected', 'pending_approval', 'refunded', 'cancelled'],
  refunded: ['refunded'],
  cancelled: ['cancelled'],
  // manual/stock path (Gemini Pro + hand-fulfilled orders) — not a reseller status.
  pending_fulfillment: ['pending_fulfillment', 'processing', 'fulfilled', 'refunded', 'rejected'],
};

export class OutOfStockError extends Error {
  constructor(message: string = 'This product is currently out of stock.') {
    super(message);
    this.name = 'OutOfStockError';
  }
}

export class InvalidOrderTransitionError extends Error {
  constructor(orderId: string, from: OrderStatus, to: OrderStatus) {
    super(`Illegal order transition for ${orderId}: "${from}" -> "${to}" is not permitted.`);
    this.name = 'InvalidOrderTransitionError';
  }
}

export function isTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/**
 * Telegram username format: 5–32 characters, alphanumerics and underscores only.
 * Must NOT be purely numeric (Telegram user IDs are not public @usernames).
 */
export const TELEGRAM_USERNAME_RE = /^(?![0-9]+$)[a-zA-Z0-9_]{5,32}$/;

/** Returns true when the username (with or without leading @) is a valid Telegram handle. */
export function isValidUsername(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@+/, '')
    .trim();
  return TELEGRAM_USERNAME_RE.test(cleaned);
}

/**
 * Normalizes a buyer-supplied recipient username: trims, strips the leading
 * '@' / URLs, and enforces the Telegram character/length rules.
 */
export function sanitizeUsername(raw: string): string {
  let cleaned = raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@+/, '')
    .trim();
  if (!TELEGRAM_USERNAME_RE.test(cleaned)) {
    throw new InvalidUsernameError(raw);
  }
  return cleaned.toLowerCase();
}

export class InvalidUsernameError extends Error {
  constructor(public readonly input: string) {
    super(`Invalid Telegram username: "${input}". Usernames are 5-32 characters (letters, numbers, underscores).`);
    this.name = 'InvalidUsernameError';
  }
}

export function createOrder(input: CreateOrderInput): Order {
  // Fail-closed guard: no order may ever be created with a non-positive,
  // non-integer, or client-forged price. Callers must resolve prices via
  // pricing.service.resolveOrderPrice() before reaching this point.
  try {
    assertPositiveIntegerETB(input.amountETB);
  } catch {
    logger.error(
      { userId: input.userId, productId: input.productId, amountETB: input.amountETB },
      'Rejected order creation with invalid amount'
    );
    throw new PricingError(`Invalid order amount for ${input.productId}`);
  }

  const db = getDatabase();
  const status: OrderStatus = input.status || 'awaiting_payment';

  // Retry on the (rare) primary-key collision of a freshly generated id.
  // Each attempt is a fresh transaction, so a failed attempt rolls back
  // cleanly — including any promo redemption side effects.
  let createdOrderId: { promoCode: string | null } | null = null;
  let orderId = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    orderId = generateOrderId();
    try {
      createdOrderId = db.transaction(() => {
        // Ensure user exists in users table to satisfy foreign key
        db.prepare(`
          INSERT INTO users (id, username, first_name)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            username = COALESCE(excluded.username, users.username),
            updated_at = CURRENT_TIMESTAMP
        `).run(input.userId, input.username || null, input.username || 'Buyer');

        // Immutable cost snapshot for net-profit analytics
        let costBasisUsd: number | null = null;
        if (input.variantId) {
          const costRow = db.prepare(
            'SELECT unit_cost_usd FROM variant_costs WHERE variant_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1'
          ).get(input.variantId) as { unit_cost_usd: number } | undefined;
          costBasisUsd = costRow?.unit_cost_usd ?? null;
        }
        const fxRate = getNumericSetting('etb_per_usd', 135);

        let discountEtb = 0;
        let promoCode: string | null = null;
        if (input.promoCode) {
          const applied = redeemPromoInTx(input.promoCode, input.userId, input.amountETB, input.productId, orderId);
          discountEtb = applied.discountEtb;
          promoCode = applied.code;
        }

        db.prepare(`
          INSERT INTO orders (
            id, user_id, username, product_id, variant_id, quantity,
            amount_etb, payment_rail, payment_ref, status,
            cost_basis_usd, fx_rate_at_sale, discount_etb, promo_code, target_username
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orderId,
          input.userId,
          input.username || null,
          input.productId,
          input.variantId || null,
          input.quantity || 1,
          input.amountETB,
          input.paymentRail,
          input.paymentRef || null,
          status,
          costBasisUsd,
          fxRate,
          discountEtb,
          promoCode,
          input.targetUsername ? sanitizeUsername(input.targetUsername) : null
        );

        appendOrderEvent(orderId, null, status, 'user', String(input.userId), 'Order created');
        return { promoCode };
      })();
      break;
    } catch (err: any) {
      const isIdCollision =
        String(err?.code || '').startsWith('SQLITE_CONSTRAINT') && /orders\.id/i.test(String(err?.message || ''));
      if (!isIdCollision || attempt === 2) throw err;
      logger.warn({ attempt }, 'Order ID collision — regenerating and retrying');
    }
  }
  if (!createdOrderId) {
    throw new Error(`Failed to create order ${orderId}`);
  }

  logger.info({ orderId, userId: input.userId, productId: input.productId, amountETB: input.amountETB, promo: createdOrderId.promoCode }, 'Order created');
  invalidate('admin:overview');
  const created = getOrderById(orderId);
  if (!created) throw new Error(`Failed to retrieve newly created order ${orderId}`);
  return created;
}

export function getOrderById(orderId: string): Order | undefined {
  try {
    const db = getDatabase();
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Order | undefined;
  } catch (err) {
    logger.error({ err, orderId }, 'Failed to get order by ID');
    return undefined;
  }
}

export function getOrdersByUserId(userId: number, limit: number = 20): Order[] {
  try {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(userId, limit) as Order[];
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch user orders');
    return [];
  }
}

export interface TransitionOptions {
  force?: boolean;
  actorType?: 'user' | 'admin' | 'system';
  actorId?: string;
  note?: string;
}

export function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  updates: Partial<Order> = {},
  opts: TransitionOptions = {}
): Order {
  const db = getDatabase();
  const current = getOrderById(orderId);
  if (!current) {
    throw new Error(`Order ${orderId} not found`);
  }

  // State machine guard: refuse illegal transitions unless explicitly forced.
  if (!opts.force && !isTransitionAllowed(current.status, status)) {
    logger.warn(
      { orderId, from: current.status, to: status },
      'Blocked illegal order status transition'
    );
    throw new InvalidOrderTransitionError(orderId, current.status, status);
  }

  const updated = db.transaction(() => {
    const fields: string[] = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values: any[] = [status];

    if (updates.payment_ref !== undefined) {
      fields.push('payment_ref = ?');
      values.push(updates.payment_ref);
    }
    if (updates.crypto_amount !== undefined) {
      fields.push('crypto_amount = ?');
      values.push(updates.crypto_amount);
    }
    if (updates.crypto_currency !== undefined) {
      fields.push('crypto_currency = ?');
      values.push(updates.crypto_currency);
    }
    if (updates.receipt_file_id !== undefined) {
      fields.push('receipt_file_id = ?');
      values.push(updates.receipt_file_id);
    }
    if (updates.receipt_note !== undefined) {
      fields.push('receipt_note = ?');
      values.push(updates.receipt_note);
    }
    if (updates.fulfillment_payload !== undefined) {
      fields.push('fulfillment_payload = ?');
      values.push(updates.fulfillment_payload);
    }
    if (updates.fulfillment_proof !== undefined) {
      fields.push('fulfillment_proof = ?');
      values.push(updates.fulfillment_proof);
    }
    if (updates.rejection_reason !== undefined) {
      fields.push('rejection_reason = ?');
      values.push(updates.rejection_reason);
    }
    if (updates.admin_notes !== undefined) {
      fields.push('admin_notes = ?');
      values.push(updates.admin_notes);
    }
    if (updates.target_username !== undefined) {
      fields.push('target_username = ?');
      values.push(updates.target_username ? sanitizeUsername(updates.target_username) : null);
    }
    if (updates.reseller_provider !== undefined) {
      fields.push('reseller_provider = ?');
      values.push(updates.reseller_provider);
    }
    if (updates.reseller_tx_id !== undefined) {
      fields.push('reseller_tx_id = ?');
      values.push(updates.reseller_tx_id);
    }
    if (updates.reseller_error !== undefined) {
      fields.push('reseller_error = ?');
      values.push(updates.reseller_error);
    }

    values.push(orderId);
    db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    // Timeline instrumentation (single choke point for ALL transitions)
    appendOrderEvent(orderId, current.status, status, opts.actorType ?? 'system', opts.actorId ?? null, opts.note ?? null);

    // Post-transition business hooks (same transaction — atomic with status)
    runFulfillmentHooks(current, status, orderId);

    return getOrderById(orderId);
  })();

  logger.info({ orderId, previousStatus: current.status, newStatus: status }, 'Order status updated');
  if (!updated) throw new Error(`Failed to fetch updated order ${orderId}`);
  invalidate('admin:overview');
  return updated;
}

function appendOrderEvent(
  orderId: string,
  fromStatus: string | null,
  toStatus: string,
  actorType: string,
  actorId: string | null,
  note: string | null
): void {
  try {
    getDatabase().prepare(
      `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(orderId, fromStatus, toStatus, actorType, actorId, note);
  } catch (err) {
    // Never let timeline bookkeeping break an order transition.
    logger.error({ err, orderId }, 'Failed to append order event');
  }
}

/**
 * Business hooks fired atomically on status changes:
 *  - fulfilled: loyalty stats increment + L1/L2 referral commissions
 *  - fulfilled → refunded: loyalty stats decrement
 */
function runFulfillmentHooks(before: Order, toStatus: OrderStatus, orderId: string): void {
  try {
    const becameFulfilled = toStatus === 'fulfilled' && before.status !== 'fulfilled';
    const unfulfilledViaRefund = before.status === 'fulfilled' && toStatus === 'refunded';

    if (becameFulfilled) {
      adjustUserStats(before.user_id, before.amount_etb, +1);
      creditReferralCommissions(before);
      invalidate('userstats:' + before.user_id);
    } else if (unfulfilledViaRefund) {
      adjustUserStats(before.user_id, -before.amount_etb, -1);
      invalidate('userstats:' + before.user_id);
    } else if (toStatus === 'cancelled') {
      releasePromoRedemption(orderId);
      const db = getDatabase();
      db.prepare(`
        UPDATE stock_items
        SET status = 'available', order_id = NULL, allocated_at = NULL
        WHERE order_id = ?
      `).run(orderId);
      invalidate('bootstrap:catalog');
    }
  } catch (err) {
    logger.error({ err, orderId }, 'Post-transition hook failure');
    throw err; // inside transaction — rolls back together with the transition
  }
}

/** L1/L2 referral commissions on fulfillment. Idempotent via idempotency_key. */
function creditReferralCommissions(order: Order): void {
  const db = getDatabase();
  const l1Pct = getNumericSetting('referral_l1_pct', 5);
  const l2Pct = getNumericSetting('referral_l2_pct', 1);
  const payable = order.amount_etb - (order.discount_etb || 0);
  if (payable <= 0) return;

  const buyer = db.prepare('SELECT referrer_id FROM users WHERE id = ?').get(order.user_id) as { referrer_id: number | null } | undefined;
  const l1 = buyer?.referrer_id ?? null;
  if (!l1) return;

  const levels: { userId: number; pct: number; key: string }[] = [
    { userId: l1, pct: l1Pct, key: `ref:${order.id}:L1` },
  ];
  const l2Row = db.prepare('SELECT referrer_id FROM users WHERE id = ?').get(l1) as { referrer_id: number | null } | undefined;
  if (l2Row?.referrer_id && l2Row.referrer_id !== order.user_id) {
    levels.push({ userId: l2Row.referrer_id, pct: l2Pct, key: `ref:${order.id}:L2` });
  }

  for (const level of levels) {
    if (level.pct <= 0) continue;
    const amount = Math.floor((payable * level.pct) / 100);
    if (amount <= 0) continue;

    db.prepare(`
      INSERT INTO ledger_entries (user_id, direction, amount_etb, type, ref_order_id, idempotency_key, note)
      VALUES (?, 'credit', ?, 'commission', ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(level.userId, amount, order.id, level.key, `${level.pct}% commission`);
  }
}

export function getOrderEvents(orderId: string): OrderEvent[] {
  return getDatabase()
    .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC')
    .all(orderId) as OrderEvent[];
}

/**
 * Updates payment metadata (rail, provider ref, crypto quote) WITHOUT
 * changing the order status. Used when a buyer switches payment rails on an
 * order that is already pending approval — the receipt and status must be
 * preserved.
 */
export function updateOrderMeta(
  orderId: string,
  meta: Partial<Pick<Order, 'payment_rail' | 'payment_ref' | 'crypto_amount' | 'crypto_currency'>>
): Order {
  const db = getDatabase();
  const current = getOrderById(orderId);
  if (!current) {
    throw new Error(`Order ${orderId} not found`);
  }

  const fields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [];

  if (meta.payment_rail !== undefined) {
    fields.push('payment_rail = ?');
    values.push(meta.payment_rail);
  }
  if (meta.payment_ref !== undefined) {
    fields.push('payment_ref = ?');
    values.push(meta.payment_ref);
  }
  if (meta.crypto_amount !== undefined) {
    fields.push('crypto_amount = ?');
    values.push(meta.crypto_amount);
  }
  if (meta.crypto_currency !== undefined) {
    fields.push('crypto_currency = ?');
    values.push(meta.crypto_currency);
  }

  values.push(orderId);
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  logger.info({ orderId, meta: { ...meta, payment_ref: meta.payment_ref ? '***' : undefined } }, 'Order payment metadata updated');
  const updated = getOrderById(orderId);
  if (!updated) throw new Error(`Failed to fetch updated order ${orderId}`);
  return updated;
}

export function submitReceipt(orderId: string, fileId: string, note?: string): Order {
  return updateOrderStatus(orderId, 'pending_approval', {
    receipt_file_id: fileId,
    receipt_note: note || null,
  });
}

/**
 * Builds the persisted 4-pillar security evaluation payload for a MANUAL admin approval.
 *
 * Manual approvals deliberately waive automated verification. Each pillar therefore records what
 * the administrator asserted in place of an automated expectation (`expected`) and what was
 * actually observed/stored (`actual`), so the audit trail stays contract-complete
 * (`SecurityPillarEvaluation` requires both) and downstream consumers never read `undefined`.
 */
function buildManualApprovalEvaluations(
  order: Order,
  adminId: number,
  effectiveRef: string
): SecurityPillarEvaluation[] {
  const beforeMins = getNumericSetting('receipt_recency_before_mins', DEFAULT_RECENCY_BEFORE_MINUTES);
  const afterMins = getNumericSetting('receipt_recency_after_mins', DEFAULT_RECENCY_AFTER_MINUTES);

  return [
    {
      pillar: 'anti_replay',
      passed: true,
      expected: 'unique_reference',
      actual: effectiveRef,
      details: `Manual approval by Admin ${adminId}`,
    },
    {
      pillar: 'beneficiary_whitelist',
      passed: true,
      expected: 'authorized_beneficiary',
      actual: 'manual_admin_approval',
      details: `Verified by Admin ${adminId}`,
    },
    {
      pillar: 'exact_amount',
      passed: true,
      expected: order.amount_etb,
      actual: order.amount_etb,
      details: `Amount ${order.amount_etb} ETB verified by Admin ${adminId}`,
    },
    {
      pillar: 'recency_window',
      passed: true,
      expected: `-${beforeMins}m / +${afterMins}m (waived)`,
      actual: 'manual_admin_override',
      details: `Approved by Admin ${adminId}`,
    },
  ];
}

export function approveReceipt(
  orderId: string,
  adminId: number,
  options?: { reference?: string; bank?: SupportedBank }
): { order: Order; autoDeliveredItem: any | null } {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== 'pending_approval' && order.status !== 'awaiting_payment') {
    throw new Error(`Order ${orderId} is in status "${order.status}" and cannot be approved.`);
  }

  const db = getDatabase();

  // 1. Resolve rail/bank
  let bank: SupportedBank = options?.bank || 'unknown';
  if (bank === 'unknown') {
    const rail = (order.payment_rail || '').toLowerCase();
    if (rail.includes('cbe')) bank = 'cbe';
    else if (rail.includes('telebirr')) bank = 'telebirr';
    else if (rail.includes('abyssinia')) bank = 'abyssinia';
  }

  // 2. Fetch latest receipt evidence if present
  const evidence = getLatestEvidenceForOrder(orderId, db);
  if (evidence && evidence.bank !== 'unknown' && bank === 'unknown') {
    bank = evidence.bank;
  }

  // 3. Resolve transaction reference
  let ref: string | undefined = options?.reference?.trim();
  if (!ref && evidence?.normalized_reference && !evidence.normalized_reference.startsWith('UNKNOWN')) {
    ref = evidence.normalized_reference;
  }
  if (!ref && evidence?.reference && !evidence.reference.startsWith('UNKNOWN')) {
    ref = evidence.reference;
  }
  if (!ref && order.payment_ref) {
    const cleanPaymentRef = order.payment_ref.trim();
    if (!cleanPaymentRef.startsWith('manual:') && !cleanPaymentRef.startsWith('text:')) {
      ref = cleanPaymentRef;
    }
  }
  if (!ref && order.receipt_note) {
    const parsedSms = parseBankSms(order.receipt_note);
    if (parsedSms?.reference) {
      ref = parsedSms.reference;
    } else {
      const refMatch = order.receipt_note.match(/\b(FT[A-Z0-9]{8,24})\b/i) ||
                       order.receipt_note.match(/(?:ref|reference|txid|txn)[\s:=-]+([A-Z0-9]{6,30})/i);
      if (refMatch) {
        ref = refMatch[1];
      }
    }
  }
  if (!ref && evidence?.raw_text) {
    const parsedSms = parseBankSms(evidence.raw_text);
    if (parsedSms?.reference) {
      ref = parsedSms.reference;
    } else {
      const refMatch = evidence.raw_text.match(/\b(FT[A-Z0-9]{8,24})\b/i) ||
                       evidence.raw_text.match(/(?:ref|reference|txid|txn)[\s:=-]+([A-Z0-9]{6,30})/i);
      if (refMatch) {
        ref = refMatch[1];
      }
    }
  }

  const normalizedRef = ref ? ref.trim().toUpperCase() : `MANUAL-${order.id}`;
  const effectiveRef = ref ? ref.trim() : normalizedRef;

  // 4. Anti-Replay Check (both for reference and file hash)
  if (ref) {
    const replay = checkAntiReplay(bank, ref, order.id, db);
    if (replay.isReplay) {
      throw new ReceiptAlreadyUsedError(ref, replay.existingOrderId);
    }
  }

  if (evidence?.file_hash) {
    const dupHash = db.prepare(`
      SELECT order_id FROM receipt_evidence
      WHERE file_hash = ? AND matched = 1 AND order_id != ?
      LIMIT 1
    `).get(evidence.file_hash, order.id) as { order_id: string } | undefined;
    if (dupHash) {
      throw new ReceiptAlreadyUsedError(`FILE_HASH:${evidence.file_hash}`, dupHash.order_id);
    }
  }

  // 5. Atomic transaction to mark evidence matched and transition order
  let autoDeliveredItem: any = null;
  let updatedOrder: Order;

  const product = getProductById(order.product_id);
  const manualEvaluations = buildManualApprovalEvaluations(order, adminId, effectiveRef);

  const approveTx = db.transaction(() => {
    // Record / match receipt_evidence with matched = 1
    if (evidence) {
      markEvidenceMatchedInTx(db, {
        evidenceId: evidence.id,
        bank,
        reference: effectiveRef,
        normalizedReference: normalizedRef,
        verifiedAmountEtb: order.amount_etb,
        beneficiaryAccount: 'manual_admin_approved',
        securityGateEvaluations: manualEvaluations,
        rawBankPayload: {
          approvedByAdminId: adminId,
          approvedAt: new Date().toISOString(),
          manualApproval: true,
        },
      });
    } else {
      const insertStmt = db.prepare(`
        INSERT INTO receipt_evidence (
          order_id, user_id, bank, source, raw_text, amount_etb,
          reference, normalized_reference, matched, verified_amount_etb,
          beneficiary_account, security_gate_passed, security_gate_evaluations,
          status, file_path, ip_address
        ) VALUES (?, ?, ?, 'manual_admin_entry', ?, ?, ?, ?, 1, ?, 'manual_admin_approved', 1, ?, 'auto_verified', ?, NULL)
      `);
      insertStmt.run(
        order.id,
        order.user_id,
        bank,
        order.receipt_note || null,
        order.amount_etb,
        effectiveRef,
        normalizedRef,
        order.amount_etb,
        JSON.stringify(manualEvaluations),
        order.receipt_file_id || null
      );
    }

    if (product && product.type === 'stock') {
      const alloc = allocateStock(order.product_id, order.id);
      if (alloc.item) {
        autoDeliveredItem = alloc.item;
        updatedOrder = updateOrderStatus(order.id, 'fulfilled', {
          payment_ref: effectiveRef,
          fulfillment_payload: alloc.item.payload,
          admin_notes: `Approved by Admin ${adminId} (Auto-fulfilled stock item #${alloc.item.id})`,
        });
        return;
      }
    }

    updatedOrder = updateOrderStatus(order.id, 'pending_fulfillment', {
      payment_ref: effectiveRef,
      admin_notes: `Approved by Admin ${adminId}`,
    });
  });

  approveTx();

  return { order: updatedOrder!, autoDeliveredItem };
}

export function getFulfillmentQueue(): Order[] {
  try {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM orders
      WHERE status = 'pending_fulfillment'
      ORDER BY created_at ASC, rowid ASC
    `).all() as Order[];
  } catch (err) {
    logger.error({ err }, 'Failed to fetch fulfillment queue');
    return [];
  }
}

export function fulfillOrderWithProof(
  orderId: string,
  adminId: number,
  proof?: { text?: string; fileId?: string }
): Order {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const product = getProductById(order.product_id);
  let fulfillmentPayload = order.fulfillment_payload;

  if (product && product.type === 'stock') {
    if (!fulfillmentPayload) {
      const alloc = allocateStock(order.product_id, order.id);
      if (!alloc.item) {
        throw new Error('Stock is currently sold out. Please add activation links to stock before fulfilling this order.');
      }
      fulfillmentPayload = alloc.item.payload;
    }
  }

  const proofText = proof?.text || (proof?.fileId ? 'Screenshot Proof Attached' : null);

  return updateOrderStatus(orderId, 'fulfilled', {
    fulfillment_payload: fulfillmentPayload,
    fulfillment_proof: proofText || null,
    receipt_file_id: proof?.fileId || order.receipt_file_id,
    admin_notes: `Fulfilled by Admin ${adminId}`,
  });
}

export function refundOrder(orderId: string, adminId: number, reason?: string): Order {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const db = getDatabase();

  return db.transaction(() => {
    // If this order had an allocated stock item, restore it to 'available'
    db.prepare(`
      UPDATE stock_items
      SET status = 'available', order_id = NULL, allocated_at = NULL
      WHERE order_id = ?
    `).run(orderId);

    // If referral commissions were credited for this order, debit them back
    const referralCredits = db.prepare(`
      SELECT user_id, amount_etb FROM ledger_entries
      WHERE ref_order_id = ? AND direction = 'credit' AND type = 'commission'
    `).all(orderId) as { user_id: number; amount_etb: number }[];

    for (const credit of referralCredits) {
      const revKey = `ref:rev:${orderId}:${credit.user_id}`;
      db.prepare(`
        INSERT INTO ledger_entries (user_id, direction, amount_etb, type, ref_order_id, idempotency_key, note)
        VALUES (?, 'debit', ?, 'payout', ?, ?, 'Referral commission reversed due to order refund')
        ON CONFLICT(idempotency_key) DO NOTHING
      `).run(credit.user_id, credit.amount_etb, orderId, revKey);
    }

    return updateOrderStatus(orderId, 'refunded', {
      rejection_reason: reason || 'Refunded by administrator',
      admin_notes: `Refunded by Admin ${adminId}: ${reason || 'Manual refund'}`,
    });
  })();
}

export function rejectReceipt(orderId: string, adminId: number, reason: string): Order {
  const order = getOrderById(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  return updateOrderStatus(orderId, 'rejected', {
    rejection_reason: reason,
    admin_notes: `Rejected by Admin ${adminId}: ${reason}`,
  });
}
