import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import { updateOrderStatus } from './orders.service.js';
import { getNumericSetting } from './settings.service.js';

export interface LifecycleResult {
  remindersSent: number;
  expiredCancelled: number;
}

/**
 * Abandoned-checkout rescue + stale-order hygiene.
 *  - Reminds buyers with unpaid orders once after `recovery_reminder_hours`.
 *  - Cancels `awaiting_payment` orders older than `order_ttl_hours`.
 * Both are legal transitions under the order state machine.
 */
export function runLifecycleSweep(bot?: { api: { sendMessage: (id: number, text: string, opts?: any) => Promise<unknown> }, botInfo?: { username?: string } }): LifecycleResult {
  const db = getDatabase();
  const now = Date.now();
  const reminderHours = getNumericSetting('recovery_reminder_hours', 2);
  const ttlHours = getNumericSetting('order_ttl_hours', 24);

  // --- 1. Abandoned checkout reminders (exactly once per order) ------------
  let remindersSent = 0;
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
      if (bot && bot.botInfo?.username) {
        const deepLink = `https://t.me/${bot.botInfo.username}?start=resume_${order.id}`;
        bot.api
          .sendMessage(
            order.user_id,
            `⏰ <b>Complete your order</b>\n\nOrder <code>${order.id}</code> is still awaiting payment.\nTap to finish checkout securely:\n${deepLink}`,
            { parse_mode: 'HTML', disable_web_page_preview: true }
          )
          .catch(() => {});
      }
      remindersSent++;
    } catch {
      // Notification failures never block the bookkeeping below.
    }
    db.prepare('UPDATE orders SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?').run(order.id);
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

  if (remindersSent || expiredCancelled) {
    logger.info({ remindersSent, expiredCancelled }, 'Lifecycle sweep completed');
  }
  return { remindersSent, expiredCancelled };
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
