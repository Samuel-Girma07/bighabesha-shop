# Changelog

All notable changes to the **Bighabesha Shop** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — "Ink & Jade" Design System (2026-08-23)
Full visual overhaul of the Mini App and Admin Dashboard around a premium-fintech identity.

### Design System
- New token layer: ink surface scale (`#070B12 → #243146`), hairline borders, jade action accent with brass reserved for tier/premium moments, semantic danger/warn/info.
- Typography: Inter Tight (UI) + JetBrains Mono (all numerals: prices, order ids, KPIs — tabular) + Noto Sans Ethiopic for Amharic; CSP updated to serve Google Fonts.

### Mini App
- Restyled every surface from the token layer: sticky blurred header, trust strip, product cards with icon tiles and soft stock pills, plan/bank selectors with selected states, bottom-sheet modals with grab bars, receipt dropzone, chat bubbles, referral card.
- Floating pill tab dock with active indicator and safe-area handling; skeleton shimmer + reduced-motion support.

### Admin Dashboard ("The Desk")
- Data-dense pass: compact 204px sidebar with rail indicators, 52px topbar with global search + live-sync pulse, flat KPI strip with tabular-mono hero values, uppercase micro-label table headers with density overrides, ghost buttons, restyled modals/toasts/filter pills.
- RBAC-aware navigation now lands restricted roles on their first permitted tab; all gold-gradient CTAs harmonized to the jade system.

### Fixes surfaced during visual QA
- `Buffer` polyfill for isomorphic TON libraries in the browser bundle (root cause of the black-screen report).
- TonConnect provider scoped to the storefront; manifest served with real URLs.
- CSP opened for fonts.googleapis/gstatic, config.ton.org, bridge.tonconnect.org, wallet-logo images, toncenter.
- Verified end-to-end via headless-Edge screenshot probes: storefront, admin login, authenticated dashboard and orders table render with zero console errors.
## [1.1.0] - Advanced Commerce Platform (2026-08-23)
The MVP becomes an enterprise-grade store: 14 advanced features spanning growth, payments automation, business intelligence, and customer experience — all on the server-authoritative seams.

### Payments & Rails
- **Chapa gateway adapter** (#13): hosted checkout for cards/Telebirr/CBE Birr with HMAC-SHA256 webhook verification (`chapa-signature`), paid-amount verification against net payable, duplicate-delivery idempotency, reconciliation-loop integration, and graceful disable when `CHAPA_SECRET_KEY` is unset.
- **TON Connect non-custodial payments** (#14): `@tonconnect/ui-react` in the Mini App sends exact-amount transactions with the order id as on-chain memo; backend verifies via TonCenter (`matchTonTransaction`: memo equality + ≥quote within 1% tolerance), ownership-guarded status endpoint, auto-fulfilment with tx-hash provenance.
- Promo/discount-aware invoicing: Stars invoices and crypto quotes now price off **net payable** (amount − discount).

### Growth Engine
- **Promo codes & flash sales** (#1): pct/flat discounts with atomic redemption inside the order-creation transaction (race-safe `used_count < max_uses` guard), per-user limits, expiry windows, product scoping, min-order thresholds, bot rail-screen redemption flow, admin CRUD endpoints, and window-checked flash-sale pricing in the authoritative resolver.
- **Two-tier referrals** (#5): deep-link attribution (`?start=ref_CODE`), L1 5% + L2 1% commissions (settings-configurable) credited idempotently on fulfilment via a double-entry ledger, discount-aware (net revenue), payout request queue with finance-role decisions and ledger settlement.
- **VIP loyalty tiers** (#4): lifetime-spend stats maintained transactionally at the status choke point (fulfilment +, refund −), Bronze/Silver/Gold tiers with server-side tier discounts in pricing, tier badge in bot profile and Mini App header.
- **Abandoned-checkout recovery** (#2): once-only reminders after configurable hours with deep links into the existing resume-payment flow.
- **Stale-order TTL sweeper** (#3): awaiting-payment orders auto-cancelled after 24h with audit trail and timeline events.

### Customer Experience
- **Real-time order stepper** (#6): `order_events` recorded at the single transition choke point (actor-attributed), served through the order detail API, rendered as an animated progress timeline in the Mini App.
- **In-app support bridge** (#7): Mini App live chat ↔ per-user Telegram forum topics, bidirectional relay, message persistence, length caps, dedicated rate limiter, env-gated graceful disable.
- **CloudStorage prefs, haptics kit & multi-currency switcher** (#8): cross-device language/currency persistence with localStorage fallback, centralized haptic feedback, display-only ETB/USD/TON toggle backed by whitelisted FX settings.

### Operations & Intelligence
- **RBAC** (#10): `admins` table with superadmin/ops/finance/support roles, permission matrix middleware on every admin route, self-healing backfill from `ADMIN_IDS`, deactivated-admin session revocation, role-scoped dashboard navigation.
- **Net-profit analytics & exports** (#11): immutable COGS/FX snapshots at order creation, per-rail fee model (Chapa %, Stars cash-out %, wallet gas bps), monthly P&L rollup, CSV/XLSX (exceljs)/PDF (pdfkit) financial exports gated behind `export.financial`.
- **Predictive restock** (#12): 7-day sales velocity, days-of-cover, reorder-point forecasting with admin insights endpoint.
- **CBE SMS matcher** (#9): fixture-tested parser for forwarded debit SMS, exact-net-amount matching against open orders with ambiguity refusal, evidence stored for human 1-tap verification.

### Tests
+58 new tests across `features_commerce.test.ts` (37) and `features_rails_rbac.test.ts` (21): promo race conditions, referral idempotency, tier boundaries, lifecycle sweeps, profit math, velocity forecasts, SMS fixtures, RBAC matrix enforcement, webhook signature/amount/idempotency adversarial cases, TON matcher tolerance, support thread routing. Total: 287 bot + 7 webapp, all green.
## [1.0.4] - Hygiene & Operability Polish (2026-08-22)
### Fixed
- **Repository hygiene:** removed scratch screenshots, debug images, `take_screenshots.mjs`, and the unused root `playwright` devDependency; `.gitignore` hardened against scratch images, screenshots, DB snapshots/backup archives, and coverage artifacts.
- **Mini App HTML metadata:** favicon now points at the real `/icons/logo.svg` (was the nonexistent `/vite.svg`); viewport no longer disables zoom (`maximum-scale`/`user-scalable=no` removed) for accessibility; added theme-color and description metadata.
- **Graceful shutdown:** SIGINT/SIGTERM now closes idle keep-alive sockets immediately and force-closes remaining connections after a 3s grace period (plus reconciliation/cleanup timer stops), so PM2 restarts complete instantly.
- **Banner generator:** exhaustive `default` case (compile-time `never` check) fails loudly on unknown banner types instead of returning undefined.
- **Docs encoding:** `MANUAL_TESTS.md` LaTeX fragment replaced with clean typography; `/wp_simulate` instructions updated to reflect admin-only/mock-only behavior.

### Added
- **Admin audit trail:** new `audit_logs` table (migration `005`) recording admin ID, action, target, change payload, IP and timestamp for logins (success/failure), 2FA verification, logout, order approve/reject/fulfill, stock add/delete, settings updates, and broadcast starts. Exposed via authenticated `GET /api/admin/audit`; audit writes are best-effort and never block operations.
- **Server-side logout:** `DELETE /api/admin/auth/logout` invalidates the session row; the dashboard calls it on sign-out and self-heals malformed local tokens (64-hex shape validation) on load.
- New hygiene regression suite `bot/tests/hygiene.test.ts` (audit trail coverage, logout invalidation, pragma configuration, banner exhaustiveness, repo/HTML cleanliness guards).

## [1.0.3] - Operational Hardening (2026-08-22)
### Fixed
- **Config drift:** deterministic `.env` resolution anchored to the monorepo root (cwd-independent, `DOTENV_PATH` override supported); duplicate `bot/.env` removed; ephemeral `trycloudflare` defaults eliminated — `WEBAPP_URL` is required HTTPS in production and the WebApp menu button is omitted when unset in dev.
- **Order state machine:** strict transition map (`ALLOWED_TRANSITIONS`) blocks status regressions — `pending_approval` can never silently drop back to `awaiting_payment`; rail switches use `updateOrderMeta` which preserves receipts and status; `fulfilled`/`refunded`/`cancelled` protected.
- **Receipt storage:** uploads validated by magic bytes (JPEG/PNG/WebP only), stored with truthful extensions under a configurable `RECEIPTS_DIR` (defaults next to the DB, not `process.cwd()`), capped at `RECEIPT_MAX_BYTES`, with automatic retention-based cleanup.
- **Broadcast scaling:** web dashboard broadcasts now run as tracked background jobs (202 + status polling) with chunked delivery, rate-limit pacing (~30 msg/s), and per-user error isolation; photo attachment support added to the dashboard for bot parity.
- **Stars invoices on sold-out products:** `POST /api/orders` returns 409 `OUT_OF_STOCK` before order creation or invoice generation for stock products.
- **Health check:** `/api/health` performs live SQLite read+write probes (heartbeat table) and returns 503 on database failure.
- **Stock CSV imports:** remote document downloads capped at 5 MB (declared size, content-length, and decoded-size checks).
- **Log privacy:** pino redact config for passwords/OTPs/tokens/payment identifiers; user message previews truncated; activation links never logged in plaintext.

### Added
- Periodic maintenance service purging expired admin sessions, OTPs, bot sessions, stale broadcast drafts, and aged receipt files.
- GitHub Actions CI workflow (typecheck → build → dist asset verification → full test suites) plus a webapp Vitest suite covering pricing helpers and en/am translation key parity.
- Hardened backup script: SQLite `integrity_check` gate, DB + receipts compressed archives, manifest stamping, clean retention pruning.
- New operational test suite `bot/tests/maintenance.test.ts` (state machine guards, health probes, purge jobs, stock gates, broadcast resilience, redaction, env determinism).
## [1.0.2] - High-Severity Hardening (2026-08-22)
### Fixed
- **Wallet Pay webhook verification:** single canonical HMAC-SHA256 scheme (hex/base64 encodings of the same HMAC), 5-minute timestamp freshness window (replay protection), and paid-amount/currency verification against the quote stored on the order before any status transition. Fail-closed when neither order nor event carries a verifiable amount.
- **`payment_ref` loss:** provider payment reference and crypto quote (`crypto_amount`, `crypto_currency` — new migration `004_wallet_pay_meta.sql`) are persisted immediately at payment creation in both the REST API and bot checkout; the reconciliation worker now queries Wallet Pay with the stored `payment_ref`.
- **Authorization gaps:** `performAdminApprove`, `promptAdminReject`, broadcast-composition, fulfillment-proof, and refund text actions all require `isAdmin()`; `cancel_order_` enforces ownership + terminal-state protection; receipt-upload prompts and uploads enforce `order.user_id === from.id`.
- **Stars stock race:** `pre_checkout_query` rejects invoices for sold-out stock products BEFORE funds are captured; post-payment delivery failures keep orders in `pending_fulfillment`, fire urgent manual-fulfillment alerts to every admin, and reassure the buyer — no paid order is ever silently dropped.
- **React Rules-of-Hooks crash:** Mini App routing split into a thin `App` router and a `StoreFront` component so hooks execute unconditionally per surface.
- **Registration trap:** users reaching phone registration via `/shop` (without `/start`) now get their `users` row created on contact share instead of an infinite re-registration loop.
- **Settings leak:** `/api/bootstrap` returns only a whitelisted set of storefront settings (`getPublicSettings`); margins, FX config, stock thresholds, and delivery instructions are no longer exposed to unauthenticated clients.
- **Merchant data scrubbed:** real CBE/Telebirr account numbers removed from seeds, handler defaults, banner SVGs, and Mini App fallbacks (replaced with placeholders); banners are now generated dynamically from catalog prices + settings with content-hash cache keys (auto-regeneration on price/account changes).
- **Magic admin ID purged** from all remaining source files and test fixtures.

### Added
- New high-severity test suite (`bot/tests/high_severity.test.ts`) covering webhook signatures/replays/amount mismatches, live-mode signature enforcement, payment_ref persistence & reconciliation wiring, IDOR/authorization guards, Stars stock-race rejection and recovery, /shop-first registration, public-settings whitelist, and source-scan guards against hardcoded merchant data.

## [1.0.1] - Security Hardening (2026-08-22)
### Fixed
- **Payment bypass:** order prices are now computed server-side (`pricing.service.ts`) from catalog variants and rate-engine settings; client-supplied `amountETB` and forged callback prices are ignored. Non-positive/non-integer amounts rejected at service level.
- **`/wp_simulate` privilege escalation:** restricted to configured admins and hard-disabled when `WALLET_PAY_MODE=live`.
- **Mock payment fail-open:** production now refuses to boot with mock Wallet Pay; the mock adapter's `verifyPayment()` returns `false` in production and the reconciliation loop skips mock-adapter fulfilment.
- **Hardcoded admin password removed** (`Bighabesha2026!Admin` default deleted); missing `ADMIN_PASSWORD` disables dashboard login in dev and blocks boot in production; hardcoded fallback admin ID removed; password/OTP comparisons made timing-safe.
- **Broken i18n in production builds:** `pnpm build` now copies locale JSON into `dist/` via `scripts/copy-assets.mjs`, so compiled bots ship with working translations.

### Added
- Rate limiting: admin login (5/15min/IP), OTP verification (5/10min/IP), checkout and receipt endpoints (10/min/IP), global API cap (300/15min/IP) via `express-rate-limit`.
- Security headers via `helmet` with a CSP allowing Telegram WebApp embedding.
- Strict CORS allowlist (`WEBAPP_URL` + optional `CORS_ORIGINS`) replacing open CORS.
- `TRUST_PROXY` configuration for correct client-IP attribution behind cloudflared tunnels.
- Split request body limits: 100 KB global, dedicated 3 MB parser for base64 receipt uploads.
- New adversarial security test suite (`bot/tests/security.test.ts`) covering price tampering, forged callbacks, unauthorized simulation, brute-force throttling, payload-size caps, CORS/header assertions, production boot guards, and i18n runtime loading.

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
