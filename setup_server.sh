#!/bin/bash
set -euo pipefail

REPO_DIR="/home/deploy/real-estate-monitor"
REPO_URL="${REPO_URL:-}"
NODE_SETUP_URL="https://deb.nodesource.com/setup_20.x"

echo "1. Ensuring deploy user exists"
id -u deploy &>/dev/null || sudo adduser --disabled-password --gecos "" deploy

echo "2. Giving deploy passwordless sudo"
echo "deploy ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/deploy > /dev/null
sudo chmod 0440 /etc/sudoers.d/deploy

echo "3. Installing system dependencies"
sudo apt-get update
sudo apt-get install -y git curl ca-certificates gnupg lsb-release sudo nginx certbot python3-certbot-nginx build-essential libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libpangocairo-1.0-0 libxcb1 libxkbcommon0

echo "4. Installing Node.js 20.x"
curl -fsSL "$NODE_SETUP_URL" | sudo -E bash -
sudo apt-get install -y nodejs

echo "5. Enabling Corepack and pnpm for deploy"
sudo -H -u deploy bash -lc 'corepack enable && corepack prepare pnpm@latest --activate'

if [ ! -d "$REPO_DIR" ]; then
  if [ -n "$REPO_URL" ]; then
    echo "6. Cloning repository from REPO_URL"
    sudo -H -u deploy git clone "$REPO_URL" "$REPO_DIR"
  elif [ -d ".git" ]; then
    CURRENT_REMOTE=$(git remote get-url origin || true)
    if [ -z "$CURRENT_REMOTE" ]; then
      echo "ERROR: No git remote found in current directory. Set REPO_URL to clone the repository."
      exit 1
    fi
    echo "6. Cloning repository from current origin: $CURRENT_REMOTE"
    sudo -H -u deploy git clone "$CURRENT_REMOTE" "$REPO_DIR"
  else
    echo "ERROR: Repository clone target does not exist and no REPO_URL provided."
    exit 1
  fi
else
  echo "6. Repository already exists at $REPO_DIR"
fi

echo "7. Installing project dependencies and Playwright browsers"
sudo -H -u deploy bash -lc "cd \"$REPO_DIR\" && pnpm install && pnpm exec playwright install --with-deps"

cat <<'EOF'

Setup completed.
Next steps on the Ubuntu VM:
  1. Review /home/deploy/real-estate-monitor/.env and add credentials.
  2. Copy deploy/real-estate-dashboard.service to /etc/systemd/system/.
  3. Copy deploy/nginx-real-estate-monitor.conf to /etc/nginx/sites-available/ and link it to /etc/nginx/sites-enabled/.
  4. Reload systemd and nginx, then enable the dashboard service.
  5. Add the cron entry for the deploy user.
EOF

