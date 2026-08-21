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
