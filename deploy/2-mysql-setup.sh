#!/bin/bash
# ============================================================
# PedidosWeb — Configuração do MySQL na Oracle VM
# Execute como usuário 'ubuntu' após o script 1-setup-oracle-ubuntu.sh
# ============================================================

# ─── CONFIGURE AQUI ────────────────────────────────────────
DB_NAME="NOME_DO_BANCO"           # ex: sysrepweb ou o nome do banco Delphi
DB_USER="pedidosweb_user"
DB_PASS="SENHA_FORTE_AQUI"        # mesma que DB_PASSWORD no .env
# ───────────────────────────────────────────────────────────

echo "=== Configurando MySQL ==="

sudo mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';"
sudo mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"

echo ""
echo "Banco '${DB_NAME}' criado com usuário '${DB_USER}'."
echo ""
echo "Para importar o dump do Windows:"
echo "  mysql -u ${DB_USER} -p ${DB_NAME} < /home/ubuntu/dump.sql"
