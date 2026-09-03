# Payment Rails & Verification

> 26 nodes · cohesion 0.12

## Key Concepts

- **security.test.ts** (37 connections) — `bot/tests/security.test.ts`
- **pricing.service.ts** (20 connections) — `bot/src/services/pricing.service.ts`
- **resolveOrderPrice()** (14 connections) — `bot/src/services/pricing.service.ts`
- **getVariantById()** (9 connections) — `bot/src/services/catalog.service.ts`
- **PricingError** (9 connections) — `bot/src/services/pricing.service.ts`
- **assertPositiveIntegerETB()** (6 connections) — `bot/src/services/pricing.service.ts`
- **tierDiscountPct()** (5 connections) — `bot/src/services/loyalty.service.ts`
- **Product** (3 connections) — `bot/src/services/catalog.service.ts`
- **Variant** (3 connections) — `bot/src/services/catalog.service.ts`
- **Tier** (3 connections) — `bot/src/services/loyalty.service.ts`
- **reconcileStuckWalletPayOrders** (3 connections) — `bot/src/services/payments/index.ts`
- **resetWalletPayAdapter()** (3 connections) — `bot/src/services/payments/index.ts`
- **ResolvedPrice** (3 connections) — `bot/src/services/pricing.service.ts`
- **authHeader()** (3 connections) — `bot/tests/security.test.ts`
- **activeSalePrice()** (2 connections) — `bot/src/services/pricing.service.ts`
- **ResolveOrderPriceParams** (2 connections) — `bot/src/services/pricing.service.ts`
- **generateValidInitData()** (2 connections) — `bot/tests/security.test.ts`
- **postOrder()** (2 connections) — `bot/tests/security.test.ts`
- **.constructor()** (1 connections) — `bot/src/services/pricing.service.ts`
- **closeServer()** (1 connections) — `bot/tests/security.test.ts`
- **collectOutboundMessages()** (1 connections) — `bot/tests/security.test.ts`
- **__dirname** (1 connections) — `bot/tests/security.test.ts`
- **__filename** (1 connections) — `bot/tests/security.test.ts`
- **listen()** (1 connections) — `bot/tests/security.test.ts`
- **MIGRATIONS_DIR** (1 connections) — `bot/tests/security.test.ts`
- *... and 1 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (34 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (16 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (11 shared connections)

## Source Files

- `bot/src/services/catalog.service.ts`
- `bot/src/services/loyalty.service.ts`
- `bot/src/services/payments/index.ts`
- `bot/src/services/pricing.service.ts`
- `bot/tests/security.test.ts`

## Audit Trail

- EXTRACTED: 99 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*