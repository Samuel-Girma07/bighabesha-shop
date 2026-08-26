# Load Testing Toolkit (k6)

Scripts benchmark the three hot paths from the production-readiness audit:
catalog browsing, order creation, and admin dashboard polling.

## Prerequisites

```bash
# Install k6 (https://k6.io/docs/get-started/installation/)
choco install k6        # Windows
brew install k6         # macOS
```

## Credentials for authenticated routes

| Env var          | How to obtain                                                                 |
|------------------|-------------------------------------------------------------------------------|
| `TMA_INIT_DATA`  | Open the Mini App in Telegram → WebView devtools → `window.Telegram.WebApp.initData` |
| `ADMIN_TOKEN`    | Log into `/admin`, then copy `bighabesha_admin_token` from localStorage       |

Tokens expire (initData ≈ 24h) — fetch fresh ones per session.

## Runs

```bash
# Anonymous browse + authenticated bootstrap mix
k6 run -e BASE_URL=http://localhost:3000 -e TMA_INIT_DATA="..." k6-catalog.js

# Order creation + admin polling (STAGING ONLY)
k6 run -e BASE_URL=https://staging-api... -e TMA_INIT_DATA="..." -e ADMIN_TOKEN="..." k6-orders.js
```

## Pass criteria (from audit §5)

- p95 < 400 ms reads, < 800 ms order-create
- Zero `SQLITE_BUSY` occurrences (`pm2 logs | grep -i busy`)
- 429s only from deliberate limiter ceilings, never 500s

## After each burst run

1. Delete test orders:
   ```bash
   sqlite3 data/shop.db "DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE user_id=<testUserId>); DELETE FROM orders WHERE user_id=<testUserId>;"
   ```
2. Watch RAM vs PM2 `max_memory_restart` (350 MB).
