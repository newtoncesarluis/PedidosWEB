#!/bin/bash
# ============================================================
# PedidosWeb — Setup inicial da VM Oracle Cloud (Ubuntu 22.04)
# Execute como usuário 'ubuntu' (não root)
# ============================================================

set -e

APP_DIR="/home/ubuntu/pedidosweb"
APP_PORT=3002

echo "=== [1/7] Atualizando sistema ==="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "=== [2/7] Instalando Node.js 20 LTS ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v

echo "=== [3/7] Instalando MySQL 8.0 ==="
sudo apt-get install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql

echo "=== [4/7] Instalando Chromium (para geração de PDF) ==="
sudo apt-get install -y chromium-browser || sudo snap install chromium

echo "=== [5/7] Instalando PM2 (gerenciador de processos) ==="
sudo npm install -g pm2

echo "=== [6/7] Criando diretório da aplicação ==="
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/logs"
mkdir -p "$APP_DIR/public/uploads"

echo "=== [7/7] Abrindo porta $APP_PORT no firewall (iptables Oracle) ==="
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $APP_PORT -j ACCEPT
sudo apt-get install -y iptables-persistent
sudo netfilter-persistent save

echo ""
echo "============================================================"
echo "  Setup concluído! Próximos passos:"
echo "============================================================"
echo ""
echo "1. Configurar MySQL — execute o script 2-mysql-setup.sh"
echo "2. Enviar arquivos do projeto (execute no Windows: deploy\\enviar-oracle.ps1)"
echo "3. Criar o arquivo .env em: $APP_DIR/.env"
echo "4. cd $APP_DIR && npm install"
echo "5. pm2 start ecosystem.config.js"
echo "6. pm2 startup && pm2 save"
echo ""
echo "  Acesso: http://IP_DA_ORACLE:$APP_PORT"
echo "============================================================"
