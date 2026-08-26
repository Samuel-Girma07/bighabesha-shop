import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import { purgeOldReceipts } from './receipts.service.js';

export interface CleanupResult {
  expiredAdminSessions: number;
  expiredAdminOtps: number;
  expiredBotSessions: number;
  staleBroadcastDrafts: number;
  purgedReceiptFiles: number;
}

/**
 * Purges expired authentication/session rows and stale drafts from SQLite.
 * Previously these rows were only deleted lazily on access, so tables grew
 * unboundedly. Safe to run on any schedule; every statement is idempotent.
 */
export function purgeExpiredData(retentionDays: number = 90, nowMs: number = Date.now()): CleanupResult {
  const db = getDatabase();
  const now = nowMs;

  const sessions = db
    .prepare('DELETE FROM admin_sessions WHERE expires_at < ?')
    .run(now).changes;

  const otps = db
    .prepare('DELETE FROM admin_otps WHERE expires_at < ?')
    .run(now).changes;

  const botSessions = db
    .prepare('DELETE FROM bot_sessions WHERE expires_at IS NOT NULL AND expires_at < ?')
    .run(now).changes;

  const draftCutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const drafts = db
    .prepare('DELETE FROM broadcast_drafts WHERE updated_at < datetime(?, ?)')
    .run(new Date(draftCutoff).toISOString().slice(0, 19).replace('T', ' '), 'utc').changes;

  let receipts = 0;
  try {
    receipts = purgeOldReceipts(retentionDays, nowMs);
  } catch {
    // Receipt purge failures are logged inside the service; never block DB cleanup.
  }

  const result: CleanupResult = {
    expiredAdminSessions: sessions,
    expiredAdminOtps: otps,
    expiredBotSessions: botSessions,
    staleBroadcastDrafts: drafts,
    purgedReceiptFiles: receipts,
  };

  if (sessions + otps + botSessions + drafts + receipts > 0) {
    logger.info(result, 'Expired data purge completed');
  }
  return result;
}

let cleanupTimer: NodeJS.Timeout | null = null;

/** Starts the periodic maintenance cycle (default: every 15 minutes). */
export function startPeriodicCleanup(intervalMs: number = 15 * 60 * 1000): NodeJS.Timeout {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => {
    try {
      purgeExpiredData();
    } catch (err) {
      logger.error({ err }, 'Scheduled data purge failed');
    }
  }, intervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();
  return cleanupTimer;
}

export function stopPeriodicCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
