# Bot Admin & Order Verification

> 87 nodes · cohesion 0.11

## Key Concepts

- **bot.ts** (104 connections) — `bot/src/bot/bot.ts`
- **createBot()** (74 connections) — `bot/src/bot/bot.ts`
- **checkout.ts** (59 connections) — `bot/src/bot/handlers/checkout.ts`
- **input.ts** (53 connections) — `bot/src/bot/handlers/input.ts`
- **handlers/admin.ts** (44 connections) — `bot/src/bot/handlers/admin.ts`
- **escapeHtml()** (42 connections) — `bot/src/utils/html.ts`
- **isAdmin()** (40 connections) — `bot/src/bot/handlers/admin.ts`
- **getOrderById()** (39 connections) — `bot/src/services/orders.service.ts`
- **handleTextInput()** (35 connections) — `bot/src/bot/handlers/input.ts`
- **getProductById()** (30 connections) — `bot/src/services/catalog.service.ts`
- **orders.ts** (28 connections) — `bot/src/bot/handlers/orders.ts`
- **catalog.service.ts** (27 connections) — `bot/src/services/catalog.service.ts`
- **getSetting()** (27 connections) — `bot/src/services/settings.service.ts`
- **admin_queue.ts** (25 connections) — `bot/src/bot/handlers/admin_queue.ts`
- **formatPriceETB()** (25 connections) — `bot/src/services/catalog.service.ts`
- **broadcast.ts** (21 connections) — `bot/src/bot/handlers/broadcast.ts`
- **setPendingAction()** (21 connections) — `bot/src/bot/session.ts`
- **gate.ts** (16 connections) — `bot/src/bot/handlers/gate.ts`
- **session.ts** (16 connections) — `bot/src/bot/session.ts`
- **html.ts** (15 connections) — `bot/src/utils/html.ts`
- **renderPaymentRailSelection()** (14 connections) — `bot/src/bot/handlers/checkout.ts`
- **handlePhotoInput()** (14 connections) — `bot/src/bot/handlers/input.ts`
- **fulfillOrderWithProof()** (14 connections) — `bot/src/services/orders.service.ts`
- **handleDocumentInput()** (13 connections) — `bot/src/bot/handlers/input.ts`
- **renderAdminOrdersQueue()** (12 connections) — `bot/src/bot/handlers/admin_queue.ts`
- *... and 62 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (217 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (132 shared connections)
- [Broadcast.Service Hardening Suite.Test Cluster](Broadcast.Service_Hardening_Suite.Test_Cluster.md) (15 shared connections)
- [Formatters Cluster](Formatters_Cluster.md) (7 shared connections)
- [SMS Receipt Parser & Ingestion](SMS_Receipt_Parser_&_Ingestion.md) (4 shared connections)
- [Banner Generation & Assets](Banner_Generation_&_Assets.md) (2 shared connections)

## Source Files

- `bot/src/bot/bot.ts`
- `bot/src/bot/handlers/admin.ts`
- `bot/src/bot/handlers/admin_queue.ts`
- `bot/src/bot/handlers/broadcast.ts`
- `bot/src/bot/handlers/checkout.ts`
- `bot/src/bot/handlers/gate.ts`
- `bot/src/bot/handlers/health.ts`
- `bot/src/bot/handlers/inline_query.ts`
- `bot/src/bot/handlers/input.ts`
- `bot/src/bot/handlers/orders.ts`
- `bot/src/bot/handlers/support.ts`
- `bot/src/bot/session.ts`
- `bot/src/logger/index.ts`
- `bot/src/services/alerts.service.ts`
- `bot/src/services/catalog.service.ts`
- `bot/src/services/orders.service.ts`
- `bot/src/services/settings.service.ts`
- `bot/src/services/stock.service.ts`
- `bot/src/services/support.service.ts`
- `bot/src/utils/html.ts`

## Audit Trail

- EXTRACTED: 785 (98%)
- INFERRED: 14 (2%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*