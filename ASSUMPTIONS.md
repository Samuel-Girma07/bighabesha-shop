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

