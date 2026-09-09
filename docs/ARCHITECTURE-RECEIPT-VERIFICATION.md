# Automated Ethiopian Bank Receipt Verification Architecture
## Native TypeScript In-Process Engine (CBE & Telebirr)

**Author:** Architecture Sub-Agent (`project-architecture-planner`)  
**Phase:** Phase 1 — System Architecture & ADR  
**Target Platform:** Node.js (v20+ ESM) / TypeScript / SQLite (`better-sqlite3`) / GramMY / Express  
**Date:** September 2026  

---

## 1. System Topology & Architecture

```mermaid
flowchart TD
    subgraph IngestionBoundary ["1. Ingestion & Pre-Processing"]
        UserUpload["User Upload (Telegram Photo/Doc/WebApp API)"] --> Validate["MIME / Magic Byte Check\n(JPEG, PNG, WebP, PDF)"]
        Validate --> Preprocess["Sharp Image Normalization\n(Grayscale, Contrast Stretch, Resize)"]
        Preprocess --> ZXing["ZXing MultiFormat Matrix Reader\n(Multi-pass Thresholding)"]
        Validate --> PDFParser["PDF Vector Stream Parser\n(pdf-parse text & link extraction)"]
    end

    subgraph OrchestrationBoundary ["2. Verification Orchestrator"]
        ZXing --> Router{"Bank Rail / URL Router"}
        PDFParser --> Router
        Router -->|CBE Pattern / Port 100 URL| CBEAdapt["CBE Bank Adapter"]
        Router -->|Telebirr Pattern / URL| TeleAdapt["Telebirr Adapter"]
        
        CBEAdapt --> CircuitBreaker["Circuit Breaker & 7.5s AbortController"]
        TeleAdapt --> CircuitBreaker
    end

    subgraph ExternalBankGateways ["3. External Bank Infrastructure"]
        CircuitBreaker -->|Direct Port 100/443 Egress| CBEGov["Commercial Bank of Ethiopia\n(apps.cbe.com.et:100)"]
        CircuitBreaker -->|HTTPS Proxy Tunnel| TeleProxy["Ethiopian Egress Proxy\n(Residential/Datacenter)"]
        TeleProxy --> TeleServer["Ethio Telecom Telebirr\n(transactioninfo.ethiotelecom.et)"]
    end

    subgraph SecurityGateBoundary ["4. 4-Pillar Security Gate"]
        CBEGov --> Extractor["Structured Bank Payload\n{ txRef, amount, beneficiary, timestamp }"]
        TeleServer --> Extractor
        Extractor --> P1["Pillar 1: Anti-Replay Assertion\n(Unique SQLite Index check)"]
        P1 --> P2["Pillar 2: Beneficiary Whitelist Match\n(Matches shop CBE/Telebirr account)"]
        P2 --> P3["Pillar 3: Exact Amount Check\n(Amount >= Net Payable ETB)"]
        P3 --> P4["Pillar 4: Recency Window Assertion\n(Within 60m before / 120m after order)"]
    end

    subgraph ResolutionBoundary ["5. Resolution & Fulfillment"]
        P4 -->|All 4 Pillars PASSED| AutoFulfill["Fulfillment Bridge\n(BEGIN IMMEDIATE TX)"]
        AutoFulfill --> StockAlloc["Stock Allocation (Gemini Pro)\nOR Reseller Dispatch (Premium)"]
        StockAlloc --> BuyerNotify["Deliver Goods to Buyer in Chat\n(Instant Zero-Touch)"]
        
        P1 -.->|Pillar Failed / Unreadable / Timeout| Fallback["Fallback Manager\n(Order -> pending_approval)"]
        P2 -.-> Fallback
        P3 -.-> Fallback
        P4 -.-> Fallback
        CircuitBreaker -.->|Upstream 5xx / Timeout| Fallback
        
        Fallback --> AdminAlert["Dispatch Alert to Admin Channel\n(Photo + Pre-filled Audit Diagnostics)"]
        AdminAlert --> ManualReview["Human Admin 1-Tap Action\n[Approve] [Reject]"]
    end
```

---

## 2. Sequence Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer
    participant TG as Telegram Bot / API
    participant Ingest as Ingestion & Matrix Decoder
    participant Orch as Verifier Orchestrator
    participant Bank as Bank Portal (CBE / Telebirr)
    participant Gate as 4-Pillar Security Gate
    participant DB as SQLite DB
    participant Fulfill as Fulfillment Bridge
    actor Admin as Store Admin

    Buyer->>TG: Uploads transfer screenshot / PDF
    TG->>Ingest: Ingest receipt buffer (Max 10MB)
    Ingest->>Ingest: Magic byte check & save to /data/receipts
    alt Format is Image
        Ingest->>Ingest: Sharp: Normalize, grayscale, contrast stretch
        Ingest->>Ingest: ZXing: Decode QR matrix
    else Format is Vector PDF
        Ingest->>Ingest: pdf-parse: Extract text & URLs
    end

    alt QR / Reference Successfully Decoded
        Ingest->>Orch: Parsed Reference / Bank Confirmation URL
        Orch->>Bank: GET Confirmation URL (Timeout = 7.5s, Port 100 or ET Proxy)
        alt Bank Responded (200 OK)
            Bank-->>Orch: Confirmation HTML / PDF
            Orch->>Orch: Extract { txRef, sender, receiverAcc, amountEtb, timestamp }
            Orch->>Gate: Evaluate 4 Pillars (orderId, requiredAmount, bankData)
            Gate->>DB: Check receipt_evidence for reference replay
            alt All 4 Pillars PASSED
                Gate->>DB: BEGIN IMMEDIATE TRANSACTION
                Gate->>DB: Insert receipt_evidence (matched=1, ref=txRef)
                Gate->>DB: Update order status='fulfilled', payment_ref=txRef
                Gate->>Fulfill: Dispatch delivery
                alt Stock Item (Gemini Pro)
                    Fulfill->>DB: allocateStock(product_id, order_id)
                    Fulfill-->>TG: Send activation link + instructions
                    TG-->>Buyer: 🎉 "Payment Verified! Here is your Gemini Pro link..."
                else Reseller Item (Telegram Premium)
                    Fulfill->>Fulfill: Call Reseller Cascade (Gramix / iStar)
                    TG-->>Buyer: ⚡ "Payment Verified! Premium gift dispatched to your @username."
                end
                Gate->>DB: COMMIT TRANSACTION
                Gate->>Admin: Info notification ("Auto-fulfilled Order #...")
            else Security Pillar Mismatch
                Gate->>DB: Update order status='pending_approval' + Log Evidence
                Gate->>Admin: Alert Admin with Diagnostic Card (e.g. "Amount Mismatch: 500 ETB vs 1250 ETB")
                TG-->>Buyer: "Receipt received! Our team is performing a manual verification."
            end
        else Bank Timeout / 502 / Proxy Failure
            Orch->>DB: Update order status='pending_approval', note="Bank verification timed out"
            Orch->>Admin: Alert Admin: "Bank portal unreachable. Manual review needed."
            TG-->>Buyer: "Receipt received! Our team is reviewing it shortly."
        end
    else QR Unreadable / Corrupted Screenshot
        Ingest->>DB: Update order status='pending_approval'
        Ingest->>Admin: Send photo + alert: "Unreadable QR / Manual review required"
        TG-->>Buyer: "Receipt received! Our team is reviewing it shortly."
    end
```

---

## 3. Modular Boundaries & Directory Structure

```
bot/src/services/receipt_verifier/
├── index.ts                      # Main facade: processReceiptSubmission()
├── types.ts                      # Contracts, interfaces, and shared types
├── ingestion/
│   ├── image_preprocessor.ts    # Sharp-based image optimization
│   ├── qr_decoder.ts            # ZXing QR matrix reader with fallback
│   ├── pdf_extractor.ts         # pdf-parse text stream extractor
│   └── text_ref_parser.ts       # Raw SMS / text regex extraction
├── adapters/
│   ├── base.adapter.ts          # IBankReceiptVerifier abstract class
│   ├── cbe.adapter.ts           # Port 100 HTTPS / PDF parser
│   ├── telebirr.adapter.ts      # Ethiopian proxy scraper via cheerio
│   └── mock.adapter.ts          # Unit test mock harness
├── security_gate/
│   ├── pillars.ts               # 4-Pillar verification engine
│   └── whitelist.ts             # Account number whitelist resolver
├── fulfillment/
│   └── fulfillment_bridge.ts    # Stock & reseller dispatch bridge
└── fallback/
    └── fallback_manager.ts      # Admin review queue router & alert card generator
```

---

## 4. Key TypeScript Interfaces

```typescript
export type BankRail = 'cbe' | 'telebirr' | 'abyssinia' | 'unknown';

export interface ExtractedReceiptData {
  bank: BankRail;
  rawReference: string;
  normalizedReference: string;
  sourceUrl?: string;
  amountEtb?: number;
  extractedAt: Date;
  rawPayloadSnippet?: string;
}

export interface BankVerificationResult {
  verified: boolean;
  bank: BankRail;
  transactionReference: string;
  amountEtb: number;
  beneficiaryAccount: string;
  beneficiaryName?: string;
  senderIdentifier?: string;
  transactionTimestamp: Date;
  rawAuditTrail: Record<string, unknown>;
  failureReason?: string;
}

export interface IBankReceiptVerifier {
  readonly bankRail: BankRail;
  canHandle(data: ExtractedReceiptData): boolean;
  verify(data: ExtractedReceiptData, timeoutMs?: number): Promise<BankVerificationResult>;
}

export interface SecurityPillarEvaluation {
  passed: boolean;
  pillar: 'anti_replay' | 'account_match' | 'amount_check' | 'recency_window';
  expected: string | number;
  actual: string | number;
  message?: string;
}

export interface SecurityGateResult {
  passed: boolean;
  evaluations: SecurityPillarEvaluation[];
  failedPillar?: SecurityPillarEvaluation;
}
```

---

## 5. Security & Threat Mitigation Summary

1. **Anti-Replay**: SQLite `receipt_evidence` stores `reference` with a unique index. A database write lock (`BEGIN IMMEDIATE`) guarantees atomic single-use per transaction slip.
2. **Account Match**: Slips paid to third parties or friends are rejected; beneficiary account must strictly match store configuration (`CBE: 1000510711258`, `Telebirr: 0965579045`).
3. **Amount Check**: Verified amount must satisfy `verifiedAmount >= order.amount_etb - order.discount_etb`.
4. **Recency Window**: Slip timestamp must fall within `[order.created_at - 60m, order.created_at + 120m]`.
5. **SSRF Guard**: Strict URL validation ensures requests only target `*.cbe.com.et` (port 100 or 443) and `*.ethiotelecom.et` / `telebirr.et`. All loopback, private, and metadata IP addresses are strictly rejected.
6. **Decompression Bomb Protection**: Sharp limits image input dimensions to 16 megapixels (`limitInputPixels: 16777216`) and input buffer sizes to 10MB.
7. **Circuit Breaker & Timeouts**: 7.5s hard `AbortController` timeout on all outbound bank calls; 3 consecutive timeouts trip the breaker to `OPEN` for 120s, instantly routing incoming receipts to the admin review queue.
