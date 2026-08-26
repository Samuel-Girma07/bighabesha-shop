#!/usr/bin/env bash
# ==============================================================================
# Bighabesha Shop — Oracle Cloud Ubuntu 22.04 VPS Setup Script
# ==============================================================================
set -euo pipefail

echo "==> [1/7] Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential sqlite3 libsqlite3-dev cron

echo "==> [2/7] Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> [3/7] Installing pnpm & pm2..."
sudo npm install -g pnpm pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

echo "==> [4/7] Setting up application directory..."
APP_DIR="/opt/bighabesha-shop"
if [ ! -d "$APP_DIR" ]; then
  sudo git clone https://github.com/your-org/bighabesha-shop.git "$APP_DIR"
fi
sudo chown -R "$USER:$USER" "$APP_DIR"
cd "$APP_DIR"

echo "==> [5/7] Installing dependencies and building project..."
pnpm install
pnpm build

echo "==> [6/7] Setting up PM2 process and auto-startup..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️ Created .env file. Please edit /opt/bighabesha-shop/.env with your production credentials."
fi

pm2 start deploy/ecosystem.config.cjs
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "/home/$USER"

echo "==> [7/7] Configuring automated SQLite backup cron job (03:00 AM EAT / 00:00 UTC)..."
chmod +x "$APP_DIR/deploy/backup.sh"
sudo touch /var/log/bighabesha-backup.log
sudo chown "$USER:$USER" /var/log/bighabesha-backup.log

# Add daily backup at 03:00 AM EAT (00:00 UTC) to user crontab
CRON_JOB="0 0 * * * $APP_DIR/deploy/backup.sh >> /var/log/bighabesha-backup.log 2>&1"
(crontab -l 2>/dev/null | grep -Fv "$APP_DIR/deploy/backup.sh" || true; echo "$CRON_JOB") | crontab -

echo "=============================================================================="
echo "✅ Bighabesha Shop installation complete!"
echo "• Monitor logs: pm2 logs bighabesha-bot"
echo "• Restart app:  pm2 restart bighabesha-bot"
echo "• Backup logs:  tail -f /var/log/bighabesha-backup.log"
echo "=============================================================================="

