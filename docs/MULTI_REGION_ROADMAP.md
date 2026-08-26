# Multi-Region / Multi-Instance Roadmap

Per the production-readiness audit decision ("Multiple VPS regions eventually"),
the current single-writer SQLite architecture must evolve before scaling out.
Wave 4 armor (BEGIN IMMEDIATE claims, guarded UPDATEs, partial UNIQUE index)
makes the data layer *safe* under multiple processes sharing one file — but
one file cannot span regions. The migration path below is ordered; each step
is independently shippable.

## Phase A — Webhook ingestion (prerequisite for N instances)
Telegram long-polling (`bot.start()`) allows exactly one consumer. Move to:
1. Set webhook via BotFather/`setWebhook` to `https://api.<region>/telegram/<secret>`.
2. Replace polling with `bot.webhookCallback()` mounted at `/telegram/:secret`.
3. PM2 may then run N processes per region for the HTTP surface while ONE
   designated worker keeps cron-style jobs (reconciliation, lifecycle sweeps,
   cleanup) behind an advisory lock (e.g. `settings` heartbeat row or `better-sqlite3` file lock).
**Effort:** ~2 days. **Unblocks:** horizontal HTTP scaling, zero-downtime deploys.

## Phase B — Single-region multi-process soak
Before regions: run 2 PM2 instances in ONE VPS against the same DB file.
Validates Wave 4 invariants under real contention.
**Exit criteria:** 24h at 2× traffic, zero SQLITE_BUSY, zero duplicate allocations.

## Phase C — Database consolidation (SQLite → Postgres)
SQLite is single-writer by design; cross-region writes need a server DB.
1. Introduce a thin repository layer (services already mostly funnel through
   `db/index.js`; wrap statements per-service).
2. Port schema via migrations translator (types map 1:1 except AUTOINCREMENT→
   GENERATED, partial indexes supported natively, datetime strings→timestamptz).
3. Swap driver to `postgres` (porsager) keeping synchronous service signatures
   via explicit async refactor — this is the bulk of the work (~2–3 weeks).
4. Keep better-sqlite3 path as a test profile (`DB_DRIVER=sqlite`) so CI stays hermetic.

## Phase D — Regions
1. Primary region hosts Postgres + webhook worker; secondary regions serve
   read-heavy Mini App traffic against read replicas (or Cloudflare cache for
   `/api/bootstrap` with short TTL).
2. Writes route to primary via tunnel/service mesh; order IDs already carry
   timestamps — add a region nibble inside `generateOrderId()` entropy if
   split-brain writes ever become possible.
3. Backups: existing integrity-gated `backup.sh` becomes per-region PITR
   (WAL archiving) once Postgres lands.

**Do NOT** run two writable copies of shop.db in different regions and sync
them ad-hoc — last-writer-wins on financial rows (ledger, payouts) is the
exact corruption class Wave 4 exists to prevent.
