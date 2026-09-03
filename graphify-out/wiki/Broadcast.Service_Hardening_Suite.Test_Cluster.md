# Broadcast.Service Hardening Suite.Test Cluster

> 31 nodes · cohesion 0.09

## Key Concepts

- **hardening_suite.test.ts** (33 connections) — `bot/tests/hardening_suite.test.ts`
- **broadcast.service.ts** (24 connections) — `bot/src/services/broadcast.service.ts`
- **phase4.test.ts** (21 connections) — `bot/tests/phase4.test.ts`
- **getBroadcastTargets()** (9 connections) — `bot/src/services/broadcast.service.ts`
- **startBroadcastJob()** (8 connections) — `bot/src/services/broadcast.service.ts`
- **executeBroadcast()** (7 connections) — `bot/src/services/broadcast.service.ts`
- **BroadcastBusyError** (5 connections) — `bot/src/services/broadcast.service.ts`
- **getFulfillmentQueue()** (5 connections) — `bot/src/services/orders.service.ts`
- **csv.ts** (5 connections) — `bot/src/utils/csv.ts`
- **deliverBroadcast()** (4 connections) — `bot/src/services/broadcast.service.ts`
- **getBroadcastJob()** (3 connections) — `bot/src/services/broadcast.service.ts`
- **listBroadcastJobs()** (3 connections) — `bot/src/services/broadcast.service.ts`
- **sendBroadcastMessage()** (3 connections) — `bot/src/services/broadcast.service.ts`
- **startBroadcastJobFromIds()** (3 connections) — `bot/src/services/broadcast.service.ts`
- **csvCell()** (3 connections) — `bot/src/utils/csv.ts`
- **guardExcelString()** (3 connections) — `bot/src/utils/csv.ts`
- **BroadcastTarget** (2 connections) — `bot/src/services/broadcast.service.ts`
- **seedAdminSession()** (2 connections) — `bot/tests/hardening_suite.test.ts`
- **.constructor()** (1 connections) — `bot/src/services/broadcast.service.ts`
- **BroadcastJob** (1 connections) — `bot/src/services/broadcast.service.ts`
- **broadcastJobs** (1 connections) — `bot/src/services/broadcast.service.ts`
- **DEFAULT_PACING** (1 connections) — `bot/src/services/broadcast.service.ts`
- **DeliveryResult** (1 connections) — `bot/src/services/broadcast.service.ts`
- **PacingOptions** (1 connections) — `bot/src/services/broadcast.service.ts`
- **__dirname** (1 connections) — `bot/tests/hardening_suite.test.ts`
- *... and 6 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (31 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (22 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (15 shared connections)

## Source Files

- `bot/src/services/broadcast.service.ts`
- `bot/src/services/orders.service.ts`
- `bot/src/utils/csv.ts`
- `bot/tests/hardening_suite.test.ts`
- `bot/tests/phase4.test.ts`

## Audit Trail

- EXTRACTED: 112 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*