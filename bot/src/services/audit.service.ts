import { getDatabase } from '../db/index.js';
import { logger, redactSecret } from '../logger/index.js';
import { SECRET_SETTING_KEYS } from './settings.service.js';

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
 * Replaces the value of every key in `SECRET_SETTING_KEYS` with the same
 * non-reversible preview (`abcd…wxyz(32)`) the application logs already use.
 *
 * WHY THIS LIVES HERE AND NOT AT THE `admin.ts` CALL SITE:
 *
 * `audit_logs` is an append-only compliance record replicated to Backblaze B2 by
 * Litestream, so anything written here must already be safe to keep forever —
 * there is no supported way to take it back out. Redacting at the single
 * settings call site would protect only today's caller; redacting at the
 * serialisation choke point protects every present and future `recordAudit`
 * caller, including the next one somebody writes that hands a settings map
 * straight through. A guard that only covers the case you remember is not a
 * guard.
 *
 * Matching is by KEY, never by value pattern: a denylist that had to recognise
 * "does this string look like a proxy URI" would be both slower and easier to
 * evade than a list of the keys that are actually secret. The accepted limit is
 * therefore that a credential stored under a key absent from
 * `SECRET_SETTING_KEYS` would still be recorded in the clear — which is exactly
 * why that set sits next to the settings it governs, and why adding a secret
 * means adding it there too.
 *
 * Import direction is acyclic: `settings.service` imports only `db` and
 * `logger`, neither of which imports `audit.service`.
 */
function redactAuditChanges(changes: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (SECRET_SETTING_KEYS.has(key)) {
      // Strings get the length-revealing preview so an auditor can still tell
      // "a 64-char HMAC key was set" from "the field was blanked".
      redacted[key] = typeof value === 'string' ? redactSecret(value) : '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Same redaction, applied to the free-text form of `changes`. A caller that
 * pre-stringifies its payload would otherwise bypass the object branch entirely,
 * so try to parse it back. A string that is not JSON is author-written prose and
 * is passed through untouched — mangling an audit record is worse than leaving
 * an operator's own note alone.
 */
function redactAuditChangesString(changes: string): string {
  try {
    const parsed: unknown = JSON.parse(changes);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify(redactAuditChanges(parsed as Record<string, unknown>));
    }
  } catch {
    // Not JSON — see above.
  }
  return changes;
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
          ? redactAuditChangesString(entry.changes)
          : JSON.stringify(redactAuditChanges(entry.changes)),
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
