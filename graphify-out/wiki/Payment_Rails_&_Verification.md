# Payment Rails & Verification

> 68 nodes · cohesion 0.06

## Key Concepts

- **server.ts** (106 connections) — `bot/src/api/server.ts`
- **getConfig()** (61 connections) — `bot/src/config/env.ts`
- **maintenance.test.ts** (49 connections) — `bot/tests/maintenance.test.ts`
- **createExpressApp()** (48 connections) — `bot/src/api/server.ts`
- **receipts.service.ts** (20 connections) — `bot/src/services/receipts.service.ts`
- **phase5.test.ts** (20 connections) — `bot/tests/phase5.test.ts`
- **support.service.ts** (17 connections) — `bot/src/services/support.service.ts`
- **receipt_endpoint.test.ts** (13 connections) — `bot/tests/receipt_endpoint.test.ts`
- **createApiServer()** (11 connections) — `bot/src/api/server.ts`
- **saveReceiptImage()** (10 connections) — `bot/src/services/receipts.service.ts`
- **auth.ts** (9 connections) — `bot/src/api/auth.ts`
- **resolveReceiptsDir()** (9 connections) — `bot/src/services/receipts.service.ts`
- **validateTelegramInitData()** (8 connections) — `bot/src/api/auth.ts`
- **idempotency.ts** (8 connections) — `bot/src/api/idempotency.ts`
- **handleReceiptUpload()** (8 connections) — `bot/src/api/server.ts`
- **resolveStoredReceiptPath()** (8 connections) — `bot/src/services/receipts.service.ts`
- **purgeOldReceipts()** (6 connections) — `bot/src/services/receipts.service.ts`
- **insertSupportMessage()** (6 connections) — `bot/src/services/support.service.ts`
- **cachedSync()** (5 connections) — `bot/src/services/cache.service.ts`
- **ReceiptValidationError** (5 connections) — `bot/src/services/receipts.service.ts`
- **getOrCreateThread()** (5 connections) — `bot/src/services/support.service.ts`
- **serveOrderReceipt()** (4 connections) — `bot/src/api/admin.ts`
- **claimIdempotencyKey()** (4 connections) — `bot/src/api/idempotency.ts`
- **isFirstDelivery()** (4 connections) — `bot/src/api/idempotency.ts`
- **recordIdempotentResult()** (4 connections) — `bot/src/api/idempotency.ts`
- *... and 43 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (133 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (57 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (53 shared connections)
- [Broadcast.Service Hardening Suite.Test Cluster](Broadcast.Service_Hardening_Suite.Test_Cluster.md) (8 shared connections)

## Source Files

- `bot/src/api/admin.ts`
- `bot/src/api/auth.ts`
- `bot/src/api/idempotency.ts`
- `bot/src/api/server.ts`
- `bot/src/config/env.ts`
- `bot/src/services/cache.service.ts`
- `bot/src/services/payments/live_wallet_pay.ts`
- `bot/src/services/payments/mock_wallet_pay.ts`
- `bot/src/services/receipts.service.ts`
- `bot/src/services/support.service.ts`
- `bot/tests/maintenance.test.ts`
- `bot/tests/phase5.test.ts`
- `bot/tests/receipt_endpoint.test.ts`

## Audit Trail

- EXTRACTED: 388 (99%)
- INFERRED: 2 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*