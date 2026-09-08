# Architectural Decision Record (ADR-001)
## Native TypeScript In-Process Receipt Verification Engine for CBE & Telebirr

- **Status:** Accepted
- **Date:** 2026-09-08
- **Context:** Bighabesha Shop Telegram Bot (Node.js ESM / TypeScript / SQLite / GramMY)
- **Deciders:** Engineering Architecture Team / Sub-Agent `project-architecture-planner`

---

## 1. Context & Problem Statement

Bighabesha Shop sells digital products (Gemini Pro 18m activation links, Telegram Premium subscriptions, and Telegram Stars) to Ethiopian customers. Over 85% of transactions are conducted using direct peer-to-peer bank transfers via Commercial Bank of Ethiopia (CBE) and Telebirr.

Currently, customer-uploaded transfer receipts (images, PDFs, or forwarded SMS) are held in an administrative review queue (`pending_approval`). Two human store administrators must inspect each receipt, log into their respective bank mobile apps, cross-check transaction references and amounts, and manually tap inline approval buttons.

This creates severe operational challenges:
1. **Fulfillment Delays**: Customers wait up to several hours for digital product delivery during peak loads and off-hours, hurting retention and conversion.
2. **Administrative Fatigue & Overhead**: Hundreds of manual reviews per day consume significant administrative labor and increase error rates.
3. **Fraud Exposure**: Cropped screenshots, fake receipt generators, and replay of previously submitted transaction references can slip through human review.

We need an automated verification system capable of decoding QR codes from transfer screenshots and PDFs, verifying transaction integrity directly against bank systems, enforcing strict anti-fraud rules, and automatically fulfilling orders without human intervention when valid, while gracefully falling back to human review on anomalies.

---

## 2. Considered Alternatives

### Option 1: External Python Microservice (`ethiobank_receipts` wrapper / FastAPI)
- **Concept**: Deploy a standalone Python service wrapping existing Python receipt extraction tools (OpenCV, PyMuPDF, `pyzbar`, `requests`).
- **Pros**: Reuses existing Python community scrapers.
- **Cons**: Requires a dual-runtime setup (Node.js + Python), doubling container overhead and memory consumption (extra 150–250MB RAM). On a free-tier 1GB VPS, this creates memory contention. Requires inter-process communication (HTTP or message queue) and distributed state coordination.

### Option 2: Commercial Ethiopian Payment Gateways (Chapa, SantimPay, ArifPay)
- **Concept**: Deprecate manual bank transfers and route all local payments through hosted checkout web views.
- **Pros**: Outsourced verification and banking relationships.
- **Cons**: Imposes merchant processing fees (2.5%–3.5%). Ethiopian domestic consumers strongly resist redirect checkouts for digital items and expect direct P2P transfer (zero consumer transaction fees). Breaks the native Telegram in-chat commerce UX.

### Option 3: Native TypeScript In-Process Verification Engine (Selected)
- **Concept**: Implement an in-process, pure TypeScript verification engine integrated directly within the existing bot runtime using `@zxing/library` + `sharp`, `pdf-parse`, `cheerio`, and `https-proxy-agent`.
- **Pros**:
  - Single runtime: runs directly inside the Node.js 20+ ESM container with zero additional process overhead.
  - Sub-second execution: no IPC serialization hops or network latency between services.
  - Strict transactional integrity: validation, anti-replay reservation, and stock auto-allocation occur within an atomic SQLite transaction (`better-sqlite3`).
  - Zero transaction processing fees: preserves 100% margin on direct P2P transfers.
  - Preserves the existing user experience: customers upload standard receipts/screenshots inside Telegram.
- **Cons**:
  - Image manipulation and QR decoding consume CPU cycles (mitigated by strict concurrency limits and image downscaling).
  - Bank portal web changes require ongoing adapter maintenance (mitigated by strict separation of concerns and instant fallback to human admin review).

---

## 3. Decision Outcome

**Chosen Alternative: Option 3 — Native TypeScript In-Process Verification Engine.**

We will build the verification engine in-process within `bot/src/services/receipt_verifier/`.

### Core Architectural Pillars:
1. **Ingestion & Matrix Decoding**: Use `sharp` for contrast enhancement, grayscale normalization, and auto-rotation, coupled with `@zxing/library` for 2D QR matrix decoding. For vector PDFs, use `pdf-parse`.
2. **Bank Confirmation Adapters**:
   - `CbeBankAdapter`: Fetches confirmation data from CBE's portal (handling port 100 and standard HTTPS), parsing vector PDF streams or HTML DOM.
   - `TelebirrAdapter`: Queries Telebirr's transaction portal via an Ethiopian residential/datacenter proxy (`https-proxy-agent`) to bypass geo-blocking, parsing HTML tables with `cheerio`.
3. **4-Pillar Security Gate**:
   - **Anti-Replay**: Unique transaction reference indexed in SQLite `receipt_evidence`.
   - **Account Whitelist**: Verified beneficiary account must strictly match shop configuration.
   - **Amount Parity**: Bank-verified amount must match or exceed the net payable order amount.
   - **Temporal Recency**: Bank transaction timestamp must fall within an acceptable time window (60–120 minutes) of order creation.
4. **Resilience & Graceful Fallback**: Outbound requests are bound to 7.5-second abort timeouts with an in-process circuit breaker. If bank portals are slow, unreachable, or unparseable, orders seamlessly transition to the existing admin review queue (`pending_approval`) with complete diagnostic logging.

---

## 4. Consequences

### Positive
- **Instant Digital Delivery**: Valid orders are fulfilled automatically in under 3 seconds.
- **Zero Additional Infrastructure**: Operates cleanly on the existing 1GB VPS without additional containers or microservice management.
- **Robust Fraud Defense**: Eliminates receipt reuse, underpayments, and edited screenshots.
- **Cohesive Codebase**: Pure TypeScript ESM, unified test suite with Vitest, and shared Pino logging.

### Negative / Risks & Mitigations
- **Risk**: Upstream changes to bank confirmation URLs or HTML layouts could break automated verification.
  - *Mitigation*: Any parsing or network failure triggers the **Fallback Manager**, routing the order to the human admin queue without disrupting the customer.
- **Risk**: Outbound port 100 blocks on certain hosting providers for CBE.
  - *Mitigation*: Adapter supports fallback to an egress proxy or reverse proxy if direct port 100 connections are refused.
- **Risk**: Telebirr geo-fencing foreign IP addresses.
  - *Mitigation*: Telebirr adapter routes through an Ethiopian HTTP proxy via `https-proxy-agent`.
- **Risk**: High CPU usage from malicious or large image uploads.
  - *Mitigation*: Input byte limits (10MB), pixel caps (16 megapixels) in `sharp`, and a concurrency semaphore limiting parallel decodes to 2.
