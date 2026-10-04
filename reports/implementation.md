# Implementation — Receipt Verifier, Phased Execution Plan

**Repo:** Bighabesha Shop — pnpm workspace (`bot/`, `webapp/`)
**Target:** `origin/master` @ `f118b8f` (merge of PR #3 `feat/bank-receipt-verification`)
**Companion doc:** `reports/00-implementation-plan.md` — full findings, evidence, rationale
**Written:** 2026-09-28

---

## How to execute this document

**Phase order is fixed: P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8. Do not begin a phase until the previous one is signed off.**

For every phase:

1. **Branch** — `feat/<phase-slug>` off the current `main`line. Never work on `master`.
2. **Implement** — only the changes listed in that phase. Not adjacent cleanup, not "while I'm here."
3. **Gate** — run the automated check. It must be fully green.
4. **Commit** — one commit, conventional message, phase scope only.
5. **Report & wait** — present the smoke checklist to the operator and **stop**. Do not begin the next phase until they confirm.

### The automated gate (every phase)

```bash
pnpm -r build
pnpm --filter bot typecheck
pnpm -r test
```

All three must exit 0 with no new failures. Record the pre-existing baseline in P0 — if a test was already failing before the phase, it stays out of scope unless the phase was meant to fix it.

### Failure policy

**If the gate fails: stop immediately.** Do not attempt a workaround, do not leave a half-finished phase, do not start the next phase. Report:
- exact command and error output
- which phase and which step
- what you believe the cause is
- what you would try next

Wait for a decision. Rollback is `git checkout mainline` — the phase branch is discarded.

### Universal rules — every phase, no exceptions

- **Never** modify: admin fulfillment-proof photo flow (`bot/src/bot/handlers/input.ts:618,727`), broadcast photo drafts (`:608`), CSV import, the 4-pillar gate semantics, circuit-breaker semantics, the anti-replay index, Litestream's `B2_*` env keys, or any existing migration file.
- **No destructive migrations.** Columns are historical audit data. Stop writing to them; never drop them.
- **Never** commit real Telebirr references, payer names, account fragments, or raw receipt HTML. Test data is synthetic.
- **Never** stage or commit pre-existing working-tree noise: `graphify-out/cache/last_query_stamp` (modified) and `.opencode/` (untracked). Leave them exactly as found.
- **Never** print or log local `.env` secrets.
- Re-read the file before editing it. Line numbers below are verified at `origin/master`; re-grep if a step looks off.

### P1-specific rule — real receipt handling

Phase 1 validates against the live Telebirr portal from the operator's Ethiopian connection. Real receipts contain live payer names and partial account numbers. Handle accordingly: work locally, never commit captured HTML, never paste a real reference into a test or a log that gets committed. Prefer ephemeral in-memory validation over writing files to disk.

---

## Phase 0 — Sync and baseline

**Goal:** get onto the correct tree and record the starting state. Nothing is modified.

### Why first

Local `master` is **0 ahead / 14 behind** `origin/master`. The entire `receipt_verifier` engine does not exist in the working copy. Every other phase's file references are invalid until this is done.

### Steps

1. Sync:
   ```bash
   git checkout master
   git pull --ff-only
   git rev-parse HEAD          # expect f118b8f…
   git rev-list --count HEAD..origin/master   # expect 0
   ```
   If the fast-forward refuses, **stop and report** — do not force, do not reset.

2. Confirm the pre-existing noise is still just that:
   ```bash
   git status --porcelain
   # expect exactly:
   #  M graphify-out/cache/last_query_stamp
   #  ?? .opencode/
   ```

3. Baseline:
   ```bash
   pnpm install --frozen-lockfile
   pnpm -r build
   pnpm --filter bot typecheck
   pnpm -r test
   ```

4. Record the baseline: commit SHA, and the full pass/fail list from `pnpm -r test`. Note any pre-existing failures — they are out of scope unless a later phase targets them.

5. Sanity-check the engine is present:
   ```bash
   ls bot/src/services/receipt_verifier/
   git grep -c "processSubmission" -- bot/src
   ```

### Check

- HEAD is `f118b8f…`, 0 behind.
- `bot/src/services/receipt_verifier/` contains `orchestrator.service.ts`, `adapters/telebirr.adapter.ts`, `adapters/cbe.adapter.ts`, `circuit_breaker.ts`, `breaker_config.ts`, `security_gate.service.ts`, `ingestion.service.ts`, `types.ts`, `constants.ts`, `index.ts`.
- Baseline captured and written down.

### Commit

None. Phase 0 produces no commit.

### Report to operator

Baseline commit SHA, test results, confirmation the verifier exists. **Wait for confirmation.**

---

## Phase 1 — Rewrite the Telebirr receipt parser

**Goal:** make `TelebirrAdapter` able to read a real Telebirr receipt. This is the highest-value phase — today the parser cannot, and in production it would reject every Telebirr payment.

**Branch:** `feat/telebirr-parser-rewrite`

### Why first

Validated live on 2026-09-28 from the operator's machine (`196.189.29.224`, Addis Ababa, `AS24757 Ethio Telecom` — portal returns HTTP 200 in ~0.3s). The adapter's `parseHtmlResponse` does a per-row key/value map:

```ts
const th = $(row).find('th, td:first-child').text().trim().toLowerCase();
const td = $(row).find('td:last-child').text().trim();
dataMap[th] = td;
```

A real receipt does not match this shape. Observed failures:

| Field | Adapter looks for | Real receipt has | Result |
|---|---|---|---|
| Reference | `dataMap['receipt number'\|'transaction number'\|'transaction id'\|'ref no']` | `የክፍያ ቁጥር/Invoice No.` | Miss → falls back to input ref (right value, wrong mechanism) |
| Amount | `dataMap['amount'\|'transferred amount'\|'payment amount'\|'total amount']` | `የተከፈለ መጠን/Settled Amount` → `1,000 Birr` | Accidentally right via regex; order-dependent, fragile |
| Beneficiary account | `dataMap['credited party'\|…]`, `\b(09[0-9]{8})\b` | `…Credited party account no` → `2519****9045` | **Fails — empty** |
| Timestamp | `dataMap['payment time'\|'date']`; ISO + slash regexes | `የክፍያ ቀን/Payment date` → `01-09-2026 00:41:13` | **Fails — returns `new Date()`** |

Root causes:
1. **Layout** — invoice table is header-row/value-row: three labels in one `<tr>`, three values in the next. Per-row first→last mapping yields `dataMap["<ref>"] = "<amount>"`. No configured key can ever match.
2. **Bilingual labels** — every label is `Amharic/English`. No English-only key matches.
3. **Date format** — dashes (`DD-MM-YYYY`). `parseEthiopianBankTimestamp` handles `YYYY-MM-DD`, `DD/MM/YYYY`, `YYYY/MM/DD` — **not** dashes. Two stacked bugs.

Consequences: beneficiary whitelist evaluates empty → `BENEFICIARY_MISMATCH` on every Telebirr payment. Recency pillar compares *now* to *now* — a no-op that cannot catch a stale receipt reused on a fresh order.

### Step 1.1 — Dev-only diagnostic (build first, before rewriting)

Create a diagnostic that fetches a real receipt through the adapter and prints each extracted field beside the raw label it came from. This is how the rewrite gets validated.

- Mount **only** when `NODE_ENV === 'development'`. Assert this at module load; refuse to mount otherwise.
- Rate-limit it. It must not become an open verification oracle.
- Print the reference being tested only in development.
- Do **not** persist captured HTML to disk or logs.

Natural home: a small script under `bot/scripts/`, invoked manually — lower risk than an HTTP route. If an HTTP route is chosen instead, it must sit behind the existing admin auth *and* the `NODE_ENV` guard.

### Step 1.2 — Bilingual label normalization

Add a helper that takes a raw label cell and returns matchable keys:
- Take the segment **after** the `/` (English), lowercased.
- Also keep the segment **before** the `/` (Amharic) as a fallback key.
- Strip punctuation, collapse whitespace, strip trailing colons.
- Result: `የክፍያ ቀን/Payment date` → keys `payment date`, `የክፍያ ቀን`.

### Step 1.3 — Header-row / value-row invoice table

Stop relying on per-row heuristics. Locate the invoice table by its header labels, then zip header cells against the following value row positionally.

Verified field map:

| Target | Label on receipt |
|---|---|
| Reference | `የክፍያ ቁጥር/Invoice No.` |
| Payment date | `የክፍያ ቀን/Payment date` |
| Settled amount | `የተከፈለ መጠን/Settled Amount` |
| Total paid | `ጠቅላላ የተከፈለ/Total Paid Amount` |
| Payer name | `የከፋይ ስም/Payer Name` |
| Credited party name | `የገንዘብ ተቀባት ስም/Credited Party name` |
| Credited account (masked) | `የገንዘብ ተቀባት ቴሌብር ቁ./Credited party account no` |
| Payer account (masked) | `የከፋይ ቴሌብር ቁ./Payer telebirr no.` |
| Service fee | `የአገልግሎት ክፍያ/Service fee` |
| Status | `የክፍያው ሁኔታ/transaction status` |

### Step 1.4 — Settled vs total

Parse **both**. The amount pillar must use **Settled Amount**. On the reference receipt: settled `1,000`, total paid `1,004` (fee `3.48` + VAT `0.52`). Using total would fail every round-number order with `AMOUNT_MISMATCH`.

Populate `BankTransactionPayload.amountEtb` from settled. Keep total available in `rawAuditTrail` for the admin evidence view.

### Step 1.5 — Masked account → name-based beneficiary

Real receipts expose `2519****9045`. **No parser can recover the full number.** The credited-party **name** is fully visible.

**Decision (operator-confirmed):** Telebirr beneficiary validation matches on **credited-party name**. CBE keeps strict numeric account matching — this phase must not alter CBE behaviour.

1. Populate `BankTransactionPayload.beneficiaryName` from `Credited Party name`.
2. `security_gate.service.ts` — for the Telebirr rail, compare a normalized credited-party name against an admin-configured name whitelist.
3. Add a dedicated settings key (e.g. `receipt_telebirr_beneficiary_names`) and register it in the `settings.service.ts` allow-list (`:164`, `:196` region) plus the admin settings surface. Mirror how the CBE beneficiary setting is exposed.
4. Normalize both sides: case-fold, strip diacritics, collapse whitespace, strip honorifics/titles if present.
5. On a name mismatch, keep the existing `BeneficiaryMismatchError` path — do not invent a new code.

### Step 1.6 — Fail closed on unparseable timestamp

Remove the `return new Date()` fallback. If the timestamp cannot be parsed, raise an explicit parse failure routed to manual review. A silent "now" turns the recency pillar into a no-op — a security regression, not cosmetics.

### Step 1.7 — Fail loudly on unrecognized layout

If fewer than the required fields resolve, raise a parse-failure error routed to manual review. Never return a partially-populated payload that could slip past a pillar.

### Step 1.8 — Status check

If `transaction status` is not `Completed`, treat as unpaid. Do not fulfill. Route to manual review with a clear reason.

### Step 1.9 — `parseEthiopianBankTimestamp` dash support

In `bot/src/services/receipt_verifier/constants.ts`, add `DD-MM-YYYY` and `DD-MM-YYYY HH:mm:ss`. Keep the EAT `+03:00` pinning — Ethiopian banking portals emit local time without a zone, and UTC-naive parsing causes false `RECEIPT_EXPIRED`.

### Step 1.10 — Tests

- Redacted HTML fixture: capture real receipt structure, **scrub every name, account, and reference**. Commit that. Never the raw capture.
- Synthetic text/SMS cases for `ingestText` — unchanged behaviour, guard against regression.
- Cover: settled-vs-total selection; masked-account name extraction; `DD-MM-YYYY` parsing; missing timestamp → fail closed; non-`Completed` status; unrecognized layout → error; name whitelist match and mismatch.
- Keep the diagnostic out of the test path.

### Check

```bash
pnpm -r build && pnpm --filter bot typecheck && pnpm -r test
```

Then, via the diagnostic against **several real references from the operator's Ethiopian connection**, confirm every field extracts correctly: reference, settled amount, credited party name, EAT timestamp, status.

### Commit

`fix(receipts): rewrite Telebirr receipt parser for real portal layout`

### Report to operator

Show the extracted-field output for each reference tested (values redacted in the report where they are sensitive), list which tests were added, confirm the gate result. **Wait for confirmation.**

---

## Phase 2 — Telebirr fail-fast and env plumbing

**Goal:** bad configuration must not masquerade as a geo-block, and the network timeout must be tunable without a code change.

**Branch:** `feat/telebirr-failfast-env`

### Step 2.1 — `BANK_PORTAL_TIMEOUT_MS`

- `bot/src/config/env.ts` — add to the zod schema: `z.coerce.number().int().min(1000).max(30000).default(8000)`.
- `.env.example` — document near the receipt-verification block, noting it replaces the hard-coded `DEFAULT_BANK_NETWORK_TIMEOUT_MS` in `constants.ts:13` as the effective value.
- Thread it at the call site in `orchestrator.service.ts` — `adapter.verify(extractedData)` becomes `adapter.verify(extractedData, { timeoutMs: getConfig().BANK_PORTAL_TIMEOUT_MS })`. Both adapters already honour `options.timeoutMs`; **no adapter signature change.**
- Confirm CBE picks this up too — it shares the base adapter default.

### Step 2.2 — `TELEBIRR_PROXY_URL` into the schema

- `env.ts` — `z.string().optional()` with a refine allowing **only** `http://` and `https://`. `HttpsProxyAgent` is HTTP-CONNECT only; `socks5://` cannot work.
- Preserve the existing runtime fallback chain in `telebirr.adapter.ts:86`: `options.proxyUrl` → `TELEBIRR_PROXY_URL` → `ETHIOPIA_PROXY_URL` → `receipt_ethiopia_proxy_url` setting.

### Step 2.3 — Proxy config errors are not geoblocks

In `telebirr.adapter.ts:97–103`, a failing `new HttpsProxyAgent(...)` currently logs a warning and **silently continues with direct egress** → guaranteed 403 → mislabeled `PORTAL_GEOBLOCKED`. Operators then debug the wrong problem.

- Change to abort with a distinct configuration-class failure.
- Carry a remediation hint naming `TELEBIRR_PROXY_URL` and the two permitted schemes.
- Update `isProxyFailure` so a malformed URL is never reported as `PORTAL_GEOBLOCKED`.
- Keep `PORTAL_GEOBLOCKED` strictly for genuine portal-side blocking (403/451, Cloudflare challenge pages, country-blocked bodies).

### Step 2.4 — Production egress warning

When `NODE_ENV === 'production'` and no proxy is configured, log **one** clear warning at boot: Telebirr auto-verification will fail `PORTAL_GEOBLOCKED` and route to manual review. Warn only — never crash, never block startup. Manual review is a valid steady state.

### Step 2.5 — Tests

Extend `bot/tests/network_infrastructure_phase5.test.ts` (it already manipulates `TELEBIRR_PROXY_URL`):
- `BANK_PORTAL_TIMEOUT_MS` is honoured and reaches the adapter.
- A malformed `TELEBIRR_PROXY_URL` produces a config-error, not a geoblock.
- A `socks5://` URL is rejected by schema validation.
- No proxy configured + 403 → `PORTAL_GEOBLOCKED` (unchanged).

Extend `bot/tests/env.test.ts` for the new key and its bounds.

### Check

```bash
pnpm -r build && pnpm --filter bot typecheck && pnpm -r test
```

### Commit

`feat(receipts): env-configurable bank timeout, proxy scheme validation, config-error class`

### Report to operator

Confirm the new env keys, the error-code distinction, and test results. **Wait for confirmation.**

---

## Phase 3 — Wire the dead auto-verify switch

**Goal:** an admin toggle that currently does nothing should do what it says.

**Branch:** `feat/wire-auto-verify-switch`

### Context

`receipt_auto_verify_enabled` is seeded (`migrations/011:174`, `seed.ts:87`), allow-listed (`settings.service.ts:164,196,217`), and toggled in the dashboard (`webapp/src/admin/AdminDashboard.tsx:3087–3117`) — but **no enforcement read-site exists anywhere in `bot/src`**. It is a dead switch.

### Step 3.1 — Enforce it

At the orchestrator entry (`processSubmission`, `receipt_verifier/orchestrator.service.ts:102`):
- When the setting is `'0'`, skip the upstream adapter call entirely.
- Route straight to the existing manual-review path with a clear reason, so admins see why.
- Reuse `handleFallback` and the existing status vocabulary — do not invent new statuses or codes.

### Step 3.2 — Keep live reconfiguration working

`refreshReceiptOrchestratorSettings()` (`receipt_verifier/index.ts:47`) is invoked from `api/admin.ts:992` when breaker settings change. Ensure the new toggle is honoured on change without a restart, consistent with the existing behaviour.

### Step 3.3 — Tests

- Setting `'1'` (default) → adapter called, normal flow.
- Setting `'0'` → adapter not called, order lands in `pending_approval`, admin alert fired with a legible reason.
- Toggle applied at runtime without process restart.

### Check

```bash
pnpm -r build && pnpm --filter bot typecheck && pnpm -r test
```

### Commit

`feat(receipts): enforce receipt_auto_verify_enabled setting`

### Report to operator

Explain the before/after behaviour of the toggle and show test evidence. **Wait for confirmation.**

---

## Phase 4 — Mini App reference checkout

**Goal:** buyers submit a transaction reference instead of a screenshot. **Additive only — no server deletion in this phase.**

**Branch:** `feat/miniapp-reference-checkout`

### Why this phase exists

The Telegram bot already retired buyer photo intake (`input.ts:50,62,275,670,704`), but the **Mini App cannot complete checkout without a screenshot**: `App.tsx:470` — `if (!checkoutOrder || !receiptBase64) return;`. File dropzone at `App.tsx:1333`, POSTing `receiptImageBase64` to `/api/receipt` (`api.ts:226,230`) → `server.ts:89 handleReceiptUpload`, which **never calls the orchestrator** — manual review only.

`/api/receipts/verify` (`api/receipts.ts:174`) already accepts `{orderId, reference, note}`, calls the orchestrator, alerts admins on fallback (`:271`), and has stronger auth (buyer **or** admin, `:220`) than `/api/receipt`. **No server rewrite is needed in this phase** — only the client.

### Step 4.1 — `webapp/src/api.ts`

`submitReceiptApi` (`:224`): stop sending `receiptImageBase64`; POST to `/api/receipts/verify` with `{ orderId, reference, note }`. Surface RFC 7807 `title` / `detail` / `remediation_hint` from the `application/problem+json` response — the endpoint already returns them.

### Step 4.2 — `webapp/src/App.tsx`

- Replace the Step 3 dropzone (`:1326–1341`) and `receiptBase64` state (`:229`) with a reference text field.
- Remove `handleReceiptFileChange` (`:493–499`) and the base64 preview `<img>`.
- Update `handleSubmitReceipt` (`:469`) — gate on reference validity, not on a base64 string being present.
- Success path (`200`) → auto-verified. Problem path → "under review" messaging consistent with existing `paymentSubmittedDesc` semantics.

### Step 4.3 — Rail-aware validation

- Telebirr: `^[A-Z0-9]{10,14}$`
- CBE: `^FT\d{6,}$`

Align with existing extraction in `ingestion.service.ts`. Show a **rail-specific** hint rather than one generic message.

### Step 4.4 — i18n

`webapp/src/i18n.ts` — replace `uploadReceipt`, `uploadReceiptSub`, `tapToUpload`, `step3Title`, `step3Receipt`, `nextReceipt` in **both** `en` and `am` with reference-entry equivalents. Both bundles; no key left dangling.

### Step 4.5 — Admin surfaces

Check `webapp/src/admin/Orders.tsx` and `AuditEvidenceModal.tsx` — confirm they display **evidence** (reference, amount, status) rather than images, and note any link that points at `/orders/:id/receipt` (removed in P6). Adjust now if trivial; otherwise flag for P6.

### Step 4.6 — Tests

- Client: reference validation per rail; submit calls the new endpoint with the right body.
- Server contract: reference-based submission reaches the orchestrator and auto-verifies (mocked adapter) or routes to manual review.

### Check

```bash
pnpm -r build && pnpm --filter bot typecheck && pnpm -r test
```

Plus a manual smoke test in the Mini App (details below).

### Commit

`feat(webapp): reference-based checkout via receipts verify API`

### Report to operator

Confirm the client is on the new endpoint, i18n complete in both bundles, and list what the smoke test should cover. **Wait for confirmation.**

---

## Phase 5 — Remove the Abyssinia rail

**Goal:** Telebirr and CBE only.

**Branch:** `feat/remove-abyssinia-rail`

### Step 5.1 — Rail definitions

- `bot/src/services/orders.service.ts:11–13` — `ActivePaymentRail`, `ACTIVE_PAYMENT_RAILS`
- `bot/src/bot/handlers/checkout.ts:17` — `VALID_PAYMENT_RAILS`
- `checkout.ts:141–142` — the fallback-to-telebirr branch
- `checkout.ts:237` — `handleManualRail` signature

### Step 5.2 — Keep the type union for back-compat

`receipt_verifier/types.ts` — `SupportedBank` **keeps** `'abyssinia'`. Historical `receipt_evidence` rows may reference it. Remove it from every **selectable** surface only. Never make historical evidence unreadable.

### Step 5.3 — Beneficiary config

`receipt_verifier/constants.ts` `BANK_BENEFICIARY_CONFIG_MAP` — remove the `abyssinia` entry; adjust the type so the key is optional rather than deleting the union member.

### Step 5.4 — Payout API

`bot/src/api/server.ts:583–585` (allowed methods list) and `:751` (discontinued-payment message).

### Step 5.5 — Settings

Remove `abyssinia_account` from the `settings.service.ts` allow-lists and the admin settings surface (`api/admin.ts`). **Leave the stored settings row alone** — dropping it is a data migration and out of scope.

### Step 5.6 — Copy

`formatters.ts:89,109`; `support.ts:27,76`; `start.ts:108`; `inline_query.ts:117`; `bot.ts:461`; `admin.ts:216–230`. Both i18n bundles.

### Step 5.7 — `.env.example`

Remove `RECEIPT_ABYSSINIA_BENEFICIARIES` (`:190`).

### Step 5.8 — Tests

- Rail lists contain exactly Telebirr and CBE.
- A historical order whose evidence names Abyssinia still renders correctly.
- No dangling references to the removed rail in user-facing copy.

### Check

```bash
pnpm -r build && pnpm --filter bot typecheck && pnpm -r test
git grep -n "abyssinia" -- bot/src webapp/src   # expect only back-compat/historical cases
```

### Commit

`feat(payments): remove Abyssinia rail, keep Telebirr and CBE`

### Report to operator

List every touchpoint changed, confirm historical data still readable, show remaining `abyssinia` grep hits and why each is legitimate. **Wait for confirmation.**

---

## Phase 6 — Retire the image pipeline

**Goal:** remove receipt-image capture, storage, and serving. Highest-risk phase — do it only after P4 is validated in a running environment.

**Branch:** `feat/retire-receipt-images`

### Why now and not earlier

P4 moved the only image-requiring buyer flow (Mini App checkout) off screenshots. Deleting the pipeline before that would break checkout. Doing it after means the deletion is cleanup, not a migration.

### Ordered steps — re-run the gate after each

1. **Boot sync** — `bot/src/index.ts`: remove import (`:8`) and the `syncReceiptsFromRemote()` block (`:35–40`).
2. **Orchestrator** — `receipt_verifier/orchestrator.service.ts`: drop `saveReceiptImage` / `resolveStoredReceiptPath` imports (`:21`). Convert `persistEvidenceArtifact` (`:319–339`) to **hash-only** — SHA-256 of the buffer for `file_hash`, no disk write, no `file_path`. The `reverifyOrder` disk-candidate loop (`:208–245`) may stay; it is `fs.existsSync`-guarded and no-ops when files are gone.
3. **Storage** — delete `bot/src/services/storage.service.ts`. Confirm zero remaining importers first.
4. **Upload endpoint** — `api/server.ts`: remove the `/api/receipt` mount (`:406–412`) and `handleReceiptUpload` (`:89–153`), plus the `saveReceiptImage` / `ReceiptValidationError` import (`:37`). P4 already migrated the client.
5. **Receipts service** — delete `bot/src/services/receipts.service.ts` once steps 2–4 and 6–7 are done. Exports removed: `saveReceiptImage`, `resolveStoredReceiptPath`, `resolveReceiptsDir`, `purgeOldReceipts`, `ReceiptValidationError`, `detectImageExtension`.
6. **Admin viewer** — `api/admin.ts`: delete `serveOrderReceipt` (`:614–685`), `GET /orders/:id/receipt` (`:686`), `GET /orders/:id/receipt-link`, `GET /receipt-dl/:payload/:sig` (`:~705–720`), and the `resolveStoredReceiptPath` import (`:8`). Confirm `download_tokens.service.ts` has no other consumer; delete it if unreferenced.
7. **Admin alert cards** — `bot/src/bot/handlers/checkout.ts`: drop the `resolveStoredReceiptPath` import (`:4`) and the photo-attach branches in `notifyAdminsNewReceipt` (`:563–585`) and `notifyAdminsVerificationFallback` (`:680–710`). Always send the text card from `splitTelegramCaption`.
8. **Ingestion — reference only** — `receipt_verifier/ingestion.service.ts`: delete `ingestBuffer` (`:87–`), `testQrMatrix` (`:142–`), the `sharp` / `zxing` imports (`:1–2`), and all QR/PDF preprocessing helpers. **Keep `ingestText` (`:124–`) exactly as is** — it is the live path. Update `IReceiptIngestionService` in `types.ts`.
9. **Verify API trim** — `api/receipts.ts`: remove `parseBase64Payload` (`:130–163`), the `receiptBase64` branch in `/verify` (`:~233–250`), and the `/test-qr` endpoint (`:310+`). Keep `/verify` and `/status/:orderId`.
10. **Maintenance** — `services/maintenance.service.ts`: remove the `purgeOldReceipts` import (`:3`) and call (`:~47`). Keep every other cleanup job.
11. **Env** — `config/env.ts`: drop `RECEIPTS_DIR` (`:123`), `RECEIPT_MAX_BYTES` (`:124`), `RECEIPT_RETENTION_DAYS` (`:132–137`), and the pass-through block (`:247–249`). **Keep** `RECEIPT_RETENTION_DAYS_RAW_PAYLOADS` and `RECEIPT_RETENTION_DAYS_UNVERIFIED` — audit-table retention, unrelated. **Keep every `B2_*` / `LITESTREAM_*`** — Litestream needs them.
12. **`.env.example`** — remove `RECEIPTS_DIR` (`:57`) and the image retention/size block (`:195–200`). Update the stale "manual photo receipt upload" rail descriptions (`:26–28`).
13. **Dependencies** — remove `sharp` and `@zxing/library` from `bot/package.json`. Audit and remove `pdf-parse` (zero imports today). **Keep `pdfkit`** (`api/admin.ts:1085` uses it) and **`cheerio`** (portal HTML parsing in both adapters). Remove `sharp` from `pnpm-workspace.yaml` `allowBuilds` / `onlyBuiltDependencies` if nothing else needs it.
14. **`render.yaml`** — update the "Receipt Persistence" comment on the B2 block. DB replication remains.
15. **Data** — `data/receipts/` may be cleared at deploy time. Leave the B2 `receipts/` prefix orphaned as historical evidence, reachable via the B2 console. **No DB migration.**

### Check

Gate after every step, not just at the end.

```bash
pnpm -r build && pnpm --filter bot typecheck && pnpm -r test
```

Final verification:
```bash
git grep -n "saveReceiptImage\|resolveStoredReceiptPath\|syncReceiptsFromRemote\|uploadReceiptToRemote\|purgeOldReceipts" -- bot/src
# must return nothing
```

### Commit

One commit per logical group is acceptable here (e.g. bot-side deletion, API deletion, dependency removal) — but each must be independently green.

`refactor(receipts): retire receipt image pipeline`

### Report to operator

List files deleted, symbols removed, dependencies dropped, and confirm the grep is empty. Flag anything deliberately retained (DB columns, B2 objects, admin fulfillment photos). **Wait for confirmation.**

---

## Phase 7 — Litestream snapshot and retention

**Goal:** back up on a schedule, not just replicate continuously.

**Branch:** `feat/litestream-retention`

### Step 7.1

`scripts/run-with-litestream.mjs` — add to the generated replica block:

```yaml
snapshot-interval: 1h
retention: 72h
retention-check-interval: 1h
```

Keep `sync-interval: 1s` — it is the feature. Add a brief comment noting B2 Class-C transaction volume so the next reader knows the trade-off was deliberate.

Verify the key names are valid for Litestream v0.3.13 (pinned at the top of the script) before committing.

Nothing else changes. The bot still boots directly when B2 credentials are absent.

### Step 7.2 — Confirm the restore path still works

`litestream restore -if-replica-exists` must remain compatible with the new config. This is a config-only change to the same YAML the restore command reads.

### Check

```bash
pnpm -r build && pnpm --filter bot typecheck && pnpm -r test
node scripts/run-with-litestream.mjs --help 2>/dev/null || true   # smoke: generates config without crashing
```

Confirm the generated YAML in the temp file contains all four keys.

### Commit

`chore(litestream): add snapshot interval and 72h retention`

### Report to operator

Show the generated YAML block. **Wait for confirmation.**

---

## Phase 8 — Tests, docs, hygiene, graphify

**Goal:** close out the change set so the repo is coherent.

**Branch:** `feat/verifier-cleanup-docs`

### Step 8.1 — Test cleanup

Delete image-only coverage:
- `bot/tests/receipt_verifier_phase4.test.ts` (entirely image/QR)
- image cases in `bot/tests/receipt_verifier_qa_edge_cases.test.ts`
- `bot/tests/receipt_persistence_phase3.test.ts`
- image cases in `bot/tests/hardening_suite.test.ts` (`:10,78–99`)
- image cases in `bot/tests/phase5.test.ts` (`:341`)
- image fixtures in `bot/tests/factories/receipt_data.factory.ts` — keep the text fixtures

Rewrite `bot/tests/receipt_endpoint.test.ts` for the reference-only contract.

Keep and extend:
- `receipt_sms_intake.test.ts` — the core path
- `receipt_reverification_flow.test.ts` — reference-only reverify
- `network_infrastructure_phase5.test.ts` — timeout override, config-error class, socks5 rejection
- `env.test.ts` — new keys present, removed keys absent

### Step 8.2 — Documentation

`docs/ARCHITECTURE-RECEIPT-VERIFICATION.md`:
- Reference-only ingestion (no image pipeline)
- The bilingual label map
- The masked-account → name-matching design and its rationale
- Fail-closed behaviour on unparseable timestamps

`docs/devops/DEPLOYMENT-RUNBOOK.md`:
- Proxy scheme is **http(s)-only** — correct the `socks5://` examples at `:191,235`
- Remove image-persistence rows
- Document `scripts/test-bank-egress.sh` for egress evaluation
- Remove the stale "Telebirr Always Returns HTTP 403" troubleshooting entry's assumption that a proxy must be pre-configured, or reword to match the new config-error behaviour

### Step 8.3 — Telebirr merchant onboarding note

New short doc capturing the long-lead-time path, since production scraping is a bridge:
- Requires business license, short code, signatory details
- **Integration proposal submitted in person at the Telebirr office**
- Testbed → production
- Production gateway `superapp.ethiomobilemoney.et:38443`
- Push-based flow: `notifyUrl` + server-to-server `getOrderStatus()`
- This eliminates the geo-block permanently and replaces the whole scraping approach

### Step 8.4 — Hygiene

- `git rm -r missing_env/` — verified secret-free (only `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, `SUPPORT_USERNAME`, `REQUIRED_CHANNEL_*`, `RESELLER_LOW_BALANCE_ALERT_USDT`, `RECEIPT_*` tuning values)
- Ensure `.gitignore` covers `.env*` except `.env.example`

### Step 8.5 — Graph refresh

Per repo convention, run after the final code change:
```bash
graphify update .
```

### Step 8.6 — Final verification

```bash
pnpm -r build
pnpm --filter bot typecheck
pnpm -r test
git status --porcelain
```

`git status` must show **only** intended changes plus the two pre-existing noise entries. Confirm the graphify cache stamp and `.opencode/` were not staged.

### Commit

`docs: update receipt verification architecture and deployment runbook`

### Report to operator

Full change summary: files deleted, files added, docs updated, test count before/after, final gate result, `git status` output. **Wait for confirmation.**

---

## Verification checklists for manual smoke tests

Hand these to the operator at the relevant phases.

**P1 — parser (real references, from the Ethiopian connection)**
- Diagnostic prints all fields for several real Telebirr references
- Reference, settled amount, credited-party name, EAT timestamp, and status all correct
- A malformed reference produces a clean error, not a crash
- A reference with a non-`Completed` status is treated as unpaid

**P4 — Mini App checkout**
- Buyer reaches checkout, pays, then enters a valid Telebirr reference → auto-verified
- Buyer enters a CBE reference → correct rail handling
- Buyer enters an invalid reference → rail-specific validation message, cannot submit
- A reference that fails the gate → "under review" message, admin notified
- Amharic UI renders the new strings correctly

**P6 — image pipeline retired**
- Bot SMS/reference flow still works end to end
- Mini App checkout still works (it now uses references only)
- Admin order view shows evidence, not a receipt image
- No admin alert tries to attach a receipt photo
- Manual review and force-approve still function

**P7 — Litestream**
- Generated config contains all four keys
- Database still replicates; restore-from-B2 still initialises a fresh container

---

## Phase summary

| Phase | Scope | Risk | Commit |
|---|---|---|---|
| P0 | Sync + baseline | — | none |
| P1 | Telebirr parser rewrite | Medium | `fix(receipts)` |
| P2 | Fail-fast + env plumbing | Low | `feat(receipts)` |
| P3 | Wire auto-verify switch | Low | `feat(receipts)` |
| P4 | Mini App reference checkout | Low | `feat(webapp)` |
| P5 | Remove Abyssinia | Medium | `feat(payments)` |
| P6 | Retire image pipeline | **High** | `refactor(receipts)` |
| P7 | Litestream retention | Low | `chore(litestream)` |
| P8 | Tests, docs, hygiene | Medium | `docs` |

## Definition of done

- [ ] P0–P8 each signed off, each on its own branch, each gate green
- [ ] A real Telebirr reference auto-verifies; a bad one routes to manual review
- [ ] Parser extracts reference, settled amount, beneficiary name, correct EAT timestamp
- [ ] Recency pillar fails closed on an unparseable timestamp
- [ ] Beneficiary check uses credited-party name for Telebirr, numeric account for CBE
- [ ] Abyssinia no longer selectable; historical evidence still readable
- [ ] No image-pipeline symbols remain in `bot/src`
- [ ] Malformed `TELEBIRR_PROXY_URL` yields a config error, not a geoblock
- [ ] `receipt_auto_verify_enabled = 0` demonstrably forces manual review
- [ ] Litestream emits `snapshot-interval` and `retention`
- [ ] `pnpm -r build`, `pnpm --filter bot typecheck`, `pnpm -r test` all green
- [ ] `graphify update .` run; `git status` shows only intended changes
- [ ] `master` never received a direct commit
