# Bighabesha Shop Admin Dashboard Verification API Contract
## Architectural Specification & REST Protocol Reference

- **Document Version:** 1.0.0
- **Date:** 2026-09-08
- **Status:** Final / Production-Ready
- **Supersedes / Implements:** [ADR-002: Admin Dashboard Bank Verification & Audit Evidence Integration](../ADR-002-ADMIN-DASHBOARD-VERIFICATION.md)
- **Related Specifications:** [ADR-001: Receipt Verification Engine](../ADR-001-RECEIPT-VERIFICATION-ENGINE.md), [RECEIPT-VERIFICATION-PROTOCOLS.md](./RECEIPT-VERIFICATION-PROTOCOLS.md), [receipt-verifier-openapi.yaml](./receipt-verifier-openapi.yaml)

---

## 1. Architectural Overview & Context

The Bighabesha Shop automated verification engine natively decodes customer bank transfer slips (Telebirr, CBE, Bank of Abyssinia) via OCR/QR matrix analysis, verifies transaction authenticity against bank settlement rails, and enforces the **4-Pillar Security Gate** (Anti-Replay, Beneficiary Whitelist, Exact Amount Match, and Recency Window).

This document specifies the complete REST API contract connecting the **Node.js Express Backend** (`bot/src/api/`) to the **React Administrator Control Plane** (`webapp/src/admin/`).

### System Interaction Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Store Administrator
    participant Dashboard as Admin Dashboard (React)
    participant OrdersApi as GET /api/admin/orders
    participant DrawerApi as GET /api/receipts/status/:id
    participant ReverifyApi as POST /api/admin/receipts/:id/reverify
    participant SettingsApi as GET/PUT /api/admin/settings
    participant Orch as ReceiptOrchestrator
    participant DB as SQLite Storage (WAL)

    %% 1. Loading Orders Table
    Admin->>Dashboard: Open Orders Tab
    Dashboard->>OrdersApi: GET /api/admin/orders?status=all [Bearer Auth]
    OrdersApi->>DB: Batch Query: SELECT orders + MAX(receipt_evidence)
    DB-->>OrdersApi: Enriched orders with latest evidence summary
    OrdersApi-->>Dashboard: 200 OK { orders: [...] }
    Dashboard-->>Admin: Display Orders Grid with Auto-Verified / Diagnostic Badges

    %% 2. Inspecting Audit Drawer
    Admin->>Dashboard: Click Order / Diagnostic Badge
    Dashboard->>DrawerApi: GET /api/receipts/status/:orderId [Bearer Auth]
    DrawerApi->>Orch: getAuditRecord(orderId) & getAuditsForOrder(orderId)
    Orch->>DB: Query receipt_evidence & bank_verification_audits
    DB-->>Orch: Evidence record & attempt history
    Orch-->>DrawerApi: Full audit details + 4-pillar evaluations
    DrawerApi-->>Dashboard: 200 OK { evidence, attempts, orderStatus, ... }
    Dashboard-->>Admin: Render Slide-Over Audit Drawer with Checklist & Slip

    %% 3. Re-verifying Receipt
    Admin->>Dashboard: Click [Re-verify with Bank]
    Dashboard->>ReverifyApi: POST /api/admin/receipts/:orderId/reverify [Bearer Auth]
    ReverifyApi->>Orch: reverifyOrder(orderId, adminId)
    Orch->>DB: Run Anti-Replay, Whitelist, Amount, Recency gates
    alt Gate Passed & Upstream Validated
        Orch->>DB: UPDATE orders SET status='pending_fulfillment'
        Orch-->>ReverifyApi: VerificationResult { success: true, status: 'auto_verified' }
        ReverifyApi-->>Dashboard: 200 OK
        Dashboard-->>Admin: Green Toast: "Bank Payment Confirmed"
    else Gate Failed or Portal Timeout
        Orch-->>ReverifyApi: VerificationResult { success: false, error: ProblemDetails }
        ReverifyApi-->>Dashboard: 422/502 ProblemDetails (RFC 7807)
        Dashboard-->>Admin: Diagnostic Toast (Severity, Code, Remediation Hint)
    end

    %% 4. Engine Configuration
    Admin->>Dashboard: Adjust Settings (Master Toggle, Bank Accounts, Recency)
    Dashboard->>SettingsApi: PUT /api/admin/settings { settings: { ... } } [Bearer Auth]
    SettingsApi->>DB: Validate KNOWN_SETTING_KEYS & UPDATE settings
    SettingsApi-->>Dashboard: 200 OK { settings: { ... } }
    Dashboard-->>Admin: Toast: "Verification Settings Updated"
```

---

## 2. Authentication & Role-Based Access Control (RBAC)

All admin endpoints enforce token-based authentication via the HTTP standard `Authorization: Bearer <session_token>` header. Session tokens are 256-bit cryptographically secure hexadecimal strings generated upon successful Telegram 2FA OTP verification and stored in the SQLite `admin_sessions` table with a 24-hour TTL.

### Role Permission Matrix

| Role | `orders.view` | `orders.decide` | `settings.read` | `settings.write` | Audit & Verification Capabilities |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **superadmin** | ✅ | ✅ | ✅ | ✅ | Full administrative governance: configure engine, manage whitelist accounts, trigger reverification, inspect full raw audit payloads. |
| **admin** | ✅ | ✅ | ✅ | ❌ | Operational supervisor: inspect audit drawers, trigger reverification, manually approve or reject orders. Cannot mutate engine settings. |
| **finance** | ✅ | ❌ | ✅ | ❌ | Financial auditor: inspect verified amounts, reconcile settlement accounts, view export reports. Read-only on orders. |
| **support** | ✅ | ❌ | ❌ | ❌ | Tier-1 support: view order statuses and diagnostic badges. Cannot trigger reverification or view raw bank payloads. |

---

## 3. Endpoint: `GET /api/admin/orders` (Enriched Orders API)

### 3.1 Protocol Specification

- **Method:** `GET`
- **Path:** `/api/admin/orders`
- **Authentication:** `Bearer <admin_session_token>`
- **Required Permission:** `orders.view`
- **Rate Limit:** 120 requests/minute per IP (`adminApiLimiter`)

#### Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `status` | `string` | No | `all` | Filter by order lifecycle status: `awaiting_payment`, `pending_approval`, `pending_fulfillment`, `fulfilled`, `cancelled`, or `all`. |
| `search` | `string` | No | `""` | Case-insensitive substring match across `id`, `username`, and `product_id`. |

### 3.2 High-Performance Batch Enrichment Architecture

To prevent **N+1 query degradation** during high-volume operations, the endpoint performs order fetching and evidence resolution using a single coordinated batch execution:

```sql
-- Step 1: Query primary orders (max 100 per page)
SELECT * FROM orders
WHERE status = ? AND (id LIKE ? OR username LIKE ? OR product_id LIKE ?)
ORDER BY created_at DESC LIMIT 100;

-- Step 2: Batch fetch latest evidence record per order in a single query
SELECT id, order_id, bank, reference, normalized_reference, status,
       error_code, verified_amount_etb, security_gate_passed, created_at
FROM receipt_evidence
WHERE id IN (
  SELECT MAX(id)
  FROM receipt_evidence
  WHERE order_id IN (?, ?, ?, ...)
  GROUP BY order_id
);
```

### 3.3 Response Schema

#### Root Response Object
```typescript
interface GetAdminOrdersResponse {
  orders: EnrichedAdminOrder[];
}
```

#### Enriched Order Interface (`EnrichedAdminOrder`)
```typescript
interface EnrichedAdminOrder {
  id: string;
  user_id: number;
  username: string | null;
  product_id: string;
  variant_id: string | null;
  amount_etb: number;
  payment_rail: 'cbe' | 'telebirr' | 'abyssinia' | 'ton' | 'chapa' | 'manual' | string;
  payment_ref: string | null;
  receipt_file_id: string | null;
  status: 'awaiting_payment' | 'pending_approval' | 'pending_fulfillment' | 'fulfilled' | 'cancelled';
  target_username: string | null;
  fulfillment_proof: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  
  /** Enriched latest receipt evidence summary (null if no slip submitted) */
  evidence: ReceiptEvidenceSummary | null;
}

interface ReceiptEvidenceSummary {
  id: number;
  bank: 'cbe' | 'telebirr' | 'abyssinia' | 'unknown' | string;
  reference: string | null;
  normalized_reference: string | null;
  status: 'auto_verified' | 'pending_manual_review' | 'rejected' | 'upstream_failure' | string;
  error_code: VerificationFailureCode | string | null;
  verified_amount_etb: number | null;
  security_gate_passed: boolean;
  created_at: string;
}
```

### 3.4 Example Response Payloads

#### Case A: Auto-Verified Order with Evidence Summary
```json
{
  "orders": [
    {
      "id": "ORD-20260908-01",
      "user_id": 987654321,
      "username": "amanuel_dev",
      "product_id": "gemini_pro_18m",
      "variant_id": "gemini_pro_18m_default",
      "amount_etb": 850,
      "payment_rail": "cbe",
      "payment_ref": "FT2609089912",
      "receipt_file_id": "receipt_ORD-20260908-01_1725801234.jpg",
      "status": "fulfilled",
      "target_username": "amanuel_dev",
      "fulfillment_proof": "Delivered via Stock Vault Link #402",
      "rejection_reason": null,
      "created_at": "2026-09-08T15:20:10.000Z",
      "updated_at": "2026-09-08T15:20:14.000Z",
      "evidence": {
        "id": 1420,
        "bank": "cbe",
        "reference": "FT2609089912",
        "normalized_reference": "FT2609089912",
        "status": "auto_verified",
        "error_code": null,
        "verified_amount_etb": 850,
        "security_gate_passed": true,
        "created_at": "2026-09-08T15:20:12.000Z"
      }
    }
  ]
}
```

#### Case B: Pending Approval Order with Upstream Bank Timeout
```json
{
  "orders": [
    {
      "id": "ORD-20260908-02",
      "user_id": 112233445,
      "username": "helen_k",
      "product_id": "telegram_premium",
      "variant_id": "telegram_premium_12m",
      "amount_etb": 1800,
      "payment_rail": "cbe",
      "payment_ref": "FT2609087711",
      "receipt_file_id": "receipt_ORD-20260908-02_1725801456.png",
      "status": "pending_approval",
      "target_username": "helen_k",
      "fulfillment_proof": null,
      "rejection_reason": null,
      "created_at": "2026-09-08T15:25:00.000Z",
      "updated_at": "2026-09-08T15:25:35.000Z",
      "evidence": {
        "id": 1421,
        "bank": "cbe",
        "reference": "FT2609087711",
        "normalized_reference": "FT2609087711",
        "status": "upstream_failure",
        "error_code": "BANK_PORTAL_UNAVAILABLE",
        "verified_amount_etb": null,
        "security_gate_passed": false,
        "created_at": "2026-09-08T15:25:05.000Z"
      }
    }
  ]
}
```

#### Case C: Order Without Uploaded Evidence (`evidence: null`)
```json
{
  "orders": [
    {
      "id": "ORD-20260908-03",
      "user_id": 556677889,
      "username": "dawit_t",
      "product_id": "gemini_pro_18m",
      "variant_id": "gemini_pro_18m_default",
      "amount_etb": 850,
      "payment_rail": "manual",
      "payment_ref": null,
      "receipt_file_id": null,
      "status": "awaiting_payment",
      "target_username": null,
      "fulfillment_proof": null,
      "rejection_reason": null,
      "created_at": "2026-09-08T15:30:00.000Z",
      "updated_at": "2026-09-08T15:30:00.000Z",
      "evidence": null
    }
  ]
}
```

---

## 4. Endpoint: `GET /api/receipts/status/:orderId` (Audit Drawer / Modal)

### 4.1 Protocol Specification

- **Method:** `GET`
- **Path:** `/api/receipts/status/:orderId`
- **Authentication:** Dual transport:
  - Admin Bearer Token (`Authorization: Bearer <token>`)
  - Telegram WebApp Signed InitData (`X-Telegram-Init-Data: <query_string>`)
- **Access Control:**
  - Administrators holding `orders.view` may inspect any order.
  - Regular customers may only query their own orders (`order.user_id === auth.userId`).
- **Rate Limit:** 60 requests/minute per IP/user.

### 4.2 Response Schema

```typescript
interface OrderReceiptStatusResponse {
  orderId: string;
  orderStatus: string;
  amountEtb: number;
  paymentRail: string;
  evidence: VerificationAuditRecord | null;
  attempts: BankVerificationAuditAttempt[];
}

interface VerificationAuditRecord {
  id: number;
  orderId: string;
  userId: number;
  source: 'telegram_photo' | 'telegram_document' | 'webapp_upload' | 'sms_forward' | 'sms' | 'manual_admin_entry';
  bank: 'cbe' | 'telebirr' | 'abyssinia' | 'unknown';
  rawReference?: string;
  normalizedReference?: string;
  amountEtb?: number;
  verifiedAmountEtb?: number;
  beneficiaryAccount?: string;
  securityGatePassed: boolean;
  securityGateEvaluations?: SecurityPillarEvaluation[];
  status: 'auto_verified' | 'pending_manual_review' | 'rejected' | 'upstream_failure';
  errorCode?: VerificationFailureCode;
  rawBankPayload?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
  updatedAt: string;
}

interface SecurityPillarEvaluation {
  pillar: 'anti_replay' | 'beneficiary_whitelist' | 'exact_amount' | 'recency_window';
  passed: boolean;
  expected: string | number;
  actual: string | number;
  details?: string;
  tolerance?: number;
}

interface BankVerificationAuditAttempt {
  id: number;
  attempt_number: number;
  bank: string;
  raw_reference: string | null;
  normalized_reference: string;
  order_amount_etb: number;
  verified_amount_etb: number | null;
  fee_etb: number;
  currency: string;
  sender_name: string | null;
  sender_identifier: string | null;
  beneficiary_account: string | null;
  beneficiary_name: string | null;
  transaction_timestamp: string | null;
  payment_channel: string | null;
  security_gate_passed: number;
  security_gate_evaluations: string | null;
  status: string;
  error_code: string | null;
  error_detail: string | null;
  raw_bank_payload: string | null;
  raw_evidence_snippet: string | null;
  http_status: number | null;
  latency_ms: number | null;
  ip_address: string | null;
  verified_by: string;
  created_at: string;
}
```

### 4.3 Example Audit Drawer Response (Complete Multi-Pillar Payload)

```json
{
  "orderId": "ORD-20260908-01",
  "orderStatus": "fulfilled",
  "amountEtb": 850,
  "paymentRail": "cbe",
  "evidence": {
    "id": 1420,
    "orderId": "ORD-20260908-01",
    "userId": 987654321,
    "source": "telegram_photo",
    "bank": "cbe",
    "rawReference": "FT2609089912",
    "normalizedReference": "FT2609089912",
    "amountEtb": 850,
    "verifiedAmountEtb": 850,
    "beneficiaryAccount": "1000123456789",
    "securityGatePassed": true,
    "securityGateEvaluations": [
      {
        "pillar": "anti_replay",
        "passed": true,
        "expected": "Unique reference in receipt_evidence",
        "actual": "Reference FT2609089912 first seen",
        "details": "Pillar 1 Anti-Replay Assertion passed. No prior matched order recorded."
      },
      {
        "pillar": "beneficiary_whitelist",
        "passed": true,
        "expected": "1000123456789 (BIGHABESHA SHOP)",
        "actual": "1000123456789 (BIGHABESHA SHOP)",
        "details": "Pillar 2 Whitelist match: account verified against active settings."
      },
      {
        "pillar": "exact_amount",
        "passed": true,
        "expected": 850,
        "actual": 850,
        "tolerance": 0,
        "details": "Pillar 3 Amount check: transferred 850.00 ETB matches payable total."
      },
      {
        "pillar": "recency_window",
        "passed": true,
        "expected": "Within -15 min / +180 min of order creation",
        "actual": "Delta: +4.2 minutes",
        "details": "Pillar 4 Recency check: slip generated at 15:24:12 (order created at 15:20:10)."
      }
    ],
    "status": "auto_verified",
    "errorCode": null,
    "rawBankPayload": {
      "transaction_status": "COMPLETED",
      "payment_mode": "CBE_BIRR_APP",
      "payer_phone": "251911****88",
      "cbe_terminal_id": "CBE_WEB_PORT_100"
    },
    "ipAddress": "196.188.24.12",
    "createdAt": "2026-09-08T15:20:12.000Z",
    "updatedAt": "2026-09-08T15:20:14.000Z"
  },
  "attempts": [
    {
      "id": 890,
      "attempt_number": 1,
      "bank": "cbe",
      "raw_reference": "FT2609089912",
      "normalized_reference": "FT2609089912",
      "order_amount_etb": 850,
      "verified_amount_etb": 850,
      "fee_etb": 0,
      "currency": "ETB",
      "sender_name": "AMANUEL GIRMA",
      "sender_identifier": "251911****88",
      "beneficiary_account": "1000123456789",
      "beneficiary_name": "BIGHABESHA SHOP",
      "transaction_timestamp": "2026-09-08 15:24:12",
      "payment_channel": "CBE Mobile Banking",
      "security_gate_passed": 1,
      "security_gate_evaluations": "[{\"pillar\":\"anti_replay\",\"passed\":true},{\"pillar\":\"beneficiary_whitelist\",\"passed\":true},{\"pillar\":\"exact_amount\",\"passed\":true},{\"pillar\":\"recency_window\",\"passed\":true}]",
      "status": "auto_verified",
      "error_code": null,
      "error_detail": null,
      "raw_bank_payload": "{\"transaction_status\":\"COMPLETED\"}",
      "raw_evidence_snippet": "Confirmation: Ref FT2609089912 transferred 850 ETB to 1000123456789",
      "http_status": 200,
      "latency_ms": 620,
      "ip_address": "196.188.24.12",
      "verified_by": "engine_pipeline_v1",
      "created_at": "2026-09-08 15:20:14"
    }
  ]
}
```

---

## 5. Endpoint: `POST /api/admin/receipts/:orderId/reverify` (Bank Re-Verification)

### 5.1 Protocol Specification

- **Method:** `POST`
- **Path:** `/api/admin/receipts/:orderId/reverify`
- **Authentication:** `Bearer <admin_session_token>`
- **Required Permission:** `orders.decide`
- **Rate Limit:** 30 requests/minute per admin IP.

#### Operational Intent
Provides an operator with an on-demand mechanism to re-run automated verification when an order previously failed due to:
1. Temporary upstream bank portal downtime (`BANK_PORTAL_UNAVAILABLE`).
2. Temporary geoblock or proxy connectivity glitches (`PORTAL_GEOBLOCKED`).
3. Bank rate limits during peak traffic hours (`RATE_LIMITED`).

The server pulls the stored binary receipt slip or extracted QR reference from disk, re-contacts the bank gateway, re-evaluates the 4-Pillar Security Gate, records a new attempt in `bank_verification_audits`, and transitions the order if successful.

### 5.2 Success Response Schema (200 OK)

```json
{
  "success": true,
  "status": "auto_verified",
  "orderId": "ORD-20260908-02",
  "bank": "cbe",
  "transactionReference": "FT2609087711",
  "reference": "FT2609087711",
  "verifiedAmountEtb": 1800,
  "evaluations": [
    {
      "pillar": "anti_replay",
      "passed": true,
      "expected": "Unique reference",
      "actual": "FT2609087711 unused"
    },
    {
      "pillar": "beneficiary_whitelist",
      "passed": true,
      "expected": "1000123456789",
      "actual": "1000123456789"
    },
    {
      "pillar": "exact_amount",
      "passed": true,
      "expected": 1800,
      "actual": 1800
    },
    {
      "pillar": "recency_window",
      "passed": true,
      "expected": "Valid time window",
      "actual": "Valid"
    }
  ],
  "auditId": 892
}
```

### 5.3 Error Response Schema (RFC 7807 Problem Details)

On verification failure, the endpoint returns standard `application/problem+json` with HTTP status code corresponding to the failure type:

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json

{
  "type": "https://api.bighabesha.shop/errors/AMOUNT_MISMATCH",
  "title": "Payment Amount Mismatch",
  "status": 422,
  "detail": "Verified bank transfer amount (500 ETB) is less than order net payable (850 ETB).",
  "instance": "/api/admin/receipts/ORD-20260908-01/reverify",
  "code": "AMOUNT_MISMATCH",
  "remediation_hint": "Ask customer to transfer the remaining balance or reject the order.",
  "details": {
    "orderAmount": 850,
    "transferredAmount": 500,
    "deficit": 350
  },
  "timestamp": "2026-09-08T15:40:00.000Z"
}
```

---

## 6. Endpoints: `GET / PUT /api/admin/settings` (Verification Settings)

### 6.1 Protocol Specification

- **`GET /api/admin/settings`:**
  - **Required Permission:** `settings.read`
  - **Description:** Returns all stored system configuration keys and values.
- **`PUT /api/admin/settings`:**
  - **Required Permission:** `settings.write`
  - **Description:** Batch updates configuration keys. Rejects unknown keys outright (`400 Bad Request`) to prevent silent typo shadowing. Logs changes to `audit_logs`.

### 6.2 Verification Engine Settings Key Matrix

All verification engine keys are registered in `KNOWN_SETTING_KEYS` (`bot/src/services/settings.service.ts`):

| Setting Key | Type | Default Value | Description & Constraints |
| :--- | :---: | :---: | :--- |
| `receipt_auto_verify_enabled` | `boolean` (string) | `"true"` | Master switch: toggles automated verification pipeline. When `"false"`, all customer submissions drop to `pending_approval`. |
| `cbe_account` | `string` | `"1000123456789"` | Primary official Commercial Bank of Ethiopia merchant account number. |
| `cbe_name` | `string` | `"BIGHABESHA SHOP"` | Primary official CBE account holder name. |
| `telebirr_account` | `string` | `"0911000000"` | Primary official Telebirr merchant phone number / shortcode. |
| `telebirr_name` | `string` | `"BIGHABESHA SHOP"` | Primary official Telebirr merchant name. |
| `abyssinia_account` | `string` | `"88880000"` | Primary official Bank of Abyssinia account number. |
| `abyssinia_name` | `string` | `"BIGHABESHA SHOP"` | Primary official Bank of Abyssinia holder name. |
| `receipt_recency_before_mins` | `integer` (string) | `"15"` | Pillar 4: Maximum allowable payment execution minutes *prior* to order creation. |
| `receipt_recency_after_mins` | `integer` (string) | `"180"` | Pillar 4: Maximum allowable payment execution minutes *after* order creation before slip is marked expired. |
| `receipt_circuit_breaker_threshold` | `integer` (string) | `"5"` | Consecutive upstream failure count before tripping circuit breaker into open state. |
| `receipt_circuit_breaker_cooldown_sec` | `integer` (string) | `"300"` | Cool-down duration in seconds before testing half-open recovery against bank portals. |
| `receipt_retention_days_raw_payloads` | `integer` (string) | `"7"` | Privacy & GDPR: Days to retain full raw upstream JSON payloads before nulling out in SQLite. |
| `receipt_retention_days_unverified` | `integer` (string) | `"30"` | Days to retain unverified or abandoned receipt submissions before purging. |
| `receipt_retention_days_verified` | `integer` (string) | `"365"` | Compliance & Accounting: Days to retain verified audit records in SQLite. |
| `receipt_cbe_beneficiaries` | `string` (CSV) | `""` | Comma-separated secondary/alternative CBE account numbers permitted by whitelist. |
| `receipt_telebirr_beneficiaries` | `string` (CSV) | `""` | Comma-separated secondary/alternative Telebirr accounts permitted by whitelist. |
| `receipt_abyssinia_beneficiaries` | `string` (CSV) | `""` | Comma-separated secondary/alternative Abyssinia accounts permitted by whitelist. |
| `receipt_ethiopia_proxy_url` | `string` (URI) | `""` | HTTP/SOCKS5 proxy URI for routing bank verification egress through Ethiopian residential IPs. |

### 6.3 Example Payloads

#### PUT Request: Update Engine Parameters
```http
PUT /api/admin/settings HTTP/1.1
Host: api.bighabesha.shop
Authorization: Bearer 8f14e45fceea167a5a36dedd4bea2543...
Content-Type: application/json

{
  "settings": {
    "receipt_auto_verify_enabled": "true",
    "receipt_recency_before_mins": "30",
    "receipt_recency_after_mins": "240",
    "receipt_circuit_breaker_threshold": "5",
    "cbe_account": "1000987654321",
    "cbe_name": "BIGHABESHA OFFICIAL STORE"
  }
}
```

#### PUT Response (200 OK)
```json
{
  "success": true,
  "settings": {
    "receipt_auto_verify_enabled": "true",
    "receipt_recency_before_mins": "30",
    "receipt_recency_after_mins": "240",
    "receipt_circuit_breaker_threshold": "5",
    "receipt_circuit_breaker_cooldown_sec": "300",
    "cbe_account": "1000987654321",
    "cbe_name": "BIGHABESHA OFFICIAL STORE",
    "telebirr_account": "0911000000",
    "telebirr_name": "BIGHABESHA SHOP"
  }
}
```

---

## 7. Standardized RFC 7807 Error Code Mapping to Admin Toast Notifications

The admin dashboard (`webapp/src/admin/adminApi.ts`) translates backend `VerificationFailureCode` strings into high-visibility notifications, diagnostic badges, and remediation hints:

| RFC 7807 Error Code | HTTP Status | Toast Title | Severity | Badge Label | CSS Class | Diagnostic Summary & Remediation Hint |
| :--- | :---: | :--- | :---: | :--- | :--- | :--- |
| `BANK_PORTAL_UNAVAILABLE` | `502` / `504` | **{Bank} Portal Unavailable** | `warning` | `{Bank} Timeout` | `diagnostic-badge warning` | Upstream bank confirmation gateway timed out. Portal may be in scheduled maintenance.<br>**Hint:** Retry in a few minutes or verify via mobile banking app. |
| `PORTAL_GEOBLOCKED` | `502` | **Bank Portal Geoblocked** | `warning` | `Geoblocked` | `diagnostic-badge warning` | Bank portal rejected non-Ethiopian egress or outbound proxy failed.<br>**Hint:** Inspect Ethiopian residential proxy configuration in Settings. |
| `BENEFICIARY_MISMATCH` | `422` | **Beneficiary Account Mismatch** | `error` | `Account Mismatch` | `diagnostic-badge danger` | Transferred funds were sent to an unauthorized account outside the merchant whitelist.<br>**Hint:** Reject order or verify if buyer paid a personal staff account. |
| `AMOUNT_MISMATCH` | `422` | **Payment Amount Mismatch** | `error` | `Amount Mismatch` | `diagnostic-badge danger` | Verified bank settlement amount is strictly less than order payable total.<br>**Hint:** Ask buyer to transfer the remaining deficit before fulfillment. |
| `RECEIPT_ALREADY_USED` | `409` | **Receipt Replay Detected** | `error` | `Replay Alert` | `diagnostic-badge danger` | Transaction reference code was previously verified and credited to another order.<br>**Hint:** Reject order immediately; potential fraud/slip reuse attempt. |
| `RECEIPT_EXPIRED` | `422` | **Receipt Stale / Expired** | `warning` | `Stale Receipt` | `diagnostic-badge warning` | Bank execution timestamp falls outside the allowable recency tolerance window.<br>**Hint:** Verify if customer paid for a previously abandoned order. |
| `QR_DECODE_FAILED` | `422` | **QR Matrix Decoding Failed** | `info` | `Blurry / Unreadable` | `diagnostic-badge neutral` | Receipt image QR code matrix could not be resolved across multi-pass filters.<br>**Hint:** Inspect uploaded slip photo manually or request a clean screenshot. |
| `UNSUPPORTED_BANK` | `422` | **Unsupported Banking Rail** | `info` | `Unsupported Bank` | `diagnostic-badge neutral` | Automated bank verification is not implemented for the detected payment rail.<br>**Hint:** Verify receipt manually via SMS or mobile banking app. |
| `CORRUPTED_FILE` | `400` | **Corrupted Receipt File** | `error` | `Corrupted File` | `diagnostic-badge danger` | Uploaded slip failed magic-byte validation (invalid JPEG, PNG, or PDF).<br>**Hint:** Request a valid image or document file from the customer. |
| `RATE_LIMITED` | `429` | **Bank Query Rate Limited** | `warning` | `Rate Limited` | `diagnostic-badge warning` | Too many verification queries dispatched against bank gateway in a short burst.<br>**Hint:** Wait 60 seconds before initiating another re-verification attempt. |
| `INTERNAL_ENGINE_ERROR` | `500` | **Verification Engine Error** | `error` | `Engine Error` | `diagnostic-badge danger` | Unhandled engine runtime exception during slip parsing or validation.<br>**Hint:** Inspect server logs (`bot.log`) or manually approve transfer. |

---

## 8. Frontend Integration Architecture

### 8.1 Orders Table Badge Rendering Rule
In `webapp/src/admin/AdminDashboard.tsx`, each row evaluates `order.evidence` and `order.status`:
1. **Auto-Verified Badge:** If `order.evidence?.status === 'auto_verified'`, render:
   - Green pill: `⚡ Auto-Verified ({BANK}) Ref: {NORMALIZED_REF}`
   - 1-Click copy button for reference code.
   - Clicking badge opens `AuditEvidenceModal` with detailed 4-pillar gate evaluations.
2. **Diagnostic Error Badge:** If `order.status === 'pending_approval'` and `order.evidence?.error_code` exists:
   - Render diagnostic pill using `badgeClass` and `badgeLabel` from `getVerificationDiagnosticToast()`.
   - Render inline micro-action button `[Re-verify with Bank]`.
3. **Audit Drawer Trigger:** Clicking any order row or evidence pill dispatches `fetchOrderReceiptStatusApi(order.id)`, presenting the operator with side-by-side inspection of customer slip and upstream bank proof.
