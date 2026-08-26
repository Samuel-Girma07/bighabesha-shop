import { getDatabase } from '../db/index.js';
import { logger } from '../logger/index.js';

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.2fa.success'
  | 'auth.logout'
  | 'order.approve'
  | 'order.reject'
  | 'order.fulfill'
  | 'order.expire'
  | 'stock.add'
  | 'stock.delete'
  | 'settings.update'
  | 'broadcast.start'
  | 'payout.decision';

export interface AuditEntry {
  adminId: number | string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  changes?: Record<string, unknown> | string | null;
  ip?: string | null;
}

/**
 * Appends an immutable audit record for an administrative action.
 * NEVER throws: audit failures are logged but must not break the
 * operation that triggered them.
 */
export function recordAudit(entry: AuditEntry): void {
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, changes, ip)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      entry.adminId,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.changes === undefined || entry.changes === null
        ? null
        : typeof entry.changes === 'string'
          ? entry.changes
          : JSON.stringify(entry.changes),
      entry.ip ?? null
    );
  } catch (err) {
    // Audit is best-effort: log loudly, never block the caller.
    logger.error({ err, entry: { ...entry, changes: undefined } }, 'Failed to write audit log');
  }
}

export interface AuditRow {
  id: number;
  admin_id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  changes: string | null;
  ip: string | null;
  created_at: string;
}

/** Recent audit trail for the admin dashboard (oldest-last). */
export function listAuditLogs(limit: number = 100): AuditRow[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as AuditRow[];
}
