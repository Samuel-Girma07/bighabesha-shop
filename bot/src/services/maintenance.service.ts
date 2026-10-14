import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';
import { purgeOldReceipts } from './receipts.service.js';
import { cleanupInterruptedBroadcasts } from './broadcast.service.js';
import { pruneSettingsAudit } from './secrets.service.js';

export interface CleanupResult {
  expiredAdminSessions: number;
  expiredAdminOtps: number;
  expiredBotSessions: number;
  staleBroadcastDrafts: number;
  purgedReceiptFiles: number;
  prunedSettingsAuditRows: number;
}

/** How long settings mutation history is kept. Owner answer: 365 days. */
const SETTINGS_AUDIT_RETENTION_DAYS = 365;

/**
 * Purges expired authentication/session rows and stale drafts from SQLite.
 * Previously these rows were only deleted lazily on access, so tables grew
 * unboundedly. Safe to run on any schedule; every statement is idempotent.
 */
export async function purgeExpiredData(retentionDays: number = 90, nowMs: number = Date.now()): Promise<CleanupResult> {
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

  // Purge expired admin OTP failures (unlocked and older than 15 min lockout window)
  const otpFailureCutoff = now - 15 * 60 * 1000;
  db.prepare('DELETE FROM admin_otp_failures WHERE locked_until < ? AND updated_at < datetime(?, ?)')
    .run(now, new Date(otpFailureCutoff).toISOString().slice(0, 19).replace('T', ' '), 'utc');

  let receipts = 0;
  try {
    receipts = await purgeOldReceipts(retentionDays, nowMs);
  } catch {
    // Receipt purge failures are logged inside the service; never block DB cleanup.
  }

  try {
    cleanupInterruptedBroadcasts();
  } catch {
    // Interrupted broadcast cleanup failures never block DB cleanup.
  }

  // Settings mutation history rides this sweep rather than getting its own
  // timer. The sweep already runs and already owns "delete things that are no
  // longer useful"; a second scheduler for one table would be a new failure
  // mode for no benefit. `pruneSettingsAudit` swallows its own errors, so this
  // cannot block the other statements either.
  const prunedSettingsAuditRows = pruneSettingsAudit(SETTINGS_AUDIT_RETENTION_DAYS);

  const result: CleanupResult = {
    expiredAdminSessions: sessions,
    expiredAdminOtps: otps,
    expiredBotSessions: botSessions,
    staleBroadcastDrafts: drafts,
    purgedReceiptFiles: receipts,
    prunedSettingsAuditRows,
  };

  if (
    sessions + otps + botSessions + drafts + receipts + prunedSettingsAuditRows > 0
  ) {
    logger.info(result, 'Expired data purge completed');
  }
  return result;
}

let cleanupTimer: NodeJS.Timeout | null = null;

/** Starts the periodic maintenance cycle (default: every 15 minutes). */
export function startPeriodicCleanup(intervalMs: number = 15 * 60 * 1000): NodeJS.Timeout {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => {
    purgeExpiredData().catch((err) => {
      logger.error({ err }, 'Scheduled data purge failed');
    });
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
