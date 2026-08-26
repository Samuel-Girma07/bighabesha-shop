-- Migration 007: Concurrency hardening for multi-writer safety.
--
-- The application currently runs single-instance (better-sqlite3's
-- synchronous engine + one PM2 process = serialized writes). This migration
-- makes the invariants hold even if a second process ever shares the DB:
--
-- 1. A stock item can never be bound to two orders. allocateStock() now
--    claims rows with a guarded UPDATE (... WHERE status='available'), and
--    this partial UNIQUE index is the database-level backstop: any code path
--    that attempts a double-bind fails at the storage layer.
--
-- Additive only — no table rebuilds, safe on any data volume.

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_items_order
    ON stock_items(order_id)
    WHERE order_id IS NOT NULL;
