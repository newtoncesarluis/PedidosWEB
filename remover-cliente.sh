#!/bin/bash
# =============================================================================
# remover-cliente.sh — remove um tenant do Oracle VPS
#
# Uso: ./remover-cliente.sh <slug>
# =============================================================================

set -e

SLUG="$1"
INSTANCES_DIR="${INSTANCES_DIR:-/root/pedidosweb-clients}"
NGINX_AVAIL="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

if [[ -z "$SLUG" ]]; then
  echo "Uso: $0 <slug>"
  exit 1
fi

echo "Removendo cliente '$SLUG'..."

pm2 stop  "sysrep-${SLUG}" 2>/dev/null || true
pm2 delete "sysrep-${SLUG}" 2>/dev/null || true
pm2 save

rm -f "${NGINX_ENABLED}/sysrep-${SLUG}"
rm -f "${NGINX_AVAIL}/sysrep-${SLUG}"
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "⚠️  Arquivos de dados preservados em: ${INSTANCES_DIR}/${SLUG}"
echo "    Para apagar permanentemente: rm -rf ${INSTANCES_DIR}/${SLUG}"
echo ""
read -p "Apagar dados agora? (s/N) " confirm
if [[ "$confirm" == "s" || "$confirm" == "S" ]]; then
  rm -rf "${INSTANCES_DIR}/${SLUG}"
  echo "✓ Dados removidos."
else
  echo "✓ Dados preservados."
fi

echo "✅ Cliente '$SLUG' removido."
