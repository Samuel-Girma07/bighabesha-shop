# Project Handoff: Production B2B Reseller, Domestic Payment Rails, Defect Remediation & AI Subagent Pipeline

**Date:** September 4, 2026  
**Repository:** `Samuel-Girma07/bighabesha-shop` (`C:\Users\KATANA\Documents\Intern\Bot`)  
**Active Branch:** `master` (Synchronized with `origin/master`)  
**Latest Verification:** 413 automated tests passing (100% pass rate: 397 bot tests across 22 files, 16 webapp tests across 2 files), 0 build errors, 0 SAST/SCA vulnerabilities  

---

## 1. Executive Summary & Core Architectural Invariants

This repository implements **Bighabesha Shop**, a high-scale e-commerce Telegram platform designed for the Ethiopian digital software market. It consists of:
1. **Telegram Bot (`bot/`):** Built with Grammy 1.35+, TypeScript 5.7, and `better-sqlite3` in WAL mode.
2. **Telegram Mini App & Web Admin Dashboard (`webapp/`):** Built with React 19, Vite 6, and `@telegram-apps/sdk-react`.

### Critical Business Logic Invariants
1. **Customer Payment Rails (Domestic Only):**
   - Active payment rails are strictly:
     - 📱 **Telebirr** (`rail_telebirr`)
     - 🏦 **Commercial Bank of Ethiopia (CBE)** (`rail_cbe`)
     - 🏛️ **Bank of Abyssinia** (`rail_abyssinia`)
   - Customers pay via bank transfer and upload a screenshot transfer slip.
   - **Legacy rails are permanently decommissioned:** Card (Chapa), Telegram Wallet Pay, and TON Connect have been stripped from active UI and their API webhooks respond with `410 Gone`. Rate engine CoinGecko polling has been disabled to save resources.
2. **Wallet Mental Model ("Connect Wallet" vs Outbound Fulfillment):**
   - The bot does **NOT** custody private keys, seed phrases, or interact directly with Fragment smart contracts.
   - "Connecting a wallet" in this bot's configuration is strictly an **inbound** receiving mechanism.
   - Outbound Telegram Premium activation is handled via a **third-party B2B Reseller API** (Gramix and iStar).
3. **Dual-Provider Cascading Failover (`CascadeResellerAdapter`):**
   - **Primary:** Gramix (`api.gramix.io`)
   - **Fallback / Secondary:** iStar (`istar.tg` / `v1.fragmentapi.com`)
   - When an order is approved, the bot calls Gramix first. If Gramix returns an insufficient balance (HTTP 403), network timeout, or 5xx outage, the bot **automatically fails over to iStar**.
   - If both providers fail, the order enters `delivery_failed`, the admin is alerted with a breakdown of both balances, and the customer is notified of a temporary queue delay.
4. **Universal Lowercase Username Normalization & Validation Gate:**
   - Gramix API strictly rejects uppercase letters with `400 Invalid username`.
   - Usernames like `@sysRQA` are automatically normalized to `sysrqa` across all 7 layers (bot gate, input, checkout, Mini App, API server, order sanitizer, and reseller dispatcher).
   - Purely numeric Telegram user IDs (e.g. `123456789`) are rejected by regex `/^(?![0-9]+$)[a-zA-Z0-9_]{5,32}$/`.
   - `POST /api/orders` enforces public handle requirement for Telegram Premium: if the buyer account lacks a public `@username` and no valid `targetUsername` is specified, the endpoint responds with HTTP 403 `USERNAME_REQUIRED`.
5. **Out-of-Stock Gate & Fail-Closed Stock Verification (Gemini Pro 18M):**
   - **Mini App:** Bootstrap fallback stock defaults to `0`; when stock is `<= 0`, product cards render a red `SOLD OUT` badge, dim opacity, block drawer opening with an alert popup, and the order action button is disabled with "Out of Stock".
   - **Bot Catalog & Checkout:** Inline buttons display `🚫 Sold Out` and bind `sold_out_${prod.id}` with `answerCallbackQuery(show_alert: true)`; `initiateCheckout` verifies `getAvailableStockCount(productId) > 0` before presenting payment rails.
   - **Order Creation API:** `POST /api/orders` validates stock products with `getAvailableStockCount(productId)` and returns HTTP 409 `OUT_OF_STOCK` if depleted.
6. **Gross vs Net Payment Pricing Invariant:**
   - Orders with promo discounts calculate net payable amount as `Math.max(order.amount_etb - (order.discount_etb || 0), 1)`.
   - Both the Telegram Bot manual transfer message and Mini App Payment Step 2 prominently instruct users to send the exact net amount, accompanied by original price and discount breakdowns.
7. **Order Refund Invariants (Stock Key Restoration & Affiliate Debit):**
   - `refundOrder()` restores allocated stock keys in `stock_items` associated with `order_id` back to `status = 'available'` with `order_id = NULL`.
   - `refundOrder()` identifies all commission credits in `ledger_entries` for the order and posts debit reversal entries (`type = 'payout'`, `note = 'Referral commission reversed due to order refund'`), eliminating phantom affiliate earnings.
8. **Promo Code Redemption Lifecycle Invariant:**
   - Order cancellations (`updateOrderStatus` transition to `cancelled`) execute `releasePromoRedemption(orderId)`, decrementing the code's `used_count` and purging redemption rows from `promo_redemptions`.
9. **Receipt Upload Guards on Finalized Orders:**
   - `POST /api/receipt` rejects receipt uploads with HTTP 400 Bad Request if the target order is already in `fulfilled`, `cancelled`, or `refunded` status.
10. **SMS Reference Replay & Duplicate Match Prevention:**
    - `matchSmsToOrders` inspects `receipt_evidence` for existing matched records (`WHERE reference = ? AND matched = 1`) and rejects duplicate attempts with `{ matched: false, reason: 'reference_already_used' }`.
11. **Affiliate Payout Request Invariant (100 ETB Minimum):**
    - `POST /api/user/payout-request` validates that withdrawals are $\ge 100\text{ ETB}$, verifies available balance in `getLedgerBalance()`, checks against existing `pending` requests in `payout_requests` (HTTP 409 Conflict), and records withdrawal records for admin review.
12. **30-Minute Low-Float Alert Cooldown & Waiting Orders Gate:**
    - The 5-minute background sweeper (`retryFailedResellerDeliveries`) checks SQLite before alerting admins:
      - **If 0 orders are waiting:** Silently skips. Admins are **never spammed** when the store is idle.
      - **If 1+ orders are waiting:** Enforces a **30-minute cooldown** (`LOW_FLOAT_ALERT_COOLDOWN_MS = 30 * 60 * 1000`). Alerts are sent at most once every 30 minutes, displaying the exact count of waiting orders.
13. **Order Delivery Concurrency Lease:**
    - `deliverWithReseller()` acquires an atomic invocation-scoped lease (`tryAcquireLease('reseller:order:' + orderId, 60_000, invocationUUID)`). Rapid double-taps by admins or duplicate callbacks cannot cause double-fulfillment or float double-spending.
14. **Deterministic Canonical Database Path (`<project_root>/data/shop.db`):**
    - `resolveDatabasePath()` and `resolveRepoRoot()` ensure the SQLite database always resolves to `<project_root>/data/shop.db` and customer receipts to `<project_root>/data/receipts/`, eliminating launch-directory split-brain behavior across PM2, Docker, root commands, and `bot/` directory executions.
    - All 7 registered users (including real buyers/admins), 12 orders, 4 stock items, and 300 receipts reside in the canonical store.
15. **User Registration & Language Preference Retention:**
    - Once a user shares their phone number (`is_registered = 1`), bot restarts NEVER re-prompt for phone registration or language.
    - Amharic selection (`langCode === 'am'`) atomically updates `users.language_code` in SQLite via `saveUserLanguage()` and dynamically renders the settings menu.
16. **Bilingual Localization & 100% Dictionary Parity (Amharic / አማርኛ & English):**
    - Complete Amharic dictionary (`bot/src/i18n/am.json`) packaged alongside `en.json` in `dist/i18n/`.
    - Telegram Bot inline keyboards, reply bottom bars, catalog, checkout rails, profile, and order tracking render authentic, idiomatic Amharic when `user.language_code === 'am'`.
    - Telegram Mini App (`webapp`) features 100% translation key parity across all Hero categories, product variants, checkout modals, payout drawers, and timeline steps.

---

## 2. Real Gramix API v1 Protocol Contract

*Official Gramix v1 API specifications implemented in `bot/src/services/reseller/gramix.ts`:*

- **Base URL:** `https://api.gramix.io/api/v1`
- **Authentication Header:** `x-api-key: <GRAMIX_API_KEY>`
- **Idempotency Header:** `idempotency-key: <orderId>`
- **Check Balance:**
  - `GET /api/v1/wallets/balance`
  - Returns: `{ "statusCode": 200, "data": { "gram": "0.0000", "usdt": "0.0000" } }`
- **Purchase Telegram Premium:**
  - `POST /api/v1/purchase/premium/{duration}` (where `{duration}` is `3`, `6`, or `12`)
  - Body:
    ```json
    {
      "recipientName": "username_in_lowercase",
      "paymentCurrency": "usdt"
    }
    ```
  - Success Response (HTTP 201):
    ```json
    {
      "statusCode": 201,
      "data": {
        "orderId": "gramix_uuid",
        "status": "processing",
        "idempotencyKey": "order_id"
      }
    }
    ```
- **Error Mapping in `bot/src/services/reseller/gramix.ts`:**
  - HTTP `403` or `"Insufficient balance"` &rarr; `InsufficientFloatError` (triggers Telegram low-float alert).
  - HTTP `400` with `"Invalid username"` &rarr; `InvalidTargetUserError`.
  - HTTP `404` &rarr; `ProviderUnavailableError` (**NEVER** map 404 route errors to `InvalidTargetUserError`, as that breaks cascade failover).

---

## 3. Mandatory AI Subagent Pipeline Workflow

Whenever you are instructed by the user to develop, refactor, audit, or deploy changes to this codebase, **YOU MUST USE THE FOLLOWING 7-AGENT PIPELINE IN THIS EXACT SEQUENCE:**

```
1. project-architecture-planner
              │
              ▼
2. api-architect
              │
              ▼
3. software-engineer-agent-v1
              │
              ▼
4. wg-code-alchemist
              │
              ▼
5. quality-playbook
              │
              ▼
6. sast-sca-security-analyzer
              │
              ▼
7. devops-expert
```

### Agent Definitions & Tool Requirements

#### Agent 1: `project-architecture-planner`
- **Role:** Analyzes requirements, checks existing database/code invariants, and writes the architectural blueprint artifact.
- **Tools:** Read/write tools (creates specification in `.gemini/.../blueprint.md` or `implementation_plan.md`), MCP tools.
- **Responsibilities:**
  - Maps affected files, schemas, and state machine transitions.
  - Ensures fail-closed design and zero breaking regressions.
  - Defines exact function signatures, interfaces, and directives for subsequent agents.

#### Agent 2: `api-architect`
- **Role:** Designs and implements backend REST endpoints, validation schemas, and client contracts.
- **Tools:** Write tools, MCP tools.
- **Responsibilities:**
  - Updates Zod schemas in `bot/src/config/env.ts`.
  - Enforces route parameters, deprecations (410 Gone), and input sanitization in `bot/src/api/server.ts` and `bot/src/api/admin.ts`.
  - Keeps TypeScript interfaces in `webapp/src/api.ts` strictly typed with backend models.

#### Agent 3: `software-engineer-agent-v1`
- **Role:** Implements core backend logic, Telegram bot handlers, domain state machines, and cron sweepers.
- **Tools:** Write tools, command execution (`run_command`), MCP tools.
- **Responsibilities:**
  - Implements bot keyboards in `bot/src/bot/handlers/checkout.ts`, `shop.ts`, `admin_queue.ts`, `input.ts`, and `gate.ts`.
  - Implements reseller adapters and services in `bot/src/services/reseller/` and `reseller.service.ts`.
  - Enforces atomic state transitions and fulfillment hooks in `bot/src/services/orders.service.ts`.

#### Agent 4: `wg-code-alchemist`
- **Role:** Frontend UI/UX engineer specializing in React 19, Telegram Mini Apps, and Web Admin Dashboard.
- **Tools:** Write tools, command execution (`run_command`), MCP tools.
- **Responsibilities:**
  - Builds responsive mobile components in `webapp/src/App.tsx` and `webapp/src/components/`.
  - Develops admin analytics, order tables, and provider badges in `webapp/src/admin/`.
  - Ensures seamless theme support, clipboard utilities, and receipt upload forms.

#### Agent 5: `quality-playbook`
- **Role:** Quality assurance engineer responsible for test suites and regression safety.
- **Tools:** Write tools, command execution (`run_command`), MCP tools.
- **Responsibilities:**
  - Runs and maintains Vitest suites in `bot/tests/` and `webapp/src/__tests__/`.
  - Writes comprehensive unit and integration tests for every new feature or bug fix (e.g. `bot/tests/defect_remediation.test.ts`).
  - Guarantees 100% pass rate before code reaches security or DevOps.

#### Agent 6: `sast-sca-security-analyzer`
- **Role:** Static Application Security Testing (SAST) and Software Composition Analysis (SCA) expert.
- **Tools:** Read tools, command execution (`run_command`), MCP tools.
- **Responsibilities:**
  - Audits code against OWASP Top 10, ReDoS, SQL injection, and path traversal.
  - Verifies credential redaction (ensuring API keys are masked in Pino logs and never serialized in API outputs).
  - Validates RBAC permissions and session tokens on admin routes.
  - Grants final security sign-off before deployment.

#### Agent 7: `devops-expert`
- **Role:** Deployment, environment verification, knowledge graph synchronization, and git release engineer.
- **Tools:** Write tools, command execution (`run_command`), MCP tools.
- **Responsibilities:**
  - Verifies production builds (`pnpm --filter bot build` and `pnpm --filter webapp build`).
  - Ensures `.env` is gitignored and `.env.example` is fully documented.
  - **Executes Knowledge Graph AST update:** `graphify update .` to maintain parity across `graphify-out/`.
  - Creates structured git commits and pushes cleanly to `origin/master`.

---

## 4. Environment Variables & Production Configuration

The server environment file (`.env`) is configured as follows:

```env
# ===================================================
# Active Payment Rails (Domestic Ethiopian Only)
# ===================================================
# Customer payments are strictly: telebirr, cbe, abyssinia
# Admin receiving account numbers are managed via /admin or settings table

# ===================================================
# Telegram Bot & Admin Configuration
# ===================================================
BOT_TOKEN=your_telegram_bot_token
ADMIN_IDS=123456789,987654321
ADMIN_PASSWORD=your_admin_master_password
NODE_ENV=production
PORT=3000

# ===================================================
# Telegram Premium B2B Reseller (Dual-Provider Failover)
# ===================================================
RESELLER_PROVIDER=both
GRAMIX_API_KEY=your_live_gramix_key
ISTAR_API_KEY=your_live_istar_key
RESELLER_LOW_BALANCE_ALERT_USDT=50
```

---

## 5. Standard Runbook & Developer Commands

### Running Tests
```bash
# Bot test suite (22 files, 397+ tests)
pnpm --filter bot test

# Webapp test suite (2 files, 16 tests)
pnpm --filter webapp test
```

### Production Build
```bash
# Compile bot TypeScript & copy assets
pnpm --filter bot build

# Bundle React 19 Mini App & Admin Dashboard via Vite
pnpm --filter webapp build
```

### Updating the Knowledge Graph (Mandatory after edits)
```bash
graphify update .
```

### Deploying & Restarting the Server
```bash
git pull origin master
pnpm install
pnpm --filter bot build
pm2 restart bighabesha-bot
```

---
*Maintained with strict architectural integrity for Bighabesha Shop.*
