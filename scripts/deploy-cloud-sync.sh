#!/usr/bin/env bash
# One-click deploy script for MemoryPets cloud-sync relay.
# Run as root (or a user with passwordless sudo) on the remote server.
#
# Usage:
#   curl -fsSL https://.../deploy-cloud-sync.sh | sudo bash
# Or copy this file to the server and run:
#   sudo bash deploy-cloud-sync.sh
#
# Configuration (set environment variables before running):
#   MP_DOMAIN=sync.example.com          # optional; if empty, uses the public IP with a self-signed cert
#   MP_PUBLIC_IP=123.57.81.235          # used when MP_DOMAIN is empty
#   MP_DATA_DIR=/var/lib/memorypets-cloud-sync
#   MP_PORT=8787
#   MP_GIT_REPO=https://github.com/WilliamSuiself/harness-plugin.git

set -euo pipefail

# ---------- 0. Configuration ----------
MP_DOMAIN="${MP_DOMAIN:-}"
MP_PUBLIC_IP="${MP_PUBLIC_IP:-$(curl -fsSL -4 ifconfig.me 2>/dev/null || echo '')}"
MP_DATA_DIR="${MP_DATA_DIR:-/var/lib/memorypets-cloud-sync}"
MP_PORT="${MP_PORT:-8787}"
MP_GIT_REPO="${MP_GIT_REPO:-https://github.com/WilliamSuiself/harness-plugin.git}"
INSTALL_DIR="/opt/memorypets-cloud-sync"
SERVICE_NAME="memorypets-cloud-sync"

if [[ "$EUID" -ne 0 ]]; then
  echo "This script must run as root (or with sudo)."
  exit 1
fi

if [[ -z "${MP_DOMAIN:-}" && -z "${MP_PUBLIC_IP:-}" ]]; then
  echo "无法自动获取公网 IP，请设置 MP_PUBLIC_IP=你的IP 或 MP_DOMAIN=你的域名"
  exit 1
fi

echo "=== MemoryPets Cloud Sync 一键部署 ==="
echo "  Domain:     ${MP_DOMAIN:-(none, will use IP ${MP_PUBLIC_IP})}"
echo "  Data dir:   ${MP_DATA_DIR}"
echo "  Local port: ${MP_PORT}"

# ---------- 1. Install Node.js 22 if missing ----------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 22 ]]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js $(node -v) already installed."
fi

# ---------- 2. Install Caddy if missing ----------
if ! command -v caddy >/dev/null 2>&1; then
  echo "Installing Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
else
  echo "Caddy already installed."
fi

# ---------- 3. Fetch the cloud-sync package ----------
if [[ -d "${INSTALL_DIR}" ]]; then
  echo "Pulling latest cloud-sync files..."
  cd "${INSTALL_DIR}"
  git pull --depth=1 origin main
else
  echo "Cloning repository..."
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --depth=1 --filter=blob:none --sparse "${MP_GIT_REPO}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
  git sparse-checkout set packages/cloud-sync
fi

cd "${INSTALL_DIR}/packages/cloud-sync"

# ---------- 4. Prepare data directory ----------
mkdir -p "${MP_DATA_DIR}"
chmod 700 "${MP_DATA_DIR}"

# ---------- 5. Create systemd service ----------
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=MemoryPets Cloud Sync Relay
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}/packages/cloud-sync
ExecStart=/usr/bin/node ${INSTALL_DIR}/packages/cloud-sync/bin/start.mjs
Environment="CLOUD_SYNC_HOST=127.0.0.1"
Environment="CLOUD_SYNC_PORT=${MP_PORT}"
Environment="CLOUD_SYNC_DATA_DIR=${MP_DATA_DIR}"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"

# ---------- 6. Configure Caddy ----------
if [[ -n "${MP_DOMAIN}" ]]; then
  # Domain mode: Caddy auto-HTTPS with Let's Encrypt
  CADDY_CONF="${MP_DOMAIN} {
    reverse_proxy 127.0.0.1:${MP_PORT}
}"
  LISTEN_URL="https://${MP_DOMAIN}"
else
  # IP mode: self-signed certificate on 443
  CADDY_CONF="${MP_PUBLIC_IP}:443 {
    tls internal
    reverse_proxy 127.0.0.1:${MP_PORT}
}"
  LISTEN_URL="https://${MP_PUBLIC_IP}"
fi

echo "Writing /etc/caddy/Caddyfile..."
cat > /etc/caddy/Caddyfile <<EOF
${CADDY_CONF}
EOF

systemctl reload caddy || systemctl restart caddy

# ---------- 7. Done ----------
echo ""
echo "=== 部署完成 ==="
echo "  服务状态: systemctl status ${SERVICE_NAME}"
echo "  查看日志: journalctl -u ${SERVICE_NAME} -f"
echo "  公网访问: ${LISTEN_URL}"
echo ""
if [[ -z "${MP_DOMAIN}" ]]; then
  echo "注意：你使用的是 IP 地址 + 自签名证书，" 
  echo "      浏览器第一次访问会提示证书不安全，选择继续即可。"
  echo "      如需去掉证书警告，请准备一个域名并重新运行："
  echo "        MP_DOMAIN=sync.example.com bash deploy-cloud-sync.sh"
fi
