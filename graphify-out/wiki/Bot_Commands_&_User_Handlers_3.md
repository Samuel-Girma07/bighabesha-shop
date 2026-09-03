# Bot Commands & User Handlers

> 13 nodes · cohesion 0.32

## Key Concepts

- **banner_generator.service.ts** (22 connections) — `bot/src/services/banner_generator.service.ts`
- **getAvailableStockCount()** (16 connections) — `bot/src/services/stock.service.ts`
- **getBannerPngPath()** (13 connections) — `bot/src/services/banner_generator.service.ts`
- **shop.ts** (12 connections) — `bot/src/bot/handlers/shop.ts`
- **getProductVariants()** (11 connections) — `bot/src/services/catalog.service.ts`
- **renderCatalog()** (8 connections) — `bot/src/bot/handlers/shop.ts`
- **renderProductDetails()** (8 connections) — `bot/src/bot/handlers/shop.ts`
- **generateSvgBanner()** (4 connections) — `bot/src/services/banner_generator.service.ts`
- **prewarmAllBanners()** (4 connections) — `bot/src/services/banner_generator.service.ts`
- **storeSnapshot()** (4 connections) — `bot/src/services/banner_generator.service.ts`
- **ensureAssetsDir()** (2 connections) — `bot/src/services/banner_generator.service.ts`
- **ASSETS_DIR** (1 connections) — `bot/src/services/banner_generator.service.ts`
- **BannerType** (1 connections) — `bot/src/services/banner_generator.service.ts`

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (23 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (20 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (8 shared connections)
- [Banner Generation & Assets](Banner_Generation_&_Assets.md) (4 shared connections)
- [WebApp Reusable UI Components](WebApp_Reusable_UI_Components.md) (1 shared connections)

## Source Files

- `bot/src/bot/handlers/shop.ts`
- `bot/src/services/banner_generator.service.ts`
- `bot/src/services/catalog.service.ts`
- `bot/src/services/stock.service.ts`

## Audit Trail

- EXTRACTED: 78 (96%)
- INFERRED: 3 (4%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*