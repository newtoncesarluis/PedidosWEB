#!/bin/bash
# Configura nginx para o Admin Panel em admin.nresolutions.com.br
set -e

DOMAIN="${1:-admin.nresolutions.com.br}"
PORT="${2:-4200}"

sudo python3 -c "
domain='${DOMAIN}'
port='${PORT}'
conf='''server {
    listen 80;
    server_name '''+domain+''';
    location / {
        proxy_pass         http://127.0.0.1:'''+port+''';
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
'''
open('/etc/nginx/sites-available/admin-panel','w').write(conf)
print('nginx config criado')
"

sudo ln -sf /etc/nginx/sites-available/admin-panel /etc/nginx/sites-enabled/admin-panel
sudo nginx -t && sudo systemctl reload nginx
echo "✓ nginx configurado para http://$DOMAIN"
