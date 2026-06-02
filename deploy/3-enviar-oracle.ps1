# ============================================================
# PedidosWeb — Envia arquivos do Windows para Oracle Cloud
# Execute este script no PowerShell a partir da pasta SysRepWeb
#
# IMPORTANTE: uploads (public/uploads/) são EXCLUÍDOS do deploy.
# Para sincronizar fotos use: deploy\5-uploads-oracle.ps1
# ============================================================

# ─── CONFIGURE AQUI ─────────────────────────────────────────
$IP_ORACLE    = "147.15.106.135"
$SSH_KEY      = "C:\xampp\htdocs\Backup\ssh-key-2026-03-22.key"
$ZIP_TEMP     = "$env:TEMP\pedidosweb-deploy.zip"
$PROJETO_DIR  = Split-Path -Parent $PSScriptRoot   # pasta SysRepWeb
# ────────────────────────────────────────────────────────────

Write-Host "=== PedidosWeb Deploy ===" -ForegroundColor Cyan
Write-Host "Projeto: $PROJETO_DIR"
Write-Host "Destino: ubuntu@${IP_ORACLE}:/home/ubuntu/pedidosweb/"
Write-Host ""

# 1. Corrigir permissões da chave SSH (necessário no Windows)
Write-Host "[1/5] Ajustando permissoes da chave SSH..."
icacls $SSH_KEY /inheritance:r | Out-Null
icacls $SSH_KEY /grant:r "${env:USERNAME}:(R)" | Out-Null

# 2. Criar ZIP excluindo pastas desnecessárias
# ATENÇÃO: public\uploads é excluído propositalmente — as fotos vivem
# apenas na Oracle e nunca devem ser sobrescritas pelo deploy de código.
Write-Host "[2/5] Criando pacote ZIP..."

$excluir = @(
    'node_modules', '.env', '.installed', 'logs',
    '*.bat', '*.ps1', 'deploy', '.git', '.vscode',
    '*.bak', 'CONTINUA_AMANHA.md', 'check_db.php', 'fix_search.php',
    'public\uploads'
)

$arquivos = Get-ChildItem -Path $PROJETO_DIR -Recurse |
    Where-Object {
        $item = $_
        $relativo = $item.FullName.Substring($PROJETO_DIR.Length + 1)
        $excluido = $false
        foreach ($ex in $excluir) {
            if ($relativo -like "$ex*" -or $item.Name -like $ex) {
                $excluido = $true; break
            }
        }
        -not $excluido -and -not $item.PSIsContainer
    }

if (Test-Path $ZIP_TEMP) { Remove-Item $ZIP_TEMP }

Compress-Archive -Path $arquivos.FullName -DestinationPath $ZIP_TEMP -CompressionLevel Optimal
$tamanho = [math]::Round((Get-Item $ZIP_TEMP).Length / 1MB, 1)
Write-Host "   ZIP criado: $ZIP_TEMP ($tamanho MB)"

# 3. Enviar ZIP para Oracle via SCP
Write-Host "[3/5] Enviando para Oracle Cloud..."
scp -i $SSH_KEY -o StrictHostKeyChecking=no $ZIP_TEMP "ubuntu@${IP_ORACLE}:/home/ubuntu/"

# 4. Descompactar, instalar dependências e recarregar o servidor
Write-Host "[4/5] Descompactando na Oracle..."
$cmd_unzip = @'
mkdir -p /home/ubuntu/pedidosweb
cd /home/ubuntu
unzip -o pedidosweb-deploy.zip -d pedidosweb/
cd /home/ubuntu/pedidosweb
npm install --omit=dev
mkdir -p logs public/uploads
'@
ssh -i $SSH_KEY -o StrictHostKeyChecking=no "ubuntu@${IP_ORACLE}" $cmd_unzip

Write-Host "[5/5] Recarregando servidor PM2..."
$cmd_reload = @'
pm2 reload pedidosweb --update-env
'@
ssh -i $SSH_KEY -o StrictHostKeyChecking=no "ubuntu@${IP_ORACLE}" $cmd_reload

Write-Host ""
Write-Host "=== Deploy concluido! ===" -ForegroundColor Green
Write-Host ""
Write-Host "As fotos (public/uploads) NAO foram alteradas na Oracle."
Write-Host "Para sincronizar fotos use: deploy\5-uploads-oracle.ps1"
