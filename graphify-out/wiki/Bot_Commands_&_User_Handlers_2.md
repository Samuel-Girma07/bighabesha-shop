# Bot Commands & User Handlers

> 46 nodes · cohesion 0.12

## Key Concepts

- **start.ts** (27 connections) — `bot/src/bot/handlers/start.ts`
- **users.service.ts** (26 connections) — `bot/src/services/users.service.ts`
- **onboarding.ts** (22 connections) — `bot/src/bot/handlers/onboarding.ts`
- **startHandler()** (22 connections) — `bot/src/bot/handlers/start.ts`
- **registration.ts** (21 connections) — `bot/src/bot/handlers/registration.ts`
- **prepared()** (20 connections) — `bot/src/db/index.ts`
- **i18n/index.ts** (15 connections) — `bot/src/i18n/index.ts`
- **getUserById()** (12 connections) — `bot/src/services/users.service.ts`
- **isUserRegistered()** (11 connections) — `bot/src/services/users.service.ts`
- **registration.test.ts** (11 connections) — `bot/tests/registration.test.ts`
- **checkChannelMembership()** (10 connections) — `bot/src/bot/handlers/onboarding.ts`
- **promptChannelSubscription()** (10 connections) — `bot/src/bot/handlers/onboarding.ts`
- **promptPhoneRegistration()** (10 connections) — `bot/src/bot/handlers/registration.ts`
- **handleOnboardingLanguage()** (9 connections) — `bot/src/bot/handlers/onboarding.ts`
- **handleContactMessage()** (9 connections) — `bot/src/bot/handlers/registration.ts`
- **t()** (9 connections) — `bot/src/i18n/index.ts`
- **handleOnboardingChannelCheck()** (8 connections) — `bot/src/bot/handlers/onboarding.ts`
- **handleManualPhoneText()** (8 connections) — `bot/src/bot/handlers/registration.ts`
- **saveUserPhone()** (8 connections) — `bot/src/services/users.service.ts`
- **upsertUser()** (6 connections) — `bot/src/services/users.service.ts`
- **health.ts** (5 connections) — `bot/src/bot/handlers/health.ts`
- **saveUserLanguage()** (5 connections) — `bot/src/services/users.service.ts`
- **validatePhoneNumber()** (5 connections) — `bot/src/services/users.service.ts`
- **healthHandler()** (4 connections) — `bot/src/bot/handlers/health.ts`
- **getRequiredChannelUsername()** (4 connections) — `bot/src/bot/handlers/onboarding.ts`
- *... and 21 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (42 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (39 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (16 shared connections)
- [Visual Snapshot & Canvas Engine](Visual_Snapshot_&_Canvas_Engine.md) (1 shared connections)

## Source Files

- `bot/src/bot/handlers/health.ts`
- `bot/src/bot/handlers/onboarding.ts`
- `bot/src/bot/handlers/registration.ts`
- `bot/src/bot/handlers/start.ts`
- `bot/src/bot/keyboards/menu.ts`
- `bot/src/db/index.ts`
- `bot/src/i18n/index.ts`
- `bot/src/services/users.service.ts`
- `bot/tests/i18n.test.ts`
- `bot/tests/registration.test.ts`

## Audit Trail

- EXTRACTED: 215 (99%)
- INFERRED: 3 (1%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*