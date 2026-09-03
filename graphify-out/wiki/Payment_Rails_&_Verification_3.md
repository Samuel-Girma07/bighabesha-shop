# Payment Rails & Verification

> 52 nodes · cohesion 0.08

## Key Concepts

- **rate_engine.service.ts** (23 connections) — `bot/src/services/rate_engine.service.ts`
- **phase2.test.ts** (23 connections) — `bot/tests/phase2.test.ts`
- **live_wallet_pay.ts** (22 connections) — `bot/src/services/payments/live_wallet_pay.ts`
- **http.ts** (19 connections) — `bot/src/lib/http.ts`
- **chapa.ts** (17 connections) — `bot/src/services/payments/chapa.ts`
- **fetchCoinGeckoPrices()** (17 connections) — `bot/src/services/rate_engine.service.ts`
- **mock_wallet_pay.ts** (16 connections) — `bot/src/services/payments/mock_wallet_pay.ts`
- **calculateCryptoQuote()** (14 connections) — `bot/src/services/rate_engine.service.ts`
- **cache.service.ts** (12 connections) — `bot/src/services/cache.service.ts`
- **getWalletPayAdapter()** (10 connections) — `bot/src/services/payments/index.ts`
- **MockWalletPayAdapter** (9 connections) — `bot/src/services/payments/mock_wallet_pay.ts`
- **LiveWalletPayAdapter** (8 connections) — `bot/src/services/payments/live_wallet_pay.ts`
- **PaymentAdapter** (8 connections) — `bot/src/services/payments/types.ts`
- **fetchJson()** (7 connections) — `bot/src/lib/http.ts`
- **hardenedFetch()** (7 connections) — `bot/src/lib/http.ts`
- **HttpError** (6 connections) — `bot/src/lib/http.ts`
- **chapaInitialize()** (6 connections) — `bot/src/services/payments/chapa.ts`
- **types.ts** (6 connections) — `bot/src/services/payments/types.ts`
- **CircuitOpenError** (5 connections) — `bot/src/lib/http.ts`
- **cached()** (5 connections) — `bot/src/services/cache.service.ts`
- **.createPayment()** (5 connections) — `bot/src/services/payments/live_wallet_pay.ts`
- **.createPayment()** (5 connections) — `bot/src/services/payments/mock_wallet_pay.ts`
- **CreatePaymentParams** (5 connections) — `bot/src/services/payments/types.ts`
- **PaymentResult** (5 connections) — `bot/src/services/payments/types.ts`
- **quoteEtbToTon()** (4 connections) — `bot/src/api/server.ts`
- *... and 27 more nodes in this community*

## Relationships

- [Payment Rails & Verification](Payment_Rails_&_Verification.md) (77 shared connections)
- [Bot Admin & Order Verification](Bot_Admin_&_Order_Verification.md) (14 shared connections)
- [Bot Commands & User Handlers](Bot_Commands_&_User_Handlers.md) (8 shared connections)

## Source Files

- `bot/src/api/server.ts`
- `bot/src/lib/http.ts`
- `bot/src/services/cache.service.ts`
- `bot/src/services/payments/chapa.ts`
- `bot/src/services/payments/index.ts`
- `bot/src/services/payments/live_wallet_pay.ts`
- `bot/src/services/payments/mock_wallet_pay.ts`
- `bot/src/services/payments/types.ts`
- `bot/src/services/rate_engine.service.ts`
- `bot/tests/phase2.test.ts`

## Audit Trail

- EXTRACTED: 206 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*