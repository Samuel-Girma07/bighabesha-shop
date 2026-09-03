# Bot Commands & User Handlers

> 89 nodes · cohesion 0.05

## Key Concepts

- **getDatabase()** (109 connections) — `bot/src/db/index.ts`
- **api/admin.ts** (75 connections) — `bot/src/api/admin.ts`
- **features_commerce.test.ts** (50 connections) — `bot/tests/features_commerce.test.ts`
- **settings.service.ts** (37 connections) — `bot/src/services/settings.service.ts`
- **getNumericSetting()** (29 connections) — `bot/src/services/settings.service.ts`
- **promo.service.ts** (18 connections) — `bot/src/services/promo.service.ts`
- **referral.service.ts** (18 connections) — `bot/src/services/referral.service.ts`
- **permissions.ts** (17 connections) — `bot/src/auth/permissions.ts`
- **loyalty.service.ts** (16 connections) — `bot/src/services/loyalty.service.ts`
- **profit.service.ts** (13 connections) — `bot/src/services/profit.service.ts`
- **profile.ts** (12 connections) — `bot/src/bot/handlers/profile.ts`
- **audit.service.ts** (12 connections) — `bot/src/services/audit.service.ts`
- **download_tokens.service.ts** (11 connections) — `bot/src/services/download_tokens.service.ts`
- **setSetting()** (11 connections) — `bot/src/services/settings.service.ts`
- **getUserStats()** (10 connections) — `bot/src/services/loyalty.service.ts`
- **getOrdersByUserId()** (10 connections) — `bot/src/services/orders.service.ts`
- **getReferralSummary()** (10 connections) — `bot/src/services/referral.service.ts`
- **sms_parser.service.ts** (10 connections) — `bot/src/services/sms_parser.service.ts`
- **ensureAdminRow()** (9 connections) — `bot/src/auth/permissions.ts`
- **analytics.service.ts** (9 connections) — `bot/src/services/analytics.service.ts`
- **renderProfile()** (8 connections) — `bot/src/bot/handlers/profile.ts`
- **recordAudit()** (8 connections) — `bot/src/services/audit.service.ts`
- **adjustUserStats()** (7 connections) — `bot/src/services/loyalty.service.ts`
- **redeemPromoInTx()** (7 connections) — `bot/src/services/promo.service.ts`
- **runLifecycleSweep()** (6 connections) — `bot/src/services/lifecycle.service.ts`
- *... and 64 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (163 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (73 shared connections)
- [Broadcast.Service Hardening Suite.Test Cluster](Broadcast.Service_Hardening_Suite.Test_Cluster.md) (22 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (18 shared connections)
- [SMS Receipt Parser & Ingestion](SMS_Receipt_Parser_&_Ingestion.md) (1 shared connections)

## Source Files

- `bot/src/api/admin.ts`
- `bot/src/auth/permissions.ts`
- `bot/src/bot/handlers/profile.ts`
- `bot/src/db/index.ts`
- `bot/src/services/analytics.service.ts`
- `bot/src/services/audit.service.ts`
- `bot/src/services/download_tokens.service.ts`
- `bot/src/services/lifecycle.service.ts`
- `bot/src/services/loyalty.service.ts`
- `bot/src/services/orders.service.ts`
- `bot/src/services/profit.service.ts`
- `bot/src/services/promo.service.ts`
- `bot/src/services/referral.service.ts`
- `bot/src/services/settings.service.ts`
- `bot/src/services/sms_parser.service.ts`
- `bot/tests/features_commerce.test.ts`

## Audit Trail

- EXTRACTED: 477 (100%)
- INFERRED: 1 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*