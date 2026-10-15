-- Migration 017: Phase 1 — pre-claim lock (TOCTOU guard)
--
-- Idempotent by construction. Never edit a migration that has shipped.

-- ---------------------------------------------------------------------------
-- Reference claims.
--
-- THE RACE THIS CLOSES
-- --------------------
-- `SecurityGateService.evaluate()` runs OUTSIDE `executeFulfillmentTx()`'s
-- synchronous transaction, after an upstream lane call that can take tens of
-- seconds. Two concurrent submissions of the SAME reference can therefore both
-- reach the anti-replay pillar and both observe "not used" before either one
-- commits. Both would then pass the gate and both would burn verifier quota;
-- the UNIQUE indexes in migration 011 would stop the second *commit*, but only
-- after both network calls were already paid for.
--
-- The pre-claim takes the reference BEFORE any network I/O. `changes === 0`
-- means somebody else already holds it, so we abort having spent nothing.
--
-- STATUS LIFECYCLE
--   verifying  claimed, network call in flight
--   matched    promoted inside the fulfillment transaction — permanently spent
--   released   the attempt failed; the claim is free for a genuine retry
--
-- A `verifying` row older than 15 minutes is stale (process crash, deploy, OOM)
-- and is reclaimable, otherwise a crash between claim and commit would block
-- that reference from the customer forever. The reclaim is audited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipt_reference_claims (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  bank                TEXT    NOT NULL,
  canonical_reference TEXT    NOT NULL,
  order_id            TEXT    NOT NULL,
  -- verifying | matched | released
  status              TEXT    NOT NULL DEFAULT 'verifying',
  claimed_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  released_at         TEXT,
  -- Audit trail for an operator reclaiming a stale claim.
  reclaimed_from      TEXT,
  UNIQUE (bank, canonical_reference)
);

-- Supports the stale-claim sweep without scanning the table.
CREATE INDEX IF NOT EXISTS idx_receipt_reference_claims_status
  ON receipt_reference_claims(status, claimed_at);

-- Lets an admin see every claim attached to one order.
CREATE INDEX IF NOT EXISTS idx_receipt_reference_claims_order
  ON receipt_reference_claims(order_id, id);