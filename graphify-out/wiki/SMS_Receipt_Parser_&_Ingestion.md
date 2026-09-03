# SMS Receipt Parser & Ingestion

> 9 nodes · cohesion 0.22

## Key Concepts

- **WebApp Checkout Screen Banner** (4 connections) — `webapp/public/banners/checkout.jpg`
- **CBE Payment Rail Icon** (4 connections) — `webapp/public/icons/cbe.jpg`
- **Bot Checkout Static Banner** (3 connections) — `bot/assets/static_banners/checkout.jpg`
- **Bank of Abyssinia Payment Icon** (3 connections) — `webapp/public/icons/abyssinia.jpg`
- **Telebirr Mobile Money Payment Icon** (3 connections) — `webapp/public/icons/telebirr.jpg`
- **PaymentAbyssiniaIcon()** (3 connections) — `webapp/src/components/Icons.tsx`
- **PaymentCbeIcon()** (3 connections) — `webapp/src/components/Icons.tsx`
- **PaymentTelebirrIcon()** (3 connections) — `webapp/src/components/Icons.tsx`
- **ParsedCbeSms** (2 connections) — `bot/src/services/sms_parser.service.ts`

## Relationships

- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (4 shared connections)
- [WebApp Reusable UI Components](WebApp_Reusable_UI_Components.md) (3 shared connections)
- [WebApp Admin Dashboard](WebApp_Admin_Dashboard.md) (3 shared connections)
- [Banner Generation & Assets](Banner_Generation_&_Assets.md) (1 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (1 shared connections)

## Source Files

- `bot/assets/static_banners/checkout.jpg`
- `bot/src/services/sms_parser.service.ts`
- `webapp/public/banners/checkout.jpg`
- `webapp/public/icons/abyssinia.jpg`
- `webapp/public/icons/cbe.jpg`
- `webapp/public/icons/telebirr.jpg`
- `webapp/src/components/Icons.tsx`

## Audit Trail

- EXTRACTED: 7 (35%)
- INFERRED: 13 (65%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*