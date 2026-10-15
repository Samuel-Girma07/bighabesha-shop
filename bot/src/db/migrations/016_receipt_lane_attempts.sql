-- Migration 016: Phase 1 — verification lane telemetry
--
-- Idempotent by construction (migrator.ts stores no checksums and silently
-- ignores edits to already-applied files, so every statement must be safe to
-- re-run). Never edit a migration that has shipped.

-- ---------------------------------------------------------------------------
-- Per-lane attempt telemetry.
--
-- WHY: without this table "the shop is down" and "links.et is down" are
-- indistinguishable in the logs. It is the substrate for two things:
--
--   1. The degraded-lane detector. A scraper that is silently broken returns
--      "not found" instead of an error, so it looks exactly like a customer
--      typo. A rate-based detector over this table is what tells those apart:
--      a lane whose syntactically-valid references come back not-found at a
--      0% success rate over a rolling window is broken, not wrong.
--
--   2. Per-lane audit. Which lane actually answered, how long it took, and
--      what it said.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipt_lane_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         TEXT    NOT NULL,
  evidence_id      INTEGER,
  -- Lane id: direct | links | verifyet | cheki
  lane             TEXT    NOT NULL,
  -- Outcome: ok | not_found | parse_fault | infrastructure | error
  status           TEXT    NOT NULL,
  -- VerificationFailureCode when the attempt produced one, else NULL.
  error_code       TEXT,
  latency_ms       INTEGER NOT NULL DEFAULT 0,
  -- Did this lane return a usable payload at all (regardless of gate verdict)?
  verified         INTEGER NOT NULL DEFAULT 0,
  -- Observed "this receipt was checked before" flag. RECORDED ONLY — it is
  -- deliberately NOT a gate input. links.et exposes no such flag at all, and
  -- verify.et's flips permanently the first time ANYONE (including a human, a
  -- previous retry, or a third party) looks the receipt up. Gating on it would
  -- brick legitimate payments the second time they were submitted.
  confirmed_before INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The degraded-lane detector scans this window on every attempt.
CREATE INDEX IF NOT EXISTS idx_receipt_lane_attempts_lane_created
  ON receipt_lane_attempts(lane, created_at DESC);

-- Lets an admin inspect one order's whole lane walk.
CREATE INDEX IF NOT EXISTS idx_receipt_lane_attempts_order
  ON receipt_lane_attempts(order_id, id);

-- ---------------------------------------------------------------------------
-- Recency window: `before_mins` tightened from 120 to 2.
--
-- The window is anchored on the ORDER's creation time. A generous "before"
-- branch lets a customer pay first and submit the receipt afterwards, which is
-- precisely the attack the window exists to stop. 2 minutes leaves room for
-- clock drift between the bank and this host and nothing else.
--
-- Only the DEFAULT changes here. An operator who has already written a value
-- keeps it: this UPDATE is scoped to rows still holding the old default, so a
-- deliberate override is never clobbered on deploy.
-- ---------------------------------------------------------------------------
UPDATE settings
   SET value = '2',
       updated_at = datetime('now')
 WHERE key = 'receipt_recency_before_mins'
   AND value = '120';

-- ---------------------------------------------------------------------------
-- Telebirr credited-party NAME whitelist, plural.
--
-- Replaces the dormant singular `receipt_telebirr_expected_name` (which ships
-- blank and therefore never enforced anything). Ethio Telecom officially permits
-- MULTIPLE Telebirr accounts per person or business, and each renders its own
-- credited-party name, so a single-value whitelist cannot be correct.
--
-- Ships as an EMPTY array on purpose. While it is empty the name pillar stays
-- DORMANT with a loud warning, exactly matching today's live behaviour — an
-- enforcing-but-empty whitelist would send 100% of real Telebirr payments to
-- the manual review queue. The pillar arms the moment the operator populates
-- this array from a real captured receipt, and is fail-closed from then on.
--
-- The singular row is deliberately LEFT IN PLACE: it is historical evidence and
-- removing it would destroy the record of the earlier operator decision.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO settings (key, value, is_secret) VALUES
    ('receipt_telebirr_beneficiary_names', '[]', 0);

-- ---------------------------------------------------------------------------
-- Total verification budget for the lane chain.
--
-- A chain of up to three lanes, each with its own ceiling, could otherwise hold
-- an inbound HTTP request open for minutes. This is the wall-clock ceiling for
-- the WHOLE chain; per-lane slices are derived from it and cannot sum above it.
-- When the budget is exhausted the chain stops and the order goes to manual
-- review with an honest reason rather than being abandoned mid-walk.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO settings (key, value, is_secret) VALUES
    ('verify_total_budget_ms', '60000', 0);