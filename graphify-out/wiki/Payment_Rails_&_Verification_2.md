# Payment Rails & Verification

> 53 nodes · cohesion 0.09

## Key Concepts

- **db/index.ts** (58 connections) — `bot/src/db/index.ts`
- **logger/index.ts** (49 connections) — `bot/src/logger/index.ts`
- **logger** (46 connections) — `bot/src/logger/index.ts`
- **payments/index.ts** (42 connections) — `bot/src/services/payments/index.ts`
- **phase1.test.ts** (26 connections) — `bot/tests/phase1.test.ts`
- **src/index.ts** (25 connections) — `bot/src/index.ts`
- **initDatabase()** (24 connections) — `bot/src/db/index.ts`
- **closeDatabase()** (18 connections) — `bot/src/db/index.ts`
- **main()** (18 connections) — `bot/src/index.ts`
- **manual_e2e_simulation.ts** (17 connections) — `bot/tests/manual_e2e_simulation.ts`
- **lifecycle.service.ts** (14 connections) — `bot/src/services/lifecycle.service.ts`
- **reconcileStuckPayments()** (14 connections) — `bot/src/services/payments/index.ts`
- **maintenance.service.ts** (12 connections) — `bot/src/services/maintenance.service.ts`
- **lease.ts** (10 connections) — `bot/src/db/lease.ts`
- **bot.test.ts** (10 connections) — `bot/tests/bot.test.ts`
- **runCustomerSimulation()** (10 connections) — `bot/tests/manual_e2e_simulation.ts`
- **buyer_notify.ts** (9 connections) — `bot/src/services/buyer_notify.ts`
- **migrator.ts** (8 connections) — `bot/src/db/migrator.ts`
- **Order** (8 connections) — `bot/src/services/orders.service.ts`
- **isChapaEnabled()** (8 connections) — `bot/src/services/payments/chapa.ts`
- **isTonConnectEnabled()** (8 connections) — `bot/src/services/payments/ton.service.ts`
- **syncAdminsFromEnv()** (6 connections) — `bot/src/auth/permissions.ts`
- **tryAcquireLease()** (6 connections) — `bot/src/db/lease.ts`
- **seed.ts** (6 connections) — `bot/src/db/seed.ts`
- **notifyBuyerOfAutoApproval()** (6 connections) — `bot/src/services/buyer_notify.ts`
- *... and 28 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (137 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (82 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (51 shared connections)
- [Broadcast.Service Hardening Suite.Test Cluster](Broadcast.Service_Hardening_Suite.Test_Cluster.md) (9 shared connections)

## Source Files

- `bot/src/auth/permissions.ts`
- `bot/src/db/index.ts`
- `bot/src/db/lease.ts`
- `bot/src/db/migrator.ts`
- `bot/src/db/seed.ts`
- `bot/src/index.ts`
- `bot/src/logger/index.ts`
- `bot/src/services/buyer_notify.ts`
- `bot/src/services/lifecycle.service.ts`
- `bot/src/services/maintenance.service.ts`
- `bot/src/services/orders.service.ts`
- `bot/src/services/payments/chapa.ts`
- `bot/src/services/payments/index.ts`
- `bot/src/services/payments/ton.service.ts`
- `bot/tests/bot.test.ts`
- `bot/tests/cleanup_test_orders.ts`
- `bot/tests/db.test.ts`
- `bot/tests/manual_e2e_simulation.ts`
- `bot/tests/phase1.test.ts`

## Audit Trail

- EXTRACTED: 404 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*