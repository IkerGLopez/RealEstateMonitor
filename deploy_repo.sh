#!/bin/bash
set -e

echo "1. Adding github.com to known_hosts..."
mkdir -p /home/deploy/.ssh
ssh-keyscan github.com >> /home/deploy/.ssh/known_hosts

echo "2. Cloning the repository..."
if [ ! -d "/home/deploy/real-estate-monitor" ]; then
    git clone git@github.com:IkerGLopez/RealEstateMonitor.git /home/deploy/real-estate-monitor
fi

cd /home/deploy/real-estate-monitor
# Optional: git checkout milestone7 if that is where the work is
# git pull

echo "3. Creating the .env file..."
cat << 'EOF' > .env
TURSO_URL=libsql://realestate-ikerglopez.aws-eu-west-1.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzU3MzE5NDMsImlkIjoiMDE5ZDcxZGUtMTMwMS03NTU5LWI4YjQtM2E0ZmYwN2E3YWQ3IiwicmlkIjoiMmZiYzUyNDgtNWEyZC00OWI0LWJmOWMtZmNiMjZiNDQyYzcwIn0.8LHFeD6kSJektuK2bFDJW1dy9I_wQgO6L_uV0h0JrscYnrfE0BA3lq24ECEzpXG8pa_yfNN1NcKHpmnjuuNjDQ

ENABLE_NOTIFICATIONS=true
TELEGRAM_BOT_TOKEN=8574814809:AAFNc9uQV9JQ1SEs6EZ8wpGk5thX_hYsAIQ
TELEGRAM_CHAT_ID=7806121547

SCRAPE_CRON="*/2 * * * *"
EOF

echo "4. Installing project dependencies with pnpm..."
pnpm install

echo "5. Installing Playwright system dependencies (requires sudo)..."
# Playwright needs sudo to install OS dependencies
npx playwright install-deps || true
npx playwright install
