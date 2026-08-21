# Bighabesha Shop 🇪🇹

Production Telegram commerce bot and Mini App for the Ethiopian market, offering Gemini Pro subscriptions, Telegram Premium, and Telegram Stars with automated and semi-automated fulfillment.

---

## 🏗 Repository Architecture

```
├── bot/              # Telegram bot (Grammy), SQLite DB, Rate Engine, Admin UI, Mini App REST API
├── webapp/           # Telegram Mini App (React 19 + Vite + TypeScript)
├── deploy/           # Production deploy scripts (Ubuntu VPS, PM2, Cloudflared tunnel, backup cron)
├── docs/             # Product specifications and manual test scripts
├── ASSUMPTIONS.md    # Architectural choices and documented decisions
├── CHANGELOG.md      # Semantic version changelog
└── pnpm-workspace.yaml
```

---

## 🚀 Quickstart & Development Setup

### Prerequisites
- **Node.js**: v20.x or higher (tested on Node 24)
- **pnpm**: v9+ (or `npm install -g pnpm`)

### 1. Installation
```bash
git clone <repo-url>
cd Bot
pnpm install
```

### 2. Local Environment Configuration
```bash
cp .env.example .env
```
Configure `.env`:
- `BOT_TOKEN`: Telegram bot token from [@BotFather](https://t.me/BotFather).
- `ADMIN_IDS`: Comma-separated Telegram User IDs for the administrators (e.g. `1397163638,987654321`).
- `WALLET_PAY_MODE`: Set to `mock` for local testing (`/wp_simulate <order_id>`), `live` for production.

### 3. Run Automated Tests
```bash
pnpm test
```

### 4. Start Local Development Services
```bash
# Start bot and REST API
pnpm bot:dev

# Start Mini App frontend (in separate terminal)
pnpm webapp:dev
```
Open `http://localhost:5173` in your browser.

---

## 📋 Client Owner-Onboarding & Handover Checklist

When transferring ownership of **Bighabesha Shop** to the client, follow this step-by-step onboarding checklist:

### 1. Telegram Bot Creation & Privacy Settings
1. Open [@BotFather](https://t.me/BotFather) on Telegram.
2. Send `/newbot` and follow prompts to set the bot name and username (e.g. `@Bighabesha_shopBot`).
3. Set bot description: `/setdescription` → describe the store and products.
4. Set profile picture: `/setuserpic` → upload Bighabesha brand logo.
5. Set Mini App Menu Button:
   - Send `/setmenubutton`
   - Enter your Cloudflare Pages URL (e.g. `https://bighabesha-shop.pages.dev`)
   - Button text: `🛍 Open Shop`

### 2. Admin Telegram IDs Configuration
1. Have both client administrators message [@userinfobot](https://t.me/userinfobot) to retrieve their numeric Telegram IDs.
2. Update `ADMIN_IDS` in production `.env` (e.g. `ADMIN_IDS=1397163638,987654321`).

### 3. Bank & Mobile Rail Numbers
1. Launch the bot and send `/admin` → **🏦 Settings & Accounts**.
2. Configure official merchant accounts:
   - **Commercial Bank of Ethiopia (CBE)**: Account number & account name
   - **Telebirr**: Phone number & merchant name
   - **Bank of Abyssinia**: Account number & account name

### 4. Wallet Pay Setup (TON / USDT)
1. Open [@wallet](https://t.me/wallet) → apply for Wallet Pay merchant account.
2. Once approved, copy your Store API Key.
3. Update `.env`:
   ```env
   WALLET_PAY_MODE=live
   WALLET_PAY_API_KEY=your_live_wallet_pay_api_key
   ```

### 5. Production VPS Deployment
Run the automated deployment script on an Ubuntu 22.04 LTS VPS (e.g. Oracle Cloud Free Tier):
```bash
curl -fsSL https://raw.githubusercontent.com/your-org/Bot/master/deploy/vps-setup.sh | bash
```

---

## 🧪 Testing & Verification

Execute the full manual verification protocol documented in [`docs/MANUAL_TESTS.md`](docs/MANUAL_TESTS.md) before production launch.
