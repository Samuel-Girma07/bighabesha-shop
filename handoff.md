# Handoff Document: Concurrency Remediation & Telegram Stars Decommissioning

**Target Repository:** `C:\Users\KATANA\Documents\Intern\Bot`  
**Master Blueprint:** `finding.md` (Executable Work Order & Concurrency Audit)  
**Previous Session ID:** `d5b762a4-681d-4d8e-ae25-a7a259905620`  
**Target Workload:** 1000+ concurrent users, single-node SQLite + Telegram Bot + WebApp  

---

## 1. Executive Summary & Objective

This repository is undergoing a major architecture and concurrency remediation alongside the complete decommissioning of Telegram Stars (XTR).
The work follows the strict **9-Step Execution Matrix (Part E)** and the blueprints in **Part B (B1–B19)** and **Part F (F-P1–F-P11)** of `finding.md`.

---

## 2. Current Progress State

### ✅ Completed Milestones (Verified in DB and Codebase)

1. **Step 1: Database Migration 008 (`bot/src/db/migrations/008_concurrency_perf.sql`) [Patch B15]**
   - Applied to live DB (`data/shop.db`).
   - Created 5 tables: `job_leases`, `broadcast_jobs`, `admin_otp_failures`, `request_idempotency`, `webhook_events`.
   - Added 12 performance indexes across stock, orders, users, promo redemptions, sessions, and threads.

2. **Step 2: Database Migration 009 (`bot/src/db/migrations/009_decommission_stars.sql`) [Patch F-P1]**
   - Applied to live DB (`data/shop.db`).
   - Deactivated `telegram_stars` product and variants (`is_active = 0`).
   - Purged Stars settings (`etb_per_star`, `stars_min`, `stars_max`, `stars_cashout_pct`).
   - Preserved historical Stars orders.

3. **Step 3: Resilient Outbound HTTP Client (`bot/src/lib/http.ts`, `bot/src/services/payments/`) [Patches B4, B5, B6]**
   - Created `bot/src/lib/http.ts` with 8000ms timeouts, circuit breaker state machine, and retry backoff with jitter.
   - Updated `bot/src/services/payments/chapa.ts` and `bot/src/services/payments/live_wallet_pay.ts` to use resilient client.
   - Updated `bot/src/services/payments/ton.service.ts`.

4. **Step 4: Single-Flight Cache & Rate Engine (`bot/src/services/cache.service.ts`, `bot/src/services/rate_engine.service.ts`) [Patches B2, B3]**
   - Created `bot/src/services/cache.service.ts` with single-flight mutex / coalescing.
   - Hardened CoinGecko rate fetch against cache stampedes.

5. **Step 5: Database Core Hardening (`bot/src/db/index.ts`, `bot/tests/hygiene.test.ts`) [Patch B1]**
   - Implemented `statementCache` (`prepared()`), reduced `busy_timeout` to 250ms, WAL checkpointing, and `withWriteRetry()`.
   - Updated `bot/tests/hygiene.test.ts` assertions.

6. **Step 6: Telegram Stars Decommissioning (85% Complete) [Patches F-P2 through F-P10]**
   - `bot/src/db/seed.ts` (F-P2): Purged Stars seeding.
   - `bot/src/bot/session.ts` (F-P6): Dropped `stars_custom_amount` session type.
   - `bot/src/services/pricing.service.ts` (F-P7): Removed Stars calculations & rail.
   - `bot/src/services/settings.service.ts` (F-P9): Removed Stars settings accessors.
   - `bot/src/services/profit.service.ts` (F-P10 / B13): Removed Stars profit records.
   - `bot/src/services/orders.service.ts` (F-P10): Removed Stars order resolution logic.
   - `bot/src/bot/handlers/shop.ts` (F-P3): Removed Stars purchase button & custom amount keyboard.
   - `bot/src/bot/handlers/checkout.ts` (F-P4): Removed Stars invoice payment branch.
   - `bot/src/bot/handlers/input.ts`: Removed `stars_custom_amount` handler block.
   - `bot/src/bot/handlers/gate.ts`: Removed Stars purchase check.
   - `bot/src/bot/bot.ts` (F-P5): Removed `pre_checkout_query`, `successful_payment`, and Stars routers.

---

## 3. Interruption Point & Current Failure State

The previous session was interrupted by an API credit limit while starting Patch **F-P11** / **Step 7 (B8)** in `bot/src/api/server.ts`.

Running `cd bot && npx tsc --noEmit` currently reports:
```text
src/api/server.ts(570,47): error TS2322: Type '"stars"' is not assignable to type 'PaymentRail'.
src/api/server.ts(624,9): error TS2353: Object literal may only specify known properties, and 'customStars' does not exist in type 'ResolveOrderPriceParams'.
```

---

## 4. Immediate Remaining Work Order

### Phase 1: Complete Step 6 (Stars Decommissioning)
- **Files**:
  - `bot/src/bot/handlers/admin.ts` (F-P11): Remove Stars settings editor and Stars configuration menus.
  - `bot/src/api/server.ts` (F-P11): Remove `telegram_stars` routes, `stars` payment rail references, and `customStars` parameters.
- **Verification**: Run `cd bot && npx tsc --noEmit` to confirm 0 compilation errors for Step 6.

### Phase 2: Execute Step 7 (API Server Hardening & Idempotency)
- **Files**:
  - `bot/src/api/idempotency.ts` (Patch B19): Implement idempotency middleware backed by the `request_idempotency` SQLite table.
  - `bot/src/api/server.ts` (Patch B8):
    - Switch `globalApiLimiter` key to Telegram User ID (`req.user?.id` / init-data user ID with IP fallback).
    - Install dedicated limiters for `/api/admin/*` and `/api/user/recheck-username`.
    - Apply single-flight cache to `/api/bootstrap` catalog calls.
    - Make user activity touches non-blocking / asynchronous.
    - Wire `idempotencyMiddleware` on payment creation and order submission endpoints.

### Phase 3: Execute Step 8 (Admin Routes & Background Services)
- **Files**:
  - `bot/src/api/admin.ts` (Patch B10): Replace N+1 loop queries in `GET /api/admin/overview` with sargable SQL and cache overview stats using `cache.service.ts`.
  - `bot/src/services/receipts.service.ts` (Patch B9): Convert synchronous `fs.writeFileSync` to `fsp.writeFile`.
  - `bot/src/services/banner_generator.service.ts` (Patch B18): Convert synchronous image writes to async `fsp.writeFile`.
  - `bot/src/services/broadcast.service.ts` (Patch B11): Migrate broadcast tracking from in-memory array to the `broadcast_jobs` SQLite table.
  - `bot/src/services/users.service.ts` (Patch B12): Use cursor/streamed batch queries for user exports.
  - `bot/src/services/promo.service.ts` (Patch B16): Implement atomic check-and-insert for promo redemption to eliminate check-then-act races.

### Phase 4: Execute Step 9 (Process Lifecycle & Leader Lease Election)
- **Files**:
  - `bot/src/services/payments/index.ts` (Patch B7): Bound reconciliation sweep loops with timeouts, single-flight locks, and batching.
  - `bot/src/index.ts` (Patch B14): Implement DB leader lease acquisition (`job_leases` table) for Telegram polling and sweeper workers; enforce proper connection drain order before calling `closeDatabase()`.

### Phase 5: Verification & Quality Gate
- Run full typecheck: `cd bot && npx tsc --noEmit`
- Run test suite: `cd bot && npx vitest run`
- Search codebase for any residual active Stars logic: `rg "telegram_stars|stars_custom|buy_custom_stars" bot/src/`
