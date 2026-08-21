# Changelog

All notable changes to the **Bighabesha Shop** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Phase 6 (2026-08-21)
### Added
- Automated VPS provisioning script (`deploy/vps-setup.sh`) for Ubuntu 22.04 LTS with Node.js 20, PM2, and log rotation.
- Automated SQLite safe online backup script (`deploy/backup.sh`) with 7-day retention.
- PM2 runtime process configuration (`deploy/ecosystem.config.cjs`).
- API request rate-limiting security middleware.
- Client owner-onboarding and credential handover checklist in `README.md`.
- Final end-to-end verification passing all 61 automated tests and manual verification scripts.

## [0.6.0] - Phase 5 (2026-08-21)
### Added
- Telegram Mini App built with React 19, Vite, and TypeScript in `webapp/`.
- Authenticated REST API server in bot process running on `PORT` (default 3000) supporting `/api/bootstrap`, `/api/orders`, and `/api/receipt`.
- Cryptographic Telegram `initData` HMAC-SHA256 authentication middleware with timing-attack prevention.
- Mini App feature parity: Gemini Pro 18m live stock view, Telegram Premium duration selectors, Telegram Stars package pills + custom amount slider/calculator.
- Client-side Username Gate modal matching bot logic with live recheck.
- Multi-rail checkout modal supporting native Stars invoices (`Telegram.WebApp.openInvoice`), Wallet Pay deep links, and manual bank rails with photo receipt uploads.
- My Orders history and detail view in Mini App with activation link copy tool and receipt review status.
- Cloudflare Pages and Cloudflared Tunnel setup documentation in `deploy/`.
- Phase 5 test suite covering initData verification (valid, invalid, tampered, expired), API contracts, and responsive layout compatibility.

## [0.5.0] - Phase 4 (2026-08-21)
### Added
- Admin Orders Fulfillment Queue with oldest-first (FIFO) sorting for pending Telegram Premium and Stars orders.
- Queue fulfillment actions supporting optional screenshot proof delivery to the buyer, instant fulfillment without proof, and refunds.
- Real-time new-order and receipt alerts dispatched to all configured `ADMIN_IDS` with one-tap action buttons.
- In-chat Broadcast announcement composer with audience filtering (All users vs English speakers), preview step, and throttled dispatch engine.
- Telegram API 429 rate limit retry middleware with `retry_after` awareness.
- Comprehensive end-to-end testing manual in `docs/MANUAL_TESTS.md`.
- Phase 4 test suite covering queue FIFO ordering, proof attachments, broadcast targeting, and admin authorization.

## [0.4.0] - Phase 3 (2026-08-21)
### Added
- Username Gate mechanism for Telegram Premium and Telegram Stars, preventing order initiation for users without public `@username`.
- Step-by-step setup guide and `[🔄 I created it — recheck]` handler querying live profile data via Bot API.
- Automated instant delivery engine for Gemini Pro 18m upon payment settlement across all payment rails (Stars, Wallet Pay, and manual approval).
- Admin-customizable instructions template for Gemini activation with VPN guidelines.
- `My Orders` screen (`/orders` & menu) listing order history with status badges, delivered payload secrets, and receipt status.
- Language preference selector with user database persistence.
- Phase 3 test suite covering gate block/unblock paths, Gemini stock link decrement and auto-delivery, and order history formatting.

## [0.3.0] - Phase 2 (2026-08-21)
### Added
- Rate Engine implementing ETB to USD, Telegram Stars (XTR), and TON/USDT conversions with ceil rounding and 5% margin.
- In-memory CoinGecko pricing cache with 5-minute TTL and resilient fallback defaults.
- Live USD/ETB helper from `open.er-api.com`.
- Full order lifecycle service (`new` -> `awaiting_payment` -> `pending_approval` -> `pending_fulfillment` -> `fulfilled` / `rejected`).
- Telegram Stars Bot Payments API integration (`currency: 'XTR'`) with `pre_checkout_query` and `successful_payment` handlers.
- Wallet Pay `PaymentAdapter` pattern with `MockWalletPay` supporting `/wp_simulate <order_id>` dev command and `LiveWalletPay` adapter.
- Manual local payment rails (Telebirr, CBE Bank, Bank of Abyssinia) displaying admin account details and supporting photo receipt uploads.
- Dual-admin DM receipt alerts with one-tap inline `[✅ Approve]` and `[❌ Reject]` buttons, updating state and notifying buyers.
- Phase 2 test suite covering rate calculations, edge cases, cache TTL, order state transitions, and payment adapters.

## [0.2.0] - Phase 1 (2026-08-21)
### Added
- Catalog models (`products`, `variants`, `stock_items`) supporting stock and order fulfillment types.
- Seed data for Gemini Pro 18m, Telegram Premium (3/6/12m), and Telegram Stars packages & custom bounds.
- Interactive inline shop browser with category navigation, pricing displays, and stock badges.
- Variant pickers and custom stars validator with range checking ($10 - 100,000$).
- Stock management service supporting single link paste and CSV file/text upload.
- Low-stock alert service ($\le 5$ items & sold-out notifications) dispatching to all admins with one-tap action buttons.
- Admin in-chat control panel for editing variant prices, restocking links, updating exchange rates, and editing bank accounts.
- Comprehensive Phase 1 test suite covering seeding idempotency, stock decrement/sold-out, CSV parsing, and rate/setting editing.

## [0.1.0] - Phase 0 (2026-08-21)
### Added
- Monorepo structure with `pnpm` workspaces (`bot/`, `webapp/`, `deploy/`, `docs/`).
- Verbatim `docs/SPEC.md` specification and architecture guidelines.
- Environment validation with `zod` and `.env.example`.
- `better-sqlite3` database initialization and migration runner.
- Initial database schema migration (`001_init.sql`).
- Fast and structured `pino` logger.
- i18n localization module with English dictionary (`en.json`).
- Grammy bot instance with `/start`, `/health`, and `/ping` commands.
- Comprehensive test suite covering env validation, database migrations, i18n, and bot command handlers.
