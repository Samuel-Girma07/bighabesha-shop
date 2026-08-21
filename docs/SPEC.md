# Bighabesha Shop — Specification & Architecture

## Global Brief (Verbatim)

```text
You are building "Bighabesha Shop", a production Telegram commerce bot for the Ethiopian market.
Read this brief fully, then wait for Phase 0.

GLOBAL RULES
- If ANY product/scope/UX requirement is ambiguous or missing: STOP and ask me before implementing. Never guess product behavior.
- For purely technical choices: use my suggested defaults below unless you have a concrete better option; record every such decision in ASSUMPTIONS.md with reasoning.
- Test after EVERY milestone. Run the tests yourself and iterate until green before reporting done.
- Secrets ONLY via env vars. Ship .env.example. Never hardcode tokens/keys.
- Commit per milestone with clear messages. Keep CHANGELOG.md.
- Suggested stack (deviate only with documented reason): TypeScript strict + ESM, Node 20, grammy (bot), better-sqlite3, React+Vite (Mini App), pnpm, monorepo: bot/ webapp/ deploy/ docs/.

V1 SCOPE (fixed)
Products (catalog model must stay extensible for v1.5 Facebook/TikTok ads without schema changes):
1. Gemini Pro 18m — type=stock. Admin uploads activation links (CSV or single paste). Auto-delivered instantly on paid (link + admin-editable instructions). Sold-out state; low-stock alert <=5 (threshold admin-set).
2. Telegram Premium — type=order, variants 3/6/12 months. Semi-auto: paid -> admin queue -> admin fulfills via Fragment -> mark fulfilled (+optional proof). USERNAME-GATED.
3. Telegram Stars ("coins") — type=order. Packages 50/100/250/500/1000/2500 (admin-editable list) + custom amount (min 10, max 100000, both admin-editable). Semi-auto. USERNAME-GATED.

Username gate (Premium/Stars): if buyer has no public @username, block purchase; show setup steps (Settings -> profile -> username) + buttons [I created it — recheck] (re-runs check) and [Contact support] -> https://t.me/Vweah.

Payments (all three in v1):
- Telegram Stars: Bot Payments API, currency XTR; stars_due = ceil(price_ETB / etb_per_star).
- Wallet Pay (TON/USDT): adapter interface; use MockWalletPay in dev (deterministic confirm), real adapter activated by env keys later.
- Manual local rails: telebirr / CBE Bank / Bank of Abyssinia. Admin stores display account details in Settings; user uploads receipt photo (+optional note) -> pending_approval -> admin approves/rejects (reason sent to user).

Pricing: all prices ETB, admin-set per variant. Rate engine params (admin Settings): etb_per_usd (with auto-fill from open.er-api.com), etb_per_star, margin_pct. TON/USDT prices from CoinGecko, cached 5 min.
crypto_amount = (price_ETB / etb_per_usd) * (1 + margin_pct/100) / coin_price_usd.
Seed sensible default values for all of the above; admin can override everything.

Order statuses: new -> awaiting_payment -> pending_approval (manual only) -> pending_fulfillment -> fulfilled; terminal: rejected / refunded / cancelled.

Users: /start -> language screen (v1 English only, but ship i18n framework with en.json; per-user preference stored) -> menu: Shop / My Orders / Language / Support(@Vweah). My Orders shows history + delivered payloads/proofs.

Admins: exactly 2, Telegram user IDs from env ADMIN_IDS. In-chat admin menu: Products, Stock, Orders (queue oldest-first; Fulfill+proof / Refund / Reject), Rates, Broadcast (text+photo, language-targeted), Settings. New-order + low-stock alerts DM both admins with one-tap action buttons.

Surfaces: v1 = inline bot first (Phases 1-4), then Mini App (Phase 5) with full parity: React+Vite, Telegram initData validated server-side, dark theme (bg #17212B, primary #078930, CTA #FCDD09 dark text, danger #DA121A), currency format "1,250 ETB".

Infra target: Oracle free VPS (bot+API, long polling, pm2), cloudflared free tunnel (HTTPS for Mini App API), Cloudflare Pages (Mini App), SQLite + nightly backup cron. Ship deploy/ scripts + README.

Report format after each phase: (1) what was built, (2) test results, (3) ASSUMPTIONS.md additions, (4) how to manually verify, (5) next phase readiness.
```

---

## Clarifications & Confirmed Decisions

1. **Gifting**: No gifting flow in v1. Recipient for Telegram Premium and Stars is always the purchasing user's public `@username`.
2. **Gemini Pro 18m Activation Instructions**:
   - Seeded with professional step-by-step guidance including VPN requirement before activation.
   - Admin-editable in database/settings.
   - Structured for future Amharic translations.
3. **Local Rails Defaults**:
   - CBE Account: `1000510711258`
   - Telebirr: `0965579045`
   - Bank of Abyssinia: `Abyssinia Bank Account (Admin configurable)`
4. **Rate Engine Formula**:
   - `crypto_amount = (price_ETB / etb_per_usd) * (1 + margin_pct / 100) / coin_price_usd`
5. **Admin Alert Concurrency**:
   - Atomic database status transitions.
   - When an order is approved/rejected/fulfilled by one admin, notification messages for all admins update and inline action buttons are disabled to prevent duplicate processing.
