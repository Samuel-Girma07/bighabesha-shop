import { getDatabase, Database } from '../../db/index.js';
import { SupportedBank } from '../receipt_verifier/types.js';

/**
 * Persistence for Phase 1 lane telemetry and the pre-claim lock.
 *
 * Everything here is deliberately synchronous. `better-sqlite3` transactions are
 * synchronous, which is precisely why the pre-claim is safe: the claim is taken,
 * checked and released without an intervening `await`, so no other JS task can
 * interleave between the check and the write.
 */

/** Wall-clock age after which an un-promoted `verifying` claim is reclaimable. */
export const STALE_CLAIM_TTL_MINUTES = 15;

export interface LaneAttemptRecord {
  orderId: string;
  evidenceId?: number | null;
  lane: string;
  /** ok | not_found | parse_fault | infrastructure | error */
  status: string;
  errorCode?: string | null;
  latencyMs: number;
  /** Did the lane return a usable payload at all? */
  verified: boolean;
  /**
   * Observed "checked before" flag. RECORDED ONLY, NEVER a gate input — see the
   * comment on the `receipt_lane_attempts` table in migration 016.
   */
  confirmedBefore?: boolean | null;
}

/**
 * Appends one lane attempt to the audit trail.
 *
 * Best-effort by design: telemetry must never be the reason a legitimate
 * payment fails, so a write error is logged and swallowed rather than thrown.
 */
export function insertLaneAttempt(attempt: LaneAttemptRecord, db?: Database): void {
  try {
    const conn = db ?? getDatabase();
    conn
      .prepare(
        `INSERT INTO receipt_lane_attempts
           (order_id, evidence_id, lane, status, error_code, latency_ms, verified, confirmed_before)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        attempt.orderId,
        attempt.evidenceId ?? null,
        attempt.lane,
        attempt.status,
        attempt.errorCode ?? null,
        attempt.latencyMs,
        attempt.verified ? 1 : 0,
        attempt.confirmedBefore === undefined || attempt.confirmedBefore === null
          ? null
          : attempt.confirmedBefore
            ? 1
            : 0
      );
  } catch (err: unknown) {
    // Intentionally swallowed — see the doc comment.
    console.error('[lane_attempt] failed to record attempt', err);
  }
}

/** Per-lane success/failure tallies inside the degraded-lane detection window. */
export interface LaneHealthWindow {
  total: number;
  successes: number;
  notFound: number;
}

/**
 * Reads a lane's recent outcomes so the degraded-lane detector can decide
 * whether a run of not-founds means "the lane is broken" or "the customer
 * mistyped".
 *
 * `not_found` is counted separately from other failures because only
 * not-founds are ambiguous: a timeout or a 5xx is self-evidently an outage,
 * whereas a scraper that has quietly broken also returns "not found".
 *
 * @param minAgeMinutes Ignore attempts newer than this, to exclude the attempt
 *                      currently in flight (which is by definition not a result
 *                      yet and would dilute the rate).
 */
export function getLaneHealthWindow(
  lane: string,
  windowMinutes: number,
  minAgeMinutes: number = 0,
  db?: Database
): LaneHealthWindow {
  const conn = db ?? getDatabase();

  const row = conn
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS successes,
         SUM(CASE WHEN status = 'not_found' THEN 1 ELSE 0 END) AS not_found
       FROM receipt_lane_attempts
       WHERE lane = ?
         AND created_at >= datetime('now', ?)
         AND created_at <= datetime('now', ?)`
    )
    .get(lane, `-${windowMinutes} minutes`, `-${minAgeMinutes} minutes`) as
    | { total: number; successes: number | null; not_found: number | null }
    | undefined;

  return {
    total: row?.total ?? 0,
    successes: row?.successes ?? 0,
    notFound: row?.not_found ?? 0,
  };
}

export interface ClaimResult {
  /** True when this caller now holds the claim and may proceed to network I/O. */
  acquired: boolean;
  /** Why the claim was refused, for the audit trail and the log line. */
  reason?: 'held_by_other_order' | 'already_matched' | null;
  /** The order currently holding the claim, when refused. */
  heldByOrderId?: string;
  /** Whether an expired `verifying` claim was reclaimed to admit this caller. */
  reclaimed?: boolean;
}

/**
 * Takes the pre-claim lock on a canonical reference BEFORE any network call.
 *
 * Returns `acquired: false` when another submission already holds the reference,
 * which lets the caller abort having spent nothing. This is the TOCTOU guard:
 * the anti-replay check inside the security gate happens after a network call
 * that can take tens of seconds, so two concurrent submissions of one reference
 * could otherwise both observe "unused" and both burn verifier quota.
 *
 * A `verifying` claim older than `STALE_CLAIM_TTL_MINUTES` is reclaimed — a
 * crashed process must not block a customer's payment forever — and the reclaim
 * is recorded in `reclaimed_from` for the audit trail.
 */
export function acquireReferenceClaim(
  bank: SupportedBank,
  canonicalReference: string,
  orderId: string,
  db?: Database
): ClaimResult {
  const conn = db ?? getDatabase();

  // Age is evaluated in SQL against SQLite's own UTC clock so it cannot drift
  // from the `datetime('now')` that wrote `claimed_at`.
  const staleCutoff = `-${STALE_CLAIM_TTL_MINUTES} minutes`;

  return conn.transaction((): ClaimResult => {
    const existing = conn
      .prepare(
        `SELECT order_id, status,
                CASE WHEN claimed_at <= datetime('now', ?) THEN 1 ELSE 0 END AS is_stale
           FROM receipt_reference_claims
          WHERE bank = ? AND canonical_reference = ?`
      )
      .get(staleCutoff, bank, canonicalReference) as
      | { order_id: string; status: string; is_stale: number }
      | undefined;

    if (existing) {
      const isSameOrder = existing.order_id === orderId;
      const isStale = existing.is_stale === 1;

      // `matched` is permanent. The fulfillment transaction owns that
      // transition, and nothing may re-acquire past it — not even after the TTL,
      // because `matched` means the reference was genuinely spent.
      if (existing.status === 'matched') {
        return { acquired: false, reason: 'already_matched', heldByOrderId: existing.order_id };
      }

      if (existing.status === 'verifying') {
        // Same order still `verifying` means a previous attempt for THIS order
        // was abandoned (a resubmission after a failed verification). Reusing
        // it is safe and desirable: a customer correcting a mistyped receipt
        // must not be blocked by their own prior failure.
        if (isSameOrder) {
          conn
            .prepare(
              `UPDATE receipt_reference_claims
                  SET claimed_at = datetime('now')
                WHERE bank = ? AND canonical_reference = ?`
            )
            .run(bank, canonicalReference);
          return { acquired: true, reclaimed: true };
        }

        // A DIFFERENT order holds a live claim. Refuse — unless it has gone
        // stale, which means the process holding it crashed mid-verification.
        // Without this a single OOM kill would block that reference from every
        // customer, permanently.
        if (!isStale) {
          return {
            acquired: false,
            reason: 'held_by_other_order',
            heldByOrderId: existing.order_id,
          };
        }
      }
    }

    if (existing) {
      // Re-claim: the previous attempt released it, or it went stale and is
      // being reclaimed after a crash. Record where it came from.
      const reclaimedFrom =
        existing.status === 'verifying' ? existing.order_id : null;
      conn
        .prepare(
          `UPDATE receipt_reference_claims
              SET order_id = ?, status = 'verifying', claimed_at = datetime('now'),
                  released_at = NULL, reclaimed_from = ?
            WHERE bank = ? AND canonical_reference = ?`
        )
        .run(orderId, reclaimedFrom, bank, canonicalReference);
    } else {
      conn
        .prepare(
          `INSERT INTO receipt_reference_claims (bank, canonical_reference, order_id, status)
           VALUES (?, ?, ?, 'verifying')
           ON CONFLICT (bank, canonical_reference) DO NOTHING`
        )
        .run(bank, canonicalReference, orderId);
    }

    return { acquired: true, reclaimed: existing?.status === 'verifying' };
  })();
}

/**
 * Promotes a claim to `matched` from inside the fulfillment transaction, so the
 * reference is permanently spent atomically with the stock allocation and the
 * audit write. A crash before this point leaves the claim reclaimable, which is
 * the correct failure mode: the customer is not blocked, and no money moved.
 */
export function promoteClaimToMatched(
  bank: SupportedBank,
  canonicalReference: string,
  orderId: string,
  db?: Database
): void {
  const conn = db ?? getDatabase();
  conn
    .prepare(
      `UPDATE receipt_reference_claims
          SET status = 'matched', released_at = NULL
        WHERE bank = ? AND canonical_reference = ? AND order_id = ?`
    )
    .run(bank, canonicalReference, orderId);
}

/**
 * Releases a claim after a failed verification so the customer can correct the
 * receipt and resubmit. Never downgrades a `matched` claim — that transition is
 * the permanent one.
 */
export function releaseReferenceClaim(
  bank: SupportedBank,
  canonicalReference: string,
  orderId: string,
  db?: Database
): void {
  const conn = db ?? getDatabase();
  conn
    .prepare(
      `UPDATE receipt_reference_claims
          SET status = 'released', released_at = datetime('now')
        WHERE bank = ? AND canonical_reference = ? AND order_id = ?
          AND status != 'matched'`
    )
    .run(bank, canonicalReference, orderId);
}