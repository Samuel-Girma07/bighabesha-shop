# Bighabesha Shop 🇪🇹

Production Telegram commerce bot and Mini App for the Ethiopian market, offering Gemini Pro subscriptions, Telegram Premium, and Telegram Stars with automated and semi-automated fulfillment.

---

## 🏗 Repository Structure

```
├── bot/              # Telegram bot (Grammy), SQLite DB, Rate Engine, Admin UI, Mini App REST API
├── webapp/           # Telegram Mini App (React + Vite + TypeScript)
├── deploy/           # Deployment scripts (Ubuntu VPS, PM2, Cloudflared tunnel, backup cron)
├── docs/             # Product specifications, manuals, and architecture documents
├── ASSUMPTIONS.md    # Documented technical decisions and architectural rationale
├── CHANGELOG.md      # Version changelog
└── pnpm-workspace.yaml
```

---

## 🚀 Quickstart & Development Setup

### Prerequisites
- **Node.js**: v20.x or higher (tested on Node 24)
- **pnpm**: v9+ (or `npm install -g pnpm`)

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repo-url>
cd Bot
pnpm install
```

### 2. Environment Configuration
Copy the example environment file and configure your credentials:
```bash
cp .env.example .env
```
Edit `.env`:
- `BOT_TOKEN`: Your Telegram bot token from [@BotFather](https://t.me/BotFather).
- `ADMIN_IDS`: Comma-separated Telegram User IDs for the administrators (e.g. `123456789,987654321`).
- `WALLET_PAY_MODE`: Set to `mock` for local development.

### 3. Run Tests
```bash
pnpm test
```

### 4. Start Development Bot
```bash
pnpm bot:dev
```

---

## 🧪 Testing

Run all workspace test suites:
```bash
pnpm -r test
```

To run only the bot unit tests:
```bash
pnpm --filter bot test
```

---

## 📜 Architecture & Specifications
See [`docs/SPEC.md`](docs/SPEC.md) for full project specifications and [`ASSUMPTIONS.md`](ASSUMPTIONS.md) for architectural choices.
