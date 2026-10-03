import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import { updateOrderStatus } from './orders.service.js';
import { getNumericSetting } from './settings.service.js';
import { getConfig } from '../config/env.js';

export interface LifecycleResult {
  remindersSent: number;
  expiredCancelled: number;
  staleApprovalsEscalated?: number;
  pendingDispatches?: Promise<unknown>[];
}

/** Minimum gap between two stale-approval digest alerts. */
export const STALE_APPROVAL_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
let lastStaleApprovalAlertTime = 0;

/** Test helper to reset the alert cooldown timestamp. */
export function resetStaleApprovalAlertCooldownForTest(): void {
  lastStaleApprovalAlertTime = 0;
}

/**
 * Abandoned-checkout rescue + stale-order hygiene.
 *  - Reminds buyers with unpaid orders once after `recovery_reminder_hours`.
 *  - Cancels `awaiting_payment` orders older than `order_ttl_hours`.
 *  - Escalates `pending_approval` orders older than `pending_approval_ttl_hours`.
 * The first two are legal transitions under the order state machine.
 *
 * NOTE: the third deliberately does NOT change order status. An order sitting in
 * `pending_approval` usually means the buyer has already paid and a human has not
 * approved it yet. Auto-cancelling would hide real revenue and, because refunds are a
 * database state flip with no money movement, would make it easy to forget to pay the
 * buyer. This sweep only surfaces the backlog to administrators.
 */
export function runLifecycleSweep(bot?: { api: { sendMessage: (id: number, text: string, opts?: any) => Promise<unknown> }, botInfo?: { username?: string } }): LifecycleResult {
  const db = getDatabase();
  const reminderHours = getNumericSetting('recovery_reminder_hours', 2);
  const ttlHours = getNumericSetting('order_ttl_hours', 24);
  const approvalTtlHours = getNumericSetting('pending_approval_ttl_hours', 48);

  // --- 1. Abandoned checkout reminders (exactly once per order) ------------
  let remindersSent = 0;
  const pendingDispatches: Promise<unknown>[] = [];
  const remindable = db.prepare(`
    SELECT id, user_id, username FROM orders
    WHERE status = 'awaiting_payment'
      AND reminded_at IS NULL
      AND created_at <= datetime('now', '-' || ? || ' hours')
      AND created_at > datetime('now', '-' || ? || ' hours')
    LIMIT 200
  `).all(reminderHours, String(ttlHours)) as { id: string; user_id: number; username: string | null }[];

  for (const order of remindable) {
    try {
      if (bot) {
        const linkSnippet = bot.botInfo?.username
          ? `\nTap to finish checkout securely:\nhttps://t.me/${bot.botInfo.username}?start=resume_${order.id}`
          : '';
        const dispatch = bot.api
          .sendMessage(
            order.user_id,
            `⏰ <b>Complete your order</b>\n\nOrder <code>${order.id}</code> is still awaiting payment.${linkSnippet}`,
            { parse_mode: 'HTML', disable_web_page_preview: true }
          )
          .then(() => {
            db.prepare('UPDATE orders SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?').run(order.id);
          })
          .catch((err: any) => {
            logger.warn({ err, orderId: order.id }, 'Failed to deliver abandoned checkout reminder to buyer');
          });
        pendingDispatches.push(dispatch);
        remindersSent++;
      } else {
        // Headless / test invocation without bot instance
        db.prepare('UPDATE orders SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?').run(order.id);
        remindersSent++;
      }
    } catch {
      // Notification failures never block the bookkeeping below.
    }
  }

  // --- 2. TTL sweeper: cancel long-abandoned unpaid orders -----------------
  let expiredCancelled = 0;
  const stale = db.prepare(`
    SELECT id, user_id FROM orders
    WHERE status = 'awaiting_payment'
      AND created_at <= datetime('now', '-' || ? || ' hours')
    LIMIT 500
  `).all(String(ttlHours)) as { id: string; user_id: number }[];

  for (const order of stale) {
    try {
      updateOrderStatus(order.id, 'cancelled', {}, {
        actorType: 'system',
        actorId: 'ttl-sweeper',
        note: `Auto-cancelled after ${ttlHours}h without payment`,
      });
      expiredCancelled++;
    } catch (err) {
      logger.warn({ err, orderId: order.id }, 'TTL sweeper could not cancel order');
    }
  }

  // --- 3. Stale approval escalation (never auto-cancels) --------------------
  // An order in `pending_approval` means the buyer has paid and is waiting on a
  // human decision. Nothing ages it out today, so a backlog can hide indefinitely.
  // We flag each order once and alert administrators; status is left untouched.
  let staleApprovalsEscalated = 0;
  const staleApprovals = db.prepare(`
    SELECT id, user_id, username, amount_etb, created_at
    FROM orders
    WHERE status = 'pending_approval'
      AND stale_approval_flagged_at IS NULL
      AND created_at <= datetime('now', '-' || ? || ' hours')
    ORDER BY created_at ASC
    LIMIT 100
  `).all(String(approvalTtlHours)) as {
    id: string;
    user_id: number;
    username: string | null;
    amount_etb: number;
    created_at: string;
  }[];

  if (staleApprovals.length > 0) {
    const nowMs = Date.now();
    const withinCooldown = nowMs - lastStaleApprovalAlertTime < STALE_APPROVAL_ALERT_COOLDOWN_MS;

    // Flag every stale order regardless of cooldown: the admin-notes marker and the
    // dedupe column are what stop a repeat alert, not the cooldown.
    for (const order of staleApprovals) {
      try {
        db.prepare(`
          UPDATE orders
          SET stale_approval_flagged_at = CURRENT_TIMESTAMP,
              admin_notes = COALESCE(admin_notes, '') || ?
          WHERE id = ?
        `).run(`\n[Stale Approval] Unapproved for over ${approvalTtlHours}h — buyer has paid, needs a decision.`, order.id);
        staleApprovalsEscalated++;
      } catch (err) {
        logger.warn({ err, orderId: order.id }, 'Could not flag stale pending_approval order');
      }
    }

    if (withinCooldown) {
      logger.info(
        { flagged: staleApprovalsEscalated, lastAlertMsAgo: nowMs - lastStaleApprovalAlertTime },
        'Stale approval alert suppressed by cooldown'
      );
    } else if (bot) {
      const total = db
        .prepare(`
          SELECT COUNT(*) AS c, COALESCE(SUM(amount_etb), 0) AS total
          FROM orders
          WHERE status = 'pending_approval'
        `)
        .get() as { c: number; total: number };
      const oldest = db
        .prepare(`
          SELECT id, created_at FROM orders
          WHERE status = 'pending_approval'
          ORDER BY created_at ASC LIMIT 1
        `)
        .get() as { id: string; created_at: string } | undefined;

      const lines = staleApprovals
        .slice(0, 10)
        .map((o) => `• <code>${o.id}</code> — ${o.amount_etb} ETB (waiting since ${o.created_at})`)
        .join('\n');
      const more = staleApprovals.length > 10 ? `\n…and ${staleApprovals.length - 10} more.` : '';

      const message =
        `⏳ <b>Stale pending approvals</b>\n\n` +
        `${staleApprovals.length} order(s) have been waiting over <b>${approvalTtlHours}h</b> for approval ` +
        `with a receipt on file.\n` +
        (oldest ? `Oldest: <code>${oldest.id}</code> since ${oldest.created_at}\n` : '') +
        `Currently ${total.c} order(s) awaiting approval, ${total.total} ETB.\n\n` +
        `${lines}${more}\n\n` +
        `These are <b>not</b> auto-cancelled — they are paid orders awaiting a decision. ` +
        `Review them in the admin dashboard.`;

      for (const adminId of getConfig().ADMIN_IDS) {
        bot.api
          .sendMessage(adminId, message, { parse_mode: 'HTML' })
          .catch((err: any) => {
            logger.error({ err, adminId }, 'Failed to send stale approval alert to admin');
          });
      }
      lastStaleApprovalAlertTime = nowMs;
    }
  }

  if (remindersSent || expiredCancelled || staleApprovalsEscalated) {
    logger.info(
      { remindersSent, expiredCancelled, staleApprovalsEscalated },
      'Lifecycle sweep completed'
    );
  }
  return { remindersSent, expiredCancelled, staleApprovalsEscalated };
}

let lifecycleTimer: NodeJS.Timeout | null = null;

export function startLifecycleJobs(bot?: any, intervalMs: number = 10 * 60 * 1000): NodeJS.Timeout {
  if (lifecycleTimer) clearInterval(lifecycleTimer);
  lifecycleTimer = setInterval(() => {
    try {
      runLifecycleSweep(bot);
    } catch (err) {
      logger.error({ err }, 'Lifecycle sweep failed');
    }
  }, intervalMs);
  if (lifecycleTimer.unref) lifecycleTimer.unref();
  return lifecycleTimer;
}

export function stopLifecycleJobs(): void {
  if (lifecycleTimer) {
    clearInterval(lifecycleTimer);
    lifecycleTimer = null;
  }
}
