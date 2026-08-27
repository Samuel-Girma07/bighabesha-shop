import crypto from 'crypto';
import { prepared } from '../db/index.js';
import { logger } from '../logger/index.js';

export function claimIdempotencyKey(
  scope: string,
  userId: number,
  rawKey: string | undefined,
  body: unknown
): { claimed: boolean; existingId: string | null; key: string } {
  const key = rawKey
    ? `${scope}:${userId}:${rawKey.slice(0, 64)}`
    : `${scope}:${userId}:${crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)}`;

  try {
    prepared('INSERT INTO request_idempotency (key, user_id, scope) VALUES (?, ?, ?)').run(key, userId, scope);
    return { claimed: true, existingId: null, key };
  } catch (err: any) {
    if (err?.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY' && err?.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
    const row = prepared('SELECT result_id FROM request_idempotency WHERE key = ?').get(key) as
      | { result_id: string | null }
      | undefined;
    return { claimed: false, existingId: row?.result_id ?? null, key };
  }
}

export function recordIdempotentResult(key: string, resultId: string): void {
  try {
    prepared('UPDATE request_idempotency SET result_id = ? WHERE key = ?').run(resultId, key);
  } catch (err) {
    logger.warn({ err, key }, 'Failed to record idempotent result');
  }
}

export function isFirstDelivery(provider: string, eventId: string): boolean {
  try {
    const res = prepared('INSERT INTO webhook_events (provider, event_id) VALUES (?, ?)').run(provider, eventId);
    return res.changes === 1;
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
    throw err;
  }
}
