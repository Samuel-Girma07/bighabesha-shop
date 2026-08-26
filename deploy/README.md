# Deployment Guide: Bighabesha Shop

This directory contains configuration scripts and infrastructure documentation for deploying **Bighabesha Shop** on free-tier infrastructure.

---

## 🏗 Architecture Overview

```
                      +-----------------------------+
                      |   Cloudflare Pages (SPA)   |
                      |   https://shop.bighabesha... |
                      +--------------+--------------+
                                     |
                                     | Telegram Mini App API requests
                                     v
+-----------------------+     +---------------+     +---------------------------+
| Oracle Free Tier VPS  | <-- |  cloudflared  | <-- | https://api.shop.bigha... |
| (Node 20, PM2, SQLite)|     | Free Tunnel   |     +---------------------------+
+-----------------------+     +---------------+
```

---

## 1. Cloudflare Pages Setup (Mini App Frontend)

1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), navigate to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Select your repository: `Bot`.
3. Build Settings:
   - **Framework Preset**: `Vite`
   - **Root directory**: `webapp`
   - **Build command**: `pnpm build`
   - **Build output directory**: `dist`
4. Environment Variables:
   - `VITE_API_URL`: `https://api.shop.bighabesha.com` (or your Cloudflared tunnel endpoint).
5. Deploy. Cloudflare will provide a permanent HTTPS URL (e.g. `https://bighabesha-shop.pages.dev`).

---

## 2. Setting Bot Menu Button in @BotFather

To connect the Mini App directly to the bot's Menu Button:
1. Open [@BotFather](https://t.me/BotFather) on Telegram.
2. Send `/setmenubutton` → Select `@Bighabesha_shopBot`.
3. Enter URL: `https://bighabesha-shop.pages.dev` (or your custom domain).
4. Enter button title: `🛍 Open Shop`.

---

## 3. Cloudflare Tunnel Setup (Backend API)

1. Install `cloudflared` on your VPS:
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```
2. Authenticate and create a tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create bighabesha-api
   ```
3. Copy [`deploy/cloudflared.yml`](cloudflared.yml) to `/etc/cloudflared/config.yml` and insert your tunnel UUID.
4. Route DNS and start the service:
   ```bash
   cloudflared tunnel route dns bighabesha-api api.shop.bighabesha.com
   sudo cloudflared service install
   sudo systemctl start cloudflared
   ```

---

## 4. VPS Provisioning & Process Management

1. Provision an Ubuntu 22.04 host, then run the setup script (edit the repo URL first):
   \\\ash
   bash deploy/vps-setup.sh
   \\\
   This installs Node 20 + pnpm + PM2, builds the workspace, registers the
   PM2 process (\deploy/ecosystem.config.cjs\), and installs the nightly
   backup cron job (00:00 UTC / 03:00 EAT).

2. Configure \/opt/bighabesha-shop/.env\ **before** starting. In production
   the process refuses to boot unless ALL of the following are set:
   - \ADMIN_PASSWORD\ (≥ 8 chars) — web dashboard master password
   - \WALLET_PAY_MODE=live\ + \WALLET_PAY_API_KEY\
   - \WEBAPP_URL\ (HTTPS Mini App URL)
   - \TRUST_PROXY=1\ — **required behind cloudflared** so rate limits key on
     real client IPs instead of the tunnel's loopback address.

---

## 5. Runtime Security Architecture (as implemented)

| Control | Detail |
|---|---|
| Rate limiting | login 5/15min·IP, OTP 5/10min·IP, checkout & receipts 10/min·IP, global API 300/15min·IP |
| Security headers | helmet + CSP allowing \	elegram.org\ WebApp embedding; \rame-ancestors\ for web.telegram.org |
| CORS | strict allow-list: \WEBAPP_URL\ + optional \CORS_ORIGINS\ |
| Body limits | 100 KB global JSON; dedicated 3 MB parser for base64 receipt uploads |
| Webhook trust | single canonical HMAC-SHA256 scheme, ±5 min timestamp freshness, paid-amount/currency verified against the stored quote |
| Order state machine | strict transition map — receipts can never be silently discarded by status regressions |
| Admin dashboard | password + Telegram 2FA OTP (constant-time compares), 24h session tokens, no default credentials |
| Data hygiene | scheduled purge of expired sessions/OTPs/drafts (15 min cycle) and receipt files (90-day retention, configurable) |

---

## 6. Backups & Recovery

\deploy/backup.sh\ (cron-installed by \ps-setup.sh\):
1. Runs \PRAGMA integrity_check\ — a corrupt database is **never** archived.
2. Snapshots the DB online (\sqlite3 .backup\, WAL-safe) **and** archives
   \data/receipts/\ (customer payment proofs) into a single compressed
   timestamped archive: \/var/backups/bighabesha/bighabesha_YYYYmmdd_HHMMSS.tar.gz\.
3. Prunes archives older than \RETENTION_DAYS\ (default 7).

Restore drill:
\\\ash
tar -xzf /var/backups/bighabesha/bighabesha_<ts>.tar.gz -C /tmp/restore
sqlite3 /tmp/restore/shop.db "PRAGMA integrity_check;"   # must print ok
pm2 stop bighabesha-bot
cp /tmp/restore/shop.db /opt/bighabesha-shop/data/shop.db
cp -r /tmp/restore/receipts /opt/bighabesha-shop/data/
pm2 start bighabesha-bot
\\\

---

## 7. Health Monitoring

\GET /api/health\ performs a live SQLite **read and write probe** (heartbeat
table) and returns **503** when the database is disconnected or corrupted —
wire your uptime monitor to this endpoint.
