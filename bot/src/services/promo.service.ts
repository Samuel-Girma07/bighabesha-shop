import type Database from 'better-sqlite3';
import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';

export interface PromoValidationResult {
  ok: boolean;
  reason?: string;
  discountEtb?: number;
  promoId?: number;
  finalAmountEtb?: number;
}

interface PromoRow {
  id: number;
  code: string;
  kind: 'pct' | 'flat';
  value: number;
  max_uses: number | null;
  used_count: number;
  per_user_limit: number;
  expires_at: string | null;
  min_amount_etb: number;
  product_scope: string;
  is_active: number;
}

/**
 * Pure validation of a promo code against a prospective order.
 * Returns the computed discount WITHOUT mutating anything — safe for
 * previews and for use inside an outer transaction before the atomic
 * redemption increment.
 */
export function validatePromo(
  db: Database.Database,
  code: string,
  userId: number,
  amountETB: number,
  productId: string,
  nowMs: number = Date.now()
): PromoValidationResult {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return { ok: false, reason: 'Enter a promo code.' };

  const row = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(clean) as PromoRow | undefined;
  if (!row || !row.is_active) return { ok: false, reason: 'Invalid or expired promo code.' };

  if (row.expires_at) {
    // Handles both SQLite 'YYYY-MM-DD HH:MM:SS' and ISO strings robustly.
    const raw = String(row.expires_at);
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
    const expiresMs = Date.parse(normalized);
    if (Number.isFinite(expiresMs) && nowMs >= expiresMs) {
      return { ok: false, reason: 'This promo code has expired.' };
    }
  }

  if (row.max_uses !== null && row.used_count >= row.max_uses) {
    return { ok: false, reason: 'This promo code has been fully redeemed.' };
  }

  const redemptions = db
    .prepare('SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id = ? AND user_id = ?')
    .get(row.id, userId) as { c: number };
  if (redemptions.c >= row.per_user_limit) {
    return { ok: false, reason: 'You have already used this promo code.' };
  }

  if (amountETB < row.min_amount_etb) {
    return { ok: false, reason: `Promo requires a minimum order of ${row.min_amount_etb.toLocaleString('en-US')} ETB.` };
  }

  const scope = JSON.parse(row.product_scope || '[]') as string[];
  if (scope.length > 0 && !scope.includes(productId)) {
    return { ok: false, reason: 'This promo code does not apply to the selected product.' };
  }

  let discount =
    row.kind === 'pct'
      ? Math.floor((amountETB * Math.min(row.value, 100)) / 100)
      : row.value;

  // A promo may never fully cover an order (payment rails require ≥1 ETB).
  if (discount >= amountETB) {
    return { ok: false, reason: 'Discount exceeds the order total.' };
  }
  if (discount < 0) discount = 0;

  return { ok: true, discountEtb: discount, promoId: row.id, finalAmountEtb: amountETB - discount };
}

export interface AppliedPromo {
  promoId: number;
  code: string;
  discountEtb: number;
  finalAmountEtb: number;
}

/**
 * Atomically validates AND redeems a promo within the caller's transaction.
 * The caller MUST be inside a better-sqlite3 transaction together with the
 * order INSERT so a failed order rolls back the redemption counter.
 */
export function redeemPromoInTx(
  code: string,
  userId: number,
  amountETB: number,
  productId: string,
  orderId: string,
  nowMs: number = Date.now()
): AppliedPromo {
  const db = getDatabase();
  const check = validatePromo(db, code, userId, amountETB, productId, nowMs);
  if (!check.ok || check.promoId === undefined || check.discountEtb === undefined || check.finalAmountEtb === undefined) {
    throw new Error(check.reason || 'Promo code could not be applied.');
  }

  // Atomic guard against concurrent over-redemption: the conditional UPDATE
  // only succeeds while usage remains under max_uses.
  const row = db.prepare('SELECT max_uses FROM promo_codes WHERE id = ?').get(check.promoId) as { max_uses: number | null };
  if (row.max_uses !== null) {
    const res = db
      .prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND max_uses IS NOT NULL AND used_count < max_uses')
      .run(check.promoId);
    if (res.changes === 0) {
      throw new Error('This promo code has been fully redeemed.');
    }
  } else {
    db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?').run(check.promoId);
  }

  db.prepare(
    'INSERT INTO promo_redemptions (promo_id, user_id, order_id, discount_etb) VALUES (?, ?, ?, ?)'
  ).run(check.promoId, userId, orderId, check.discountEtb);

  logger.info({ promoId: check.promoId, orderId, userId, discount: check.discountEtb }, 'Promo code redeemed');
  return { promoId: check.promoId, code: String(code).trim().toUpperCase(), discountEtb: check.discountEtb, finalAmountEtb: check.finalAmountEtb };
}

/** Applies a promo to an EXISTING awaiting-payment order (bot rail-screen flow). */
export function applyPromoToOrder(orderId: string, userId: number, code: string): { order: any; discountEtb: number; finalAmountEtb: number } {
  const db = getDatabase();

  // Pre-flight guards outside the transaction for clean error messages.
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
  if (!existing || existing.user_id !== userId) throw new Error('Order not found.');
  if (existing.status !== 'awaiting_payment' && existing.status !== 'new') {
    throw new Error('Promo codes can only be applied to unpaid orders.');
  }
  if (existing.promo_code) throw new Error('A promo code is already applied to this order.');

  // Atomic: redemption counter + order discount commit or roll back together.
  const applied = db.transaction(() => {
    const result = redeemPromoInTx(code, userId, existing.amount_etb, existing.product_id, orderId);
    db.prepare('UPDATE orders SET discount_etb = ?, promo_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(result.discountEtb, result.code, orderId);
    return result;
  })();

  logger.info({ orderId, code: applied.code }, 'Promo applied to existing order');
  return { order: getOrderAfter(orderId), discountEtb: applied.discountEtb, finalAmountEtb: applied.finalAmountEtb };
}

function getOrderAfter(orderId: string): any {
  return getDatabase().prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

// ---------------------------------------------------------------------------
// Admin CRUD helpers (used by dashboard endpoints)
// ---------------------------------------------------------------------------

export function createPromoCode(input: {
  code: string; kind: 'pct' | 'flat'; value: number;
  maxUses?: number | null; perUserLimit?: number; expiresAt?: string | null;
  minAmountEtb?: number; productScope?: string[];
}): any {
  const db = getDatabase();
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error('Code must be 3-32 chars (A-Z, 0-9, _ or -).');
  if (!(input.value > 0)) throw new Error('Discount value must be positive.');
  if (input.kind === 'pct' && input.value > 100) throw new Error('Percentage discounts cannot exceed 100.');

  const res = db.prepare(`
    INSERT INTO promo_codes (code, kind, value, max_uses, per_user_limit, expires_at, min_amount_etb, product_scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code, input.kind, input.value,
    input.maxUses ?? null, input.perUserLimit ?? 1,
    input.expiresAt ?? null, input.minAmountEtb ?? 0,
    JSON.stringify(input.productScope ?? [])
  );
  return db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(res.lastInsertRowid);
}

export function listPromoCodes(): any[] {
  return getDatabase().prepare('SELECT * FROM promo_codes ORDER BY id DESC').all();
}
