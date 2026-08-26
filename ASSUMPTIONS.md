# Architectural & Technical Assumptions

This document records technical and design decisions made throughout the development of **Bighabesha Shop**.

---

## Phase 0: Foundations, Architecture & Monorepo

### 1. Monorepo Structure & Package Management
- **Decision:** Use `pnpm` workspaces with two packages: `bot/` (Grammy bot, SQLite, rate engine, REST API) and `webapp/` (React + Vite Telegram Mini App).
- **Reasoning:** Monorepo keeps database schemas, validation types, and shared domain models closely aligned while keeping frontend and backend dependencies cleanly separated.
- **Node Target:** Node 20+ with strict TypeScript and native ES Modules (`"type": "module"`).

### 2. Database Engine & Persistence
- **Decision:** `better-sqlite3` running in WAL (Write-Ahead Logging) mode with `busy_timeout = 5000` and foreign keys enabled.
- **Reasoning:** Synchronous SQLite operations via `better-sqlite3` provide high throughput, zero external database operational overhead for VPS deployment, and ACID transaction guarantees.
- **Migration Strategy:** Lightweight custom SQL file-based migration runner executing in lexicographical order (`001_init.sql`, etc.) tracked in a `_migrations` schema table.

### 3. Environment & Configuration Validation
- **Decision:** Zod schema parsing for all environment variables with fail-fast validation at boot.
- **Reasoning:** Prevents runtime errors caused by missing secrets or invalid port formats before services start.
- **Admin IDs:** Parsed as an array of numeric Telegram IDs from comma-separated string in `ADMIN_IDS`.

### 4. Logging & Diagnostics
- **Decision:** `pino` logger with structured JSON output in production and `pino-pretty` in local development.
- **Reasoning:** Fast, structured, low-overhead logging suitable for pm2 log aggregation and diagnostics.

### 5. Internationalization (i18n) Framework
- **Decision:** Lightweight key-path translation engine (`i18n/`) loading JSON translation dictionaries (`en.json`), with runtime parameter interpolation (`{name}`, `{link}`) and fallback to English.
- **Reasoning:** Phase 1 ships English, but foundation is fully ready for Amharic and other localized languages without refactoring.

### 6. Currency & Number Formatting
- **Decision:** Standard format `"1,250 ETB"`, with integer rounding or explicit decimal formatting where appropriate.
- **Crypto Formula:** `crypto_amount = (price_ETB / etb_per_usd) * (1 + margin_pct / 100) / coin_price_usd`.

### 7. Concurrency & Multi-Admin Handling
- **Decision:** Database transactions for order state transitions. When an admin takes an action on an order (e.g. approve/reject/fulfill), the action atomically updates the order and updates/disables inline keyboard buttons for all admins to avoid double-fulfillment.

---

## Phase 1: Catalog, Pricing, Stock & Admin Core

### 1. Seeded Catalog Prices (ETB)
- **Gemini Pro (18 Months):** `1,500 ETB` (Instant delivery via single-use activation link).
- **Telegram Premium:**
  - 3 Months: `1,100 ETB`
  - 6 Months: `1,900 ETB`
  - 12 Months: `3,400 ETB`
- **Telegram Stars (Coins):**
  - Base Rate: `2.5 ETB / Star`
  - Preset packages: 50 ⭐ (125 ETB), 100 ⭐ (250 ETB), 250 ⭐ (625 ETB), 500 ⭐ (1,250 ETB), 1,000 ⭐ (2,500 ETB), 2,500 ⭐ (6,250 ETB).
  - Custom amount: Min `10 ⭐`, Max `100,000 ⭐`, price calculated as $\lceil \text{stars} \times 2.5 \rceil$ ETB.

### 2. Default Rate Engine Parameters
- `etb_per_usd`: `135 ETB`
- `etb_per_star`: `2.5 ETB`
- `margin_pct`: `5%`

### 3. Stock Management & Alert Rules
- `stock_items` stored with states `available`, `allocated`, `invalid`.
- Stock allocation executes inside atomic SQLite transaction with `RETURNING *`.
- Low-stock threshold defaults to `5` items (admin-editable); triggers DM alert with one-tap restock buttons to all configured `ADMIN_IDS` when remaining stock $\le 5$ or upon reaching `0` (sold out).
- CSV upload supports flexible formats (single-column, comma-separated, quoted links, optional header rows).

---

## Phase 2: Rate Engine, Payment Rails & Lifecycle

### 1. Rate Engine Math & Crypto Precision
- **Telegram Stars (XTR):** `stars_due = ceil(price_ETB / etb_per_star)`.
- **Crypto Conversion (TON/USDT):**  
  $\text{usd\_with\_margin} = (\text{price\_ETB} / \text{etb\_per\_usd}) \times (1 + \text{margin\_pct}/100)$  
  $\text{crypto\_amount} = \text{usd\_with\_margin} / \text{coin\_price\_usd}$ (rounded to 4 decimals for TON, 2 for USDT).
- **CoinGecko 5-minute Cache:** Cached in-memory with TTL of 300,000 ms. Fallback to default prices ($3.00 TON / $1.00 USDT) if network timeout occurs to ensure checkout availability.
- **Auto-Fill Exchange Rates:** API helper querying `open.er-api.com` for real-time ETB/USD market reference.

### 2. Payment Rails
- **Telegram Stars:** Native Telegram Invoices using currency `XTR`, handled via `pre_checkout_query` and `successful_payment`.
- **Wallet Pay:** `PaymentAdapter` architecture with `MockWalletPay` for local development (supports `/wp_simulate <order_id>`) and `LiveWalletPay` for production.
- **Manual Rails (Telebirr / CBE / Abyssinia):** User uploads receipt photo $\rightarrow$ transitions order to `pending_approval` $\rightarrow$ both admins receive instant photo notifications with `[✅ Approve]` and `[❌ Reject]` action buttons.

---

## Phase 3: Username Gate, Auto-Delivery & Orders History

### 1. Username Gate Enforcement
- **Requirement:** Users purchasing Telegram Premium or Telegram Stars MUST have a public `@username` set.
- **Gating Mechanism:** If `username` is missing, checkout is halted, displaying step-by-step guidance to set a username in Telegram Settings, along with a `[🔄 I created it — recheck]` button that queries the user's latest Telegram profile data via Bot API without restarting checkout.
- **Gemini Pro Exemption:** Gemini Pro 18m does not require a public username since fulfillment is delivered directly in-chat via unique activation links.

### 2. Automated Delivery Engine
- Instant single-use link allocation for Gemini Pro 18m upon payment verification on all payment rails.
- Delivery message embeds customizable activation steps and instructions template with VPN connection guidance.
- If inventory is exhausted before payment settles, order enters `pending_fulfillment` with instant high-priority alerts to admins.

### 3. Orders & Navigation
- `/orders` displays chronological order history with state badges (`✅ Delivered`, `⏳ Processing`, `⏳ Verifying Receipt`, `💳 Awaiting Payment`, `❌ Rejected`).
- Detail view surfaces delivered activation links, receipt review status, and direct support routing to `@Vweah`.

---

## Phase 4: Fulfillment Queue, Alerts, Broadcast & Hardening

### 1. Oldest-First (FIFO) Fulfillment Queue
- Pending fulfillment orders (`status = 'pending_fulfillment'`) are queried with `ORDER BY created_at ASC, rowid ASC` to ensure fair, chronological processing of Fragment gifts and Stars transfers.
- Admins can fulfill with optional screenshot proofs delivered directly to the buyer or perform instant fulfillment without proof.

### 2. Broadcast Engine
- Language-targeted broadcast dispatcher sending to all users or filtered by user `language_code`.
- Built-in rate limiting throttling to stay within Telegram API thresholds (30 req/sec) with automated error handling for blocked users.

### 3. Resilience & Rate Limit Recovery
- Grammy middleware intercepting `GrammyError` 429 and waiting for `parameters.retry_after` seconds.
- Idempotent state transitions preventing duplicate deliveries during concurrent admin actions.

---

## Phase 5: Telegram Mini App & Authenticated API

### 1. Telegram initData Authentication
- Server-side HMAC-SHA256 signature verification validating that requests originate from legitimate Telegram clients authenticated with `BOT_TOKEN`.
- Constant-time comparison preventing timing attacks.
- Enforces 24-hour expiration on `auth_date`.

### 2. REST API Endpoints in Bot Process
- Shared database and event loop architecture exposing `/api/bootstrap`, `/api/orders`, and `/api/receipt`.
- Telegram Stars invoice generation via Bot API `createInvoiceLink` allowing one-tap native in-app payments (`Telegram.WebApp.openInvoice`).
- Direct integration with `MockWalletPay` / `LiveWalletPay` for TON/USDT deep-linking.

### 3. Mobile Viewport & Design Tokens
- Design palette adhering strictly to SPEC tokens: bg `#17212B`, card `#242F3D`, primary `#078930`, CTA `#FCDD09` with dark text `#0E1621`, danger `#DA121A`.
- Fully responsive layout optimized for standard 360px and 414px mobile viewports.

---

## Phase 6: Production Deployment & Handover

### 1. Free-Tier Infrastructure Target
- **Compute:** Oracle Cloud Free Tier VPS (Ubuntu 22.04 LTS, Node.js 20, PM2 process management with auto-restart on memory limit > 350MB).
- **Ingress:** Cloudflare Tunnel (`cloudflared`) exposing backend `/api` routes with zero open incoming firewall ports.
- **Frontend:** Cloudflare Pages (Free SPA hosting) serving React Mini App bundle.
- **Storage & Backup:** SQLite with WAL mode + nightly cron backup script retaining 7 daily snapshots.

### 2. Security Pass & Handover
- Complete segregation of production credentials via `.env`.
- In-memory rate limiting on API endpoints (60 req/min/IP).
- Detailed onboarding instructions in `README.md` for seamless ownership transfer to the client.

---

## Phase 7: Critical Security Hardening

### 1. Server-Side Pricing Authority (Payment Bypass Fix)
- **Decision:** All order prices are resolved exclusively by `bot/src/services/pricing.service.ts` (`resolveOrderPrice`). The `amountETB` field in `POST /api/orders` and in Telegram callback payloads (`buy_custom_stars_<stars>_<price>`) is never trusted; prices are recomputed from catalog variants and the rate engine settings (`etb_per_star`, `stars_min`, `stars_max`).
- **Reasoning:** Client-supplied prices allowed arbitrary price injection (e.g., a 1,500 ETB product ordered for 1 ETB with automatic stock delivery). Defense-in-depth added via a positivity/integer guard inside `createOrder`.

### 2. Fail-Closed Production Configuration
- **Decision:** With `NODE_ENV=production`, boot fails unless `ADMIN_PASSWORD` (≥8 chars), `WALLET_PAY_MODE=live`, and `WALLET_PAY_API_KEY` are all explicitly configured. `MockWalletPayAdapter.verifyPayment()` additionally returns `false` in production, and the reconciliation loop refuses to run through the mock adapter.
- **Reasoning:** The previous default (`mock`) auto-confirmed real orders after 5 minutes if an operator forgot to set live mode. Fail-closed beats fail-open for payment systems.

### 3. `/wp_simulate` Lockdown
- **Decision:** The dev simulation command now requires both administrator membership (`ADMIN_IDS`) and `WALLET_PAY_MODE !== 'live'`. Non-admins receive a silent no-op.

### 4. Credential Handling & Brute-Force Protection
- **Decision:** Removed the hardcoded `ADMIN_PASSWORD` default and the hardcoded fallback admin ID (`1397163638`). Password and OTP comparisons use SHA-256 + `crypto.timingSafeEqual`. Missing `ADMIN_PASSWORD` in development disables the dashboard login (503) rather than falling back to any default. Added `helmet` security headers, strict CORS allowlist (`WEBAPP_URL` + optional `CORS_ORIGINS`), trust-proxy support (`TRUST_PROXY`) behind cloudflared, split body limits (100 KB global / 3 MB receipt uploads), and `express-rate-limit` on login (5/15 min), OTP verification (5/10 min), checkout & receipts (10/min each), and a global API cap (300/15 min).
- **Note:** This supersedes the Phase 6 assumption above — rate limiting is now genuinely implemented and tested.

### 5. i18n Bundling in Production Builds
- **Decision:** `pnpm build` runs `scripts/copy-assets.mjs` after `tsc`, copying `src/i18n/*.json` into `dist/i18n/`. TypeScript does not emit raw JSON assets, so without this step the compiled bot booted with an empty translation dictionary.
- **Reasoning:** Keeps locale JSON as the translator-facing format while guaranteeing runtime availability identically in `tsx` dev mode and compiled `node dist/index.js`.

---

## Phase 8: High-Severity Hardening

### 1. Wallet Pay Webhook Trust Model
- **Decision:** One canonical signature scheme (HMAC-SHA256 over `METHOD.path.timestamp.base64(body)`, keyed with the Store API key; hex canonical, base64 tolerated), a ±5-minute timestamp freshness window applied in every mode, and mandatory paid-amount/currency verification against `orders.crypto_amount`/`crypto_currency` before fulfilment. Events lacking verifiable amounts fail closed.
- **Reasoning:** The previous implementation accepted four alternative HMAC constructions and never checked freshness or amount — enabling replay and partial-payment fulfilment. Provider-side amount correctness is additionally guaranteed because reconciliation now queries by the stored provider `payment_ref`.

### 2. Payment Metadata Persistence
- **Decision:** Migration `004_wallet_pay_meta.sql` adds `crypto_amount`/`crypto_currency`; both payment-creation paths persist `payment_ref` + quote immediately via `updateOrderStatus`.
- **Reasoning:** Reconciliation previously fell back to the internal order id when querying Wallet Pay, producing permanent 404s for stuck live orders.

### 3. Authorization & Ownership Invariants
- **Decision:** Every admin callback/text action re-verifies `isAdmin()` server-side; every user order mutation verifies `order.user_id === from.id`. Cancellation additionally refuses terminal states.
- **Reasoning:** Callback data is client-forgeable; authorization must never rely on who could have received a button.

### 4. Stars Payment Capture Safety
- **Decision:** `pre_checkout_query` blocks sold-out stock products before capture; any post-capture delivery failure transitions to `pending_fulfillment`, alerts all admins with funds-captured context, and acknowledges the buyer.
- **Reasoning:** Telegram captures funds before `successful_payment` arrives — every failure path after that point must preserve deliverability and visibility.

### 5. Public Data Surface
- **Decision:** `/api/bootstrap` exposes only `getPublicSettings()` whitelist (star rate, star bounds, rail accounts/names). Banners render prices/accounts dynamically with content-hash PNG caching so admin edits propagate automatically.
- **Reasoning:** Margins, FX configuration, stock thresholds, and fulfillment instructions are operational secrets; merchant account numbers must never be committed to source control.

### 6. Frontend Structure
- **Decision:** Mini App root splits into an `App` route selector plus a `StoreFront` component; each surface owns its hooks unconditionally.
- **Reasoning:** Conditional early-return around hook calls crashed on route switches (Rules of Hooks).

---

## Phase 9: Operational Hardening

### 1. Environment Loading
- **Decision:** `.env` candidates resolve deterministically from the module directory (repo root first, cwd last resort, `DOTENV_PATH` override highest). Single file wins — no merging. Production additionally requires an HTTPS `WEBAPP_URL`; dev omits the menu button when unset.
- **Reasoning:** Two divergent `.env` files with ephemeral trycloudflare URLs made behavior depend on the launch directory and pointed production users at dead tunnels.

### 2. Order State Machine
- **Decision:** `updateOrderStatus` validates against an explicit transition map (`ALLOWED_TRANSITIONS`) with a documented escape hatch (`{force:true}`); rail/quote changes use `updateOrderMeta`, which never touches status.
- **Reasoning:** Payment-rail switching used to regress `pending_approval` orders to `awaiting_payment`, silently discarding uploaded receipts.

### 3. Receipt Lifecycle
- **Decision:** Receipts are validated by magic bytes (JPEG/PNG/WebP), size-capped (`RECEIPT_MAX_BYTES`, default 5 MB), stored with truthful extensions under `RECEIPTS_DIR` (defaults beside the SQLite DB) and purged after `RECEIPT_RETENTION_DAYS` (default 90).
- **Reasoning:** Fixed-extension `.jpg` storage plus blind `process.cwd()` paths made uploads both spoofable and launch-dir dependent.

### 4. Broadcast Delivery Model
- **Decision:** All broadcasts run through `deliverBroadcast` — injectable core loop with per-user error isolation, chunked pacing (~30 msg/s), and background-job tracking for the web dashboard (202 Accepted + status polling endpoint). Dashboard supports photo attachments via Telegram file_id.
- **Reasoning:** A synchronous request loop cannot survive fan-outs to large audiences and blocked users previously risked aborting runs.

### 5. Data Hygiene & Observability
- **Decision:** `maintenance.service.ts` purges expired sessions/OTPs/drafts every 15 minutes and receipt files on retention policy. `/api/health` performs real read+write probes returning 503 on failure. Logs redact credentials/tokens/payment ids; user text is preview-truncated; activation links are never logged raw.
- **Reasoning:** Lazy deletion let auth tables grow unboundedly; shallow health checks hid database outages from monitors.

### 6. Continuous Integration
- **Decision:** GitHub Actions workflow runs typecheck → build → dist-asset verification → bot + webapp test suites on pushes/PRs. Webapp gains Vitest coverage for pricing helpers and translation key parity.
- **Reasoning:** The repo previously had no CI gate despite carrying financial logic.








---

## Phase 10: Hygiene & Operability Polish

### 1. Audit Trail
- **Decision:** Append-only `audit_logs` table records every critical admin action (auth events, order decisions, stock mutations, settings updates, broadcast launches) with admin ID, target, change payload, and client IP. Writes are best-effort — a failed audit insert logs an error but never blocks the operation. Exposed read-only to admins via `/api/admin/audit`.
- **Reasoning:** Per-order notes alone cannot answer "who changed the bank account" or "which admin approved this" during incident response.

### 2. Session Lifecycle
- **Decision:** Logout invalidates the server-side session row (`DELETE /api/admin/auth/logout`); the dashboard clears local storage on logout, any 401, and self-heals tokens failing 64-hex shape validation.
- **Reasoning:** Client-only sign-out left valid bearer tokens in SQLite indefinitely.

### 3. Shutdown Semantics
- **Decision:** SIGINT/SIGTERM stops background timers, closes idle keep-alive connections immediately, force-closes remaining sockets after a 3s grace window, then flushes SQLite.
- **Reasoning:** `server.close()` alone waits for long-lived keep-alive clients, stalling PM2 restarts/deployments.

### 4. Repository Policy
- **Decision:** Scratch screenshots, debug images, screenshot tooling and unused root deps are removed; `.gitignore` blocks scratch images, DB snapshots/backup archives, and coverage artifacts; hygiene regression tests assert root cleanliness and correct Mini App HTML metadata (real favicon path, zoom-accessible viewport).
---

## Phase 11: Advanced Commerce Platform (v1.1.0)

### 1. Pricing Remains Singular & Authoritative
- **Decision:** Flash sales, loyalty tier discounts, and promo codes all resolve inside `resolveOrderPrice`/`createOrder` — never client-side. Promo redemption is atomic with order creation; a failed order rolls back the redemption counter.
- **Reasoning:** The payment-bypass class of vulnerability is structurally impossible when every discount path flows through the same choke point.

### 2. Referral Ledger Discipline
- **Decision:** Commissions are ledger entries with unique `idempotency_key` (`ref:<orderId>:L1|L2`) credited only on `fulfilled`, computed on NET revenue (after discounts). Payouts debit the ledger under a payout-specific idempotency key.
- **Reasoning:** Re-fulfilment, forced transitions, and duplicate webhook deliveries can never double-pay referrers.

### 3. RBAC Backward Compatibility
- **Decision:** `ADMIN_IDS` members are auto-backfilled as superadmins at boot and lazily on first sight; role checks deny unknown/inactive admins and revoke their sessions.
- **Reasoning:** Existing deployments upgrade without migration scripts while gaining least-privilege scoping for new team members.

### 4. Rail Extensibility Without Schema Churn
- **Decision:** The orders table was rebuilt once (migration 006) to relax the rail CHECK; new rails (chapa, ton_connect) are app-layer validated. Chapa verifies via signature+amount+idempotency; TON Connect verifies on-chain memo/amount against the treasury feed.
- **Reasoning:** Adding future rails becomes code-only changes.

### 5. Human-in-the-Loop Where It Matters
- **Decision:** CBE SMS matching is decision-support: evidence is stored and admin alerts are enriched ("1-tap verify"), but fulfilment still requires administrator approval. Support relays preserve full conversation records.
- **Reasoning:** Forwarded SMS is spoofable; automation assists judgment, it does not replace trust roots.
---

## Phase 12: "Ink & Jade" Design System (v1.2.0)

### 1. Token-First, Class-Compatible Restyle
- **Decision:** Both stylesheets were rebuilt around a single token layer (ink surface scale, jade action accent, brass premium accent, semantic colors, Inter Tight + JetBrains Mono + Noto Sans Ethiopic) while preserving every existing class name and mapping all legacy CSS custom properties to the new palette.
- **Reasoning:** Maximum visual transformation with zero JSX churn risk; inline-styled legacy surfaces keep working through the compatibility variable map.

### 2. One Action Color
- **Decision:** Jade is the only interactive/CTA color across both apps; brass is reserved for loyalty tiers and premium highlights; semantic red/blue carry warnings/information.
- **Reasoning:** Single-accent restraint is what reads as "premium fintech"; multiple competing accents read as marketplace.

### 3. Numerals Are Data
- **Decision:** All prices, order ids, KPIs and balances render in JetBrains Mono with tabular figures.
- **Reasoning:** Monospaced tabular numerals align vertically in tables and signal precision — the core of the data-dense admin desk.

### 4. Web3 in the Browser Requires Node Shims
- **Decision:** `buffer` polyfill imported first in the entry, Vite `define` maps `global`/`process.env`, TonConnect provider mounts only on the storefront, and the CSP allow-lists ton.org/toncenter/bridge plus wallet-logo images.
- **Reasoning:** Isomorphic TON libraries assume Node globals; without shims the whole bundle dies (the black-screen incident).