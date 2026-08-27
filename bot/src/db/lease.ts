import crypto from 'crypto';
import { prepared } from './index.js';
import { logger } from '../logger/index.js';

const processOwnerId = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;

export function getProcessOwnerId(): string {
  return processOwnerId;
}

/**
 * Attempts to acquire or renew a lease for `name`.
 * Returns true if this process successfully acquired or already owns the lease, false otherwise.
 * @param name The unique lease name (e.g. 'payments:reconcile', 'process:leader')
 * @param ttlMs Lease time-to-live in milliseconds
 * @param ownerId Optional owner identifier (defaults to process-specific owner ID)
 */
export function tryAcquireLease(name: string, ttlMs: number, ownerId: string = processOwnerId): boolean {
  const now = Date.now();
  const expiresAt = now + ttlMs;

  try {
    const res = prepared(`
      INSERT INTO job_leases (name, owner_id, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        owner_id = excluded.owner_id,
        expires_at = excluded.expires_at
      WHERE job_leases.expires_at <= ? OR job_leases.owner_id = ?
    `).run(name, ownerId, expiresAt, now, ownerId);

    return res.changes > 0;
  } catch (err) {
    logger.warn({ err, name }, 'Error attempting to acquire job lease');
    return false;
  }
}

/**
 * Releases a lease if currently held by this owner.
 */
export function releaseLease(name: string, ownerId: string = processOwnerId): boolean {
  try {
    const res = prepared(`
      DELETE FROM job_leases
      WHERE name = ? AND owner_id = ?
    `).run(name, ownerId);
    return res.changes > 0;
  } catch (err) {
    logger.warn({ err, name }, 'Error releasing job lease');
    return false;
  }
}
