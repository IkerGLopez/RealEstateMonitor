#!/bin/bash
set -e

echo "1. Adding deploy user (already done, but making sure)"
id -u deploy &>/dev/null || sudo adduser --disabled-password --gecos "" deploy

echo "2. Setting up sudoers for deploy"
echo "deploy ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/deploy
sudo chmod 0440 /etc/sudoers.d/deploy

echo "3. Installing Node.js & pnpm"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm

echo "4. Generating deploy user SSH keys"
sudo su - deploy -c 'yes "" | ssh-keygen -t ed25519 -C "deploy@real-estate-vm" -f ~/.ssh/id_ed25519 -N ""' || true

echo "5. Your deploy user public key is:"
sudo su - deploy -c 'cat ~/.ssh/id_ed25519.pub'
