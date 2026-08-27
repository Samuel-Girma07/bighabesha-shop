# THE DOSSIER: SYSTEM & CODEBASE SURVEY

**Target:** Bighabesha Shop (`Samuel-Girma07/bighabesha-shop`)  
**Audit Context:** High-Concurrency Readiness Assessment (1,000+ Concurrent Users)  
**Verification Standard:** Verbatim code quotations with exact paths and line numbers. Zero paraphrasing.

---

## SECTION 0 — SYSTEM MAP

### 1. Technology Stack
* **Runtime:** Node.js 20 (`node:20-bookworm-slim`, ES Modules `type: module`)
* **Core Language:** TypeScript 5.7.3 (`bot/package.json:35`) compiled via `tsc` to ES2022 / Node16 modules (`bot/tsconfig.json:3-9`)
* **Web Server:** Express 5.2.1 (`bot/package.json:19`)
* **Bot Framework:** Grammy 1.35.0 (`bot/package.json:21`)
* **Database Driver:** `better-sqlite3` 11.8.1 (`bot/package.json:15`)
* **Validation & Security:** `zod` 3.24.2, `helmet` 8.3.0, `cors` 2.8.6, `express-rate-limit` 8.6.2
* **Media & Graphics:** `@resvg/resvg-js` 2.6.2, `exceljs` 4.4.0, `pdfkit` 0.19.1
* **Logging:** `pino` 9.6.0, `pino-pretty` 13.0.0
* **Frontend WebApp:** React 18.3.1, Vite 6.1.0 (`webapp/package.json:17,28`)

### 2. Serving Architecture & Topology
* **Process Topology:** Single Node.js process (`bot/dist/index.js`). Single-threaded event loop.
* **Process Model:** Single worker process without Node.js cluster mode (`Dockerfile:73`).
* **Container Spec:** Multi-stage Docker container based on `node:20-bookworm-slim` (`Dockerfile:4,36`), exposed on port `7860` (`Dockerfile:51,71`) or `PORT` env var (default `3000`, `bot/src/config/env.ts:87`).
* **Telegram Connection:** Outbound HTTP Long Polling via `bot.start()` (`bot/src/index.ts:99-110`). No Telegram Webhook mode configured.

### 3. Datastores & External Services
* **Datastore:** SQLite 3 database file (`shop.db`, default `./data/shop.db`, `bot/src/config/env.ts:67`). Opened via synchronous `better-sqlite3` binding.
* **External HTTP Services:**
  1. Telegram Bot API (`https://api.telegram.org`) — Long polling, messaging, payments, invoice links, and file downloads.
  2. CoinGecko REST API (`https://api.coingecko.com/api/v3/simple/price`) — TON and USDT live USD pricing.
  3. Open Exchange Rates API (`https://open.er-api.com/v6/latest/USD`) — USD/ETB fiat conversion rates.
  4. Wallet Pay API (`https://pay.wallet.tg/wpay/v1`) — Crypto payment order creation and status queries.
  5. Chapa Payment Gateway (`https://api.chapa.co/v1`) — Ethiopian local payment session creation and verification.
  6. TonCenter REST API (`https://toncenter.com/api/v2`) — TON blockchain treasury transaction indexing and matching.

### 4. Request Lifecycle (10 Steps)
1. **Entry:** Client sends HTTP request to Express server (Mini App / Webhook / Admin) OR Telegram sends update to long-polling Grammy runner.
2. **Reverse Proxy & Security:** Express resolves client IP via `trust proxy` (`bot/src/api/server.ts:194-200`), evaluates `helmet` security headers (`bot/src/api/server.ts:203-233`), and checks CORS origin whitelist (`bot/src/api/server.ts:172-185`).
3. **Rate Limiting:** Request passes through route-specific `express-rate-limit` instances (Admin Login, 2FA, Checkout, Receipt, Support, or Global API limiter).
4. **Body Parsing:** Route-specific body parsing runs (`express.json` with 100KB general cap or 3MB receipt upload cap, capturing `rawBody` buffer for HMAC verification).
5. **Authentication & Authorization:** 
   * Mini App routes validate `Authorization: tma <initData>` via HMAC-SHA256(`WebAppData`, botToken) and verify `auth_date` freshness (`bot/src/api/auth.ts:21-81`).
   * Web Admin routes validate `Authorization: Bearer <token>` against `admin_sessions` SQLite table and verify RBAC role permissions (`bot/src/api/admin.ts:258-317`).
   * Webhooks validate provider HMAC signatures (`verifyChapaSignature`, `verifyWalletPayWebhookSignature`).
6. **Input Validation:** Handlers assert parameters using Zod schemas, type assertions, or business logic validators (`assertPositiveIntegerETB`, etc.).
7. **Service Execution:** Controller calls domain service (`orders.service.ts`, `pricing.service.ts`, `stock.service.ts`, etc.).
8. **Synchronous Data Layer:** Service executes synchronous SQLite statement or transaction via `better-sqlite3` instance blocking the event loop until completion.
9. **Outbound Network I/O (if required):** Async calls out to external APIs (CoinGecko, TonCenter, Chapa, Wallet Pay, Telegram API) with or without timeouts.
10. **Response & Side Effects:** Audit log appended synchronously/best-effort (`recordAudit`), Telegram notification dispatched asynchronously (`bot.api.sendMessage`), and JSON response returned to caller.

---

## SECTION 1 — DATA LAYER

### 1. Database Connection & Engine Configuration
From `bot/src/db/index.ts:19-28`:
```typescript
19:   const db = new Database(dbPath);
20: 
21:   // Performance and safety pragmas
22:   db.pragma('journal_mode = WAL');
23:   db.pragma('foreign_keys = ON');
24:   db.pragma('busy_timeout = 5000');
25:   db.pragma('synchronous = NORMAL');
26:   db.pragma('cache_size = -64000');
27:   db.pragma('mmap_size = 268435456');
```
* **Pool Size:** `1` (Single connection instance in memory; no pooling mechanism).
* **Execution Mode:** Synchronous (all queries execute on Node.js main event loop thread).
* **Busy Timeout:** `5000ms`.
* **Cache Size:** `-64000` (64 MB).
* **Mmap Size:** `268435456` (256 MB).
* **Foreign Keys:** `ON`.

---

### 2. Complete Database Schemas, Models & Constraints (Verbatim)

#### Migration: `bot/src/db/migrations/001_init.sql`
```sql
3: CREATE TABLE IF NOT EXISTS users (
4:     id INTEGER PRIMARY KEY,
5:     username TEXT,
6:     first_name TEXT,
7:     last_name TEXT,
8:     language_code TEXT DEFAULT 'en',
9:     is_admin INTEGER DEFAULT 0,
10:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
11:     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
12: );
13: 
14: CREATE TABLE IF NOT EXISTS products (
15:     id TEXT PRIMARY KEY,
16:     type TEXT NOT NULL CHECK (type IN ('stock', 'order')),
17:     name TEXT NOT NULL,
18:     description TEXT,
19:     is_active INTEGER DEFAULT 1,
20:     meta TEXT DEFAULT '{}',
21:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
22:     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
23: );
24: 
25: CREATE TABLE IF NOT EXISTS variants (
26:     id TEXT PRIMARY KEY,
27:     product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
28:     name TEXT NOT NULL,
29:     price_etb INTEGER NOT NULL CHECK (price_etb >= 0),
30:     is_active INTEGER DEFAULT 1,
31:     sort_order INTEGER DEFAULT 0,
32:     meta TEXT DEFAULT '{}',
33:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
34:     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
35: );
36: 
37: CREATE TABLE IF NOT EXISTS stock_items (
38:     id INTEGER PRIMARY KEY AUTOINCREMENT,
39:     product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
40:     payload TEXT NOT NULL,
41:     status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'allocated', 'invalid')),
42:     order_id TEXT,
43:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
44:     allocated_at DATETIME
45: );
46: 
47: CREATE INDEX IF NOT EXISTS idx_stock_items_product_status ON stock_items(product_id, status);
48: 
49: CREATE TABLE IF NOT EXISTS orders (
50:     id TEXT PRIMARY KEY,
51:     user_id INTEGER NOT NULL REFERENCES users(id),
52:     username TEXT,
53:     product_id TEXT NOT NULL REFERENCES products(id),
54:     variant_id TEXT REFERENCES variants(id),
55:     quantity INTEGER DEFAULT 1,
56:     amount_etb INTEGER NOT NULL,
57:     payment_rail TEXT NOT NULL CHECK (payment_rail IN ('stars', 'wallet_pay', 'telebirr', 'cbe', 'abyssinia')),
58:     payment_ref TEXT,
59:     status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'pending_approval', 'pending_fulfillment', 'fulfilled', 'rejected', 'refunded', 'cancelled')),
60:     receipt_file_id TEXT,
61:     receipt_note TEXT,
62:     fulfillment_payload TEXT,
63:     fulfillment_proof TEXT,
64:     rejection_reason TEXT,
65:     admin_notes TEXT,
66:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
67:     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
68: );
69: 
70: CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at ASC);
71: CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
72: 
73: CREATE TABLE IF NOT EXISTS settings (
74:     key TEXT PRIMARY KEY,
75:     value TEXT NOT NULL,
76:     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
77: );
```

#### Migration: `bot/src/db/migrations/002_add_phone.sql`
```sql
2: ALTER TABLE users ADD COLUMN phone_number TEXT;
3: ALTER TABLE users ADD COLUMN is_registered INTEGER DEFAULT 0;
```

#### Migration: `bot/src/db/migrations/003_session_store.sql`
```sql
3: CREATE TABLE IF NOT EXISTS admin_sessions (
4:   token TEXT PRIMARY KEY,
5:   admin_id INTEGER NOT NULL,
6:   expires_at INTEGER NOT NULL,
7:   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
8: );
9: 
10: CREATE TABLE IF NOT EXISTS admin_otps (
11:   admin_id INTEGER PRIMARY KEY,
12:   otp TEXT NOT NULL,
13:   expires_at INTEGER NOT NULL,
14:   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
15: );
16: 
17: CREATE TABLE IF NOT EXISTS bot_sessions (
18:   user_id INTEGER PRIMARY KEY,
19:   type TEXT NOT NULL,
20:   data TEXT NOT NULL,
21:   expires_at INTEGER
22: );
23: 
24: CREATE TABLE IF NOT EXISTS broadcast_drafts (
25:   admin_id INTEGER PRIMARY KEY,
26:   text TEXT NOT NULL,
27:   photo_file_id TEXT,
28:   target_lang TEXT NOT NULL,
29:   updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
30: );
```

#### Migration: `bot/src/db/migrations/004_wallet_pay_meta.sql`
```sql
7: ALTER TABLE orders ADD COLUMN crypto_amount REAL;
8: ALTER TABLE orders ADD COLUMN crypto_currency TEXT;
```

#### Migration: `bot/src/db/migrations/005_audit_logs.sql`
```sql
6: CREATE TABLE IF NOT EXISTS audit_logs (
7:     id INTEGER PRIMARY KEY AUTOINCREMENT,
8:     admin_id INTEGER NOT NULL,
9:     action TEXT NOT NULL,
10:     target_type TEXT,
11:     target_id TEXT,
12:     changes TEXT,
13:     ip TEXT,
14:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
15: );
16: 
17: CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_time ON audit_logs(admin_id, created_at DESC);
18: CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs(action, created_at DESC);
```

#### Migration: `bot/src/db/migrations/006_advanced.sql`
```sql
8: CREATE TABLE IF NOT EXISTS promo_codes (
9:     id INTEGER PRIMARY KEY AUTOINCREMENT,
10:     code TEXT NOT NULL UNIQUE,
11:     kind TEXT NOT NULL CHECK (kind IN ('pct','flat')),
12:     value INTEGER NOT NULL CHECK (value > 0),
13:     max_uses INTEGER,
14:     used_count INTEGER NOT NULL DEFAULT 0,
15:     per_user_limit INTEGER NOT NULL DEFAULT 1,
16:     expires_at DATETIME,
17:     min_amount_etb INTEGER NOT NULL DEFAULT 0,
18:     product_scope TEXT NOT NULL DEFAULT '[]',
19:     is_active INTEGER NOT NULL DEFAULT 1,
20:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
21: );
22: 
23: CREATE TABLE IF NOT EXISTS promo_redemptions (
24:     id INTEGER PRIMARY KEY AUTOINCREMENT,
25:     promo_id INTEGER NOT NULL REFERENCES promo_codes(id),
26:     user_id INTEGER NOT NULL,
27:     order_id TEXT NOT NULL UNIQUE,
28:     discount_etb INTEGER NOT NULL,
29:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
30: );
31: 
32: -- Rebuild orders: relaxed rail CHECK + new columns, preserving all data.
33: CREATE TABLE IF NOT EXISTS orders_new (
34:     id TEXT PRIMARY KEY,
35:     user_id INTEGER NOT NULL REFERENCES users(id),
36:     username TEXT,
37:     product_id TEXT NOT NULL REFERENCES products(id),
38:     variant_id TEXT REFERENCES variants(id),
39:     quantity INTEGER DEFAULT 1,
40:     amount_etb INTEGER NOT NULL,
41:     discount_etb INTEGER NOT NULL DEFAULT 0,
42:     promo_code TEXT,
43:     payment_rail TEXT NOT NULL,
44:     payment_ref TEXT,
45:     crypto_amount REAL,
46:     crypto_currency TEXT,
47:     reminded_at DATETIME,
48:     cost_basis_usd REAL,
49:     fx_rate_at_sale REAL,
50:     status TEXT NOT NULL CHECK (status IN ('new', 'awaiting_payment', 'pending_approval', 'pending_fulfillment', 'fulfilled', 'rejected', 'refunded', 'cancelled')),
51:     receipt_file_id TEXT,
52:     receipt_note TEXT,
53:     fulfillment_payload TEXT,
54:     fulfillment_proof TEXT,
55:     rejection_reason TEXT,
56:     admin_notes TEXT,
57:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
58:     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
59: );
...
74: DROP TABLE orders;
75: ALTER TABLE orders_new RENAME TO orders;
76: 
77: CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at ASC);
78: CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
79: CREATE INDEX IF NOT EXISTS idx_orders_rail ON orders(payment_rail, status);
80: 
81: CREATE TABLE IF NOT EXISTS order_events (
82:     id INTEGER PRIMARY KEY AUTOINCREMENT,
83:     order_id TEXT NOT NULL,
84:     from_status TEXT,
85:     to_status TEXT NOT NULL,
86:     actor_type TEXT NOT NULL DEFAULT 'system',
87:     actor_id TEXT,
88:     note TEXT,
89:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
90: );
91: CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, id);
92: 
93: CREATE TABLE IF NOT EXISTS user_stats (
94:     user_id INTEGER PRIMARY KEY REFERENCES users(id),
95:     lifetime_etb INTEGER NOT NULL DEFAULT 0,
96:     orders_count INTEGER NOT NULL DEFAULT 0,
97:     tier TEXT NOT NULL DEFAULT 'bronze',
98:     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
99: );
100: 
101: ALTER TABLE users ADD COLUMN referrer_id INTEGER REFERENCES users(id);
102: ALTER TABLE users ADD COLUMN referral_code TEXT;
103: CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
104: 
105: CREATE TABLE IF NOT EXISTS ledger_entries (
106:     id INTEGER PRIMARY KEY AUTOINCREMENT,
107:     user_id INTEGER NOT NULL REFERENCES users(id),
108:     direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
109:     amount_etb INTEGER NOT NULL CHECK (amount_etb > 0),
110:     type TEXT NOT NULL,
111:     ref_order_id TEXT,
112:     idempotency_key TEXT UNIQUE,
113:     note TEXT,
114:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
115: );
116: CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, id DESC);
117: 
118: CREATE TABLE IF NOT EXISTS payout_requests (
119:     id INTEGER PRIMARY KEY AUTOINCREMENT,
120:     user_id INTEGER NOT NULL REFERENCES users(id),
121:     amount_etb INTEGER NOT NULL CHECK (amount_etb > 0),
122:     method TEXT NOT NULL DEFAULT 'telebirr',
123:     destination TEXT NOT NULL,
124:     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
125:     processed_by INTEGER,
126:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
127: );
128: 
129: CREATE TABLE IF NOT EXISTS support_threads (
130:     id INTEGER PRIMARY KEY AUTOINCREMENT,
131:     user_id INTEGER NOT NULL REFERENCES users(id),
132:     forum_topic_id INTEGER,
133:     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
134:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
135: );
136: 
137: CREATE TABLE IF NOT EXISTS support_messages (
138:     id INTEGER PRIMARY KEY AUTOINCREMENT,
139:     thread_id INTEGER NOT NULL REFERENCES support_threads(id),
140:     sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin','system')),
141:     body TEXT NOT NULL,
142:     tg_message_id INTEGER,
143:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
144: );
145: CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, id);
146: 
147: CREATE TABLE IF NOT EXISTS receipt_evidence (
148:     id INTEGER PRIMARY KEY AUTOINCREMENT,
149:     order_id TEXT NOT NULL,
150:     user_id INTEGER NOT NULL,
151:     source TEXT NOT NULL DEFAULT 'sms',
152:     raw_text TEXT,
153:     amount_etb INTEGER,
154:     reference TEXT,
155:     matched INTEGER NOT NULL DEFAULT 0,
156:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
157: );
158: 
159: CREATE TABLE IF NOT EXISTS admins (
160:     tg_user_id INTEGER PRIMARY KEY,
161:     role TEXT NOT NULL DEFAULT 'support' CHECK (role IN ('superadmin','ops','finance','support')),
162:     is_active INTEGER NOT NULL DEFAULT 1,
163:     created_by TEXT,
164:     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
165: );
166: 
167: CREATE TABLE IF NOT EXISTS variant_costs (
168:     id INTEGER PRIMARY KEY AUTOINCREMENT,
169:     variant_id TEXT NOT NULL REFERENCES variants(id),
170:     unit_cost_usd REAL NOT NULL CHECK (unit_cost_usd >= 0),
171:     effective_from DATETIME DEFAULT CURRENT_TIMESTAMP,
172:     created_by TEXT
173: );
174: CREATE INDEX IF NOT EXISTS idx_variant_costs_latest ON variant_costs(variant_id, effective_from DESC);
```

#### Migration: `bot/src/db/migrations/007_concurrency_hardening.sql`
```sql
14: CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_items_order
15:     ON stock_items(order_id)
16:     WHERE order_id IS NOT NULL;
```

---

### 3. Exhaustive Query Catalog

| Location | SQL Statement / Operation | Inside Loop? | Lacks LIMIT? | In Tx? |
| :--- | :--- | :--- | :--- | :--- |
| `bot/src/auth/permissions.ts:45` | `SELECT role, is_active FROM admins WHERE tg_user_id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/auth/permissions.ts:55` | `INSERT INTO admins (tg_user_id, role, is_active, created_by) VALUES (?, 'superadmin', 1, 'env-backfill') ON CONFLICT(tg_user_id) DO NOTHING` | Yes (boot loop) | N/A | No |
| `bot/src/api/server.ts:340` | `SELECT COUNT(*) as c FROM settings` | No | No | No |
| `bot/src/api/server.ts:347` | `CREATE TABLE IF NOT EXISTS _health_heartbeat (id INTEGER PRIMARY KEY CHECK (id = 1), ts TEXT NOT NULL)` | No | N/A | No |
| `bot/src/api/server.ts:349` | `INSERT INTO _health_heartbeat (id, ts) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET ts = excluded.ts` | No | N/A | No |
| `bot/src/api/server.ts:442` | `INSERT INTO users (id, username, first_name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, updated_at = CURRENT_TIMESTAMP` | No | N/A | No |
| `bot/src/api/server.ts:499` | `UPDATE support_messages SET tg_message_id = ? WHERE thread_id = ? AND sender_role = ? AND id = (SELECT MAX(id) FROM support_messages WHERE thread_id = ?)` | No | N/A | No |
| `bot/src/api/server.ts:515` | `SELECT * FROM support_threads WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1` | No | No | No |
| `bot/src/api/admin.ts:136` | `INSERT INTO admin_otps (admin_id, otp, expires_at) VALUES (?, ?, ?) ON CONFLICT(admin_id) DO UPDATE SET otp = excluded.otp, expires_at = excluded.expires_at, created_at = CURRENT_TIMESTAMP` | **Yes** (over target admin IDs) | N/A | No |
| `bot/src/api/admin.ts:176` | `DELETE FROM admin_sessions WHERE token = ?` | No | N/A | No |
| `bot/src/api/admin.ts:211` | `SELECT admin_id, otp, expires_at FROM admin_otps WHERE admin_id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/api/admin.ts:218` | `DELETE FROM admin_otps WHERE admin_id = ?` | No | N/A | No |
| `bot/src/api/admin.ts:233` | `DELETE FROM admin_otps WHERE admin_id = ?` | No | N/A | No |
| `bot/src/api/admin.ts:240` | `INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)` | No | N/A | No |
| `bot/src/api/admin.ts:272` | `SELECT token, admin_id as adminId, expires_at as expiresAt FROM admin_sessions WHERE token = ?` | No | Yes (1-row by PK) | No |
| `bot/src/api/admin.ts:279` | `DELETE FROM admin_sessions WHERE token = ?` | No | N/A | No |
| `bot/src/api/admin.ts:288` | `DELETE FROM admin_sessions WHERE token = ?` | No | N/A | No |
| `bot/src/api/admin.ts:332` | `SELECT COALESCE(SUM(amount_etb), 0) as total FROM orders WHERE status = 'fulfilled' [AND payment_rail = ?]` | No | No (Aggregate) | No |
| `bot/src/api/admin.ts:336` | `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'fulfilled' THEN 1 ELSE 0 END) as fulfilled... FROM orders WHERE 1=1 [AND payment_rail = ?]` | No | No (Aggregate) | No |
| `bot/src/api/admin.ts:345` | `SELECT COUNT(*) as total, SUM(CASE WHEN is_registered = 1 THEN 1 ELSE 0 END) as registered FROM users` | No | No (Aggregate) | No |
| `bot/src/api/admin.ts:354` | `SELECT payment_rail, COUNT(*) as count, SUM(amount_etb) as total_etb FROM orders WHERE status = 'fulfilled' GROUP BY payment_rail` | No | **Yes (No LIMIT)** | No |
| `bot/src/api/admin.ts:363` | `SELECT COUNT(*) as units, COALESCE(SUM(amount_etb), 0) as revenue FROM orders WHERE product_id = ? AND status = 'fulfilled' [AND payment_rail = ?]` | **Yes** (per product) | No (Aggregate) | No |
| `bot/src/api/admin.ts:385` | `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND date(created_at, '+3 hours') = date('now', '+3 hours') AND CAST(strftime('%H', datetime(created_at, '+3 hours')) AS INTEGER) >= ? AND CAST(strftime('%H', datetime(created_at, '+3 hours')) AS INTEGER) < ?` | **Yes** (8 loop iterations) | No (Aggregate) | No |
| `bot/src/api/admin.ts:400` | `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND date(created_at, '+3 hours') = date(?)` | **Yes** (7 loop iterations) | No (Aggregate) | No |
| `bot/src/api/admin.ts:414` | `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND datetime(created_at, '+3 hours') >= datetime('now', '+3 hours', '-' \|\| ? \|\| ' days') AND datetime(created_at, '+3 hours') < datetime('now', '+3 hours', '-' \|\| ? \|\| ' days')` | **Yes** (4 loop iterations) | No (Aggregate) | No |
| `bot/src/api/admin.ts:434` | `SELECT COALESCE(SUM(amount_etb), 0) as rev, COUNT(*) as count FROM orders WHERE status = 'fulfilled' AND strftime('%m', datetime(created_at, '+3 hours')) = ? AND strftime('%Y', datetime(created_at, '+3 hours')) = ?` | **Yes** (6 or 12 loop iterations) | No (Aggregate) | No |
| `bot/src/api/admin.ts:446` | `SELECT id, user_id, username, product_id, amount_etb, payment_rail, status, created_at FROM orders WHERE 1=1 [AND payment_rail = ?] ORDER BY created_at DESC LIMIT 5` | No | No (LIMIT 5) | No |
| `bot/src/api/admin.ts:474,494` | `SELECT * FROM orders [WHERE ...] ORDER BY created_at DESC LIMIT 100` | No | No (LIMIT 100) | No |
| `bot/src/api/admin.ts:697` | `SELECT * FROM stock_items WHERE product_id = 'gemini_pro_18m' ORDER BY created_at DESC` | No | **Yes (No LIMIT)** | No |
| `bot/src/api/admin.ts:740` | `SELECT id FROM stock_items WHERE payload = ?` | **Yes** (in loop per submitted line) | Yes (1-row) | No |
| `bot/src/api/admin.ts:853` | `SELECT DISTINCT user_id as id FROM orders WHERE status = 'fulfilled'` | No | **Yes (No LIMIT)** | No |
| `bot/src/api/admin.ts:855` | `SELECT id FROM users WHERE is_registered = 1` | No | **Yes (No LIMIT)** | No |
| `bot/src/api/admin.ts:918` | `SELECT * FROM payout_requests WHERE status = ? ORDER BY id ASC LIMIT 200` | No | No (LIMIT 200) | No |
| `bot/src/api/admin.ts:934` | `SELECT * FROM payout_requests WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/api/admin.ts:943` | `UPDATE payout_requests SET status = ?, processed_by = ? WHERE id = ? AND status = ?` | No | N/A | No |
| `bot/src/api/admin.ts:953` | `INSERT INTO ledger_entries (user_id, direction, amount_etb, type, idempotency_key, note) VALUES (?, 'debit', ?, 'payout', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING` | No | N/A | No |
| `bot/src/api/admin.ts:1002` | `SELECT id, name FROM products WHERE type = 'stock' AND is_active = 1` | No | **Yes (No LIMIT)** | No |
| `bot/src/api/admin.ts:1014` | `SELECT * FROM orders WHERE status = 'fulfilled' ORDER BY created_at DESC LIMIT 10000` | No | No (LIMIT 10000) | No |
| `bot/src/bot/handlers/broadcast.ts:69` | `INSERT INTO broadcast_drafts (admin_id, text, photo_file_id, target_lang, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(admin_id) DO UPDATE SET text = excluded.text, photo_file_id = excluded.photo_file_id, target_lang = excluded.target_lang, updated_at = CURRENT_TIMESTAMP` | No | N/A | No |
| `bot/src/bot/handlers/broadcast.ts:116` | `SELECT admin_id, text, photo_file_id, target_lang FROM broadcast_drafts WHERE admin_id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/bot/handlers/broadcast.ts:128` | `DELETE FROM broadcast_drafts WHERE admin_id = ?` | No | N/A | No |
| `bot/src/bot/handlers/checkout.ts:93` | `SELECT * FROM orders WHERE user_id = ? AND product_id = ? AND (variant_id = ? OR (variant_id IS NULL AND ? IS NULL)) AND status = 'awaiting_payment' AND created_at > datetime('now', '-15 minutes') ORDER BY created_at DESC LIMIT 1` | No | No (LIMIT 1) | No |
| `bot/src/bot/handlers/gate.ts:75` | `UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?` | No | N/A | No |
| `bot/src/bot/handlers/input.ts:88` | `INSERT INTO receipt_evidence (order_id, user_id, source, raw_text, amount_etb, reference, matched) VALUES (?, ?, ?, ?, ?, ?, ?)` | No | N/A | No |
| `bot/src/bot/handlers/orders.ts:204` | `UPDATE users SET language_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?` | No | N/A | No |
| `bot/src/bot/session.ts:23` | `INSERT INTO bot_sessions (user_id, type, data, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET type = excluded.type, data = excluded.data, expires_at = excluded.expires_at` | No | N/A | No |
| `bot/src/bot/session.ts:35` | `SELECT user_id, type, data, expires_at FROM bot_sessions WHERE user_id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/bot/session.ts:45` | `DELETE FROM bot_sessions WHERE user_id = ?` | No | N/A | No |
| `bot/src/bot/session.ts:63` | `DELETE FROM bot_sessions WHERE user_id = ?` | No | N/A | No |
| `bot/src/services/analytics.service.ts:16` | `SELECT COALESCE(SUM(quantity), 0) AS units FROM orders WHERE product_id = ? AND status = 'fulfilled' AND created_at >= datetime('now', '-' \|\| ? \|\| ' days')` | No | No (Aggregate) | No |
| `bot/src/services/audit.service.ts:36` | `INSERT INTO audit_logs (admin_id, action, target_type, target_id, changes, ip) VALUES (?, ?, ?, ?, ?, ?)` | No | N/A | No |
| `bot/src/services/audit.service.ts:71` | `SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?` | No | No (LIMIT capped at 500) | No |
| `bot/src/services/broadcast.service.ts:36` | `SELECT id, language_code FROM users` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/broadcast.service.ts:38` | `SELECT id, language_code FROM users WHERE language_code = ?` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/catalog.service.ts:35` | `SELECT * FROM products ORDER BY rowid ASC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/catalog.service.ts:37` | `SELECT * FROM products WHERE is_active = 1 ORDER BY rowid ASC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/catalog.service.ts:47` | `SELECT * FROM products WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/catalog.service.ts:58` | `SELECT * FROM variants WHERE product_id = ? ORDER BY sort_order ASC, price_etb ASC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/catalog.service.ts:60` | `SELECT * FROM variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order ASC, price_etb ASC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/catalog.service.ts:70` | `SELECT * FROM variants WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/catalog.service.ts:84` | `UPDATE variants SET price_etb = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?` | No | N/A | No |
| `bot/src/services/catalog.service.ts:99` | `UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?` | No | N/A | No |
| `bot/src/services/lifecycle.service.ts:25` | `SELECT id, user_id, username FROM orders WHERE status = 'awaiting_payment' AND reminded_at IS NULL AND created_at <= datetime('now', '-' \|\| ? \|\| ' hours') AND created_at > datetime('now', '-' \|\| ? \|\| ' hours') LIMIT 200` | No | No (LIMIT 200) | No |
| `bot/src/services/lifecycle.service.ts:50` | `UPDATE orders SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?` | **Yes** (in loop over remindable orders) | N/A | No |
| `bot/src/services/lifecycle.service.ts:56` | `SELECT id, user_id FROM orders WHERE status = 'awaiting_payment' AND created_at <= datetime('now', '-' \|\| ? \|\| ' hours') LIMIT 500` | No | No (LIMIT 500) | No |
| `bot/src/services/loyalty.service.ts:16` | `SELECT user_id, lifetime_etb, orders_count, tier FROM user_stats WHERE user_id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/loyalty.service.ts:31` | `INSERT INTO user_stats (user_id, lifetime_etb, orders_count) VALUES (?, MAX(?, 0), MAX(?, 0)) ON CONFLICT(user_id) DO UPDATE SET lifetime_etb = MAX(user_stats.lifetime_etb + ?, 0), orders_count = MAX(user_stats.orders_count + ?, 0), updated_at = CURRENT_TIMESTAMP` | No | N/A | No (unless called in order Tx) |
| `bot/src/services/loyalty.service.ts:46` | `UPDATE user_stats SET tier = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?` | No | N/A | No (unless called in order Tx) |
| `bot/src/services/maintenance.service.ts:23` | `DELETE FROM admin_sessions WHERE expires_at < ?` | No | N/A | No |
| `bot/src/services/maintenance.service.ts:27` | `DELETE FROM admin_otps WHERE expires_at < ?` | No | N/A | No |
| `bot/src/services/maintenance.service.ts:31` | `DELETE FROM bot_sessions WHERE expires_at IS NOT NULL AND expires_at < ?` | No | N/A | No |
| `bot/src/services/maintenance.service.ts:36` | `DELETE FROM broadcast_drafts WHERE updated_at < datetime(?, ?)` | No | N/A | No |
| `bot/src/services/orders.service.ts:143` | `INSERT INTO users (id, username, first_name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = COALESCE(excluded.username, users.username), updated_at = CURRENT_TIMESTAMP` | No | N/A | **Yes** (inside `createOrder` Tx) |
| `bot/src/services/orders.service.ts:154` | `SELECT unit_cost_usd FROM variant_costs WHERE variant_id = ? ORDER BY effective_from DESC, id DESC LIMIT 1` | No | No (LIMIT 1) | **Yes** (inside `createOrder` Tx) |
| `bot/src/services/orders.service.ts:169` | `INSERT INTO orders (id, user_id, username, product_id, variant_id, quantity, amount_etb, payment_rail, payment_ref, status, cost_basis_usd, fx_rate_at_sale, discount_etb, promo_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` | No | N/A | **Yes** (inside `createOrder` Tx) |
| `bot/src/services/orders.service.ts:216` | `SELECT * FROM orders WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/orders.service.ts:227` | `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?` | No | No (Parameterized LIMIT) | No |
| `bot/src/services/orders.service.ts:308` | `UPDATE orders SET [fields...] WHERE id = ?` | No | N/A | **Yes** (inside `updateOrderStatus` Tx) |
| `bot/src/services/orders.service.ts:334` | `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, note) VALUES (?, ?, ?, ?, ?, ?)` | No | N/A | No |
| `bot/src/services/orders.service.ts:373` | `SELECT referrer_id FROM users WHERE id = ?` | No | Yes (1-row by PK) | **Yes** (inside `updateOrderStatus` Tx) |
| `bot/src/services/orders.service.ts:380` | `SELECT referrer_id FROM users WHERE id = ?` | No | Yes (1-row by PK) | **Yes** (inside `updateOrderStatus` Tx) |
| `bot/src/services/orders.service.ts:391` | `INSERT INTO ledger_entries (user_id, direction, amount_etb, type, ref_order_id, idempotency_key, note) VALUES (?, 'credit', ?, 'commission', ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING` | **Yes** (up to 2 referral levels) | N/A | **Yes** (inside `updateOrderStatus` Tx) |
| `bot/src/services/orders.service.ts:400` | `SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/orders.service.ts:441` | `UPDATE orders SET [fields...] WHERE id = ?` | No | N/A | No |
| `bot/src/services/orders.service.ts:497` | `SELECT * FROM orders WHERE status = 'pending_fulfillment' ORDER BY created_at ASC, rowid ASC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/payments/index.ts:47` | `SELECT * FROM orders WHERE status = 'awaiting_payment' AND payment_rail IN ('wallet_pay', 'chapa', 'ton_connect') AND created_at <= datetime('now', '-5 minutes')` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/profit.service.ts:71` | `SELECT * FROM orders WHERE status = 'fulfilled' AND created_at >= datetime('now', '-' \|\| ? \|\| ' months') ORDER BY created_at ASC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/promo.service.ts:44` | `SELECT * FROM promo_codes WHERE code = ?` | No | Yes (1-row by UNIQUE) | No (or in caller Tx) |
| `bot/src/services/promo.service.ts:62` | `SELECT COUNT(*) c FROM promo_redemptions WHERE promo_id = ? AND user_id = ?` | No | No (Aggregate) | No (or in caller Tx) |
| `bot/src/services/promo.service.ts:119` | `SELECT max_uses FROM promo_codes WHERE id = ?` | No | Yes (1-row by PK) | **Yes** (inside `redeemPromoInTx`) |
| `bot/src/services/promo.service.ts:122` | `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND max_uses IS NOT NULL AND used_count < max_uses` | No | N/A | **Yes** (inside `redeemPromoInTx`) |
| `bot/src/services/promo.service.ts:128` | `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?` | No | N/A | **Yes** (inside `redeemPromoInTx`) |
| `bot/src/services/promo.service.ts:131` | `INSERT INTO promo_redemptions (promo_id, user_id, order_id, discount_etb) VALUES (?, ?, ?, ?)` | No | N/A | **Yes** (inside `redeemPromoInTx`) |
| `bot/src/services/promo.service.ts:144` | `SELECT * FROM orders WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/promo.service.ts:154` | `UPDATE orders SET discount_etb = ?, promo_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?` | No | N/A | **Yes** (inside `applyPromoToOrder` Tx) |
| `bot/src/services/promo.service.ts:183` | `INSERT INTO promo_codes (code, kind, value, max_uses, per_user_limit, expires_at, min_amount_etb, product_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)` | No | N/A | No |
| `bot/src/services/promo.service.ts:191` | `SELECT * FROM promo_codes WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/promo.service.ts:195` | `SELECT * FROM promo_codes ORDER BY id DESC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/referral.service.ts:8` | `SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount_etb ELSE -amount_etb END), 0) AS balance FROM ledger_entries WHERE user_id = ?` | No | No (Aggregate) | No |
| `bot/src/services/referral.service.ts:17` | `SELECT referral_code FROM users WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/referral.service.ts:23` | `UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL` | **Yes** (retry loop up to 10) | N/A | No |
| `bot/src/services/referral.service.ts:24` | `SELECT referral_code FROM users WHERE id = ?` | **Yes** (retry loop up to 10) | Yes (1-row by PK) | No |
| `bot/src/services/referral.service.ts:60` | `SELECT id FROM users WHERE referral_code = ?` | No | Yes (1-row by UNIQUE) | No |
| `bot/src/services/referral.service.ts:64` | `SELECT referrer_id FROM users WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/referral.service.ts:67` | `SELECT COUNT(*) c FROM orders WHERE user_id = ?` | No | No (Aggregate) | No |
| `bot/src/services/referral.service.ts:70` | `UPDATE users SET referrer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?` | No | N/A | No |
| `bot/src/services/referral.service.ts:77` | `SELECT COUNT(*) c FROM users WHERE referrer_id = ?` | No | No (Aggregate) | No |
| `bot/src/services/referral.service.ts:83` | `SELECT direction, amount_etb, type, ref_order_id, created_at FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT 20` | No | No (LIMIT 20) | No |
| `bot/src/services/settings.service.ts:13` | `SELECT value FROM settings WHERE key = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/settings.service.ts:31` | `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP` | No | N/A | No |
| `bot/src/services/settings.service.ts:47` | `SELECT key, value FROM settings` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/sms_parser.service.ts:110` | `SELECT id, amount_etb, discount_etb FROM orders WHERE user_id = ? AND status IN ('awaiting_payment', 'new') AND created_at >= datetime('now', '-' \|\| ? \|\| ' minutes') ORDER BY created_at DESC LIMIT 25` | No | No (LIMIT 25) | No |
| `bot/src/services/stock.service.ts:28` | `SELECT id, status FROM stock_items WHERE payload = ?` | No | Yes (1-row) | No |
| `bot/src/services/stock.service.ts:33` | `INSERT INTO stock_items (product_id, payload, status) VALUES (?, ?, 'available')` | No | N/A | No |
| `bot/src/services/stock.service.ts:39` | `SELECT * FROM stock_items WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/stock.service.ts:47` | `DELETE FROM stock_items WHERE id = ? AND status = 'available'` | No | N/A | No |
| `bot/src/services/stock.service.ts:73` | `INSERT INTO stock_items (product_id, payload, status) VALUES (?, ?, 'available')` | **Yes** (in loop over links) | N/A | **Yes** (inside `insertTx`) |
| `bot/src/services/stock.service.ts:112` | `SELECT id FROM stock_items WHERE payload = ?` | **Yes** (in loop over CSV lines) | Yes (1-row) | No |
| `bot/src/services/stock.service.ts:134` | `SELECT COUNT(*) as count FROM stock_items WHERE product_id = ? AND status = 'available'` | No | No (Aggregate) | No |
| `bot/src/services/stock.service.ts:149` | `SELECT status, COUNT(*) as count FROM stock_items WHERE product_id = ? GROUP BY status` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/stock.service.ts:186` | `SELECT * FROM stock_items WHERE product_id = ? AND status = 'available' LIMIT 1` | No | No (LIMIT 1) | **Yes** (inside `tx.immediate`) |
| `bot/src/services/stock.service.ts:200` | `UPDATE stock_items SET status = 'allocated', order_id = ?, allocated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'available'` | No | N/A | **Yes** (inside `tx.immediate`) |
| `bot/src/services/stock.service.ts:212` | `SELECT COUNT(*) as count FROM stock_items WHERE product_id = ? AND status = 'available'` | No | No (Aggregate) | **Yes** (inside `tx.immediate`) |
| `bot/src/services/support.service.ts:31` | `SELECT * FROM support_threads WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1` | No | No (LIMIT 1) | No |
| `bot/src/services/support.service.ts:45` | `INSERT INTO support_threads (user_id, forum_topic_id) VALUES (?, ?)` | No | N/A | No |
| `bot/src/services/support.service.ts:46` | `SELECT * FROM support_threads WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/support.service.ts:53` | `INSERT INTO support_messages (thread_id, sender_role, body, tg_message_id) VALUES (?, ?, ?, ?)` | No | N/A | No |
| `bot/src/services/support.service.ts:59` | `SELECT id, sender_role, body, created_at FROM support_messages WHERE thread_id = ? AND id > ? ORDER BY id ASC LIMIT 200` | No | No (LIMIT 200) | No |
| `bot/src/services/support.service.ts:65` | `UPDATE support_threads SET status = 'closed' WHERE id = ?` | No | N/A | No |
| `bot/src/services/support.service.ts:71` | `SELECT * FROM support_threads WHERE forum_topic_id = ? AND status = 'open'` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/users.service.ts:20` | `SELECT * FROM users WHERE id = ?` | No | Yes (1-row by PK) | No |
| `bot/src/services/users.service.ts:30` | `SELECT * FROM users ORDER BY created_at DESC` | No | **Yes (No LIMIT)** | No |
| `bot/src/services/users.service.ts:47` | `INSERT INTO users (id, username, first_name, language_code, is_admin, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET username = COALESCE(excluded.username, users.username), first_name = COALESCE(excluded.first_name, users.first_name), language_code = COALESCE(excluded.language_code, users.language_code), is_admin = ?, updated_at = CURRENT_TIMESTAMP` | No | N/A | No |
| `bot/src/services/users.service.ts:75` | `INSERT INTO users (id, username, first_name) VALUES (?, NULL, 'User') ON CONFLICT(id) DO NOTHING` | No | N/A | No |
| `bot/src/services/users.service.ts:81` | `UPDATE users SET phone_number = ?, is_registered = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?` | No | N/A | No |

---

## SECTION 2 — EXTERNAL I/O

### 1. Outbound HTTP Call Inventory

```
1. CoinGecko Price Fetch
   File & Line: bot/src/services/rate_engine.service.ts:32-35
   Code:
     const res = await fetch(
       'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,tether&vs_currencies=usd',
       { signal: AbortSignal.timeout(5000) }
     );
   Timeout Set: YES (5000ms via AbortSignal.timeout)
   Retry Logic: NO (catches 429 and errors, returns cached or fallback price)
   Execution Context: Request path on cache miss (/api/bootstrap, order quotes) and background reconciliation loop

2. Open Exchange Rates USD/ETB Fetch
   File & Line: bot/src/services/rate_engine.service.ts:70-72
   Code:
     const res = await fetch('https://open.er-api.com/v6/latest/USD', {
       signal: AbortSignal.timeout(6000),
     });
   Timeout Set: YES (6000ms via AbortSignal.timeout)
   Retry Logic: NO
   Execution Context: Optional helper, request path if invoked

3. Chapa Transaction Initialize
   File & Line: bot/src/services/payments/chapa.ts:42-56
   Code:
     const response = await fetch(`${CHAPA_API}/transaction/initialize`, {
       method: 'POST',
       headers: {
         Authorization: `Bearer ${config.CHAPA_SECRET_KEY}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({ ... }),
     });
   Timeout Set: NO (MISSING — no AbortSignal or timeout configured)
   Retry Logic: NO
   Execution Context: Request path (POST /api/orders with paymentRail='chapa', bot pay_chapa callback)

4. Chapa Transaction Verify
   File & Line: bot/src/services/payments/chapa.ts:74-76
   Code:
     const response = await fetch(`${CHAPA_API}/transaction/verify/${encodeURIComponent(txRef)}`, {
       headers: { Authorization: `Bearer ${config.CHAPA_SECRET_KEY}` },
     });
   Timeout Set: NO (MISSING — no AbortSignal or timeout configured)
   Retry Logic: NO
   Execution Context: Background reconciliation loop (reconcileStuckPayments)

5. Live Wallet Pay Order Creation
   File & Line: bot/src/services/payments/live_wallet_pay.ts:94-110
   Code:
     const response = await fetch('https://pay.wallet.tg/wpay/v1/order', {
       method: 'POST',
       headers: {
         'Wpay-Store-Api-Key': this.apiKey,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({ ... }),
     });
   Timeout Set: NO (MISSING — no AbortSignal or timeout configured)
   Retry Logic: NO
   Execution Context: Request path (POST /api/orders with paymentRail='wallet_pay', bot pay_wp callback)

6. Live Wallet Pay Order Status Preview
   File & Line: bot/src/services/payments/live_wallet_pay.ts:131-135
   Code:
     const response = await fetch(`https://pay.wallet.tg/wpay/v1/order/preview?id=${paymentRef}`, {
       headers: {
         'Wpay-Store-Api-Key': this.apiKey,
       },
     });
   Timeout Set: NO (MISSING — no AbortSignal or timeout configured)
   Retry Logic: NO
   Execution Context: Background reconciliation loop (reconcileStuckPayments)

7. TonCenter Treasury Inbound Transactions Query
   File & Line: bot/src/services/payments/ton.service.ts:47-50
   Code:
     const response = await fetch(
       `${TONCENTER_BASE}/getTransactions?address=${encodeURIComponent(address)}&limit=${limit}`,
       { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
     );
   Timeout Set: YES (8000ms via AbortSignal.timeout)
   Retry Logic: NO
   Execution Context: Request path (POST /api/payments/ton/status/:orderId) and background reconciliation loop

8. Telegram Bot API File Stream (Admin Receipt Download)
   File & Line: bot/src/api/admin.ts:544-554
   Code:
     const controller = new AbortController();
     const timeoutId = setTimeout(() => controller.abort(), 6000);
     ...
     const resp = await fetch(telegramFileUrl, { signal: controller.signal });
   Timeout Set: YES (6000ms via AbortController)
   Retry Logic: NO
   Execution Context: Request path (GET /api/admin/orders/:id/receipt and GET /api/admin/receipt-dl/:payload/:sig)

9. Telegram Bot API Stock CSV Document Download
   File & Line: bot/src/bot/handlers/input.ts:492
   Code:
     const response = await fetch(fileUrl);
   Timeout Set: NO (MISSING — no AbortSignal or timeout configured)
   Retry Logic: NO
   Execution Context: Telegram bot document handler (admin stock CSV upload)

10. Grammy Telegram Bot API Client Calls
    File & Line: bot/src/bot/bot.ts:99-112
    Code:
      bot.api.config.use(async (prev, method, payload, signal) => {
        try {
          return await prev(method, payload, signal);
        } catch (err: any) {
          if (err instanceof GrammyError && err.error_code === 429) {
            const retryAfter = err.parameters?.retry_after || 1;
            logger.warn({ retryAfter, method }, `Hit Telegram API 429 rate limit. Waiting ${retryAfter}s before retrying.`);
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
            return await prev(method, payload, signal);
          }
          throw err;
        }
      });
    Timeout Set: Grammy default timeout (typically 500s on long polling, default socket timeout on standard calls)
    Retry Logic: YES (intercepts 429 rate limit errors and retries after retry_after seconds)
    Execution Context: Throughout application for all messaging and bot actions
```

---

### 2. File System Writes

* `bot/src/services/receipts.service.ts:124`:
  ```typescript
  124:   fs.writeFileSync(filePath, buffer);
  ```
  Synchronous disk write on receipt upload execution path (`POST /api/receipt`).
* `bot/src/services/receipts.service.ts:155`:
  ```typescript
  155:           fs.unlinkSync(full);
  ```
  Synchronous file deletion during periodic maintenance execution.
* `bot/src/services/banner_generator.service.ts:358`:
  ```typescript
  358:       fs.writeFileSync(filePath, pngBuffer);
  ```
  Synchronous PNG rasterization write during prewarm and dynamic generation.
* `bot/src/db/index.ts:14`:
  ```typescript
  14:       fs.mkdirSync(dir, { recursive: true });
  ```
  Directory creation on database boot.

---

### 3. Webhooks, Queues & Background Jobs

* **Webhooks Received:**
  1. `POST /api/webhooks/chapa` (`bot/src/api/server.ts:727-778`) — Chapa payment status webhook.
  2. `POST /api/wallet-pay/webhook` (`bot/src/api/server.ts:830-933`) — Telegram Wallet Pay event webhook.
* **Background Jobs (Timers):**
  1. **Maintenance Sweeper (`bot/src/services/maintenance.service.ts:63-74`):**
     * Runs every 15 minutes (`intervalMs = 15 * 60 * 1000`).
     * Deletes expired `admin_sessions`, `admin_otps`, `bot_sessions`, stale `broadcast_drafts`, and purges old receipt image files.
  2. **Lifecycle Sweeper (`bot/src/services/lifecycle.service.ts:83-94`):**
     * Runs every 10 minutes (`intervalMs = 10 * 60 * 1000`).
     * Scans for unpaid orders and sends abandoned checkout reminders (orders between `recovery_reminder_hours` and `order_ttl_hours` old).
     * Cancels stale `awaiting_payment` orders older than `order_ttl_hours`.
  3. **Payment Reconciliation Worker (`bot/src/services/payments/index.ts:122-138`):**
     * Runs every 60 seconds (`intervalMs = 60000`).
     * Polls Wallet Pay API, Chapa API, and TonCenter blockchain index for stuck `awaiting_payment` orders older than 5 minutes.
  4. **Broadcast Runner (`bot/src/services/broadcast.service.ts:198-213`):**
     * In-memory async worker spawned on broadcast dispatch.
     * Iterates through user list in chunks of 100 with 35ms message delay and 1000ms chunk delay.
* **Websockets:** None.

---

## SECTION 3 — CONCURRENCY & SHARED STATE

### 1. Global / Module-Level Mutable State & In-Memory Singletons
* `bot/src/db/index.ts:8`: `let dbInstance: Database.Database | null = null;` (Global singleton database connection)
* `bot/src/config/env.ts:183`: `let cachedConfig: AppConfig | null = null;` (Cached environment configuration)
* `bot/src/api/admin.ts:42`: `let botInstance: any = null;` (Global Grammy bot reference in Express routes)
* `bot/src/api/admin.ts:74`: `const otpFailures = new Map<number, { count: number; lockedUntil: number }>();` (In-memory admin 2FA brute force state)
* `bot/src/api/server.ts:329`: `let lastHeartbeatWriteMs = 0;` (Health check DB write probe throttle)
* `bot/src/services/rate_engine.service.ts:11-15`: `let priceCache: CryptoPriceCache = { ... };` (In-memory CoinGecko price cache)
* `bot/src/services/broadcast.service.ts:105`: `const broadcastJobs = new Map<string, BroadcastJob>();` (In-memory broadcast background job tracking)
* `bot/src/services/payments/index.ts:14`: `let adapterInstance: PaymentAdapter | null = null;` (Wallet Pay adapter singleton)
* `bot/src/services/payments/index.ts:120`: `let reconciliationTimer: NodeJS.Timeout | null = null;` (Reconciliation timer handle)
* `bot/src/services/maintenance.service.ts:60`: `let cleanupTimer: NodeJS.Timeout | null = null;` (Maintenance timer handle)
* `bot/src/services/lifecycle.service.ts:81`: `let lifecycleTimer: NodeJS.Timeout | null = null;` (Lifecycle timer handle)
* `bot/src/i18n/index.ts:11`: `const translations: Record<string, TranslationDict> = {};` (In-memory translation dictionary cache)

---

### 2. Locks, Mutexes & Atomic Operations
* **SQLite Transactions:**
  * `stock.service.ts:183-223`: `tx = db.transaction(...)` with `tx.immediate()` (`BEGIN IMMEDIATE`) claiming stock rows using guarded SQL `UPDATE stock_items SET status = 'allocated'... WHERE id = ? AND status = 'available'`.
  * `orders.service.ts:141-194`: `createdOrderId = db.transaction(...)` wrapping user upsert, cost snapshot, promo redemption, order insertion, and event appending.
  * `orders.service.ts:266-317`: `updated = db.transaction(...)` wrapping order update, event append, loyalty adjustments, and referral commissions.
  * `promo.service.ts:152-157`: `applied = db.transaction(...)` wrapping promo redemption counter increment and order update.
  * `stock.service.ts:77-82`: `insertTx = db.transaction(...)` for batch stock insertion.
  * `migrator.ts:40-44`: `applyTx = db.transaction(...)` wrapping migration file execution and `_migrations` insertion.
  * `seed.ts:7-114`: `seedTx = db.transaction(...)` for initial seeding.
* **Storage-Level Constraints:**
  * Partial unique index `idx_stock_items_order ON stock_items(order_id) WHERE order_id IS NOT NULL` preventing double stock allocation (`bot/src/db/migrations/007_concurrency_hardening.sql:14-16`).
  * Unique constraint on `ledger_entries.idempotency_key` preventing duplicate referral commissions (`bot/src/db/migrations/006_advanced.sql:112`).
  * Unique constraint on `promo_redemptions.order_id` preventing double promo redemption on one order (`bot/src/db/migrations/006_advanced.sql:27`).
  * Conditional update atomic claim in `admin.ts:943` (`WHERE id = ? AND status = 'pending'`).

---

### 3. Single-Server / Single-Process Assumptions

```typescript
// 1. In-Memory Admin OTP Failure Tracking (Bypassed if scaled across multiple instances)
// File: bot/src/api/admin.ts:74-86
74: const otpFailures = new Map<number, { count: number; lockedUntil: number }>();
75: 
76: function registerOtpFailure(adminId: number): void {
77:   if (otpFailures.size > 1000) otpFailures.clear(); // hard bound; admins are few
78:   const rec = otpFailures.get(adminId) ?? { count: 0, lockedUntil: 0 };
79:   rec.count += 1;
80:   if (rec.count >= otpLockoutConfig.maxAttempts) {
81:     rec.lockedUntil = Date.now() + otpLockoutConfig.lockoutMs;
82:     rec.count = 0;
83:     logger.warn({ adminId }, 'Admin OTP verification locked after repeated failures');
84:   }
85:   otpFailures.set(adminId, rec);
86: }

// 2. In-Memory Broadcast Job Registry (Status polling returns 404 on different workers)
// File: bot/src/services/broadcast.service.ts:105
105: const broadcastJobs = new Map<string, BroadcastJob>();

// 3. Local Filesystem Receipt Storage (Receipts uploaded on worker A are invisible to worker B)
// File: bot/src/services/receipts.service.ts:44-51
44: export function resolveReceiptsDir(databasePath?: string): string {
45:   const config = getConfig();
46:   if (config.RECEIPTS_DIR) {
47:     return path.resolve(config.RECEIPTS_DIR);
48:   }
49:   const dbFile = path.resolve(databasePath || config.DATABASE_PATH);
50:   return path.join(path.dirname(dbFile), 'receipts');
51: }

// 4. Telegram Long Polling (Multiple processes running bot.start() trigger 409 Conflict)
// File: bot/src/index.ts:99-100
99:     await bot.start({
100:       onStart: (botInfo) => {
```

---

## SECTION 4 — CONFIG & RESOURCE LIMITS

### 1. Connection Pools & Limits
* **SQLite Connection Pool:** `1` (Single synchronous file handle via `better-sqlite3`).
* **Redis Connection Pool:** NONE (No Redis or external caching store configured).
* **HTTP Client Connection Pool:** Node.js global `fetch` default undici dispatcher pool (~256 max sockets).

---

### 2. Timeout & Retry Matrix

| Operation | Location | Timeout Configured | Retry Logic |
| :--- | :--- | :--- | :--- |
| CoinGecko Price Query | `bot/src/services/rate_engine.service.ts:34` | 5000ms (`AbortSignal.timeout`) | None (Falls back to cache) |
| USD/ETB Exchange Rate Query | `bot/src/services/rate_engine.service.ts:71` | 6000ms (`AbortSignal.timeout`) | None |
| Chapa Initialize Order | `bot/src/services/payments/chapa.ts:42` | **MISSING** | None |
| Chapa Verify Order Status | `bot/src/services/payments/chapa.ts:74` | **MISSING** | None |
| Wallet Pay Create Order | `bot/src/services/payments/live_wallet_pay.ts:94` | **MISSING** | None |
| Wallet Pay Status Preview | `bot/src/services/payments/live_wallet_pay.ts:131` | **MISSING** | None |
| TonCenter Transaction Index Query | `bot/src/services/payments/ton.service.ts:49` | 8000ms (`AbortSignal.timeout`) | None |
| Telegram Receipt Stream | `bot/src/api/admin.ts:545,549` | 6000ms / 5000ms (`AbortController` / `Promise.race`) | None |
| Telegram Stock CSV Download | `bot/src/bot/handlers/input.ts:492` | **MISSING** | None |
| Order Primary Key Collision | `bot/src/services/orders.service.ts:138-202` | N/A | **3 attempts** on collision |
| Referral Code Generation Collision | `bot/src/services/referral.service.ts:20-29` | N/A | **10 attempts** on collision |
| Telegram Bot API 429 Errors | `bot/src/bot/bot.ts:100-110` | N/A | **Retries after retry_after seconds** |
| Express Server Shutdown Drain | `bot/src/index.ts:69` | 500ms hard sleep before exit | None |

---

### 3. Rate Limiting Configuration

```typescript
// Rate limiters defined in bot/src/api/server.ts:240-282
240:   const adminLoginLimiter = rateLimit({
241:     windowMs: 15 * 60 * 1000,
242:     limit: 5,
243:     standardHeaders: true,
244:     legacyHeaders: false,
245:     handler: jsonRateLimitHandler('Too many login attempts. Please try again in 15 minutes.'),
246:   });
247: 
248:   const adminOtpLimiter = rateLimit({
249:     windowMs: 10 * 60 * 1000,
250:     limit: 5,
251:     standardHeaders: true,
252:     legacyHeaders: false,
253:     handler: jsonRateLimitHandler('Too many verification attempts. Please request a new code.'),
254:   });
255: 
256:   const checkoutLimiter = rateLimit({
257:     windowMs: 60 * 1000,
258:     limit: 10,
259:     standardHeaders: true,
260:     legacyHeaders: false,
261:     handler: jsonRateLimitHandler('Too many requests. Please slow down.'),
262:   });
263: 
264:   const receiptLimiter = rateLimit({
265:     windowMs: 60 * 1000,
266:     limit: 10,
267:     standardHeaders: true,
268:     legacyHeaders: false,
269:     handler: jsonRateLimitHandler('Too many receipt uploads. Please slow down.'),
270:   });
271: 
272:   const globalApiLimiter = rateLimit({
273:     windowMs: 15 * 60 * 1000,
274:     limit: 1000,
275:     standardHeaders: true,
276:     legacyHeaders: false,
277:     skip: (req) =>
278:       req.path === '/api/health' ||
279:       req.path.startsWith('/api/admin') ||
280:       !req.path.startsWith('/api'),
281:     handler: jsonRateLimitHandler('Too many requests from this address. Please try again later.'),
282:   });

// In-App Support Bridge Rate Limiter in bot/src/api/server.ts:466-473
466:   const supportLimiter = rateLimit({
467:     windowMs: 5 * 60 * 1000,
468:     limit: 20,
469:     standardHeaders: true,
470:     legacyHeaders: false,
471:     keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? 'unknown')}:${(req.headers.authorization || '').slice(-24)}`,
472:     handler: (_req, res) => res.status(429).json({ error: 'Too many messages. Please slow down.' }),
473:   });
```

* **Missing Rate Limiting:**
  * `GET /api/bootstrap` (Subject only to global 1000/15min IP bucket).
  * `GET /api/user/recheck-username` (Unbounded live Telegram `getChat` calls).
  * `POST /api/payments/ton/status/:orderId` (Unbounded live TonCenter queries).
  * `POST /api/webhooks/chapa` and `POST /api/wallet-pay/webhook` (No endpoint rate limiting).
  * All `/api/admin/*` protected routes (Excluded from `globalApiLimiter`).
  * Telegram bot message handlers & callback queries (No bot-level throttling middleware).

---

### 4. Memory-Heavy Operations & Payload Limits
* **JSON Body Limits:**
  * General API: `100kb` (`bot/src/api/server.ts:53,296`).
  * Receipt Uploads: `3mb` (`bot/src/api/server.ts:54,290`).
* **Unbounded Database In-Memory Allocations:**
  * `bot/src/services/broadcast.service.ts:36`: `SELECT id, language_code FROM users` loads all user records into a JavaScript array.
  * `bot/src/services/users.service.ts:30`: `SELECT * FROM users ORDER BY created_at DESC` loads all user table rows into memory on `GET /api/admin/users`.
  * `bot/src/api/admin.ts:697`: `SELECT * FROM stock_items WHERE product_id = 'gemini_pro_18m' ORDER BY created_at DESC` loads all stock records.
  * `bot/src/api/admin.ts:1014`: `SELECT * FROM orders WHERE status = 'fulfilled' ORDER BY created_at DESC LIMIT 10000` loads up to 10,000 orders into RAM.
  * `bot/src/services/profit.service.ts:71`: `SELECT * FROM orders WHERE status = 'fulfilled' AND created_at >= datetime('now', '-' || ? || ' months')` loads multi-month order history into memory for JavaScript loop aggregation.
* **Document Generation in RAM:**
  * `bot/src/api/admin.ts:1033-1066`: Entire `ExcelJS.Workbook` built in RAM before sending.
  * `bot/src/api/admin.ts:1075-1096`: PDF document rendered synchronously via `PDFKit`.
  * `bot/src/services/banner_generator.service.ts:350-357`: Native Rust `Resvg` rasterizer generates 1200x630 PNG images in memory.

---

## SECTION 5 — ABUSE SURFACE

### 1. Authentication & Session Verification

#### Telegram Mini App Authentication (`bot/src/api/auth.ts:21-81`)
* Uses Telegram HMAC-SHA256 data-check-string signature validation.
* Derives secret key via `crypto.createHmac('sha256', 'WebAppData').update(token).digest()`.
* Compares calculated hash using `crypto.timingSafeEqual`.
* Checks `auth_date` expiry: rejects if `authDate > nowSec` or `(nowSec - authDate) > 86400` (24-hour TTL).
* Parses user JSON payload from `user` query parameter.

#### Admin Web Dashboard Authentication (`bot/src/api/admin.ts:89-252`)
* **Step 1:** Verifies `ADMIN_PASSWORD` against master password using `timingSafeEqualStrings`. Generates cryptographically secure 6-digit OTP (`crypto.randomInt(100_000, 1_000_000)`), stores it in `admin_otps` with 10-minute expiry, and dispatches it via Telegram DM to configured `ADMIN_IDS`.
* **Step 2:** Verifies OTP on `/api/admin/auth/verify-2fa`. Enforces in-memory lockout via `otpFailures` (5 attempts / 15-minute lock). On success, issues a 32-byte hex token (`crypto.randomBytes(32).toString('hex')`) stored in `admin_sessions` with 24-hour TTL.
* **Middleware:** `requireAdminAuth` validates `Authorization: Bearer <token>` against `admin_sessions`. Verifies admin RBAC role and permissions via `requirePermission(perm)`.

#### Receipt Media Download Token (`bot/src/services/download_tokens.service.ts:28-66`)
* Signed URL endpoint: `GET /api/admin/receipt-dl/:payload/:sig`.
* HMAC-SHA256 signed payload containing `orderId|expiresAt|nonce` with 60-second TTL. Verified with `crypto.timingSafeEqual`.

---

### 2. Direct User Input Flowing to Storage / Filesystem
* **User Input to Database:**
  * Phone numbers: validated against regex in `validatePhoneNumber` (`bot/src/services/users.service.ts:108-120`) and written to `users.phone_number`.
  * Telegram usernames & first names: upserted directly into `users` table via parameterized queries.
  * Promo codes: trimmed and uppercased, verified against `promo_codes` table via parameterized queries.
  * CBE SMS text: forwarded bank SMS stored in `receipt_evidence.raw_text` (`bot/src/bot/handlers/input.ts:88-90`).
  * Support messages: stored up to 2000 characters in `support_messages.body` (`bot/src/services/support.service.ts:54`).
* **User Input to Filesystem:**
  * Base64 receipt uploads (`bot/src/services/receipts.service.ts:91-132`):
    * Magic byte validation (`detectImageExtension`) restricts files to JPEG (`ffd8ff`), PNG (`89504e470d0a1a0a`), and WebP (`RIFF...WEBP`).
    * File path is sanitized: `const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, '_')`.
    * Written to `resolveReceiptsDir()` as `receipt_${safeOrderId}_${timestamp}.${ext}`.
    * Path containment verified on read via `path.relative` in `resolveStoredReceiptPath` (`bot/src/services/receipts.service.ts:77-81`).

---

### 3. Missing Caching & Expensive Endpoints
* `GET /api/bootstrap`: No response caching. Every request performs multi-table database queries and crypto exchange rate checks.
* `GET /api/admin/overview`: No aggregation caching. Queries full table sums and executes 8-12 dynamic sub-queries in loops for chart points on every request.
* `GET /api/user/recheck-username`: Dispatches outbound HTTP call to Telegram Bot API `getChat` on every request.
* `POST /api/payments/ton/status/:orderId`: Queries TonCenter API on every poll without client throttling.

---

## SECTION 6 — HOT PATH CODE (VERBATIM)

### 1. `bot/src/index.ts`
```typescript
1: import { getConfig } from './config/env.js';
2: import { logger } from './logger/index.js';
3: import { initDatabase, closeDatabase } from './db/index.js';
4: import { createBot } from './bot/bot.js';
5: import { startPeriodicCleanup, stopPeriodicCleanup } from './services/maintenance.service.js';
6: import { stopWalletPayReconciliation } from './services/payments/index.js';
7: import { startLifecycleJobs, stopLifecycleJobs } from './services/lifecycle.service.js';
8: import { syncAdminsFromEnv } from './auth/permissions.js';
9: import { prewarmAllBanners } from './services/banner_generator.service.js';
10: 
11: async function main() {
12:   // Process-level safety nets. Express 5 routes async-handler rejections into
13:   // its error chain and Grammy has bot.catch — these cover the residual class:
14:   // stray fire-and-forget promises and programmer errors outside any handler.
15:   // Without them Node >=15 crashes on the first unhandled rejection.
16:   process.on('unhandledRejection', (reason) => {
17:     logger.error({ err: reason }, 'Unhandled promise rejection — logged; process kept alive');
18:   });
19:   process.on('uncaughtException', (err) => {
20:     logger.fatal({ err }, 'Uncaught exception — terminating for PM2 restart');
21:     process.exit(1);
22:   });
23: 
24:   try {
25:     const config = getConfig();
26:     logger.info('Starting Bighabesha Shop Bot...');
27: 
28:     // Initialize database
29:     initDatabase(config.DATABASE_PATH);
30:     syncAdminsFromEnv();
31: 
32:     // Pre-rasterize standard product banners into disk cache
33:     void prewarmAllBanners();
34: 
35:     // Periodic hygiene: expired sessions/OTPs/drafts + old receipt uploads
36:     startPeriodicCleanup();
37: 
38:     // Create Grammy bot instance
39:     const bot = createBot(config.BOT_TOKEN);
40: 
41:     // Abandoned-checkout reminders + stale-order TTL sweeper
42:     startLifecycleJobs(bot);
43: 
44:     // Start Mini App REST API server
45:     const apiServer = (await import('./api/server.js')).startApiServer(bot, config.PORT);
46: 
47:     // Graceful shutdown handlers
48:     const shutdown = async (signal: string) => {
49:       logger.info({ signal }, 'Shutting down gracefully...');
50:       try {
51:         stopPeriodicCleanup();
52:         stopLifecycleJobs();
53:         stopWalletPayReconciliation();
54:         bot.stop();
55: 
56:         // Stop accepting new connections, kill idle keep-alive sockets
57:         // immediately, then allow a short drain window for in-flight
58:         // requests before force-closing survivors and exiting. PM2 gets a
59:         // fast, deterministic restart either way.
60:         apiServer.close();
61:         const httpServer = apiServer as unknown as {
62:           closeIdleConnections?: () => void;
63:           closeAllConnections?: () => void;
64:         };
65:         httpServer.closeIdleConnections?.();
66: 
67:         closeDatabase();
68:         logger.info('Cleanup complete. Draining briefly before exit.');
69:         await new Promise((resolve) => setTimeout(resolve, 500));
70:         httpServer.closeAllConnections?.();
71:         process.exit(0);
72:       } catch (err) {
73:         logger.error({ err }, 'Error during shutdown');
74:         process.exit(1);
75:       }
76:     };
77: 
78:     process.on('SIGINT', () => shutdown('SIGINT'));
79:     process.on('SIGTERM', () => shutdown('SIGTERM'));
80: 
81:     // Update Telegram Chat Menu Button to point to active WEBAPP_URL
82:     if (config.WEBAPP_URL) {
83:       try {
84:         await bot.api.setChatMenuButton({
85:           menu_button: {
86:             type: 'web_app',
87:             text: '🛍️ Open Shop',
88:             web_app: { url: config.WEBAPP_URL },
89:           },
90:         });
91:         logger.info({ webAppUrl: config.WEBAPP_URL }, 'Telegram Chat Menu Button automatically updated');
92:       } catch (err) {
93:         logger.warn({ err }, 'Failed to set Telegram Chat Menu Button');
94:       }
95:     }
96: 
97:     // Start bot polling
98:     logger.info('Bot initialized. Starting long polling...');
99:     await bot.start({
100:       onStart: (botInfo) => {
101:         logger.info(
102:           {
103:             botId: botInfo.id,
104:             username: botInfo.username,
105:             nodeEnv: config.NODE_ENV,
106:           },
107:           'Bot successfully connected to Telegram API!'
108:         );
109:       },
110:     });
111:   } catch (err) {
112:     logger.fatal({ err }, 'Failed to start Bighabesha Shop Bot');
113:     process.exit(1);
114:   }
115: }
116: 
117: if (process.env.NODE_ENV !== 'test') {
118:   main();
119: }
```

---

### 2. `bot/src/config/env.ts`
```typescript
1: import { z } from 'zod';
2: import dotenv from 'dotenv';
3: import path from 'path';
4: import fs from 'fs';
5: import { fileURLToPath } from 'url';
6: 
7: const __filename = fileURLToPath(import.meta.url);
8: const __dirname = path.dirname(__filename);
9: 
10: /**
11:  * Deterministic .env candidate paths, independent of the process working
12:  * directory. Priority order:
13:  *   1. Explicit override via DOTENV_PATH env var
14:  *   2. Monorepo root (bot/../.env) — the single source of truth
15:  *   3. bot/ local directory (legacy convenience during development)
16:  *
17:  * The FIRST existing file wins; no merging. This eliminates the previous
18:  * launch-directory-dependent behavior where running from `bot/` vs the repo
19:  * root silently loaded different configurations.
20:  */
21: export function resolveEnvCandidates(moduleDir: string = __dirname): string[] {
22:   const candidates: string[] = [];
23:   if (process.env.DOTENV_PATH) {
24:     candidates.push(path.resolve(process.env.DOTENV_PATH));
25:   }
26:   candidates.push(
27:     path.resolve(moduleDir, '../../..', '.env'), // bot/dist or bot/src -> repo root
28:     path.resolve(moduleDir, '../..', '.env'),    // fallback two levels up
29:     path.resolve(process.cwd(), '.env')          // last resort: current dir
30:   );
31:   return [...new Set(candidates)];
32: }
33: 
34: for (const p of resolveEnvCandidates()) {
35:   if (fs.existsSync(p)) {
36:     dotenv.config({ path: p, override: true });
37:     break;
38:   }
39: }
40: 
41: export const EnvSchema = z
42:   .object({
43:     BOT_TOKEN: z
44:       .string({ required_error: 'BOT_TOKEN is required' })
45:       .min(1, 'BOT_TOKEN is required'),
46:     ADMIN_IDS: z
47:       .string({ required_error: 'ADMIN_IDS is required' })
48:       .min(1, 'ADMIN_IDS is required')
49:       .transform((val) =>
50:         val
51:           .split(',')
52:           .map((id) => id.trim())
53:           .filter((id) => id.length > 0)
54:           .map((id) => {
55:             const parsed = Number(id);
56:             if (isNaN(parsed)) {
57:               throw new Error(`Invalid Admin ID in ADMIN_IDS: "${id}"`);
58:             }
59:             return parsed;
60:           })
61:       ),
62:     WALLET_PAY_MODE: z.enum(['mock', 'live']).default('mock'),
63:     WALLET_PAY_API_KEY: z.string().optional().default(''),
64:     // No default: missing ADMIN_PASSWORD disables the web admin login (fail-closed)
65:     // and is a hard boot error in production.
66:     ADMIN_PASSWORD: z.string().optional(),
67:     DATABASE_PATH: z.string().default('./data/shop.db'),
68:     RECEIPTS_DIR: z.string().optional(),       // defaults to <db-dir>/receipts
69:     RECEIPT_MAX_BYTES: z
70:       .string()
71:       .default(String(5 * 1024 * 1024))
72:       .transform((v) => {
73:         const n = parseInt(v, 10);
74:         if (isNaN(n) || n <= 0) throw new Error('RECEIPT_MAX_BYTES must be a positive integer');
75:         return n;
76:       }),
77:     RECEIPT_RETENTION_DAYS: z
78:       .string()
79:       .default('90')
80:       .transform((v) => {
81:         const n = parseInt(v, 10);
82:         if (isNaN(n) || n < 0) throw new Error('RECEIPT_RETENTION_DAYS must be a non-negative integer');
83:         return n;
84:       }),
85:     PORT: z
86:       .string()
87:       .default('3000')
88:       .transform((val) => {
89:         const parsed = parseInt(val, 10);
90:         if (isNaN(parsed)) throw new Error('PORT must be a valid number');
91:         return parsed;
92:       }),
93:     NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
94:     LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
95:     /**
96:      * Public HTTPS URL of the Mini App. NO ephemeral default: when unset the
97:      * bot simply omits the WebApp menu button instead of pointing users at a
98:      * dead trycloudflare tunnel.
99:      */
100:     WEBAPP_URL: z
101:       .string()
102:       .url()
103:       .optional()
104:       .or(z.literal(''))
105:       .transform((v) => v || undefined),
106:     SUPPORT_USERNAME: z.string().default('Vweah'),
107:     // '' = disabled. Accepts hop count ("1"), boolean ("true"/"false"),
108:     // or an express `trust proxy` expression ("loopback", "10.0.0.0/8", ...).
109:     TRUST_PROXY: z.string().default(''),
110:     // Comma-separated list of extra allowed CORS origins (the WEBAPP_URL is always allowed).
111:     CORS_ORIGINS: z.string().default(''),
112:     // Optional integrations — features self-disable when unset.
113:     SUPPORT_GROUP_ID: z
114:       .string()
115:       .optional()
116:       .transform((v) => (v && /^-?\d+$/.test(v.trim()) ? parseInt(v.trim(), 10) : undefined)),
117:     CHAPA_SECRET_KEY: z.string().optional().default(''),
118:     TON_TREASURY_ADDRESS: z.string().optional().default(''),
119:   })
120:   .superRefine((cfg, ctx) => {
121:     if (cfg.NODE_ENV === 'production') {
122:       if (!cfg.ADMIN_PASSWORD || cfg.ADMIN_PASSWORD.length < 8) {
123:         ctx.addIssue({
124:           code: z.ZodIssueCode.custom,
125:           path: ['ADMIN_PASSWORD'],
126:           message:
127:             'ADMIN_PASSWORD is required in production (minimum 8 characters) — refusing to boot with insecure defaults',
128:         });
129:       }
130:       if (cfg.WALLET_PAY_MODE !== 'live') {
131:         ctx.addIssue({
132:           code: z.ZodIssueCode.custom,
133:           path: ['WALLET_PAY_MODE'],
134:           message:
135:             'WALLET_PAY_MODE must be explicitly set to "live" in production — mock payments auto-confirm orders and are forbidden outside development',
136:         });
137:       }
138:       if (!cfg.WALLET_PAY_API_KEY) {
139:         ctx.addIssue({
140:           code: z.ZodIssueCode.custom,
141:           path: ['WALLET_PAY_API_KEY'],
142:           message: 'WALLET_PAY_API_KEY is required in production when WALLET_PAY_MODE=live',
143:         });
144:       }
145:       if (!cfg.WEBAPP_URL || !cfg.WEBAPP_URL.startsWith('https://')) {
146:         ctx.addIssue({
147:           code: z.ZodIssueCode.custom,
148:           path: ['WEBAPP_URL'],
149:           message: 'WEBAPP_URL must be set to an HTTPS URL in production (the Mini App menu button points here)',
150:         });
151:       }
152:     }
153:   });
154: 
155: export type AppConfig = z.infer<typeof EnvSchema>;
156: 
157: export function loadEnv(envInput: Record<string, string | undefined> = process.env): AppConfig {
158:   const result = EnvSchema.safeParse(envInput);
159:   if (!result.success) {
160:     const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
161:     throw new Error(`Environment validation failed:\n${issues}`);
162:   }
163:   const cfg = result.data;
164: 
165:   if (cfg.NODE_ENV === 'production' && !cfg.TRUST_PROXY.trim()) {
166:     cfg.TRUST_PROXY = 'loopback';
167:     console.warn(
168:       '[config] TRUST_PROXY was empty in production — auto-set to "loopback" ' +
169:         '(correct behind cloudflared/nginx-on-box). Set TRUST_PROXY explicitly to override.'
170:     );
171:   }
172: 
173:   return cfg;
174: }
175: 
176: let cachedConfig: AppConfig | null = null;
177: 
178: export function getConfig(): AppConfig {
179:   if (!cachedConfig) {
180:     cachedConfig = loadEnv();
181:   }
182:   return cachedConfig;
183: }
184: 
185: export function resetConfigCache(): void {
186:   cachedConfig = null;
187: }
188: 
189: export function isProduction(config: AppConfig = getConfig()): boolean {
190:   return config.NODE_ENV === 'production';
191: }
```

---

### 3. `bot/src/db/index.ts`
```typescript
1: import Database from 'better-sqlite3';
2: import fs from 'fs';
3: import path from 'path';
4: import { logger } from '../logger/index.js';
5: import { runMigrations } from './migrator.js';
6: import { seedDatabase } from './seed.js';
7: 
8: let dbInstance: Database.Database | null = null;
9: 
10: export function initDatabase(dbPath: string = './data/shop.db', migrationsDir?: string): Database.Database {
11:   if (dbPath !== ':memory:') {
12:     const dir = path.dirname(dbPath);
13:     if (!fs.existsSync(dir)) {
14:       fs.mkdirSync(dir, { recursive: true });
15:     }
16:   }
17: 
18:   logger.info({ dbPath }, 'Initializing SQLite database...');
19:   const db = new Database(dbPath);
20: 
21:   // Performance and safety pragmas
22:   db.pragma('journal_mode = WAL');
23:   db.pragma('foreign_keys = ON');
24:   db.pragma('busy_timeout = 5000');
25:   db.pragma('synchronous = NORMAL');
26:   db.pragma('cache_size = -64000');
27:   db.pragma('mmap_size = 268435456');
28: 
29:   runMigrations(db, migrationsDir);
30:   seedDatabase(db);
31: 
32:   dbInstance = db;
33:   return db;
34: }
35: 
36: export function getDatabase(): Database.Database {
37:   if (!dbInstance) {
38:     throw new Error('Database has not been initialized. Call initDatabase() first.');
39:   }
40:   return dbInstance;
41: }
42: 
43: export function closeDatabase(): void {
44:   if (dbInstance) {
45:     dbInstance.close();
46:     dbInstance = null;
47:   }
48: }
```

---

### 4. `bot/src/api/auth.ts`
```typescript
1: import crypto from 'crypto';
2: import { getConfig } from '../config/env.js';
3: import { logger } from '../logger/index.js';
4: 
5: export interface TelegramUser {
6:   id: number;
7:   first_name: string;
8:   last_name?: string;
9:   username?: string;
10:   language_code?: string;
11:   is_premium?: boolean;
12: }
13: 
14: export interface ValidatedInitData {
15:   user: TelegramUser;
16:   auth_date: number;
17:   query_id?: string;
18:   hash: string;
19: }
20: 
21: export function validateTelegramInitData(initDataRaw: string, botToken?: string): ValidatedInitData | null {
22:   if (!initDataRaw) return null;
23: 
24:   const token = botToken || getConfig().BOT_TOKEN;
25:   if (!token) return null;
26: 
27:   try {
28:     const params = new URLSearchParams(initDataRaw);
29:     const hash = params.get('hash');
30:     if (!hash) return null;
31: 
32:     // Build data-check-string (all params sorted alphabetically except hash)
33:     const items: string[] = [];
34:     params.forEach((value, key) => {
35:       if (key !== 'hash') {
36:         items.push(`${key}=${value}`);
37:       }
38:     });
39:     items.sort();
40:     const dataCheckString = items.join('\n');
41: 
42:     // HMAC-SHA-256("WebAppData", botToken)
43:     const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
44: 
45:     // HMAC-SHA-256(secretKey, dataCheckString)
46:     const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
47: 
48:     // Constant-time comparison
49:     const hashBuffer = Buffer.from(hash, 'hex');
50:     const calculatedBuffer = Buffer.from(calculatedHash, 'hex');
51: 
52:     if (hashBuffer.length !== calculatedBuffer.length || !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)) {
53:       logger.warn('Telegram initData signature verification failed');
54:       return null;
55:     }
56: 
57:     const authDate = parseInt(params.get('auth_date') || '0', 10);
58:     if (!authDate) return null;
59: 
60:     const nowSec = Math.floor(Date.now() / 1000);
61:     if (authDate > nowSec || (nowSec - authDate) > 86400) {
62:       logger.warn({ authDate, nowSec }, 'Telegram initData auth_date expired or in future (>24h)');
63:       return null;
64:     }
65: 
66:     const userRaw = params.get('user');
67:     if (!userRaw) return null;
68: 
69:     const user = JSON.parse(userRaw) as TelegramUser;
70: 
71:     return {
72:       user,
73:       auth_date: authDate,
74:       query_id: params.get('query_id') || undefined,
75:       hash,
76:     };
77:   } catch (err) {
78:     logger.error({ err }, 'Error during Telegram initData validation');
79:     return null;
80:   }
81: }
```

---

### 5. `bot/src/services/stock.service.ts`
```typescript
1: import { getDatabase } from '../db/index.js';
2: import { logger } from '../logger/index.js';
3: import { getNumericSetting } from './settings.service.js';
4: 
5: export interface StockItem {
6:   id: number;
7:   product_id: string;
8:   payload: string;
9:   status: 'available' | 'allocated' | 'invalid';
10:   order_id: string | null;
11:   created_at: string;
12:   allocated_at: string | null;
13: }
...
130: export function getAvailableStockCount(productId: string): number {
131:   try {
132:     const db = getDatabase();
133:     const row = db.prepare(`
134:       SELECT COUNT(*) as count
135:       FROM stock_items
136:       WHERE product_id = ? AND status = 'available'
137:     `).get(productId) as { count: number };
138:     return row ? row.count : 0;
139:   } catch (err) {
140:     logger.error({ err, productId }, 'Failed to count available stock');
141:     return 0;
142:   }
143: }
...
174: export function allocateStock(
175:   productId: string,
176:   orderId: string
177: ): { item: StockItem | null; remaining: number; shouldAlertLowStock: boolean } {
178:   const db = getDatabase();
179: 
180:   let allocatedItem: StockItem | null = null;
181:   let remainingCount = 0;
182: 
183:   const tx = db.transaction(() => {
184:     // Select one available item
185:     const item = db.prepare(`
186:       SELECT * FROM stock_items
187:       WHERE product_id = ? AND status = 'available'
188:       LIMIT 1
189:     `).get(productId) as StockItem | undefined;
190: 
191:     if (!item) {
192:       return;
193:     }
194: 
195:     // Atomic claim with an explicit status guard: the UPDATE only succeeds
196:     // while the row is still 'available'. Combined with BEGIN IMMEDIATE this
197:     // makes double-allocation impossible even across multiple processes
198:     // sharing one database file.
199:     const claim = db.prepare(`
200:       UPDATE stock_items
201:       SET status = 'allocated', order_id = ?, allocated_at = CURRENT_TIMESTAMP
202:       WHERE id = ? AND status = 'available'
203:     `).run(orderId, item.id);
204: 
205:     if (claim.changes !== 1) {
206:       return; // Lost the race (multi-writer) — nothing allocated.
207:     }
208: 
209:     allocatedItem = { ...item, status: 'allocated', order_id: orderId, allocated_at: new Date().toISOString() };
210: 
211:     const countRow = db.prepare(`
212:       SELECT COUNT(*) as count
213:       FROM stock_items
214:       WHERE product_id = ? AND status = 'available'
215:     `).get(productId) as { count: number };
216: 
217:     remainingCount = countRow ? countRow.count : 0;
218:   });
219: 
220:   // BEGIN IMMEDIATE grabs the write lock upfront instead of deferring to the
221:   // first write — eliminating upgrade-deadlock windows between concurrent
222:   // writers and serializing read-then-claim sequences across processes.
223:   tx.immediate();
224: 
225:   const threshold = getNumericSetting('low_stock_threshold', 5);
226:   const shouldAlertLowStock = remainingCount <= threshold;
227: 
228:   return {
229:     item: allocatedItem,
230:     remaining: remainingCount,
231:     shouldAlertLowStock,
232:   };
233: }
```

---

### 6. `bot/src/services/pricing.service.ts`
```typescript
1: import { getProductById, getVariantById, Product, Variant } from './catalog.service.js';
2: import { getNumericSetting } from './settings.service.js';
3: import { tierDiscountPct, type Tier } from './loyalty.service.js';
4: import { logger } from '../logger/index.js';
5: 
6: export interface ResolvedPrice {
7:   amountETB: number;
8:   quantity: number;
9:   productName: string;
10:   product: Product;
11:   variant: Variant | null;
12:   /** Set when an active flash-sale price was used instead of the base price. */
13:   saleApplied?: boolean;
14: }
15: 
16: export interface ResolveOrderPriceParams {
17:   productId: string;
18:   variantId?: string | null;
19:   customStars?: number | null;
20:   /** Buyer's loyalty tier — applies the server-side tier discount. */
21:   userTier?: Tier | null;
22: }
23: 
24: export class PricingError extends Error {
25:   constructor(message: string) {
26:     super(message);
27:     this.name = 'PricingError';
28:   }
29: }
30: 
31: export function assertPositiveIntegerETB(amount: unknown): asserts amount is number {
32:   if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
33:     throw new PricingError(`Order amount must be a positive integer in ETB (received: ${JSON.stringify(amount)})`);
34:   }
35: }
...
70: export function resolveOrderPrice(params: ResolveOrderPriceParams): ResolvedPrice {
71:   const product = getProductById(params.productId);
72:   if (!product) {
73:     throw new PricingError(`Product not found: ${params.productId}`);
74:   }
75:   if (!product.is_active) {
76:     throw new PricingError(`Product is not available: ${product.name}`);
77:   }
78: 
79:   if (params.variantId) {
80:     const variant = getVariantById(params.variantId);
81:     if (!variant) {
82:       throw new PricingError(`Variant not found: ${params.variantId}`);
83:     }
84:     if (!variant.is_active) {
85:       throw new PricingError(`This plan is currently unavailable: ${variant.name}`);
86:     }
87:     if (variant.product_id !== product.id) {
88:       throw new PricingError(`Variant ${variant.id} does not belong to product ${product.id}`);
89:     }
90: 
91:     const nowMs = Date.now();
92:     const sale = activeSalePrice(variant, nowMs);
93:     const baseAmount = sale ?? variant.price_etb;
94:     const tierPct = params.userTier ? tierDiscountPct(params.userTier) : 0;
95:     const amountETB = Math.max(1, Math.ceil(baseAmount * (1 - tierPct / 100)));
96: 
97:     assertPositiveIntegerETB(amountETB);
98: 
99:     return {
100:       amountETB,
101:       quantity: 1,
102:       productName: `${product.name} (${variant.name})`,
103:       product,
104:       variant,
105:       saleApplied: sale !== null && tierPct === 0 ? true : sale !== null,
106:     };
107:   }
108: 
109:   if (params.customStars !== undefined && params.customStars !== null) {
110:     if (product.id !== 'telegram_stars') {
111:       throw new PricingError(`Custom amounts are only supported for Telegram Stars`);
112:     }
113: 
114:     const stars = params.customStars;
115:     if (typeof stars !== 'number' || !Number.isFinite(stars) || !Number.isInteger(stars) || stars <= 0) {
116:       throw new PricingError('Stars amount must be a positive whole number.');
117:     }
118: 
119:     const minStars = getNumericSetting('stars_min', 10);
120:     const maxStars = getNumericSetting('stars_max', 100000);
121:     if (stars < minStars || stars > maxStars) {
122:       throw new PricingError(
123:         `Custom Stars orders must be between ${minStars.toLocaleString('en-US')} and ${maxStars.toLocaleString('en-US')} Stars.`
124:       );
125:     }
126: 
127:     const etbPerStar = getNumericSetting('etb_per_star', 2.5);
128:     if (!(etbPerStar > 0)) {
129:       logger.error({ etbPerStar }, 'etb_per_star setting is invalid; refusing to price order');
130:       throw new PricingError('Store pricing is temporarily unavailable. Please contact support.');
131:     }
132: 
133:     const amountETB = Math.ceil(stars * etbPerStar);
134:     assertPositiveIntegerETB(amountETB);
135: 
136:     return {
137:       amountETB,
138:       quantity: stars,
139:       productName: `${stars.toLocaleString('en-US')} Telegram Stars`,
140:       product,
141:       variant: null,
142:     };
143:   }
144: 
145:   throw new PricingError('Order requires either a valid plan variant or a custom Stars amount.');
146: }
```

---

## SECTION 7 — SUSPICION LIST

1. `bot/src/db/index.ts:19` — The entire system shares a single, synchronous `better-sqlite3` instance; at 1,000+ concurrent users, every query blocks the single Node.js event loop thread, causing massive request queuing and event loop starvation.
2. `bot/src/db/index.ts:24` — `busy_timeout = 5000` means any transaction waiting over 5 seconds under concurrent write volume will fail abruptly with `SqliteError: database is locked`.
3. `bot/src/index.ts:99-110` — The bot runs exclusively in Telegram long-polling mode (`bot.start()`), making horizontal scaling across multiple container instances impossible (Telegram rejects multiple concurrent polling workers with 409 Conflict).
4. `bot/src/services/receipts.service.ts:124` — `saveReceiptImage` performs synchronous disk I/O via `fs.writeFileSync()` in the main request path of `POST /api/receipt`, blocking all concurrent user traffic during image writes.
5. `bot/src/services/receipts.service.ts:44-51` — User receipts are stored strictly on the local container filesystem; in a multi-instance or auto-scaling cluster without a shared network volume, receipts uploaded to one instance are unreachable by admin reviewers hitting another instance.
6. `bot/src/services/banner_generator.service.ts:356-358` — `@resvg/resvg-js` rasterizes 1200x630 PNG images synchronously in-process and writes them to local disk via `fs.writeFileSync()`, consuming heavy CPU and blocking the event loop on banner cache misses.
7. `bot/src/api/server.ts:375-384` — `/api/bootstrap` is fetched by every Mini App client on startup and executes an un-cached N+1 database query loop (all products + variants + stock count per product + settings + user stats) on every invocation.
8. `bot/src/api/server.ts:430` — `/api/user/recheck-username` triggers an unthrottled, live outbound Telegram Bot API call (`bot.api.getChat()`) on every request, allowing concurrent users to exhaust Telegram Bot API rate limits.
9. `bot/src/api/server.ts:781-824` — `/api/payments/ton/status/:orderId` triggers an unthrottled outbound HTTP call to TonCenter API on every client poll, which will hit TonCenter public API rate limits under concurrent buyers.
10. `bot/src/services/payments/ton.service.ts:48-50` — `fetchTreasuryTransactions` queries TonCenter with a hardcoded limit of 100 transactions; under high transaction volume, incoming payments can be pushed past the 100-item window before matching, permanently dropping user payments.
11. `bot/src/services/payments/chapa.ts:42` — Outbound HTTP `fetch` to Chapa initialize has no `AbortSignal.timeout` or socket timeout; a slow or hung Chapa gateway will permanently tie up Node.js HTTP sockets and client connections.
12. `bot/src/services/payments/chapa.ts:74` — Outbound HTTP `fetch` to Chapa transaction verify lacks a timeout, risking hung background reconciliation loops.
13. `bot/src/services/payments/live_wallet_pay.ts:94` — Outbound HTTP `fetch` to Wallet Pay order creation lacks a timeout, risking hung checkout requests.
14. `bot/src/services/payments/live_wallet_pay.ts:131` — Outbound HTTP `fetch` to Wallet Pay order preview lacks a timeout, risking stalled reconciliation timers.
15. `bot/src/bot/handlers/input.ts:492` — Outbound HTTP `fetch` downloading CSV documents from Telegram Bot API lacks an `AbortSignal.timeout`.
16. `bot/src/services/payments/index.ts:71-108` — `reconcileStuckPayments` executes a sequential `for...of` loop performing synchronous DB reads and multiple external HTTP calls per order, causing the 60s reconciliation interval to drift and stall under large queues.
17. `bot/src/services/payments/index.ts:127` — `startWalletPayReconciliation` runs an in-memory `setInterval` without distributed locking; multiple server processes will run simultaneous polling sweeps against external payment gateways.
18. `bot/src/services/lifecycle.service.ts:83` — `startLifecycleJobs` runs an in-memory `setInterval` without distributed coordination; scaling beyond one process will trigger duplicate Telegram reminder messages and race conditions on order cancellations.
19. `bot/src/services/maintenance.service.ts:63` — `startPeriodicCleanup` runs an in-memory `setInterval` without distributed locking.
20. `bot/src/services/broadcast.service.ts:36,38` — `getBroadcastTargets` executes unbounded queries (`SELECT id, language_code FROM users`) loading the entire database user table into a single JavaScript array in memory.
21. `bot/src/services/broadcast.service.ts:105` — `broadcastJobs` status registry is stored in a process-local `Map`; status polling (`/api/admin/broadcast/status/:jobId`) fails with 404 if the admin request hits another server worker.
22. `bot/src/services/broadcast.service.ts:198-213` — Broadcast dispatching runs inside an unpersisted in-memory async loop (`void (async () => { ... })()`); process restarts or crashes mid-broadcast permanently abort in-flight campaigns with no resume mechanism.
23. `bot/src/api/admin.ts:74` — Admin 2FA failure lockout state (`otpFailures`) is kept in process RAM, allowing distributed attackers to bypass brute-force limits by distributing requests across multiple processes.
24. `bot/src/api/admin.ts:381-443` — `/api/admin/overview` executes up to 12 separate database aggregation queries inside JavaScript loops on every dashboard view instead of using a single grouped SQL query.
25. `bot/src/api/admin.ts:697` — `GET /api/admin/stock` runs an unbounded `SELECT * FROM stock_items WHERE product_id = 'gemini_pro_18m'` without pagination, loading all historic stock rows into memory.
26. `bot/src/api/admin.ts:740` — `adminRouter.post('/stock')` executes individual `SELECT id FROM stock_items` queries in a synchronous loop for every line in the input batch instead of batch querying.
27. `bot/src/api/admin.ts:853` — Admin broadcast targeting runs unbounded `SELECT DISTINCT user_id as id FROM orders WHERE status = 'fulfilled'` into memory.
28. `bot/src/api/admin.ts:855` — Admin broadcast targeting runs unbounded `SELECT id FROM users WHERE is_registered = 1` into memory.
29. `bot/src/api/admin.ts:1014` — Financial order exports execute `SELECT * FROM orders WHERE status = 'fulfilled' ... LIMIT 10000`, allocating up to 10,000 full rows in Node memory.
30. `bot/src/api/admin.ts:1033` — `ExcelJS.Workbook` buffers the entire spreadsheet in memory before sending, creating large RAM spikes during financial exports.
31. `bot/src/api/admin.ts:1075` — PDF financial report renders in-memory via `PDFKit` without streaming database rows.
32. `bot/src/services/users.service.ts:30` — `getAllUsers()` runs an unbounded `SELECT * FROM users ORDER BY created_at DESC` with no `LIMIT` or pagination, degrading memory and response times as the customer base scales.
33. `bot/src/services/profit.service.ts:71` — `monthlyPnl()` loads months of order history with an unbounded `SELECT * FROM orders` query and computes all COGS and fee math inside a JavaScript loop.
34. `bot/src/bot/bot.ts:106` — Grammy 429 rate limit handler executes `await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000))` inside the API middleware chain, stalling the processing pipeline on Telegram rate limits.
35. `bot/src/bot/handlers/checkout.ts:93` — `initiateCheckout` queries previous `awaiting_payment` orders within 15 minutes, holding locks on checkout creation under rapid successive user interactions.
36. `bot/src/services/orders.service.ts:138-202` — `createOrder` runs inside a 3-attempt retry loop on primary key collisions with transaction rollback, compounding database write-lock contention under high checkout concurrency.
37. `bot/src/services/stock.service.ts:223` — `allocateStock` executes `tx.immediate()`, acquiring an exclusive SQLite database write lock upfront and serializing all stock allocations across the entire platform.
38. `bot/src/api/server.ts:272-282` — `globalApiLimiter` keys by IP address (`req.ip`), causing all users behind shared mobile network CGNATs (common across Ethiopian telecom networks) to share a single 1,000 requests / 15 minute quota.
39. `bot/src/api/server.ts:868-930` — Wallet Pay webhook handler processes incoming events sequentially in a single request, executing synchronous database lookups and order updates inside the HTTP request loop.
40. `bot/src/api/server.ts:770` — Chapa webhook handler executes synchronous `approveReceipt` and order status transition directly inside the HTTP request handler path instead of queuing.
41. `bot/src/bot/session.ts:35` — Bot conversation state uses synchronous database queries (`SELECT * FROM bot_sessions WHERE user_id = ?`) on every incoming user message and callback query.
42. `bot/src/bot/handlers/gate.ts:75` — `handleGateRecheck` synchronously writes updated usernames to SQLite (`UPDATE users SET username = ...`) on every recheck button press.

---
**END OF DOSSIER**
