# Bighabesha Shop — Production Operations & Deployment Runbook
**Ethiopian Bank Receipt Verification Engine & Bot Platform**

- **Target Audience:** DevOps Engineers, Site Reliability Engineers (SRE), Systems Administrators
- **Classification:** Internal / Confidential Operational Standard
- **Revision:** v1.3.0 (Post-Phase 8 Hardening)
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
5. [Database Migration Playbook (Migration 011)](#5-database-migration-playbook-migration-011)
6. [Operational Telemetry, Monitoring & Alerting](#6-operational-telemetry-monitoring--alerting)
7. [Disaster Recovery, Backups & Rollback Playbook](#7-disaster-recovery-backups--rollback-playbook)
8. [Troubleshooting & Incident Response Quick Reference](#8-troubleshooting--incident-response-quick-reference)

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

## 5. Database Migration Playbook (Migration 011)

### 5.1 Scope of Migration 011 (`011_bank_receipt_verification.sql`)
Migration 011 upgrades the database from the legacy schema to the Phase 8 engine:
1. Rebuilds `receipt_evidence` with foreign keys to `orders(id)` and `users(id)`, adding `normalized_reference`, `security_gate_evaluations`, and `status`.
2. Creates the structural **Anti-Replay Unique Indexes**:
   - `idx_receipt_evidence_anti_replay` ON `receipt_evidence(bank, reference COLLATE NOCASE) WHERE matched = 1`
   - `idx_receipt_evidence_normalized_anti_replay` ON `receipt_evidence(bank, normalized_reference) WHERE matched = 1`
3. Creates `bank_verification_audits` for attempt-level telemetry and upstream DOM snapshots.
4. Initializes default system settings in `settings` table.

### 5.2 Pre-Flight Safety Checks (Zero-Downtime Guarantee)
1. **Verify WAL Journal Mode:**
   ```bash
   sqlite3 /app/data/shop.db "PRAGMA journal_mode;"
   # Must output: wal
   ```
2. **Execute Online Non-Blocking Hot Backup:**
   ```bash
   sqlite3 /app/data/shop.db ".backup /app/data/shop.db.pre-011.bak"
   sqlite3 /app/data/shop.db.pre-011.bak "PRAGMA integrity_check;"
   # Must output: ok
   ```
3. **Execution:**
   Migration 011 executes automatically upon application boot via `bot/src/db/index.ts` within an atomic transaction. If an error occurs, the transaction rolls back cleanly without data loss.

---

## 6. Operational Telemetry, Monitoring & Alerting

### 6.1 Critical Operational Metrics & SLOs

| Metric Name | Prometheus / Pino Log Key | Warning Threshold | Critical Incident Threshold | Recommended Remediation Action |
| :--- | :--- | :--- | :--- | :--- |
| **Circuit Breaker Open** | `cbe_adapter.circuit_open`<br>`telebirr_adapter.circuit_open` | 1 occurrence | State remains OPEN > 5 minutes | Inspect upstream portal with `curl`; check DNS or firewall Port 100 egress. |
| **Rejection Ratio** | `status = 'rejected'` | > 10% of submissions | > 25% of submissions | Check for updated bank SMS/portal formats or potential phishing attacks. |
| **P95 Bank Query Latency** | `latencyMs` in `bank_verification_audits` | > 4,000 ms | > 7,500 ms | Upstream bank portal degradation; verify proxy bandwidth. |
| **Unverified Review Backlog** | `status = 'pending_manual_review'` | > 15 orders | > 50 orders | Alert operations team to process manual admin review queue. |
| **Anti-Replay Collisions** | `error_code = 'RECEIPT_ALREADY_USED'` | > 5 / hour | > 20 / hour | Potential automated replay attack; examine offending Telegram user IDs. |

### 6.2 Administrative Telemetry Queries

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
```

---

## 7. Disaster Recovery, Backups & Rollback Playbook

### 7.1 Automated Nightly Backup Schedule
The automated cron script `deploy/backup.sh` runs every night at 00:00 UTC (03:00 EAT):
- Verifies SQLite consistency via `PRAGMA integrity_check`.
- Creates a timestamped hot snapshot (`sqlite3 .backup`).
- Archives `/app/data/receipts/` into `/var/backups/bighabesha/bighabesha_YYYYmmdd_HHMMSS.tar.gz`.
- Rotates backups, pruning files older than 7 days.

### 7.2 Database Restoration Procedure (RTO < 5 minutes)
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

### 7.3 Automated Rollback Execution
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

## 8. Troubleshooting & Incident Response Quick Reference

| Symptom | Probable Cause | Verification & Diagnostic Command | Immediate Resolution |
| :--- | :--- | :--- | :--- |
| **CBE Verification Hangs (8000ms timeout)** | Outbound TCP Port 100 blocked by cloud security group or VPS firewall. | `nc -zv apps.cbe.com.et 100`<br>`curl -Iv https://apps.cbe.com.et:100` | Open Port 100 outbound in Security Group / UFW. |
| **Telebirr Always Returns HTTP 403** | Ethiopian geofence active; request originated from foreign IP address. | `curl -Iv https://transactioninfo.ethiotelecom.et/` | Configure `TELEBIRR_PROXY_URL` with an Ethiopian residential or in-country proxy. |
| **Container Status: "unhealthy"** | Database write probe failed or container out of disk space. | `curl http://localhost:3000/health`<br>`df -h /app/data` | Check disk space; verify SQLite WAL lock; restart container. |
| **Circuit Breaker trips to OPEN** | Upstream bank web portal is down, under maintenance, or blocking IPs. | `sqlite3 data/shop.db "SELECT * FROM bank_verification_audits ORDER BY id DESC LIMIT 5;"` | Engine automatically routes submissions to manual admin review queue until upstream recovers. |
| **Orders stuck in 'pending_manual_review'** | Normal fail-safe fallback when slip is ambiguous or portal is unreachable. | Open Admin Dashboard: `/admin` → "Receipt Review Queue". | Review uploaded slip photo; click "Approve" or "Reject". |
