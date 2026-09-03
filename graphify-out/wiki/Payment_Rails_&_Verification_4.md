# Payment Rails & Verification

> 45 nodes · cohesion 0.07

## Key Concepts

- **orders.service.ts** (68 connections) — `bot/src/services/orders.service.ts`
- **high_severity.test.ts** (64 connections) — `bot/tests/high_severity.test.ts`
- **createOrder()** (32 connections) — `bot/src/services/orders.service.ts`
- **updateOrderStatus()** (32 connections) — `bot/src/services/orders.service.ts`
- **phase3.test.ts** (24 connections) — `bot/tests/phase3.test.ts`
- **approveReceipt()** (19 connections) — `bot/src/services/orders.service.ts`
- **submitReceipt()** (18 connections) — `bot/src/services/orders.service.ts`
- **allocateStock()** (9 connections) — `bot/src/services/stock.service.ts`
- **seedPaidOrder()** (5 connections) — `bot/tests/high_severity.test.ts`
- **appendOrderEvent()** (4 connections) — `bot/src/services/orders.service.ts`
- **creditReferralCommissions()** (4 connections) — `bot/src/services/orders.service.ts`
- **InvalidOrderTransitionError** (4 connections) — `bot/src/services/orders.service.ts`
- **runFulfillmentHooks()** (4 connections) — `bot/src/services/orders.service.ts`
- **orderInState()** (4 connections) — `bot/tests/maintenance.test.ts`
- **isTransitionAllowed()** (3 connections) — `bot/src/services/orders.service.ts`
- **PaymentRail** (3 connections) — `bot/src/services/orders.service.ts`
- **seedUser()** (3 connections) — `bot/tests/high_severity.test.ts`
- **starsStockOrder()** (3 connections) — `bot/tests/high_severity.test.ts`
- **walletOrderWithQuote()** (3 connections) — `bot/tests/high_severity.test.ts`
- **generateOrderId()** (2 connections) — `bot/src/services/orders.service.ts`
- **WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS** (2 connections) — `bot/src/services/payments/live_wallet_pay.ts`
- **makeBotWithInfo()** (2 connections) — `bot/tests/high_severity.test.ts`
- **plantActionSession()** (2 connections) — `bot/tests/high_severity.test.ts`
- **ALLOWED_TRANSITIONS** (1 connections) — `bot/src/services/orders.service.ts`
- **CreateOrderInput** (1 connections) — `bot/src/services/orders.service.ts`
- *... and 20 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (86 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (58 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (41 shared connections)
- [Broadcast.Service Hardening Suite.Test Cluster](Broadcast.Service_Hardening_Suite.Test_Cluster.md) (9 shared connections)

## Source Files

- `bot/src/services/orders.service.ts`
- `bot/src/services/payments/live_wallet_pay.ts`
- `bot/src/services/stock.service.ts`
- `bot/tests/high_severity.test.ts`
- `bot/tests/maintenance.test.ts`
- `bot/tests/phase3.test.ts`

## Audit Trail

- EXTRACTED: 265 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*