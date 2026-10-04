# Implementation Plan — Receipt Verifier: Parser Fix, Image-Pipeline Retirement, Rail Cleanup

**Repo:** Bighabesha Shop — pnpm workspace (`bot/`, `webapp/`).
**Target:** `origin/master` @ `f118b8f` (merge of PR #3 `feat/bank-receipt-verification`).
**Status of this document:** verified against live code and a live Telebirr receipt on 2026-09-28.

---

## 0. Preconditions

1. **Sync first — mandatory.** Local `master` is **0 ahead / 14 behind** `origin/master`. The entire `receipt_verifier` engine does not exist in the working copy.
   ```
   git checkout master
   git pull --ff-only
   git rev-parse HEAD     # expect f118b8f…
   ```
   Clean fast-forward, no local commits at risk.
2. **Do not touch pre-existing working-tree state.** `graphify-out/cache/last_query_stamp` (modified) and `.opencode/` (untracked) predate this work. Never stage, commit, or clean them.
3. **Local `.env` is real config.** Do not read secrets into logs, do not commit, do not modify.
4. **Baseline before any edit:**
   ```
   pnpm install --frozen-lockfile
   pnpm -r build
   pnpm --filter bot typecheck
   pnpm -r test
   ```
   Record the result. Every workstream must return this to green.

All `file:line` references below are verified at `origin/master` and are correct after Step 0.

---

## 1. What the investigation actually found

### 1.1 Branch drift (blocking)

| | |
|---|---|
| Local `master` | `a09000a` — no `receipt_verifier/` directory at all |
| `origin/master` | `f118b8f` — full engine, merged via PR #3 |
| Divergence | 0 ahead, **14 behind** |

### 1.2 The Telebirr parser is broken against real receipts — highest-value fix

Tested live on 2026-09-28 against `https://transactioninfo.ethiotelecom.et/receipt/<ref>`. Dev machine egresses from `196.189.29.224`, Addis Ababa, `AS24757 Ethio Telecom`; portal returns **HTTP 200 in ~0.3s**. The geo-block is confirmed purely IP-based.

`telebirr.adapter.ts` `parseHtmlResponse` extracts fields via a per-row key/value map:
```ts
const th = $(row).find('th, td:first-child').text().trim().toLowerCase();
const td = $(row).find('td:last-child').text().trim();
dataMap[th] = td;
```

A real receipt does not match this. Observed field-by-field:

| Field | Adapter expects | Real receipt contains | Outcome |
|---|---|---|---|
| Reference | `dataMap['receipt number' \| 'transaction number' \| 'transaction id' \| 'ref no']` | `የክፍያ ቁጥር/Invoice No.` | Miss → falls back to the ref we searched with (correct value, wrong mechanism) |
| Amount | `dataMap['amount' \| 'transferred amount' \| 'payment amount' \| 'total amount']` | `የተከፈለ መጠን/Settled Amount` → `1,000 Birr` | Accidentally correct via regex; **order-dependent and fragile** |
| Beneficiary account | `dataMap['credited party' \| 'receiver phone' …]`, `\b(09[0-9]{8})\b` | `የገንዘብ ተቀባት ቴሌብር ቁ./Credited party account no` → `2519****9045` | **FAILS — empty string** |
| Timestamp | `dataMap['payment time' \| 'date']`; ISO + slash regexes | `የክፍያ ቀን/Payment date` → `01-09-2026 00:41:13` | **FAILS — returns `new Date()` (now)** |

**Root causes**

1. **Layout mismatch.** The invoice table is a *header-row / value-row* structure: three labels in one `<tr>`, three values in the next. Per-row `first-cell → last-cell` mapping produces `dataMap["<ref>"] = "<amount>"`. No configured key can ever match.
2. **Bilingual labels.** Every label is `Amharic/English`. No English-only key matches.
3. **Date format is dashes.** `01-09-2026` (`DD-MM-YYYY`). `parseEthiopianBankTimestamp` (`constants.ts`) handles `YYYY-MM-DD`, `DD/MM/YYYY`, `YYYY/MM/DD` — **not** `DD-MM-YYYY`. Two stacked bugs: even a correct pattern match fails to parse.

**Production consequence:** beneficiary whitelist evaluates empty → `BENEFICIARY_MISMATCH` on **every Telebirr payment**, routed to manual review as suspected fraud. Separately, the recency pillar compares *now* against *now* — a silent no-op that cannot detect a stale receipt reused against a fresh order. This is a security regression, not a cosmetic defect.

### 1.3 Design blocker: the credited account is masked

Real receipts expose `2519****9045`. **No parser can recover the full number.** The beneficiary-whitelist pillar therefore cannot pass for Telebirr under the current numeric-account design. The credited-party **name** is fully visible. Decision: match the whitelist on **credited-party name** for Telebirr; keep strict numeric account matching for CBE.

### 1.4 Amount semantics

A real receipt shows settled `1,000 Birr` and total paid `1,004` (service fee `3.48` + VAT `0.52`). The gate must compare **settled amount**, not total paid, or every exactly-round order fails `AMOUNT_MISMATCH`.

### 1.5 Image pipeline: legacy in Telegram, blocking in Mini App

| Surface | State at `origin/master` |
|---|---|
| Telegram bot | Buyer photo/document intake **already retired** — `input.ts:50,62,275,670,704` ("Photos / screenshots are no longer accepted"). Text/SMS reference is live at `input.ts:319,352`. |
| **Mini App** | **Checkout Step 3 requires a receipt screenshot and cannot complete without one.** `App.tsx:470` — `if (!checkoutOrder || !receiptBase64) return;`. File dropzone at `App.tsx:1333`. POSTs to `/api/receipt` (`api.ts:226,230`) → `server.ts:89 handleReceiptUpload`, which **never calls the orchestrator** — manual review only. |
| API | `/api/receipts/verify` (`api/receipts.ts:174`) already accepts `{orderId, reference, note}`, calls the orchestrator, alerts admins on fallback (`:271`), and has stronger auth (buyer **or** admin, `:220`) than `/api/receipt`. |
| Storage | `storage.service.ts` (B2 upload + boot sync), `receipts.service.ts` (save/resolve/purge) |
| Admin | `admin.ts:614–720` viewer + signed receipt links; `checkout.ts:563,680` photo-attach in admin alerts |

Bot is **pre-production** → hard delete, no deprecation shim, no stale-client handling. Quality bar: production-grade.

### 1.6 Rejected options (tested or verified false)

| Option | Verdict |
|---|---|
| cheki free API | **Tested 2026-09-28: `http_code=000`, 30s timeout, 0 bytes.** Dead. |
| `X-Forwarded-For` spoof | Portal is geo-fenced via Cloudflare + edge routing (`DEPLOYMENT-RUNBOOK.md:170`). Edge determines client IP; header is ignored. |
| Free public proxy lists | No legitimate free residential pool exists; IPRoyal publishes an explicit warning against free ET proxies; live ET indices show zero entries. Unsafe for payment references. |
| "Ethiopian VPS" (HahuCloud / Yegara) | **Both resell offshore capacity.** HahuCloud: US/SG/UK/NL/DE/CA/BD. Yegara: "servers located in Europe… DigitalOcean London and Hetzner Germany." Neither provides an Ethiopian IP. |
| Datacenter free tier (Webshare etc.) | Geo-block keys on ASN. A foreign datacenter IP is no better than Render's. |
| Third-party verify SaaS | Their own docs concede the same limitation. Would hold live payment data. |

### 1.7 Other defects found

- **`receipt_auto_verify_enabled` is a dead switch.** Seeded (`migration 011:174`, `seed.ts:87`), allow-listed (`settings.service.ts:164,196,217`), toggled in the dashboard (`webapp/src/admin/AdminDashboard.tsx:3087–3117`) — but **no enforcement read-site exists anywhere in `bot/src`**.
- **Proxy config failures are misreported.** `telebirr.adapter.ts:97–103`: if `new HttpsProxyAgent(badUrl)` throws, it logs a warning and **silently proceeds with direct egress** → guaranteed 403 → mislabeled `PORTAL_GEOBLOCKED`, sending operators to debug the wrong thing.
- **Runbook documents `socks5://`** (`DEPLOYMENT-RUNBOOK.md:191,235`) but `HttpsProxyAgent` is HTTP-CONNECT only. Socks5 fails silently.
- **Timeout not env-overridable.** `DEFAULT_BANK_NETWORK_TIMEOUT_MS = 8000` (`constants.ts:13`). `verify()` accepts `options.timeoutMs`; the orchestrator never passes it.
- **Litestream never snapshots.** Generated config sets only `sync-interval: 1s`; no `snapshot-interval` / `retention`.
- `missing_env/.env` and `missing_env/missing.env` are committed. **Verified to contain no secrets** (only `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, etc.). Hygiene issue only.

### 1.8 Verified infrastructure facts

| Fact | Evidence |
|---|---|
| Boot sync is the only B2 download path | `index.ts:39`; sole `GetObjectCommand` at `storage.service.ts:108` |
| Orchestrator reads receipts from local disk only | `orchestrator.service.ts:217`; no on-demand remote fetch exists |
| Proxy resolution chain | `options.proxyUrl → TELEBIRR_PROXY_URL → ETHIOPIA_PROXY_URL → receipt_ethiopia_proxy_url` (`telebirr.adapter.ts:86`) |
| Breaker wraps portal calls | `base.adapter.ts:254–275`; admin-tunable via `breaker_config.ts` + `refreshReceiptOrchestratorSettings()` |
| Upstream failures route to manual review | `resolveFallbackStatus` → `upstream_failure`; order → `pending_approval`; admin action card |
| `zod` v3 is the env validator | `env.ts:148` `NODE_ENV` enum; `RECEIPTS_DIR`/`RECEIPT_MAX_BYTES`/`RECEIPT_RETENTION_DAYS` present |
| Litestream reuses `B2_*` env | `render.yaml`; `run-with-litestream.mjs` — **must not be removed** |
| Test commands | `pnpm -r test` (bot: `vitest run`), `pnpm -r build` (`tsc && copy-assets`), `pnpm --filter bot typecheck` |
| Heavy deps are receipt-only | `sharp`, `@zxing/library` → `ingestion.service.ts:1,2`; `pdfkit` **also** used by `admin.ts:1085` (keep) |

---

## 2. Workstream map

| # | Workstream | Risk | Depends on |
|---|---|---|---|
| **A1** | Mini App → reference-based checkout via `/api/receipts/verify` | Low (additive) | — |
| **A2** | Retire image pipeline (bot, API, storage, admin, deps) | High | A1 validated |
| **B** | Remove Abyssinia rail; keep Telebirr + CBE | Medium | — |
| **C** | Rewrite Telebirr receipt parser | Medium | dev diagnostic |
| **D** | Telebirr fail-fast, proxy config errors, env plumbing | Low | — |
| **E** | Litestream snapshot/retention | Low | — |
| **F** | Wire dead auto-verify switch | Low | D |
| **G** | Tests, docs, hygiene, graphify | Medium | all |

**A1 runs first and is purely additive** — if A2 later breaks something, buyers are already on the new path.

---

## 3. Workstream A1 — Mini App reference checkout (additive)

Goal: buyers submit a transaction reference instead of a screenshot; orders flow through the orchestrator with auto-verify and manual fallback.

1. **`webapp/src/api.ts`** — `submitReceiptApi` (`:224`): stop sending `receiptImageBase64`; POST to `/api/receipts/verify` with `{ orderId, reference, note }`. Surface RFC 7807 `title` / `detail` / `remediation_hint` from the error body (endpoint returns `application/problem+json`).
2. **`webapp/src/App.tsx`** — replace the Step 3 dropzone (`:1326–1341`) and its `receiptBase64` state (`:229`) with a reference text field. Remove the `handleReceiptFileChange` FileReader (`:493–499`) and the preview `<img>`. Gate the submit button on reference validity, not on a base64 string. Update `handleSubmitReceipt` (`:469`).
3. **Rail-aware client validation** — Telebirr `^[A-Z0-9]{10,14}$`; CBE `^FT\d{6,}$` (align with existing extraction in `ingestion.service.ts`). Show a specific hint per rail instead of one generic message.
4. **`webapp/src/i18n.ts`** — replace `uploadReceipt`, `uploadReceiptSub`, `tapToUpload`, `step3Title`, `step3Receipt`, `nextReceipt` in **both** `en` and `am` bundles with reference-entry equivalents. Keep `paymentSubmittedDesc` semantics: on `200` → auto-verified; on problem+json with `needsAdminReview` semantics → "under review".
5. **Admin order-detail receipts** — `webapp/src/admin/Orders.tsx` / `AuditEvidenceModal.tsx` reference receipts; confirm they display evidence (reference/amount/status), not images, and that no admin view depends on `/orders/:id/receipt` after A2. Adjust in A2 if a link points at the deleted endpoint.

**Do not** change the server in this workstream. Validate in development: a real Telebirr reference typed into the Mini App must reach the orchestrator.

---

## 4. Workstream A2 — Retire the image pipeline

Verification never requires an image; `extractSubmissionReference` (`orchestrator.service.ts`) already prefers `directReference`.

**Delete, in order, re-running `pnpm --filter bot typecheck` after each step:**

1. **Boot sync** — `bot/src/index.ts`: remove import (`:8`) and the `await syncReceiptsFromRemote()` block (`:35–40`).
2. **Orchestrator** — `receipt_verifier/orchestrator.service.ts`: drop `saveReceiptImage` / `resolveStoredReceiptPath` imports (`:21`). Convert `persistEvidenceArtifact` (`:319–339`) to **hash-only** persistence (SHA-256 of the buffer for `file_hash`; no disk write, no `file_path`). The `reverifyOrder` disk-candidate loop (`:208–245`) may stay — it is `fs.existsSync`-guarded and no-ops when files are gone.
3. **Storage** — delete `bot/src/services/storage.service.ts`. Confirm zero remaining importers first.
4. **Mini App upload endpoint** — `bot/src/api/server.ts`: remove the `/api/receipt` mount (`:406–412`) and `handleReceiptUpload` (`:89–153`), plus the `saveReceiptImage` / `ReceiptValidationError` import (`:37`). **A1 already migrated the client.**
5. **Receipts service** — delete `bot/src/services/receipts.service.ts` once 2–6 are done. Exports removed: `saveReceiptImage`, `resolveStoredReceiptPath`, `resolveReceiptsDir`, `purgeOldReceipts`, `ReceiptValidationError`, `detectImageExtension`.
6. **Admin viewer** — `bot/src/api/admin.ts`: delete `serveOrderReceipt` (`:614–685`), `GET /orders/:id/receipt` (`:686`), `GET /orders/:id/receipt-link`, `GET /receipt-dl/:payload/:sig` (`:~705–720`), and the `resolveStoredReceiptPath` import (`:8`). Confirm sole use of `download_tokens.service.ts`; delete it if unreferenced.
7. **Admin alert cards** — `bot/src/bot/handlers/checkout.ts`: drop the `resolveStoredReceiptPath` import (`:4`) and the photo-attach branches in `notifyAdminsNewReceipt` (`:563–585`) and `notifyAdminsVerificationFallback` (`:680–710`); always send the text card built by `splitTelegramCaption`.
8. **Ingestion — reference only** — `receipt_verifier/ingestion.service.ts`: delete `ingestBuffer` (`:87–`), `testQrMatrix` (`:142–`), the `sharp` / `zxing` imports (`:1–2`) and all QR/PDF preprocessing helpers. **Keep `ingestText` (`:124–`) exactly as is** — it is the live path. Update `IReceiptIngestionService` in `types.ts`.
9. **Verify API trim** — `api/receipts.ts`: remove `parseBase64Payload` (`:130–163`), the `receiptBase64` branch in `/verify` (`:~233–250`), and the `/test-qr` endpoint (`:310+`). Keep `/verify` and `/status/:orderId`.
10. **Maintenance** — `services/maintenance.service.ts`: remove the `purgeOldReceipts` import (`:3`) and call (`:~47`); keep every other cleanup job.
11. **Env** — `config/env.ts`: drop `RECEIPTS_DIR` (`:123`), `RECEIPT_MAX_BYTES` (`:124`), `RECEIPT_RETENTION_DAYS` (`:132–137`) and the pass-through block (`:247–249`). **Keep** `RECEIPT_RETENTION_DAYS_RAW_PAYLOADS` and `RECEIPT_RETENTION_DAYS_UNVERIFIED` (audit-table retention, unrelated). **Keep all `B2_*` / `LITESTREAM_*`** — Litestream needs them.
12. **`.env.example`** — remove `RECEIPTS_DIR` (`:57`) and the image retention/size block (`:195–200`). Update the stale "manual photo receipt upload" rail descriptions (`:26–28`).
13. **Dependencies** — remove `sharp` and `@zxing/library` from `bot/package.json`; audit and remove `pdf-parse` (zero imports today). **Keep `pdfkit`** (`admin.ts:1085`) and **`cheerio`** (portal HTML parsing in both adapters). Remove `sharp` from `pnpm-workspace.yaml` `allowBuilds` / `onlyBuiltDependencies` if nothing else needs it.
14. **`render.yaml`** — update the "Receipt Persistence" comment on the B2 block (DB replication remains).
15. **Data** — `data/receipts/` may be cleared at deploy. Leave the B2 `receipts/` prefix orphaned as historical evidence; reachable via B2 console. No DB migration.

**Acceptance:** `pnpm -r build` + `pnpm -r test` green, and
```
git grep -n "saveReceiptImage\|resolveStoredReceiptPath\|syncReceiptsFromRemote\|uploadReceiptToRemote\|purgeOldReceipts" bot/src
```
returns nothing.

---

## 5. Workstream B — Remove the Abyssinia rail

Keep **Telebirr** and **CBE** only.

1. **Rail definitions** — `orders.service.ts:11–13` (`ActivePaymentRail`, `ACTIVE_PAYMENT_RAILS`); `checkout.ts:17` `VALID_PAYMENT_RAILS`; drop `'abyssinia'` from both. `checkout.ts:141–142` (fallback-to-telebirr branch) and `:237` `handleManualRail` signature.
2. **Types** — `receipt_verifier/types.ts`: `SupportedBank` keeps `'abyssinia'` only if a historical DB value may still exist (it may — rows exist). **Decision: keep the union member for back-compat, remove it from all *selectable* surfaces.** Never make historical evidence unreadable.
3. **Beneficiary config** — `receipt_verifier/constants.ts` `BANK_BENEFICIARY_CONFIG_MAP`: remove the `abyssinia` entry; make the type accept it as optional.
4. **Payout API** — `api/server.ts:583–585` (allowed methods) and `:751` (discontinued message).
5. **Settings** — remove `abyssinia_account` from allow-lists in `settings.service.ts` and from the admin settings surface (`api/admin.ts`); leave the stored row alone.
6. **Copy** — `formatters.ts:89,109`; `support.ts:27,76`; `start.ts:108`; `inline_query.ts:117`; `bot.ts:461`; `admin.ts:216–230`. Both i18n bundles.
7. **`.env.example`** — remove `RECEIPT_ABYSSINIA_BENEFICIARIES` (`:190`).

**Never** delete a migration or drop a column — historical `receipt_evidence` rows may reference the rail.

---

## 6. Workstream C — Rewrite the Telebirr receipt parser

The most important workstream. Target `telebirr.adapter.ts` `parseHtmlResponse` and `parseEthiopianBankTimestamp` (`constants.ts`).

**C0 — Dev-only diagnostic (do this first, before rewriting).**
Add a diagnostic route/script, mounted **only** when `NODE_ENV === 'development'`, that fetches a real receipt through the adapter and prints each extracted field next to the raw label it came from. Guard it hard: development-only, rate-limited, never mounted in production, and it must log the *reference* only in development. Purpose: run it against several real references from this machine (which egresses from `AS24757` in Addis Ababa) and confirm every field before finalizing tests.

**C1 — Parser rewrite.**

1. **Header-row / value-row table handling.** Detect the invoice table by its bilingual header labels, then zip the header row's cells against the following value row's cells positionally. Do not rely on per-row first/last-cell heuristics.
2. **Bilingual label matching.** Every label is `Amharic/English`. Match on the **English segment after the `/`** (e.g. `የከፍያ ቀን/Payment date` → `payment date`), and additionally accept the Amharic prefix as a fallback for resilience. Normalize: lowercase, strip non-alphanumerics, collapse whitespace.
3. **Field map (verified against a live receipt):**
   | Target | Label on receipt |
   |---|---|
   | Reference | `የክፍያ ቁጥር/Invoice No.` |
   | Payment date | `የክፍያ ቀን/Payment date` |
   | Settled amount | `የተከፈለ መጠን/Settled Amount` |
   | Total paid | `ጠቅላላ የተከፈለ/Total Paid Amount` |
   | Payer name | `የከፋይ ስም/Payer Name` |
   | Credited party name | `የገንዘብ ተቀባት ስም/Credited Party name` |
   | Credited account (masked) | `የገንዘብ ተቀባት ቴሌብር ቁ./Credited party account no` |
   | Status | `የክፍያው ሁኔታ/transaction status` → `Completed` |
4. **Settled vs total.** The security gate must compare **Settled Amount**. Parse both; use settled for the amount pillar. On a real receipt: settled `1,000`, total paid `1,004` (fee `3.48` + VAT `0.52`) — comparing against total would fail every round-number order.
5. **Masked account → name-based beneficiary validation** (decision taken). Populate `BankTransactionPayload.beneficiaryName` from `Credited Party name`. For Telebirr, `security_gate.service.ts` `assertBeneficiary` compares a normalized form of the credited-party name against an admin-configured whitelist; the numeric account is no longer authoritative for this rail. **CBE keeps strict numeric account matching.** Add a dedicated settings key for the Telebirr name whitelist and surface it in the admin settings allow-list.
6. **Never return `new Date()` on parse failure.** If the timestamp cannot be parsed, the recency pillar must fail closed (`RECEIPT_EXPIRED` / parse-failure code), not silently pass. A silent `new Date()` turns the recency check into a no-op — that is the security regression in §1.2.
7. **Fail loudly on unrecognized layout.** If fewer than the required fields resolve, raise an explicit parse-failure error routed to manual review, rather than returning a partially-populated payload that could slip past a pillar.
8. **Status check.** If `transaction status` is not `Completed`, treat as a failed payment (do not fulfill).

**C2 — `parseEthiopianBankTimestamp`:** add `DD-MM-YYYY` (and `DD-MM-YYYY HH:mm:ss`) support. Keep EAT `+03:00` pinning.

**C3 — Tests:** unit tests over a **redacted** committed fixture (structure preserved; all names, accounts, references scrubbed) plus synthetic text-only cases. Cover: settled-vs-total selection, masked-account name extraction, dash-date parsing, missing-timestamp fail-closed, non-`Completed` status, and an unrecognized-layout error.

> **Data handling:** real receipts contain live payer names and partial account numbers. Never commit raw receipt HTML, never place a real reference in a test or fixture, never log payer PII. Use synthetic references everywhere.

---

## 7. Workstream D — Telebirr fail-fast and env plumbing

1. **`BANK_PORTAL_TIMEOUT_MS`** — add to the `env.ts` zod schema: `z.coerce.number().int().min(1000).max(30000).default(8000)`. Document in `.env.example`. Thread at the call site: `orchestrator.service.ts` `adapter.verify(extractedData)` → `adapter.verify(extractedData, { timeoutMs: getConfig().BANK_PORTAL_TIMEOUT_MS })`. Both adapters already honour `options.timeoutMs`; no signature change.
2. **`TELEBIRR_PROXY_URL` in the schema** — `z.string().optional()` with a refine permitting **only** `http://` / `https://`. `HttpsProxyAgent` is HTTP-CONNECT only. Correct the `socks5://` examples in `DEPLOYMENT-RUNBOOK.md:191,235` (see G2). Preserve the existing fallback chain at `telebirr.adapter.ts:86`.
3. **Proxy config errors are not geoblocks** — at `telebirr.adapter.ts:97–103`, a failing `new HttpsProxyAgent(...)` currently logs a warning and **silently continues with direct egress**. Change to abort with a distinct configuration-class failure carrying a remediation hint naming `TELEBIRR_PROXY_URL` and the allowed schemes. Update `isProxyFailure` so a malformed URL is never reported as `PORTAL_GEOBLOCKED`.
4. **Production egress warning** — when `NODE_ENV === 'production'` and no proxy is configured, log one clear warning at boot: Telebirr auto-verification will fail `PORTAL_GEOBLOCKED` and route to manual review. Warn only; never crash.
5. **Do not change** fallback routing: `BANK_PORTAL_UNAVAILABLE` / `PORTAL_GEOBLOCKED` → `upstream_failure` → `pending_approval` + admin action card. Manual review is the safety net and it already works.

---

## 8. Workstream E — Litestream tuning

`scripts/run-with-litestream.mjs` — add to the generated replica block:
```yaml
snapshot-interval: 1h
retention: 72h
retention-check-interval: 1h
```
Keep `sync-interval: 1s`. Add a brief comment noting B2 Class-C transaction volume. Nothing else changes; the bot still boots directly when B2 creds are absent.

---

## 9. Workstream F — Wire the dead auto-verify switch

`receipt_auto_verify_enabled` is admin-toggleable but enforced nowhere. **Wire it.** When the setting is `'0'`, skip the upstream adapter call and route the submission straight to manual review with a clear reason, so the dashboard toggle has real effect. Reuse the existing fallback path rather than inventing a new one.

---

## 10. Workstream G — Tests, docs, hygiene

**G1 — Tests.** Delete image-only coverage: `receipt_verifier_phase4.test.ts`, image cases in `receipt_verifier_qa_edge_cases.test.ts`, `receipt_persistence_phase3.test.ts`, image cases in `hardening_suite.test.ts` (`:10,78–99`) and `phase5.test.ts` (`:341`), and image fixtures in `bot/tests/factories/receipt_data.factory.ts`. Rewrite `receipt_endpoint.test.ts` for the reference-only contract. Keep and extend `receipt_sms_intake.test.ts` (core path), `receipt_reverification_flow.test.ts` (reference-only), `network_infrastructure_phase5.test.ts` (+ timeout override, + proxy config-error class, + socks5 rejection), `env.test.ts` (+ new keys, − removed keys).

**G2 — Docs.** `docs/ARCHITECTURE-RECEIPT-VERIFICATION.md` — reference-only ingestion, bilingual label map, masked-account design. `docs/devops/DEPLOYMENT-RUNBOOK.md` — http(s)-only proxy scheme, drop image-persistence rows, document `scripts/test-bank-egress.sh` for egress evaluation, reference the **official Telebirr H5 C2B API** as the long-term replacement for scraping.

**G3 — Telebirr merchant onboarding note.** Add a short doc capturing the long-lead-time path: business license, short code, signatory details, **in-person proposal submission at the Telebirr office**, then testbed → production, with production gateway `superapp.ethiomobilemoney.et:38443`. The integration is push-based (`notifyUrl` + server-to-server `getOrderStatus`), so it eliminates the geo-block permanently.

**G4 — Hygiene.** `git rm -r missing_env/` (verified secret-free). Ensure `.gitignore` covers `.env*` except `.env.example`.

**G5 — Finish.** `graphify update .`, then `pnpm -r build`, `pnpm --filter bot typecheck`, `pnpm -r test`. Review `git status` — only intended files. Never stage the pre-existing `graphify-out` stamp or `.opencode/`.

---

## 11. Telebirr egress strategy (production)

No proxy provider is committed by this plan. Volume math: a receipt page ≈ 30–80 KB; ~1,000 verifications/month ≈ 50 MB.

| Phase | Approach | Cost |
|---|---|---|
| **Development** | This machine — `AS24757`, Addis Ababa. Portal returns HTTP 200. Validate the real parser against real receipts at no cost. | Free |
| **Interim (production)** | Ethiopian residential proxy via `TELEBIRR_PROXY_URL` (IPRoyal ~$1.75/GB, ProxyEmpire $0.75/GB, DataImpulse $1.00/GB). Trial first, then pay. **No code change needed** — D is already in place. | ≈ $0.05–0.09/mo |
| **Long term** | Official Telebirr H5 C2B API — push-based, no scraping, no geo-block. | Facilitation fee |

Excluded permanently: free public proxy lists, `X-Forwarded-For` spoofing, cheki, third-party verify SaaS, and "Ethiopian VPS" resellers.

---

## 12. Guardrails

- **Never touch:** admin fulfillment-proof photo flow (`input.ts:618,727`), broadcast photo drafts (`:608`), CSV import, the 4-pillar gate semantics, breaker semantics, the anti-replay index, Litestream's `B2_*` env keys, or any existing migration.
- **No destructive migration.** `orders.receipt_file_id`, `receipt_evidence.file_path`, `file_hash` stay for historical audit; stop writing, never drop.
- `git grep` every symbol before deleting a file.
- No real Telebirr reference, payer name, or account fragment in code, tests, fixtures, or logs.
- The dev diagnostic is **development-only** and must not be reachable in production.
- Every workstream ends green: `pnpm --filter bot typecheck` and `pnpm -r test`.
- Work on a feature branch per workstream; `master` stays clean.

---

## 13. Acceptance criteria

- [ ] A real Telebirr reference submitted from the Mini App auto-verifies; a bad one routes to manual review with a readable reason.
- [ ] Parser extracts reference, settled amount, beneficiary name, and a correct EAT timestamp from a real receipt.
- [ ] Recency pillar fails closed on an unparseable timestamp.
- [ ] Beneficiary check passes on credited-party name for Telebirr, numeric account for CBE.
- [ ] Abyssinia no longer selectable anywhere; historical evidence still readable.
- [ ] `git grep` for the deleted image symbols returns nothing.
- [ ] `TELEBIRR_PROXY_URL` set to a malformed value yields a config-error, not a geoblock.
- [ ] `receipt_auto_verify_enabled = 0` demonstrably forces manual review.
- [ ] Litestream emits `snapshot-interval` / `retention`.
- [ ] `pnpm -r build`, `pnpm --filter bot typecheck`, `pnpm -r test` all green.
- [ ] `git status` shows only intended changes.
