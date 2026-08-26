#!/usr/bin/env bash
# ==============================================================================
# Bighabesha Shop — Automated Nightly Backup (DB + receipts) with Verification
# ==============================================================================
# - Verifies SQLite integrity BEFORE archiving (corrupt DBs are never backed up)
# - Uses sqlite3 online-safe .backup (consistent snapshot during WAL traffic)
# - Archives the database AND data/receipts/ (customer payment proofs)
# - Compressed, timestamped archives with clean retention pruning
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/bighabesha}"
APP_DIR="${APP_DIR:-/opt/bighabesha-shop}"
DB_PATH="${DB_PATH:-$APP_DIR/data/shop.db}"
RECEIPTS_DIR="${RECEIPTS_DIR:-$APP_DIR/data/receipts}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
WORK_DIR=$(mktemp -d)
ARCHIVE_FILE="${BACKUP_DIR}/bighabesha_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

if [ ! -f "$DB_PATH" ]; then
  echo "⚠️ [${TIMESTAMP}] Database not found at ${DB_PATH}. Skipping backup."
  exit 1
fi

# --- 1. Integrity gate: never archive a corrupt database ---------------------
INTEGRITY_RESULT=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" | head -n 1)
if [ "$INTEGRITY_RESULT" != "ok" ]; then
  echo "🚨 [${TIMESTAMP}] INTEGRITY CHECK FAILED (${INTEGRITY_RESULT}). Backup aborted — investigate immediately."
  exit 2
fi
echo "✅ [${TIMESTAMP}] Database integrity verified (integrity_check: ok)."

# --- 2. Online-safe snapshot + receipts into a staging directory -------------
sqlite3 "$DB_PATH" ".backup '${WORK_DIR}/shop.db'"
echo "✅ [${TIMESTAMP}] Consistent DB snapshot created (sqlite3 .backup)."

if [ -d "$RECEIPTS_DIR" ]; then
  cp -r "$RECEIPTS_DIR" "${WORK_DIR}/receipts"
  RECEIPT_COUNT=$(find "${WORK_DIR}/receipts" -type f | wc -l)
  echo "✅ [${TIMESTAMP}] Archived ${RECEIPT_COUNT} receipt file(s)."
else
  echo "⚠️ [${TIMESTAMP}] Receipts directory not found at ${RECEIPTS_DIR} — archiving database only."
fi

# Record the integrity verdict inside the archive for auditability.
echo "integrity_check=ok @ $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${WORK_DIR}/MANIFEST.txt"

# --- 3. Compressed, timestamped archive --------------------------------------
tar -czf "$ARCHIVE_FILE" -C "$WORK_DIR" .
chmod 600 "$ARCHIVE_FILE"
echo "✅ [${TIMESTAMP}] Backup archive created: ${ARCHIVE_FILE} ($(du -h "$ARCHIVE_FILE" | cut -f1))."

# --- 4. Retention pruning ----------------------------------------------------
PRUNED=$(find "$BACKUP_DIR" -type f -name "bighabesha_*.tar.gz" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
echo "🧹 [${TIMESTAMP}] Pruned ${PRUNED} archive(s) older than ${RETENTION_DAYS} days."
