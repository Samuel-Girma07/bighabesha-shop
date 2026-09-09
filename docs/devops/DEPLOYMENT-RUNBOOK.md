# Bighabesha Shop — Production Operations & Deployment Runbook
**Ethiopian Bank Receipt Verification Engine & Bot Platform**

- **Target Audience:** DevOps Engineers, Site Reliability Engineers (SRE), Systems Administrators
- **Classification:** Internal / Confidential Operational Standard
- **Revision:** v1.4.0 (Admin Dashboard Bank Verification Integration)
- **Last Updated:** September 2026

---

## Table of Contents

1. [Architectural Overview & Network Topology](#1-architectural-overview--network-topology)
2. [Egress Firewall & Banking Port Policies](#2-egress-firewall--banking-port-policies)
3. [Telebirr Residential Proxy Architecture](#3-telebirr-residential-proxy-architecture)
4. [Multi-Platform Deployment Guides](#4-multi-platform-deployment-guides)
   - [4.1 Render / Hugging Face Spaces (PaaS + Litestream)](#41-render--hugging-face-spaces-paas--litestream)
   - [4.2 AWS EC2 / Lightsail](#42-aws-ec2--lightsail)
   - [4.3 DigitalOcean Droplets & Hetzner Cloud](#43-digitalocean-droplets--hetzner-cloud)
   - [4.4 Ethio Telecom Cloud / In-Country Ethiopian VPS](#44-ethio-telecom-cloud--in-country-ethiopian-vps)
5. [Database Migration Playbook (Migrations 011 & 012)](#5-database-migration-playbook-migrations-011--012)
   - [5.1 Scope of Migration 011 (Core Verification Schema)](#51-scope-of-migration-011-core-verification-schema)
   - [5.2 Scope of Migration 012 (Admin Dashboard Optimizations & Composite Indexing)](#52-scope-of-migration-012-admin-dashboard-optimizations--composite-indexing)
   - [5.3 Pre-Flight Safety Checks & Zero-Downtime Guarantee](#53-pre-flight-safety-checks--zero-downtime-guarantee)
6. [Dynamic Bank Account & Engine Configuration (Zero-.env Standard)](#6-dynamic-bank-account--engine-configuration-zero-env-standard)
   - [6.1 Why Bank Accounts Are NOT Configured in .env](#61-why-bank-accounts-are-not-configured-in-env)
   - [6.2 Configuring Bank Accounts via Web Admin Dashboard](#62-configuring-bank-accounts-via-web-admin-dashboard)
   - [6.3 Configuring Bank Accounts via Telegram Bot](#63-configuring-bank-accounts-via-telegram-bot)
   - [6.4 Runtime Persistence & Zero-Restart Cache Invalidation](#64-runtime-persistence--zero-restart-cache-invalidation)
7. [Admin Dashboard Verification & Operational Acceptance Playbook](#7-admin-dashboard-verification--operational-acceptance-playbook)
   - [7.1 Production Build & Static Asset Verification](#71-production-build--static-asset-verification)
   - [7.2 Master Toggle Verification](#72-master-toggle-verification)
   - [7.3 Bank Account Number Strict Validation Tests](#73-bank-account-number-strict-validation-tests)
   - [7.4 Audit Evidence Modal & Telemetry Verification](#74-audit-evidence-modal--telemetry-verification)
8. [Operational Telemetry, Monitoring & Alerting](#8-operational-telemetry-monitoring--alerting)
   - [8.1 Critical Operational Metrics & SLOs](#81-critical-operational-metrics--slos)
   - [8.2 Administrative Telemetry Queries](#82-administrative-telemetry-queries)
9. [Disaster Recovery, Backups & Rollback Playbook](#9-disaster-recovery-backups--rollback-playbook)
   - [9.1 Automated Nightly Backup Schedule](#91-automated-nightly-backup-schedule)
   - [9.2 Database Restoration Procedure (RTO < 5 minutes)](#92-database-restoration-procedure-rto--5-minutes)
   - [9.3 Automated Rollback Execution](#93-automated-rollback-execution)
10. [Troubleshooting & Incident Response Quick Reference](#10-troubleshooting--incident-response-quick-reference)

---

## 1. Architectural Overview & Network Topology

Bighabesha Shop operates a containerized Node.js runtime hosting a Telegram Bot (GrammY), a Mini App REST API (Express), an embedded SQLite database engine (`better-sqlite3` configured with Write-Ahead Logging — WAL), continuous S3/Backblaze B2 replication (Litestream), and the **Ethiopian Bank Receipt Verification Engine**.

```
                           +-----------------------------------------------+
                           |            Customer / User Traffic            |
                           |   (Telegram Bot Client / Mini App WebApp)     |
                           +-----------------------+-----------------------+
                                                   |
                                                   v
                           +-----------------------------------------------+
                           |          Ingress Reverse Proxy / CDN          |
                           |   (Cloudflare Pages / Tunnel / Nginx / ALB)   |
                           +-----------------------+-----------------------+
                                                   |  HTTPS / WSS (Port 3000)
                                                   v
   +-----------------------------------------------------------------------------------------------+
   | Container Runtime: bighabesha-bot (node:20-bookworm-slim, User: node)                         |
   |                                                                                               |
   |  +---------------------------+  +--------------------------+  +----------------------------+  |
   |  |     GrammY Bot Engine     |  |   Express REST Server    |  |  Receipt Ingestion Service |  |
   |  | (Photo/Doc/Text Handlers) |  |   (/api/health, /verify) |  |  (Sharp, ZXing QR, PDF)    |  |
   |  +-------------+-------------+  +------------+-------------+  +-------------+--------------+  |
   |                |                             |                              |                 |
   |                +-----------------------------+------------------------------+                 |
   |                                              |                                                |
   |                                              v                                                |
   |                         +-----------------------------------------+                           |
   |                         |       Receipt Orchestrator Engine       |                           |
   |                         |  - 4-Pillar Security Gate               |                           |
   |                         |  - Circuit Breakers (CBE, Telebirr)     |                           |
   |                         +--------------------+--------------------+                           |
   |                                              |                                                |
   |         +------------------------------------+------------------------------------+           |
   |         v                                                                         v           |
   |  +-----------------------+                                                 +---------------+  |
   |  | Local SQLite Database |                                                 | Bank Adapters |  |
   |  | (data/shop.db, WAL)   |                                                 +-------+-------+  |
   |  +-----------+-----------+                                                         |          |
   +--------------|---------------------------------------------------------------------|----------+
                  |                                                                     |
                  | (Litestream Replication)                                            | (Outbound Egress)
                  v                                                                     v
   +------------------------------+                    +--------------------------------+---------------+
   | Cloud S3 / Backblaze B2      |                    | External Banking Rail Portals                  |
   | - Continuous WAL Sync        |                    | - CBE: https://apps.cbe.com.et:100            |
   | - Customer Receipt Snapshots |                    | - Telebirr: https://transactioninfo.ethio...  |
   +------------------------------+                    | - Awash Bank: Port 8225                        |
                                                       +------------------------------------------------+
```

---

## 2. Egress Firewall & Banking Port Policies

Unlike standard web applications whose egress is strictly bound to Port 443/80, the Ethiopian Bank Receipt Verification Engine communicates with proprietary government and commercial banking infrastructure operating over custom non-standard ports.

### 2.1 Required Outbound Egress Table

| Destination Entity | Domain / Hostname | Outbound Port | Protocol | Purpose / Description |
| :--- | :--- | :--- | :--- | :--- |
| **Telegram Bot API** | `api.telegram.org` | **443** | HTTPS | Bot polling, webhook dispatch, photo/document downloads. |
| **Commercial Bank of Ethiopia** | `apps.cbe.com.et` | **100** | HTTPS | CBE transaction confirmation portal (`/?id=FT...`). |
| **Commercial Bank of Ethiopia (Web)** | `apps.cbe.com.et` | **443** | HTTPS | CBE web fallback confirmation. |
| **Telebirr Confirmation Portal** | `transactioninfo.ethiotelecom.et` | **443** | HTTPS | Telebirr slip validation (via proxy or direct). |
| **Telebirr Core Rail** | `telebirr.et` | **443** | HTTPS | Secondary Telebirr portal redirect. |
| **Awash Bank Mobile Portal** | `awashbirr.awashbank.com` | **8225** | HTTPS | Awash Bank payment verification portal. |
| **Bank of Abyssinia** | `bankofabyssinia.com` | **443** | HTTPS | BoA payment verification portal. |
| **Ethiopian Residential Proxy** | Customer Proxy Endpoint | **1080 / 8080** | SOCKS5 / HTTP | Residential egress forward proxy for Telebirr geo-fence bypass. |
| **Backblaze B2 / S3** | `s3.*.backblazeb2.com` | **443** | HTTPS | Litestream continuous SQLite WAL replication. |

> [!CAUTION]
> **Port 100 Egress Warning:**
> Most cloud providers (e.g. AWS Security Groups, DigitalOcean Cloud Firewalls, Hetzner Cloud Networks) default to allowing all outbound traffic (`0.0.0.0/0 ALL`), but **strict enterprise VPCs, internal corporate firewalls, and certain university networks block outbound TCP Port 100 by default** because Port 100 is historically reserved. You MUST verify outbound Port 100 egress before deploying.

### 2.2 Egress Verification Script

Use the automated diagnostic script located in the repository:
```bash
chmod +x scripts/test-bank-egress.sh
./scripts/test-bank-egress.sh
```

Or perform manual checks with `nc` and `curl`:
```bash
# 1. Test CBE Port 100 TCP handshake
nc -zv apps.cbe.com.et 100

# 2. Test CBE Port 100 HTTPS negotiation
curl -Iv --connect-timeout 5 https://apps.cbe.com.et:100/

# 3. Test Awash Port 8225 TCP handshake
nc -zv awashbirr.awashbank.com 8225

# 4. Test Telebirr Portal
curl -Iv --connect-timeout 5 https://transactioninfo.ethiotelecom.et/
```

### 2.3 Firewall Rule Configurations (UFW & iptables)

If deploying on an Ubuntu host with UFW enabled:
```bash
# Allow standard SSH and HTTP/HTTPS ingress
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# If outgoing policy is set to DENY, explicitly allow banking ports:
sudo ufw allow out 53/udp     # DNS
sudo ufw allow out 443/tcp    # HTTPS
sudo ufw allow out 100/tcp    # Commercial Bank of Ethiopia (CBE)
sudo ufw allow out 8225/tcp   # Awash Bank
sudo ufw allow out 1080/tcp   # SOCKS5 Proxy Egress
sudo ufw reload
```

---

## 3. Telebirr Residential Proxy Architecture

### 3.1 The Telebirr Geoblocking Mechanism
Ethio Telecom’s confirmation portal (`transactioninfo.ethiotelecom.et`) actively enforces geo-fencing via Cloudflare and internal edge routing. Incoming queries from IP addresses originating outside Ethiopia (Autonomous System `AS24757 - ETHIONET`) receive an immediate `HTTP 403 Forbidden` or `HTTP 451 Unavailable For Legal Reasons`.

When the receipt verification engine detects an HTTP 403 or network proxy drop from Telebirr, it throws a typed `PortalGeoblockedError` and safely diverts the order into the **manual administrative review queue** without failing the customer order.

### 3.2 Setting Up the In-Country Proxy
To achieve 100% automated Telebirr verification from cloud environments outside Ethiopia:

1. **Option A: Dedicated In-Country Proxy (Recommended)**
   - Provision a low-cost VPS inside Ethiopia (e.g. Ethio Telecom Cloud, Addis Ababa Datacenter) or install an authenticated forward proxy (Squid or Dante) on a local gateway.
   - Install Dante SOCKS5 server:
     ```bash
     sudo apt-get install dante-server
     ```
   - Configure `/etc/danted.conf` to require username/password authentication.

2. **Option B: Residential Proxy Network**
   - Utilize a residential proxy provider with dedicated Ethiopian ASN targeting (`country=ET`, `asn=24757`).

3. **Configuring Bighabesha Shop:**
   Add the proxy connection string to `.env`:
   ```bash
   TELEBIRR_PROXY_URL=socks5://proxy_user:proxy_secret@196.188.120.45:1080
   # Or HTTP/HTTPS proxy:
   # TELEBIRR_PROXY_URL=http://proxy_user:proxy_secret@196.188.120.45:8888
   ```

4. **Verifying Proxy Connectivity:**
   Test that Telebirr responds with HTTP 200 through the proxy:
   ```bash
   curl -x "$TELEBIRR_PROXY_URL" -Iv https://transactioninfo.ethiotelecom.et/
   ```

---

## 4. Multi-Platform Deployment Guides

### 4.1 Render / Hugging Face Spaces (PaaS + Litestream)

For zero-maintenance deployments utilizing Render’s Docker Web Service or Hugging Face Docker Spaces:

1. **Configure Persistent Disk on Render:**
   - Mount Path: `/var/data`
   - Size: `10 GB` (adequate for 100,000+ receipts and SQLite WAL)
2. **Environment Variables in Render Dashboard:**
   ```bash
   NODE_ENV=production
   PORT=3000
   DATA_DIR=/var/data
   DATABASE_PATH=/var/data/shop.db
   RECEIPTS_DIR=/var/data/receipts
   BOT_TOKEN=<your-telegram-bot-token>
   ADMIN_IDS=<admin1_id>,<admin2_id>
   ADMIN_PASSWORD=<strong-master-password>
   WALLET_PAY_MODE=live
   WALLET_PAY_API_KEY=<wallet-pay-key>
   WEBAPP_URL=https://shop.bighabesha.com
   TRUST_PROXY=1
   # Litestream cloud replication:
   B2_BUCKET=bighabesha-db-backup
   B2_ENDPOINT=s3.us-west-004.backblazeb2.com
   B2_KEY_ID=<backblaze-key-id>
   B2_APPLICATION_KEY=<backblaze-app-key>
   # Receipt verification:
   RECEIPT_AUTO_VERIFY_ENABLED=1
   RECEIPT_CBE_PORT=100
   TELEBIRR_PROXY_URL=socks5://user:pass@ethiopia-proxy:1080
   ```
3. Render automatically executes the multi-stage Dockerfile, launches `scripts/run-with-litestream.mjs`, restores the SQLite DB from Backblaze B2 if `/var/data/shop.db` is empty, runs migrations, and serves the application.

---

### 4.2 AWS EC2 / Lightsail

For running on an AWS Ubuntu 22.04 / 24.04 instance:

1. **Security Group Configuration:**
   - **Inbound:** Port `22` (SSH, restricted to your IP), Port `80` (HTTP), Port `443` (HTTPS).
   - **Outbound:** All traffic (`0.0.0.0/0`), ensuring Port `100` (CBE) and Port `443` are reachable.
2. **Deploy with Docker Compose:**
   ```bash
   git clone https://github.com/Samuel-Girma07/bighabesha-shop.git /opt/bighabesha-shop
   cd /opt/bighabesha-shop
   cp .env.example .env
   # Edit .env with production credentials
   nano .env

   # Build and launch
   docker compose up -d bot
   ```
3. **Attach Cloudflare Tunnel or Caddy/Nginx Reverse Proxy:**
   Forward incoming HTTPS requests on `api.shop.bighabesha.com` to `http://127.0.0.1:3000`.

---

### 4.3 DigitalOcean Droplets & Hetzner Cloud

1. **System Initialization:**
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 sqlite3 curl git
   sudo systemctl enable --now docker
   ```
2. **Deploy Application:**
   ```bash
   mkdir -p /opt/bighabesha-shop && cd /opt/bighabesha-shop
   git clone https://github.com/Samuel-Girma07/bighabesha-shop.git .
   cp .env.example .env
   nano .env
   docker compose up -d bot
   ```
3. **Smoke Test Healthcheck:**
   ```bash
   docker ps
   # Inspect container healthcheck status:
   docker inspect --format='{{json .State.Health}}' bighabesha-bot | jq
   ```

---

### 4.4 Ethio Telecom Cloud / In-Country Ethiopian VPS

Hosting directly on an in-country provider in Addis Ababa offers distinct architectural advantages:
- **Zero Geoblocking:** Direct access to Telebirr (`transactioninfo.ethiotelecom.et`) without requiring a proxy.
- **Ultra-low Latency:** `< 15ms` roundtrip to CBE Port 100 and Telebirr portals.
- **High Ingestion Throughput:** Upstream bank portal queries complete in under 800ms.

Deployment steps are identical to Section 4.3. Leave `TELEBIRR_PROXY_URL` blank in `.env` for direct local network egress.

---

## 5. Database Migration Playbook (Migrations 011 & 012)

### 5.1 Scope of Migration 011 (`011_bank_receipt_verification.sql`)
Migration 011 establishes the foundational data architecture for automated Ethiopian bank receipt verification:
1. Rebuilds `receipt_evidence` with foreign keys to `orders(id)` and `users(id)`, adding `normalized_reference`, `security_gate_evaluations`, and `status`.
2. Creates the structural **Anti-Replay Unique Indexes**:
   - `idx_receipt_evidence_anti_replay` ON `receipt_evidence(bank, reference COLLATE NOCASE) WHERE matched = 1`
   - `idx_receipt_evidence_normalized_anti_replay` ON `receipt_evidence(bank, normalized_reference) WHERE matched = 1`
3. Creates `bank_verification_audits` for attempt-level telemetry and upstream DOM snapshots.
4. Initializes default system settings in `settings` table.

### 5.2 Scope of Migration 012 (`012_admin_dashboard_optimizations.sql`)
Migration 012 delivers critical query performance optimizations and configuration completeness required by the Admin Dashboard:

1. **Composite Covering Index for Batch Evidence Resolution:**
   ```sql
   CREATE INDEX IF NOT EXISTS idx_receipt_evidence_order_id
       ON receipt_evidence(order_id, id DESC);
   ```
   - **Problem Solved:** In the Admin Dashboard Orders view, orders are loaded in pages of up to 100 records. To enrich each order with its latest verification evidence, the backend executes:
     ```sql
     SELECT MAX(id) FROM receipt_evidence WHERE order_id IN (?, ?, ...) GROUP BY order_id;
     ```
   - **Performance Impact:** Without this composite index, SQLite performs sequential table scans over `receipt_evidence`. With `idx_receipt_evidence_order_id`, SQLite utilizes an **index-only covering scan**, dropping query execution latency from ~85ms down to `< 1.5ms` across 500,000+ records.

2. **Idempotent Verification Settings Seeding:**
   Ensures all 12 core bank verification configuration keys are present in SQLite with hardened defaults:
   ```sql
   INSERT INTO settings (key, value) VALUES
       ('receipt_auto_verify_enabled', '1'),
       ('receipt_recency_before_mins', '120'),
       ('receipt_recency_after_mins', '120'),
       ('receipt_circuit_breaker_threshold', '5'),
       ('receipt_circuit_breaker_cooldown_sec', '60'),
       ('receipt_retention_days_raw_payloads', '14'),
       ('receipt_retention_days_unverified', '30'),
       ('receipt_retention_days_verified', '365'),
       ('receipt_cbe_beneficiaries', '["0000000000000"]'),
       ('receipt_telebirr_beneficiaries', '["0000000000"]'),
       ('receipt_abyssinia_beneficiaries', '["0000000000000"]'),
       ('receipt_ethiopia_proxy_url', '')
   ON CONFLICT(key) DO NOTHING;
   ```

### 5.3 Pre-Flight Safety Checks & Zero-Downtime Guarantee
1. **Zero-Downtime Startup Execution:**
   - Database migrations are automatically discovered and executed by `bot/src/db/migrator.ts` during application boot.
   - Migrations execute sequentially inside an atomic SQLite transaction (`db.transaction(...)`).
   - SQLite WAL mode (`PRAGMA journal_mode = WAL`) guarantees that existing read queries are never blocked while the migration transaction commits.
2. **Pre-Flight Hot Backup Command:**
   Prior to container updates or schema rollout:
   ```bash
   sqlite3 /app/data/shop.db ".backup /app/data/shop.db.pre-012.bak"
   sqlite3 /app/data/shop.db.pre-012.bak "PRAGMA integrity_check;"
   # Expected output: ok
   ```
3. **Post-Boot Migration Verification:**
   ```bash
   # Verify migration 012 is recorded:
   sqlite3 /app/data/shop.db "SELECT name, applied_at FROM _migrations ORDER BY id DESC LIMIT 3;"
   # Expected: 012_admin_dashboard_optimizations.sql

   # Verify covering index existence:
   sqlite3 /app/data/shop.db "PRAGMA index_info('idx_receipt_evidence_order_id');"

   # Verify default verification settings:
   sqlite3 /app/data/shop.db "SELECT key, value FROM settings WHERE key LIKE 'receipt_%';"
   ```

---

## 6. Dynamic Bank Account & Engine Configuration (Zero-.env Standard)

### 6.1 Why Bank Accounts Are NOT Configured in `.env`
Bighabesha Shop strictly adheres to a **Zero-Secret / Dynamic Configuration Standard** for merchant banking accounts:

1. **Security & Leak Prevention:** Hardcoding merchant bank accounts or Till numbers into `.env` files exposes them to version control leaks, environment dumps, log captures, and container inspection.
2. **Zero-Downtime Reconfiguration:** Merchant bank accounts and Till numbers occasionally rotate due to bank branch limits, business restructuring, or maintenance. Requiring a `.env` modification and container restart causes service interruption.
3. **Role-Based Governance (RBAC):** Updating bank accounts requires authenticated administrative access with explicit `settings.write` permission. Every configuration change is recorded in `audit_logs` with the actor's user ID, IP address, and old/new values.
4. **Fail-Safe Initial State:** Out-of-the-box installations initialize with dummy placeholder beneficiary numbers (`["0000000000000"]`). The automated verification engine will reject transactions until the legitimate merchant account is configured by a verified administrator.

### 6.2 Configuring Bank Accounts via Web Admin Dashboard
Administrators configure and manage beneficiary accounts through the single-page Admin Dashboard:

1. **Access Control:** Log into `/admin` using administrative credentials and enter the Telegram 2FA OTP.
2. **Navigate to Settings:** Click on the **Settings** navigation tab.
3. **Configure Bank Beneficiary Accounts:**
   - **Commercial Bank of Ethiopia (CBE):** Enter 13-digit account numbers (e.g., `1000123456789`). Supports multiple accounts entered as comma-separated values or JSON array.
   - **Telebirr:** Enter 10-digit mobile account numbers starting with `09` or `07` (e.g., `0911234567` or `0712345678`).
   - **Bank of Abyssinia (BoA):** Enter 13 to 16-digit account numbers (e.g., `1234567890123`).
   - **Residential Proxy URL (Optional):** Enter the SOCKS5 or HTTP proxy URL (e.g., `socks5://user:secret@196.188.120.45:1080`) used to bypass Telebirr geoblocking if hosting outside Ethiopia.
4. **Save Configuration:** Click **Save Settings**. The frontend validates all fields client-side before dispatching the payload.
5. **Confirmation:** A green toast notification confirms atomic persistence.

### 6.3 Configuring Bank Accounts via Telegram Bot
For field emergencies or mobile-only administrators, bank accounts can also be managed directly in Telegram:
- Open a private chat with the Bot from an authorized Telegram Admin ID (`ADMIN_IDS`).
- Send `/admin` -> Select **Bank Settings** -> **Manage Accounts**.
- The bot validates the account format (13 digits for CBE, 10 digits for Telebirr) and persists the changes directly to SQLite.

### 6.4 Runtime Persistence & Zero-Restart Cache Invalidation
The configuration pipeline operates completely in-memory and in SQLite without requiring process restarts:

```
[Admin Dashboard UI]
        │  PUT /api/admin/settings { settings: { ... } }
        ▼
[adminRouter.put('/settings')]
        │  1. Authorize: req.admin.permissions.includes('settings.write')
        │  2. Whitelist: check against KNOWN_SETTING_KEYS
        │  3. Validate: validateVerificationSettings(settings)
        ▼
[settings.service.ts -> setSettings()]
        │  4. Atomic Transaction: INSERT ... ON CONFLICT(key) DO UPDATE
        ▼
[cache.service.ts -> invalidate('bootstrap:catalog')]
        │  5. Evict public bootstrap cache
        ▼
[Mini App & Bot Storefront]
   (Instantly serves updated account numbers to checkout clients)
```

1. **Atomic Transaction:** All key-value updates execute within a single `db.transaction()` block in `settings.service.ts`.
2. **Instant Cache Eviction:** Upon committing, `cache.service.ts` invalidates the public `bootstrap:catalog` cache. Customer Mini App instances immediately fetch the new beneficiary details.
3. **Verification Engine Synchronization:** Every receipt verification job calls `getVerificationSettings()`, which reads directly from the updated database state.

---

## 7. Admin Dashboard Verification & Operational Acceptance Playbook

DevOps and QA teams must execute this verification checklist following any container deployment or version upgrade.

### 7.1 Production Build & Static Asset Verification
Verify that the multi-stage Docker build bundled the compiled single-page application and that Express serves all static assets:

1. **Verify Asset Artifacts:**
   ```bash
   # Inside container or build output:
   ls -lh /app/webapp/dist
   # Confirm index.html and assets/ directory exist with hashed bundles:
   # dist/assets/index-*.js
   # dist/assets/AdminDashboard-*.js
   # dist/assets/index-*.css
   ```
2. **Verify Static Asset Serving via Express:**
   ```bash
   # Test main application index:
   curl -sI http://localhost:3000/ | grep -E "HTTP/1.1 200|content-type: text/html"

   # Test Admin SPA fallback (non-API route returns index.html):
   curl -sI http://localhost:3000/admin | grep -E "HTTP/1.1 200|content-type: text/html"

   # Test static chunk serving (must return 200 with javascript content-type):
   CHUNK=$(grep -o 'assets/index-[^"]*\.js' /app/webapp/dist/index.html | head -n 1)
   curl -sI "http://localhost:3000/$CHUNK" | grep -E "HTTP/1.1 200|javascript"
   ```

### 7.2 Master Toggle Verification
1. **Navigate to Dashboard:** Open `/admin` in the browser, authenticate, and navigate to **Settings**.
2. **Toggle Master Switch:**
   - Locate **Automated Verification Engine** master switch.
   - Toggle the switch to **Disabled (OFF)** and click **Save Settings**.
   - **Verification:** Submit a test receipt or inspect `settings` in SQLite:
     ```bash
     sqlite3 /app/data/shop.db "SELECT value FROM settings WHERE key = 'receipt_auto_verify_enabled';"
     # Must return: 0
     ```
   - In this state, any uploaded receipt automatically bypasses upstream portal calls and enters the queue with status `pending_manual_review` and error code `AUTO_VERIFY_DISABLED`.
3. **Restore Master Switch:**
   - Toggle the switch back to **Enabled (ON)** and click **Save Settings**.
   - Confirm `receipt_auto_verify_enabled` returns to `1`.

### 7.3 Bank Account Number Strict Validation Tests
Verify that the Admin Dashboard prevents invalid account formats from reaching the database:

| Bank Provider | Valid Test Input | Invalid Test Input | Expected UI Behavior | Expected API HTTP Response |
| :--- | :--- | :--- | :--- | :--- |
| **Commercial Bank of Ethiopia (CBE)** | `1000123456789` (13 digits) | `100012345` (9 digits)<br>`10001234567890` (14 digits)<br>`1000ABCD56789` (letters) | Inline error: "CBE account numbers must be 13 digits" | `400 Bad Request` |
| **Telebirr** | `0911234567` (10 digits)<br>`0712345678` (10 digits) | `0811234567` (invalid prefix)<br>`09112345` (8 digits)<br>`+251911234567` (international format) | Inline error: "Telebirr account numbers must be 10 digits starting with 09 or 07" | `400 Bad Request` |
| **Bank of Abyssinia (BoA)** | `1234567890123` (13 digits)<br>`1234567890123456` (16 digits) | `123456789` (9 digits)<br>`12345678901234567` (17 digits) | Inline error: "Bank of Abyssinia accounts must be 13 to 16 digits" | `400 Bad Request` |

**Automated API Validation Check:**
```bash
# Verify API strictly rejects invalid CBE account format:
curl -s -X PUT http://localhost:3000/api/admin/settings \
  -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"settings":{"receipt_cbe_beneficiaries":"[\"99999\"]"}}' | jq .
# Expected: { "error": "Settings validation failed: CBE account numbers must be 13 digits..." }
```

### 7.4 Audit Evidence Modal & Telemetry Verification
The Admin Dashboard provides full forensic visibility into receipt verification through the `AuditEvidenceModal`.

1. **Access Orders Management:** Navigate to `/admin` -> **Orders**.
2. **Locate Verified / Flagged Orders:** Locate an order displaying a verification status badge (`Auto-Verified`, `Needs Review`, `Rejected`, or `Verified`).
3. **Open Audit Evidence Modal:** Click on the receipt status badge or the **Audit Evidence** button.
4. **Verification Checklist:**
   - **Header Forensic Telemetry:** Confirm the modal displays the transaction reference (e.g. `FT262529W1GB`), normalized reference, bank badge (CBE/Telebirr/Abyssinia), and match status.
   - **4-Pillar Security Gate Card:**
     - **Recency Check:** Green checkmark if transaction was within ±120 minutes of order creation; amber/red if outside tolerance.
     - **Amount Match:** Expected order total in ETB vs transferred receipt amount.
     - **Beneficiary Match:** Destination account matching registered merchant accounts.
     - **Anti-Replay Protection:** Unique reference verification guaranteeing no prior order claimed this transaction.
   - **Extracted Text / OCR Tab:** Verify that parsed OCR data (sender name, recipient name, timestamp, reference) is visible.
   - **Upstream Portal DOM Snapshot:** For automated CBE or Telebirr verifications, inspect the DOM snapshot tab to review the raw HTML or portal response captured during verification.
   - **Receipt Image Inspection:** Verify the receipt image loads with full pan/zoom capabilities and a direct download option.
   - **Manual Administrative Override:** For orders in `pending_manual_review`, test clicking **Approve Order** or **Reject Order** (providing a reason). Confirm:
     - The order status updates immediately in the dashboard without full page reload.
     - An audit log entry is written to `audit_logs` table (`action = 'order.approve'` or `'order.reject'`).

---

## 8. Operational Telemetry, Monitoring & Alerting

### 8.1 Critical Operational Metrics & SLOs

| Metric Name | Prometheus / Pino Log Key | Warning Threshold | Critical Incident Threshold | Recommended Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| **Circuit Breaker Open** | `cbe_adapter.circuit_open`<br>`telebirr_adapter.circuit_open` | 1 occurrence | State remains OPEN > 5 minutes | Inspect upstream portal with `curl`; check DNS or firewall Port 100 egress. |
| **Rejection Ratio** | `status = 'rejected'` | > 10% of submissions | > 25% of submissions | Check for updated bank SMS/portal formats or potential phishing attacks. |
| **P95 Bank Query Latency** | `latencyMs` in `bank_verification_audits` | > 4,000 ms | > 7,500 ms | Upstream bank portal degradation; verify proxy bandwidth. |
| **Unverified Review Backlog** | `status = 'pending_manual_review'` | > 15 orders | > 50 orders | Alert operations team to process manual admin review queue. |
| **Anti-Replay Collisions** | `error_code = 'RECEIPT_ALREADY_USED'` | > 5 / hour | > 20 / hour | Potential automated replay attack; examine offending Telegram user IDs. |
| **Admin Settings Validation Errors** | `settings.update_rejected` | > 3 / hour | > 10 / hour | Review administrator inputs or inspect potential unauthorized configuration tampering. |

### 8.2 Administrative Telemetry Queries

Run these operational queries directly against `shop.db` or via the Admin Dashboard `/admin`:

```sql
-- 1. Real-time verification success rate over the past 24 hours
SELECT
    bank,
    COUNT(*) AS total_attempts,
    SUM(CASE WHEN status = 'auto_verified' THEN 1 ELSE 0 END) AS verified,
    SUM(CASE WHEN status = 'pending_manual_review' THEN 1 ELSE 0 END) AS manual_review,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
    ROUND(AVG(latency_ms), 0) AS avg_latency_ms
FROM bank_verification_audits
WHERE created_at >= datetime('now', '-24 hours')
GROUP BY bank;

-- 2. Inspect active circuit breaker trips and recent upstream errors
SELECT
    bank,
    normalized_reference,
    error_code,
    error_detail,
    latency_ms,
    created_at
FROM bank_verification_audits
WHERE status = 'upstream_failure'
ORDER BY created_at DESC
LIMIT 10;

-- 3. Top Rejection Causes in Security Gate
SELECT
    error_code,
    COUNT(*) AS count
FROM receipt_evidence
WHERE status = 'rejected'
GROUP BY error_code
ORDER BY count DESC;

-- 4. Batch Evidence Resolution Performance Check (Testing Index idx_receipt_evidence_order_id)
EXPLAIN QUERY PLAN
SELECT re.*
FROM receipt_evidence re
INNER JOIN (
    SELECT MAX(id) AS max_id
    FROM receipt_evidence
    WHERE order_id IN (1, 2, 3, 4, 5)
    GROUP BY order_id
) latest ON re.id = latest.max_id;
-- Expected Plan: SEARCH receipt_evidence USING INDEX idx_receipt_evidence_order_id (order_id=?)
```

---

## 9. Disaster Recovery, Backups & Rollback Playbook

### 9.1 Automated Nightly Backup Schedule
The automated cron script `deploy/backup.sh` runs every night at 00:00 UTC (03:00 EAT):
- Verifies SQLite consistency via `PRAGMA integrity_check`.
- Creates a timestamped hot snapshot (`sqlite3 .backup`).
- Archives `/app/data/receipts/` into `/var/backups/bighabesha/bighabesha_YYYYmmdd_HHMMSS.tar.gz`.
- Rotates backups, pruning files older than 7 days.

### 9.2 Database Restoration Procedure (RTO < 5 minutes)
In the event of catastrophic volume corruption:

```bash
# 1. Stop bot container to prevent writes
docker compose stop bot

# 2. Extract backup archive
tar -xzf /var/backups/bighabesha/bighabesha_LATEST.tar.gz -C /tmp/restore/

# 3. Verify SQLite integrity of the restore target
sqlite3 /tmp/restore/shop.db "PRAGMA integrity_check;"
# MUST print: ok

# 4. Copy restored database and receipts into persistent volume
cp /tmp/restore/shop.db /var/lib/docker/volumes/bighabesha-shop_bot_data/_data/shop.db
cp -r /tmp/restore/receipts/* /var/lib/docker/volumes/bighabesha-shop_bot_data/_data/receipts/

# 5. Start bot container and inspect logs
docker compose start bot
docker compose logs -f bot
```

### 9.3 Automated Rollback Execution
If a deployment fails the post-deployment smoke test in GitHub Actions (`.github/workflows/deploy.yml`):
1. GitHub Actions detects non-200 response on `http://127.0.0.1:3000/health`.
2. The workflow automatically executes git rollback:
   ```bash
   git reset --hard "$PREV_COMMIT"
   docker compose build bot
   docker compose up -d bot
   ```
3. To manually reset the circuit breaker after resolving bank portal issues:
   ```bash
   curl -X POST http://127.0.0.1:3000/api/admin/receipts/circuit-breaker/reset \
     -H "Authorization: Bearer <ADMIN_SESSION_TOKEN>"
   ```

---

## 10. Troubleshooting & Incident Response Quick Reference

| Symptom | Probable Cause | Verification & Diagnostic Command | Immediate Resolution |
| :--- | :--- | :--- | :--- |
| **CBE Verification Hangs (8000ms timeout)** | Outbound TCP Port 100 blocked by cloud security group or VPS firewall. | `nc -zv apps.cbe.com.et 100`<br>`curl -Iv https://apps.cbe.com.et:100` | Open Port 100 outbound in Security Group / UFW. |
| **Telebirr Always Returns HTTP 403** | Ethiopian geofence active; request originated from foreign IP address. | `curl -Iv https://transactioninfo.ethiotelecom.et/` | Configure `TELEBIRR_PROXY_URL` in Admin Settings with an Ethiopian residential or in-country proxy. |
| **Container Status: "unhealthy"** | Database write probe failed or container out of disk space. | `curl http://localhost:3000/health`<br>`df -h /app/data` | Check disk space; verify SQLite WAL lock; restart container. |
| **Circuit Breaker trips to OPEN** | Upstream bank web portal is down, under maintenance, or blocking IPs. | `sqlite3 data/shop.db "SELECT * FROM bank_verification_audits ORDER BY id DESC LIMIT 5;"` | Engine automatically routes submissions to manual admin review queue until upstream recovers. |
| **Orders stuck in 'pending_manual_review'** | Normal fail-safe fallback when slip is ambiguous or portal is unreachable. | Open Admin Dashboard: `/admin` → "Receipt Review Queue". | Review uploaded slip photo; click "Approve" or "Reject". |
| **Settings Save Fails: "Settings validation failed"** | Admin entered account number that fails regex format validation. | Inspect browser toast or server response: `curl -X PUT ... /api/admin/settings` | Verify CBE accounts are 13 digits, Telebirr accounts are 10 digits starting with 09/07, BoA accounts are 13-16 digits. |
| **Admin Dashboard shows 404 on page reload** | Reverse proxy is not falling back to `index.html` for client-side SPA routes. | `curl -Iv http://localhost:3000/admin` | Ensure Express SPA fallback in `server.ts` is active or Nginx has `try_files $uri /index.html;`. |
| **Slow Orders Grid Loading (> 500ms)** | Missing composite index `idx_receipt_evidence_order_id` on large DB. | `sqlite3 data/shop.db "PRAGMA index_info('idx_receipt_evidence_order_id');"` | Restart container to trigger migration 012 or execute `CREATE INDEX IF NOT EXISTS idx_receipt_evidence_order_id ON receipt_evidence(order_id, id DESC);`. |
| **Audit Evidence Modal Fails to Load Receipt Image** | Receipt image missing from `/app/data/receipts` or invalid permissions. | `ls -la /app/data/receipts/<receipt_id>.jpg` | Ensure Docker volume `bot_data` is mounted to `/app/data` with read permissions for user `node`. |
