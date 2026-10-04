import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/db/index.js';
import { createOrder, getOrderById } from '../src/services/orders.service.js';
import { setSetting } from '../src/services/settings.service.js';
import {
  runLifecycleSweep,
  resetStaleApprovalAlertCooldownForTest,
} from '../src/services/lifecycle.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../src/db/migrations');

process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '111111111';

const BUYER_ID = 1001;

function makeBot() {
  const sent: { adminId: number; text: string }[] = [];
  return {
    sent,
    api: {
      sendMessage: vi.fn(async (adminId: number, text: string) => {
        sent.push({ adminId, text });
        return {};
      }),
    },
    botInfo: { username: 'testbot' },
  };
}

/** Backdate an order so it looks older than the given number of hours. */
function backdateHours(orderId: string, hours: number): void {
  const db = initDbRef!;
  db.prepare(
    `UPDATE orders SET created_at = datetime('now', '-' || ? || ' hours') WHERE id = ?`
  ).run(String(hours), orderId);
}

let initDbRef: Database.Database | null = null;

describe('Lifecycle sweep: stale pending_approval escalation', () => {
  let db: Database.Database;

  beforeEach(() => {
    initDbRef = db = initDatabase(':memory:', migrationsDir);
    resetStaleApprovalAlertCooldownForTest();

    db.prepare(`INSERT INTO users (id, username, first_name) VALUES (${BUYER_ID}, 'buyer', 'Buyer')`).run();
    db.prepare(
      `INSERT INTO products (id, type, name, description) VALUES ('gemini_pro', 'stock', 'Gemini Pro 18M', 'Test')
       ON CONFLICT(id) DO NOTHING`
    ).run();
  });

  afterEach(() => {
    initDbRef = null;
    closeDatabase();
    vi.restoreAllMocks();
  });

  function makePaidOrder(rail: 'cbe' | 'telebirr' = 'cbe') {
    return createOrder({
      userId: BUYER_ID,
      productId: 'gemini_pro',
      amountETB: 1250,
      paymentRail: rail,
    });
  }

  // ==========================================================================
  // Core contract: escalate, never cancel
  // ==========================================================================

  it('flags a stale pending_approval order and alerts admins', () => {
    setSetting('pending_approval_ttl_hours', '48');
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 72);

    const bot = makeBot();
    const result = runLifecycleSweep(bot as never);

    expect(result.staleApprovalsEscalated).toBe(1);
    expect(bot.sent.length).toBeGreaterThan(0);
    expect(bot.sent[0].text).toContain('Stale pending approvals');
    expect(bot.sent[0].text).toContain(order.id);
  });

  it('NEVER cancels or transitions a paid order that is awaiting approval', () => {
    setSetting('pending_approval_ttl_hours', '48');
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 500);

    runLifecycleSweep(makeBot() as never);

    // The whole point: paid orders must not disappear from the queue.
    expect(getOrderById(order.id)?.status).toBe('pending_approval');
  });

  it('records the flag timestamp and an explanatory admin note', () => {
    setSetting('pending_approval_ttl_hours', '48');
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 72);

    runLifecycleSweep(makeBot() as never);

    const row = db
      .prepare('SELECT stale_approval_flagged_at, admin_notes FROM orders WHERE id = ?')
      .get(order.id) as { stale_approval_flagged_at: string | null; admin_notes: string | null };

    expect(row.stale_approval_flagged_at).toBeTruthy();
    expect(row.admin_notes).toContain('Stale Approval');
  });

  it('escalates each order only once across repeated sweeps', () => {
    setSetting('pending_approval_ttl_hours', '48');
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 72);

    const first = runLifecycleSweep(makeBot() as never);
    expect(first.staleApprovalsEscalated).toBe(1);

    // Second sweep must not re-flag or re-alert for the same order.
    const bot2 = makeBot();
    resetStaleApprovalAlertCooldownForTest();
    const second = runLifecycleSweep(bot2 as never);
    expect(second.staleApprovalsEscalated).toBe(0);
    expect(bot2.sent.length).toBe(0);
  });

  it('leaves orders inside the TTL window alone', () => {
    setSetting('pending_approval_ttl_hours', '48');
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 5);

    const bot = makeBot();
    const result = runLifecycleSweep(bot as never);

    expect(result.staleApprovalsEscalated).toBe(0);
    expect(bot.sent.length).toBe(0);
  });

  it('ignores orders that are still awaiting payment', () => {
    setSetting('pending_approval_ttl_hours', '48');
    const order = makePaidOrder(); // stays in awaiting_payment
    backdateHours(order.id, 72);

    const result = runLifecycleSweep(makeBot() as never);
    expect(result.staleApprovalsEscalated).toBe(0);
  });

  // ==========================================================================
  // TTL configuration
  // ==========================================================================

  it('honours a custom TTL from settings', () => {
    setSetting('pending_approval_ttl_hours', '2');
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 3);

    const result = runLifecycleSweep(makeBot() as never);
    expect(result.staleApprovalsEscalated).toBe(1);
  });

  it('falls back to 48h when the TTL setting is missing or garbage', () => {
    db.prepare(`DELETE FROM settings WHERE key = 'pending_approval_ttl_hours'`).run();
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 47);

    // Under the 48h default this order is still fresh.
    expect(runLifecycleSweep(makeBot() as never).staleApprovalsEscalated).toBe(0);

    backdateHours(order.id, 50);
    expect(runLifecycleSweep(makeBot() as never).staleApprovalsEscalated).toBe(1);
  });

  // ==========================================================================
  // Headless operation
  // ==========================================================================

  it('flags orders correctly in a headless sweep with no bot instance', () => {
    setSetting('pending_approval_ttl_hours', '48');
    const order = makePaidOrder();
    db.prepare(`UPDATE orders SET status = 'pending_approval' WHERE id = ?`).run(order.id);
    backdateHours(order.id, 72);

    // No bot: must not throw, and must still do the bookkeeping.
    const result = runLifecycleSweep(undefined);
    expect(result.staleApprovalsEscalated).toBe(1);
    expect(getOrderById(order.id)?.status).toBe('pending_approval');
  });

  it('preserves the existing result contract for existing callers', () => {
    const result = runLifecycleSweep(undefined);
    expect(result).toHaveProperty('remindersSent');
    expect(result).toHaveProperty('expiredCancelled');
    expect(typeof result.remindersSent).toBe('number');
    expect(typeof result.expiredCancelled).toBe('number');
  });
});
