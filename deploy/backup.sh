#!/usr/bin/env bash
# ==============================================================================
# Bighabesha Shop — Automated SQLite Nightly Backup with 7-Day Retention
# ==============================================================================
set -euo pipefail

BACKUP_DIR="/var/backups/bighabesha"
DB_PATH="/opt/bighabesha-shop/data/shop.db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/shop_${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_PATH" ]; then
  # Use sqlite3 online safe backup command (prevents corruption during WAL transactions)
  sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"
  echo "✅ [${TIMESTAMP}] Database backup created successfully: ${BACKUP_FILE}"

  # Enforce 7-day retention (remove backups older than 7 days)
  find "$BACKUP_DIR" -type f -name "shop_*.db" -mtime +7 -delete
  echo "🧹 Old backups older than 7 days pruned."
else
  echo "⚠️ Database not found at ${DB_PATH}. Skipping backup."
fi
