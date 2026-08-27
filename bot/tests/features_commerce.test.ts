import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/db/index.js';
import { resetConfigCache, loadEnv } from '../src/config/env.js';
import { createOrder, getOrderById, updateOrderStatus, submitReceipt, getOrderEvents } from '../src/services/orders.service.js';
import { addStockLink } from '../src/services/stock.service.js';
import { resolveOrderPrice } from '../src/services/pricing.service.js';
import {
  validatePromo,
  redeemPromoInTx,
  applyPromoToOrder,
  createPromoCode,
  listPromoCodes,
} from '../src/services/promo.service.js';
import { getUserStats, tierForLifetime, adjustUserStats, tierDiscountPct } from '../src/services/loyalty.service.js';
import {
  attributeReferral,
  getLedgerBalance,
  getOrCreateReferralCode,
  getReferralSummary,
} from '../src/services/referral.service.js';
import { runLifecycleSweep } from '../src/services/lifecycle.service.js';
import { profitForOrder } from '../src/services/profit.service.js';
import { salesVelocity, forecastForStockProduct } from '../src/services/analytics.service.js';
import { parseBankSms, matchSmsToOrders } from '../src/services/sms_parser.service.js';
import { setSetting } from '../src/services/settings.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');
const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';

function seedUser(db: Database.Database, id: number): void {
  db.prepare('INSERT INTO users (id, username, first_name) VALUES (?, ?, ?)').run(id, `u${id}`, 'U');
}

// ---------------------------------------------------------------------------
// Feature 1+2 (pricing side): Flash sales & promo codes
// ---------------------------------------------------------------------------

describe('Feature: Promo codes & flash sales', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    process.env.NODE_ENV = 'development';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 900001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('applies percentage discounts correctly and stores them on the order', () => {
    createPromoCode({ code: 'WELCOME10', kind: 'pct', value: 10 });
    const order = createOrder({
      userId: 900001,
      productId: 'gemini_pro_18m',
      variantId: 'gemini_pro_18m_default',
      amountETB: 1500,
      paymentRail: 'cbe',
      promoCode: 'welcome10', // case-insensitive
    });

    expect(order.promo_code).toBe('WELCOME10');
    expect(order.discount_etb).toBe(150);
  });

  it('applies flat discounts and rejects codes that fully cover the order', () => {
    createPromoCode({ code: 'FLAT200', kind: 'flat', value: 200 });
    const order = createOrder({
      userId: 900001,
      productId: 'telegram_premium',
      variantId: 'tg_prem_3m',
      amountETB: 1100,
      paymentRail: 'telebirr',
      promoCode: 'FLAT200',
    });
    expect(order.discount_etb).toBe(200);

    // A flat discount >= price must be rejected outright
    createPromoCode({ code: 'TOOBIG', kind: 'flat', value: 5000 });
    expect(() =>
      createOrder({ userId: 900001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe', promoCode: 'TOOBIG' })
    ).toThrow(/exceeds/i);

    // Failed order creation must NOT consume a redemption slot
    const promo = db.prepare("SELECT used_count FROM promo_codes WHERE code='FLAT200'").get() as any;
    expect(promo.used_count).toBe(1); // only the successful order above
  });

  it('enforces max_uses atomically under sequential exhaustion', () => {
    seedUser(db, 900002);
    seedUser(db, 900003);
    createPromoCode({ code: 'ONCE', kind: 'pct', value: 5, maxUses: 1 });

    createOrder({ userId: 900001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe', promoCode: 'ONCE' });
    expect(() =>
      createOrder({ userId: 900002, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe', promoCode: 'ONCE' })
    ).toThrow(/fully redeemed/);
    void db; void 900003;
  });

  it('enforces per-user redemption limits', () => {
    createPromoCode({ code: 'ONEPER', kind: 'pct', value: 5, perUserLimit: 1 });
    createOrder({ userId: 900001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe', promoCode: 'ONEPER' });

    const check = validatePromo(getDatabase(), 'ONEPER', 900001, 1500, 'gemini_pro_18m');
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already used/i);
  });

  it('honours expiry windows and product scope', () => {
    createPromoCode({ code: 'OLDIE', kind: 'pct', value: 10, expiresAt: new Date(Date.now() - 3600_000).toISOString() });
    createPromoCode({ code: 'GEMONLY', kind: 'pct', value: 10, productScope: ['gemini_pro_18m'] });

    const expired = validatePromo(getDatabase(), 'OLDIE', 900001, 1500, 'gemini_pro_18m');
    expect(expired.ok).toBe(false);
    expect(expired.reason).toMatch(/expired/i);

    const wrongProduct = validatePromo(getDatabase(), 'GEMONLY', 900001, 1100, 'telegram_premium');
    expect(wrongProduct.ok).toBe(false);
    expect(wrongProduct.reason).toMatch(/does not apply/i);

    const rightProduct = validatePromo(getDatabase(), 'GEMONLY', 900001, 1500, 'gemini_pro_18m');
    expect(rightProduct.ok).toBe(true);
  });

  it('enforces minimum order amounts', () => {
    createPromoCode({ code: 'MIN500', kind: 'flat', value: 50, minAmountEtb: 500 });
    const tooSmall = validatePromo(getDatabase(), 'MIN500', 900001, 300, 'gemini_pro_18m');
    expect(tooSmall.ok).toBe(false);
    expect(tooSmall.reason).toMatch(/minimum order of 500 ETB/i);
  });

  it('flash sale prices activate within the window and never raise prices', () => {
    const future = Date.now() + 86400_000;
    const past = Date.now() - 3600_000;

    // Active sale
    db.prepare("UPDATE variants SET meta = ? WHERE id = 'tg_prem_3m'").run(
      JSON.stringify({ months: 3, sale_price: 900, sale_starts_at: new Date(past).toISOString(), sale_ends_at: new Date(future).toISOString() })
    );
    const active = resolveOrderPrice({ productId: 'telegram_premium', variantId: 'tg_prem_3m' });
    expect(active.amountETB).toBe(900);
    expect(active.saleApplied).toBe(true);

    // Sale not started yet → base price
    db.prepare("UPDATE variants SET meta = ? WHERE id = 'tg_prem_3m'").run(
      JSON.stringify({ months: 3, sale_price: 900, sale_starts_at: new Date(future).toISOString() })
    );
    expect(resolveOrderPrice({ productId: 'telegram_premium', variantId: 'tg_prem_3m' }).amountETB).toBe(1100);

    // Absurd "sale" above base price → ignored
    db.prepare("UPDATE variants SET meta = ? WHERE id = 'tg_prem_3m'").run(JSON.stringify({ months: 3, sale_price: 9999 }));
    expect(resolveOrderPrice({ productId: 'telegram_premium', variantId: 'tg_prem_3m' }).amountETB).toBe(1100);
  });

  it('bot-side applyPromoToOrder works on unpaid orders and survives later receipts', async () => {
    createPromoCode({ code: 'LATER5', kind: 'pct', value: 5 });
    const order = createOrder({ userId: 900001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'stars' });

    // Applied while awaiting payment
    const result = applyPromoToOrder(order.id, 900001, 'later5');
    expect(result.discountEtb).toBe(55);
    expect(result.order.status).toBe('awaiting_payment');
    expect(result.order.promo_code).toBe('LATER5');

    // Receipt upload afterwards keeps the discount intact
    const withReceipt = submitReceipt(order.id, 'file-9');
    expect(withReceipt.status).toBe('pending_approval');
    expect(withReceipt.discount_etb).toBe(55);

    // Second promo on the now-pending order blocked (status guard)
    createPromoCode({ code: 'SECOND', kind: 'pct', value: 5 });
    expect(() => applyPromoToOrder(order.id, 900001, 'SECOND')).toThrow(/unpaid orders/i);
  });

  it('promo admin CRUD validates shape', () => {
    const created = createPromoCode({ code: 'GOODCODE', kind: 'pct', value: 10 });
    expect(created.code).toBe('GOODCODE');
    expect(() => createPromoCode({ code: 'x!', kind: 'pct', value: 10 })).toThrow();
    expect(() => createPromoCode({ code: 'GOODCODE', kind: 'pct', value: 5 })).toThrow(/unique/i);
    expect(() => createPromoCode({ code: 'TOOBIG', kind: 'pct', value: 101 })).toThrow(/100/);
    expect(listPromoCodes().length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Feature 4: VIP Loyalty Tiers
// ---------------------------------------------------------------------------

describe('Feature: VIP Loyalty Tiers', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 901001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('computes tiers from lifetime spend with correct boundaries', () => {
    expect(tierForLifetime(0)).toBe('bronze');
    expect(tierForLifetime(4999)).toBe('bronze');
    expect(tierForLifetime(5000)).toBe('silver');
    expect(tierForLifetime(19999)).toBe('silver');
    expect(tierForLifetime(20000)).toBe('gold');
  });

  it('fulfilled orders increment stats and upgrade tiers automatically', () => {
    setSetting('tier_silver_etb', '1000');
    const order = createOrder({ userId: 901001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe' });
    updateOrderStatus(order.id, 'pending_approval', {}, {});
    updateOrderStatus(order.id, 'fulfilled');

    const stats = getUserStats(901001);
    expect(stats.lifetime_etb).toBe(1500);
    expect(stats.orders_count).toBe(1);
    expect(stats.tier).toBe('silver');
  });

  it('refunds decrement lifetime stats symmetrically', () => {
    const order = createOrder({ userId: 901001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    updateOrderStatus(order.id, 'fulfilled');
    expect(getUserStats(901001).lifetime_etb).toBe(1100);

    updateOrderStatus(order.id, 'refunded');
    const after = getUserStats(901001);
    expect(after.lifetime_etb).toBe(0);
    expect(after.orders_count).toBe(0);
  });

  it('tier discounts apply server-side in pricing resolution', () => {
    expect(tierDiscountPct('bronze')).toBe(0);
    expect(tierDiscountPct('silver')).toBe(2);
    expect(tierDiscountPct('gold')).toBe(5);

    const goldPrice = resolveOrderPrice({ productId: 'telegram_premium', variantId: 'tg_prem_3m', userTier: 'gold' });
    expect(goldPrice.amountETB).toBe(Math.ceil(1100 * 0.95));
    const bronzePrice = resolveOrderPrice({ productId: 'telegram_premium', variantId: 'tg_prem_3m', userTier: 'bronze' });
    expect(bronzePrice.amountETB).toBe(1100);
  });

  it('adjustUserStats never goes negative under adversarial refund sequences', () => {
    adjustUserStats(901001, -5000, -10);
    const stats = getUserStats(901001);
    expect(stats.lifetime_etb).toBeGreaterThanOrEqual(0);
    expect(stats.orders_count).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Feature 5: Two-Tier Referrals & Affiliate Commissions
// ---------------------------------------------------------------------------

describe('Feature: Two-tier referral system', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 902001); // L1 referrer
    seedUser(db, 902002); // buyer
    db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run('REFBOSS1', 902001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('attributes brand-new users via deep-link payload and blocks self-referral', () => {
    expect(attributeReferral(902002, 'ref_REFBOSS1').attributed).toBe(true);
    expect((db.prepare('SELECT referrer_id FROM users WHERE id = 902002').get() as any).referrer_id).toBe(902001);

    // Self-referral: owner uses own link
    expect(attributeReferral(902001, 'ref_REFBOSS1').attributed).toBe(false);
    // Unknown code
    expect(attributeReferral(902003, 'ref_GHOST12').attributed).toBe(false);
    // Double attribution blocked
    expect(attributeReferral(902002, 'ref_REFBOSS1').attributed).toBe(false);
  });

  it('credits L1 (5%) and L2 (1%) commissions on fulfillment, idempotently', () => {
    seedUser(db, 902003); // L1's referrer (L2)
    db.prepare('UPDATE users SET referrer_id = ? WHERE id = ?').run(902003, 902001);
    attributeReferral(902002, 'ref_REFBOSS1');

    const order = createOrder({ userId: 902002, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe' });
    updateOrderStatus(order.id, 'fulfilled');

    // L1: 5% of 1500 = 75 ; L2: 1% of 1500 = 15
    expect(getLedgerBalance(902001)).toBe(75);
    expect(getLedgerBalance(902003)).toBe(15);

    // Idempotent: forcing another fulfilled transition must not double-pay
    updateOrderStatus(order.id, 'refunded', {}, { force: true });
    updateOrderStatus(order.id, 'fulfilled', {}, { force: true });
    expect(getLedgerBalance(902001)).toBe(75);
    expect(getLedgerBalance(902003)).toBe(15);
  });

  it('discounted orders pay commission on NET revenue', () => {
    attributeReferral(902002, 'ref_REFBOSS1');
    const order = createOrder({
      userId: 902002, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default',
      amountETB: 1500, paymentRail: 'cbe', promoCode: (() => {
        createPromoCode({ code: 'NET10', kind: 'pct', value: 10 });
        return 'NET10';
      })(),
    });
    updateOrderStatus(order.id, 'fulfilled');
    // Net = 1350 → L1 = 67 (floor of 5%)
    expect(getLedgerBalance(902001)).toBe(67);
    void order;
  });

  it('referral summary exposes code, balance, downline count', () => {
    attributeReferral(902002, 'ref_REFBOSS1');
    const summary = getReferralSummary(902001);
    expect(summary.code).toBe('REFBOSS1');
    expect(summary.referredUsers).toBe(1);
    expect(summary.balanceEtb).toBe(0);
    expect(summary.commissionRatePct).toBe(5);
  });

  it('referral codes are unique per user and stable across calls', () => {
    const a = getOrCreateReferralCode(902005);
    const b = getOrCreateReferralCode(902005);
    expect(a).toBe(b);
    const c = getOrCreateReferralCode(902006);
    expect(c).not.toBe(a);
  });
});

// ---------------------------------------------------------------------------
// Features 3 & 2: TTL sweeper & recovery reminders
// ---------------------------------------------------------------------------

describe('Feature: Lifecycle sweeper (TTL cancel + reminders)', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 903001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  function insertOrder(id: string, createdHoursAgo: number): void {
    db.prepare(`
      INSERT INTO orders (id, user_id, username, product_id, amount_etb, payment_rail, status, created_at)
      VALUES (?, 903001, 'u903001', 'telegram_premium', 1100, 'cbe', 'awaiting_payment', datetime('now', '-' || ? || ' hours'))
    `).run(id, String(createdHoursAgo));
  }

  it('cancels awaiting_payment orders older than 24h with audit trail', () => {
    insertOrder('ORD-TTL-OLD', 30);
    insertOrder('ORD-TTL-NEW', 1);
    insertOrder('ORD-TTL-APPROVED', 48);
    db.prepare("UPDATE orders SET status = 'pending_approval' WHERE id = 'ORD-TTL-APPROVED'").run();

    const result = runLifecycleSweep(undefined);
    expect(result.expiredCancelled).toBe(1);
    expect(getOrderById('ORD-TTL-OLD')?.status).toBe('cancelled');
    expect(getOrderById('ORD-TTL-NEW')?.status).toBe('awaiting_payment');
    expect(getOrderById('ORD-TTL-APPROVED')?.status).toBe('pending_approval'); // never touched

    // Timeline event recorded for the sweep
    const events = getOrderEvents('ORD-TTL-OLD');
    expect(events.some((e) => e.to_status === 'cancelled' && e.actor_type === 'system')).toBe(true);
  });

  it('marks remindable orders exactly once', () => {
    insertOrder('ORD-REMIND-ME', 3); // older than default 2h, younger than 24h

    const first = runLifecycleSweep(undefined);
    expect(first.remindersSent).toBe(1);
    expect((db.prepare("SELECT reminded_at FROM orders WHERE id='ORD-REMIND-ME'").get() as any).reminded_at).toBeTruthy();

    const second = runLifecycleSweep(undefined);
    expect(second.remindersSent).toBe(0);
  });

  it('respects configured reminder hours', () => {
    setSetting('recovery_reminder_hours', '6');
    insertOrder('ORD-FRESH-CFG', 3);
    const result = runLifecycleSweep(undefined);
    expect(result.remindersSent).toBe(0); // 3h < 6h threshold
  });
});

// ---------------------------------------------------------------------------
// Feature 6: Order timeline events
// ---------------------------------------------------------------------------

describe('Feature: Order event timeline', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 904001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('records every legal transition at the single choke point', () => {
    const order = createOrder({ userId: 904001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    submitReceipt(order.id, 'file-x');
    updateOrderStatus(order.id, 'rejected', { rejection_reason: 'blurry' }, { actorType: 'admin', actorId: '111111111' });
    submitReceipt(order.id, 'file-y');

    const events = getOrderEvents(order.id);
    const statuses = events.map((e) => e.to_status);
    expect(statuses[0]).toBe('awaiting_payment'); // creation event
    expect(statuses).toContain('pending_approval');
    expect(statuses).toContain('rejected');
    // Re-submission appended again
    expect(statuses.filter((s) => s === 'pending_approval').length).toBe(2);
    // Actor attribution preserved
    const rejectEvent = events.find((e) => e.to_status === 'rejected');
    expect(rejectEvent?.actor_type).toBe('admin');
    expect(rejectEvent?.actor_id).toBe('111111111');
  });

  it('illegal transitions append NO events', () => {
    const order = createOrder({ userId: 904001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    submitReceipt(order.id);
    const before = getOrderEvents(order.id).length;
    expect(() => updateOrderStatus(order.id, 'awaiting_payment')).toThrow();
    expect(getOrderEvents(order.id).length).toBe(before);
    void db;
  });
});

// ---------------------------------------------------------------------------
// Feature 11: Net-profit analytics
// ---------------------------------------------------------------------------

describe('Feature: True net-profit engine', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 905001);
    // Cost basis: Gemini costs 8 USD/unit
    db.prepare("INSERT INTO variant_costs (variant_id, unit_cost_usd) VALUES ('gemini_pro_18m_default', 8)").run();
    setSetting('etb_per_usd', '150'); // fx snapshot at sale time
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('snapshots cost basis and FX rate immutably at creation', () => {
    const order = createOrder({ userId: 905001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'chapa' as any });
    expect(order.cost_basis_usd).toBe(8);
    expect(order.fx_rate_at_sale).toBe(150);

    // Later cost changes don't affect the historical snapshot
    db.prepare('INSERT INTO variant_costs (variant_id, unit_cost_usd) VALUES (?, ?)').run('gemini_pro_18m_default', 20);
    const order2 = createOrder({ userId: 905001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'chapa' as any });
    expect(order2.cost_basis_usd).toBe(20);
    expect(getOrderById(order.id)?.cost_basis_usd).toBe(8);
    void db;
  });

  it('computes net profit with COGS and rail fees', () => {
    setSetting('chapa_fee_pct', '2');
    const order = createOrder({ userId: 905001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'chapa' as any });

    const p = profitForOrder(order);
    expect(p.netRevenueEtb).toBe(1500);
    expect(p.cogsEtb).toBe(1200);          // 8 USD × 150
    expect(p.railFeeEtb).toBe(30);         // 2% of 1500
    expect(p.netProfitEtb).toBe(270);      // 1500 − 1200 − 30
    expect(p.marginPct).toBeCloseTo(18, 0);
  });

  it('manual rails carry zero platform fees', () => {
    const order = createOrder({ userId: 905001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe' });
    expect(profitForOrder(order).railFeeEtb).toBe(0);
  });

  it('orders without cost snapshots report unknown COGS rather than fabricating numbers', () => {
    const order = createOrder({ userId: 905001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    const p = profitForOrder(order);
    expect(p.cogsEtb).toBeNull();
    expect(p.netProfitEtb).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feature 12: Predictive restock forecasting
// ---------------------------------------------------------------------------

describe('Feature: Restock velocity forecasting', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 906001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('calculates rolling velocity from fulfilled orders', () => {
    // Seed 7 fulfilled orders in the last day
    for (let i = 0; i < 7; i++) {
      const o = createOrder({ userId: 906001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe' });
      updateOrderStatus(o.id, 'fulfilled');
    }
    const velocity = salesVelocity('gemini_pro_18m', 7);
    expect(velocity).toBe(1); // 7 units / 7 days
  });

  it('flags reorder when days-of-cover drops below lead time', () => {
    for (let i = 0; i < 14; i++) {
      const o = createOrder({ userId: 906001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe' });
      updateOrderStatus(o.id, 'fulfilled');
    }
    // velocity = 2/day; available = 5 → cover = 2.5 days < 7-day lead
    const forecast = forecastForStockProduct('gemini_pro_18m', 5);
    expect(forecast.velocityPerDay).toBe(2);
    expect(forecast.daysOfCover).toBeCloseTo(2.5, 0);
    expect(forecast.reorderNow).toBe(true);

    // Deep stock → no reorder flag despite high velocity
    const healthy = forecastForStockProduct('gemini_pro_18m', 500);
    expect(healthy.reorderNow).toBe(false);
  });

  it('never flags reorder when there is no demand signal', () => {
    const forecast = forecastForStockProduct('gemini_pro_18m', 0);
    expect(forecast.velocityPerDay).toBe(0);
    expect(forecast.reorderNow).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feature 9: CBE SMS parser & matcher
// ---------------------------------------------------------------------------

describe('Feature: CBE SMS confirmation matching', () => {
  let db: Database.Database;

  beforeEach(() => {
    process.env.BOT_TOKEN = TOKEN;
    process.env.ADMIN_IDS = '111111111';
    process.env.WALLET_PAY_MODE = 'mock';
    resetConfigCache();
    db = initDatabase(':memory:', MIGRATIONS_DIR);
    seedUser(db, 907001);
  });

  afterEach(() => {
    closeDatabase();
    resetConfigCache();
  });

  it('parses common CBE debit formats', () => {
    const s1 = parseBankSms('You have transferred 1,500.00 Birr to ABEBE KEBED via CBE Birr. Ref: FT2501ABCD');
    expect(s1?.amountEtb).toBe(1500);
    expect(s1?.direction).toBe('debit');

    const s2 = parseBankSms('Debited: ETB 2,500.00 Ref: FT99XYZ1234 on 25/08/2026 14:32 Balance: 5,000.00 ETB');
    expect(s2?.amountEtb).toBe(2500);
    expect(s2?.reference).toBe('FT99XYZ1234');

    const s3 = parseBankSms('ETB : 1,100.00 transferred. Reference: FT777QQQQ');
    expect(s3?.amountEtb).toBe(1100);
    expect(s3?.reference).toBe('FT777QQQQ');
  });

  it('rejects garbage and non-debit content', () => {
    expect(parseBankSms('hello there friend')).toBeNull();
    expect(parseBankSms('<script>alert(1)</script>')).toBeNull();
    expect(parseBankSms('')).toBeNull();
  });

  it('matches unique open orders by exact net amount within window', () => {
    const order = createOrder({ userId: 907001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });

    const match = matchSmsToOrders(getDatabase(), 907001, { amountEtb: 1100, reference: 'FT123' });
    expect(match.matched).toBe(true);
    expect(match.orderId).toBe(order.id);

    const wrongAmount = matchSmsToOrders(getDatabase(), 907001, { amountEtb: 1099, reference: 'FT123' });
    expect(wrongAmount.matched).toBe(false);
    expect(wrongAmount.reason).toBe('no_amount_match');
  });

  it('respects discounts (net payable) and refuses ambiguous matches', () => {
    createPromoCode({ code: 'HALF', kind: 'pct', value: 50 });
    createOrder({ userId: 907001, productId: 'gemini_pro_18m', variantId: 'gemini_pro_18m_default', amountETB: 1500, paymentRail: 'cbe', promoCode: 'HALF' });

    // Net payable = 750
    const discounted = matchSmsToOrders(getDatabase(), 907001, { amountEtb: 750, reference: 'X1' });
    expect(discounted.matched).toBe(true);

    // Two orders with identical amounts → ambiguous, no guess
    createOrder({ userId: 907001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    createOrder({ userId: 907001, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'cbe' });
    const ambiguous = matchSmsToOrders(getDatabase(), 907001, { amountEtb: 1100, reference: 'X2' });
    expect(ambiguous.matched).toBe(false);
    expect(ambiguous.reason).toBe('ambiguous');
  });

  it('other users orders never leak into matching (IDOR guard)', () => {
    seedUser(db, 907002);
    createOrder({ userId: 907002, productId: 'telegram_premium', variantId: 'tg_prem_3m', amountETB: 1100, paymentRail: 'telebirr' });
    const match = matchSmsToOrders(getDatabase(), 907001, { amountEtb: 1100, reference: 'X' });
    expect(match.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Env contract for new integrations
// ---------------------------------------------------------------------------

describe('Advanced env contracts', () => {
  it('parses SUPPORT_GROUP_ID as integer or leaves undefined', () => {
    const cfg = loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '1', SUPPORT_GROUP_ID: '-1001234567890' });
    expect(cfg.SUPPORT_GROUP_ID).toBe(-1001234567890);
    const cfg2 = loadEnv({ BOT_TOKEN: TOKEN, ADMIN_IDS: '1', SUPPORT_GROUP_ID: '' });
    expect(cfg2.SUPPORT_GROUP_ID).toBeUndefined();
  });
});
