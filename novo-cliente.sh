#!/bin/bash
# =============================================================================
# novo-cliente.sh — provisiona um novo tenant no Oracle VPS
#
# Uso:
#   ./novo-cliente.sh <slug> <CHAVE-LICENCA> [dominio-base]
#
# Exemplo:
#   ./novo-cliente.sh acme ABCD-1234-EFGH-5678
#   ./novo-cliente.sh acme ABCD-1234-EFGH-5678 pedidos.nresolutions.com.br
#
# O que o script faz:
#   1. Valida a chave na Oracle (sistema_licencas)
#   2. Cria /opt/sysrepweb/instances/<slug>/ com .env e data/
#   3. Inicia processo PM2 na próxima porta livre
#   4. Cria bloco nginx para <slug>.<dominio-base>
#   5. Recarrega nginx e salva estado PM2
#
# Pré-requisitos na VPS:
#   - Node.js + PM2 instalados
#   - nginx instalado
#   - Código do app em /opt/sysrepweb/app/ (git clone)
#   - DNS wildcard *.pedidos.nresolutions.com.br → IP do servidor
#   - Certificado SSL wildcard (Let's Encrypt ou similar)
# =============================================================================

set -e

SLUG="$1"
CHAVE="$2"
DOMAIN_BASE="${3:-pedidos.nresolutions.com.br}"

APP_DIR="${APP_DIR:-/home/ubuntu/pedidosweb}"
INSTANCES_DIR="${INSTANCES_DIR:-/home/ubuntu/pedidosweb-clients}"
NGINX_AVAIL="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
PORT_START=3100

# ── Validações ────────────────────────────────────────────────────────────────
if [[ -z "$SLUG" || -z "$CHAVE" ]]; then
  echo "Uso: $0 <slug> <CHAVE-LICENCA> [dominio-base]"
  echo "Ex:  $0 acme ABCD-1234-EFGH-5678"
  exit 1
fi

if [[ ! "$SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "ERRO: slug deve conter apenas letras minúsculas, números e hífens."
  exit 1
fi

CHAVE=$(echo "$CHAVE" | tr '[:lower:]' '[:upper:]' | tr -d ' ')
DOMAIN="${SLUG}.${DOMAIN_BASE}"
INSTANCE_DIR="${INSTANCES_DIR}/${SLUG}"

if [[ -d "$INSTANCE_DIR" ]]; then
  echo "ERRO: instância '$SLUG' já existe em $INSTANCE_DIR"
  echo "Para remover: ./remover-cliente.sh $SLUG"
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "ERRO: código do app não encontrado em $APP_DIR"
  echo "Execute: git clone <repo> $APP_DIR"
  exit 1
fi

# ── Encontra próxima porta livre ──────────────────────────────────────────────
PORT=$PORT_START
while ss -tlnp | grep -q ":${PORT} " 2>/dev/null || pm2 list 2>/dev/null | grep -q ":${PORT}"; do
  PORT=$((PORT + 1))
done
echo "Porta disponível: $PORT"

# ── Gera JWT_SECRET aleatório para esta instância ─────────────────────────────
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# ── Lê variáveis do .env do app para herdar configurações comuns ──────────────
APP_ENV="${APP_DIR}/.env"
read_env() { grep -m1 "^\s*${1}=" "$APP_ENV" 2>/dev/null | sed 's/^\s*//' | cut -d= -f2- || echo ""; }

LICENSE_DB_HOST=$(read_env LICENSE_DB_HOST)
LICENSE_DB_PORT=$(read_env LICENSE_DB_PORT)
LICENSE_DB_NAME=$(read_env LICENSE_DB_NAME)
LICENSE_DB_USER=$(read_env LICENSE_DB_USER)
LICENSE_DB_PASSWORD=$(read_env LICENSE_DB_PASSWORD)
SUPORTE_NOME=$(read_env SUPORTE_NOME)
SUPORTE_WHATSAPP=$(read_env SUPORTE_WHATSAPP)
SUPORTE_EMAIL=$(read_env SUPORTE_EMAIL)
PIX_CHAVE=$(read_env PIX_CHAVE)
PIX_TIPO=$(read_env PIX_TIPO)
PIX_NOME=$(read_env PIX_NOME)
TRUST_PROXY_HOPS=$(read_env TRUST_PROXY_HOPS)
TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS:-1}
SMTP_HOST=$(read_env SMTP_HOST)
SMTP_PORT=$(read_env SMTP_PORT)
SMTP_USER=$(read_env SMTP_USER)
SMTP_PASS=$(read_env SMTP_PASS)

# ── Cria diretório da instância ───────────────────────────────────────────────
mkdir -p "${INSTANCE_DIR}/data/licenses"
mkdir -p "${INSTANCE_DIR}/public/uploads"

# Cria .installed para pular setup
touch "${INSTANCE_DIR}/.installed"

# ── Cria .env da instância ────────────────────────────────────────────────────
cat > "${INSTANCE_DIR}/.env" << EOF
# Instância: $SLUG
# Criado em: $(date '+%Y-%m-%d %H:%M:%S')
# Domínio:   https://$DOMAIN

# ── Tenant amarrado a esta licença ───────────────────────────────────────────
CHAVE_LICENCA=$CHAVE

# ── Servidor ─────────────────────────────────────────────────────────────────
PORT=$PORT
NODE_ENV=production
TRUST_PROXY_HOPS=$TRUST_PROXY_HOPS
ALLOWED_ORIGINS=https://$DOMAIN

# ── Segurança ─────────────────────────────────────────────────────────────────
JWT_SECRET=$JWT_SECRET
SESSION_SECRET=$SESSION_SECRET

# ── Base de licenças MySQL (servidor remoto/central) ──────────────────────────
LICENSE_DB_HOST=${LICENSE_DB_HOST}
LICENSE_DB_PORT=${LICENSE_DB_PORT:-3306}
LICENSE_DB_NAME=${LICENSE_DB_NAME:-sistema_licencas}
LICENSE_DB_USER=${LICENSE_DB_USER}
LICENSE_DB_PASSWORD=${LICENSE_DB_PASSWORD}

# ── Suporte ───────────────────────────────────────────────────────────────────
SUPORTE_NOME=${SUPORTE_NOME:-NC Sistemas}
SUPORTE_WHATSAPP=${SUPORTE_WHATSAPP}
SUPORTE_EMAIL=${SUPORTE_EMAIL}

# ── PIX ───────────────────────────────────────────────────────────────────────
PIX_CHAVE=${PIX_CHAVE}
PIX_TIPO=${PIX_TIPO:-cpf}
PIX_NOME=${PIX_NOME}

# ── SMTP ──────────────────────────────────────────────────────────────────────
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
EOF

echo "✓ .env criado em ${INSTANCE_DIR}/.env"

# ── Inicia processo PM2 ───────────────────────────────────────────────────────
pm2 start "${APP_DIR}/server.js" \
  --name "sysrep-${SLUG}" \
  --cwd "${INSTANCE_DIR}" \
  --env production \
  --time \
  --restart-delay=3000 \
  --max-restarts=5

pm2 save
echo "✓ PM2 iniciado: sysrep-${SLUG} (porta $PORT)"

# ── Certificado SSL ────────────────────────────────────────────────────────────
# Procura cert existente que cubra o domínio (wildcard ou individual)
SSL_CERT=""
SSL_KEY=""
for dir in $(ls -d /etc/letsencrypt/live/*/ 2>/dev/null); do
  dir="${dir%/}"
  if [[ -f "${dir}/fullchain.pem" ]]; then
    # Verifica se o cert cobre este domínio
    if sudo openssl x509 -in "${dir}/fullchain.pem" -text -noout 2>/dev/null \
        | grep -qE "(DNS:${DOMAIN}|DNS:\*\.${DOMAIN_BASE})"; then
      SSL_CERT="${dir}/fullchain.pem"
      SSL_KEY="${dir}/privkey.pem"
      echo "  Certificado existente cobre $DOMAIN: $SSL_CERT"
      break
    fi
  fi
done

if [[ -z "$SSL_CERT" ]]; then
  echo "  Gerando certificado SSL para $DOMAIN via HTTP-01..."

  # Bloco HTTP temporário via Python (sem problema de heredoc em SSH remoto)
  sudo python3 -c "
f=open('${NGINX_AVAIL}/sysrep-${SLUG}','w')
f.write('server {\n    listen 80;\n    server_name ${DOMAIN};\n    location /.well-known/acme-challenge/ { root /var/www/html; }\n    location / { return 200 \"ok\"; }\n}\n')
f.close()
"
  sudo ln -sf "${NGINX_AVAIL}/sysrep-${SLUG}" "${NGINX_ENABLED}/sysrep-${SLUG}"
  sudo nginx -t && sudo systemctl reload nginx

  sudo certbot certonly --nginx -d "$DOMAIN" \
    --non-interactive --agree-tos -m "newton.bauru@gmail.com" \
    --keep-until-expiring

  SSL_CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  SSL_KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  echo "  Certificado gerado: $SSL_CERT"
fi

# ── Bloco nginx final via Python (evita problemas de heredoc em SSH remoto) ───
sudo python3 -c "
content = '''server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};
    ssl_certificate     ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    client_max_body_size 25M;
    access_log /var/log/nginx/sysrep-${SLUG}.access.log;
    error_log  /var/log/nginx/sysrep-${SLUG}.error.log;
    location / {
        proxy_pass         http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection upgrade;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}'''
open('${NGINX_AVAIL}/sysrep-${SLUG}','w').write(content)
"

sudo ln -sf "${NGINX_AVAIL}/sysrep-${SLUG}" "${NGINX_ENABLED}/sysrep-${SLUG}"
sudo nginx -t && sudo systemctl reload nginx
echo "✓ nginx configurado para https://$DOMAIN"

# ── Resultado final ───────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo " ✅ Cliente '$SLUG' provisionado com sucesso!"
echo ""
echo "   URL:    https://$DOMAIN"
echo "   Porta:  $PORT"
echo "   PM2:    sysrep-$SLUG"
echo "   Chave:  $CHAVE"
echo "   Dir:    $INSTANCE_DIR"
echo ""
echo " Logs:    pm2 logs sysrep-$SLUG"
echo " Parar:   pm2 stop sysrep-$SLUG"
echo " Remover: ./remover-cliente.sh $SLUG"
echo "════════════════════════════════════════════════════════════════"
