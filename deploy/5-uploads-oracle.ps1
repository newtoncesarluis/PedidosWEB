# ============================================================
# PedidosWeb — Sincroniza uploads (fotos) entre local e Oracle
#
# Opção A — Enviar local → Oracle
#   Copia arquivos do XAMPP que não existem ainda na Oracle.
#   Não apaga arquivos que existam só na Oracle.
#
# Opção B — Baixar Oracle → local  (backup)
#   Baixa toda a pasta uploads da Oracle para a máquina local.
#   Use antes de reinstalar o servidor ou como backup periódico.
# ============================================================

# ─── CONFIGURE AQUI ─────────────────────────────────────────
$IP_ORACLE      = "147.15.106.135"
$SSH_KEY        = "C:\xampp\htdocs\Backup\ssh-key-2026-03-22.key"
$LOCAL_UPLOADS  = "C:\xampp\htdocs\SysRepWeb\public\uploads"
$ORACLE_UPLOADS = "/home/ubuntu/pedidosweb/public/uploads"
$BACKUP_DIR     = "C:\xampp\htdocs\SysRepWeb\public\uploads\_backup_oracle"
# ────────────────────────────────────────────────────────────

# Corrigir permissões da chave SSH
icacls $SSH_KEY /inheritance:r | Out-Null
icacls $SSH_KEY /grant:r "${env:USERNAME}:(R)" | Out-Null

Write-Host ""
Write-Host "=== Sincronizacao de Uploads - PedidosWeb ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  A) Enviar fotos LOCAL → Oracle  (restaurar fotos locais no servidor)"
Write-Host "  B) Baixar fotos Oracle → LOCAL  (backup do servidor para a maquina)"
Write-Host ""
$opcao = Read-Host "Escolha A ou B"

if ($opcao -eq 'A' -or $opcao -eq 'a') {
    # ─── ENVIAR LOCAL → ORACLE ───────────────────────────────

    Write-Host ""
    Write-Host "[1/2] Listando arquivos na Oracle para comparar..." -ForegroundColor Yellow

    # Obtém lista de arquivos que já existem na Oracle
    $arquivos_oracle = ssh -i $SSH_KEY -o StrictHostKeyChecking=no "ubuntu@${IP_ORACLE}" `
        "find $ORACLE_UPLOADS -type f 2>/dev/null | sed 's|$ORACLE_UPLOADS/||'" 2>$null

    $set_oracle = @{}
    foreach ($linha in ($arquivos_oracle -split "`n")) {
        $linha = $linha.Trim()
        if ($linha) { $set_oracle[$linha] = $true }
    }

    Write-Host "   Oracle tem $($set_oracle.Count) arquivo(s) de upload."

    # Descobre arquivos locais que faltam na Oracle
    $novos = @()
    Get-ChildItem -Path $LOCAL_UPLOADS -Recurse -File | ForEach-Object {
        $relativo = $_.FullName.Substring($LOCAL_UPLOADS.Length + 1).Replace('\', '/')
        if (-not $set_oracle.ContainsKey($relativo)) {
            $novos += $_
        }
    }

    if ($novos.Count -eq 0) {
        Write-Host "   Nenhum arquivo novo para enviar. Oracle ja esta atualizada." -ForegroundColor Green
        exit 0
    }

    Write-Host "[2/2] Enviando $($novos.Count) arquivo(s) novo(s) para a Oracle..." -ForegroundColor Yellow

    foreach ($arquivo in $novos) {
        $relativo  = $arquivo.FullName.Substring($LOCAL_UPLOADS.Length + 1).Replace('\', '/')
        $destino   = "$ORACLE_UPLOADS/$relativo"
        $dest_dir  = ($destino -split '/')[0..($destino.Split('/').Count - 2)] -join '/'

        # Cria diretório remoto se necessário
        ssh -i $SSH_KEY -o StrictHostKeyChecking=no "ubuntu@${IP_ORACLE}" "mkdir -p $dest_dir" 2>$null

        Write-Host "   + $relativo"
        scp -i $SSH_KEY -o StrictHostKeyChecking=no $arquivo.FullName "ubuntu@${IP_ORACLE}:${destino}" 2>$null
    }

    Write-Host ""
    Write-Host "=== Concluido! $($novos.Count) arquivo(s) enviado(s). ===" -ForegroundColor Green

} elseif ($opcao -eq 'B' -or $opcao -eq 'b') {
    # ─── BAIXAR ORACLE → LOCAL (BACKUP) ─────────────────────

    $data = Get-Date -Format "yyyyMMdd_HHmm"
    $dest = "${BACKUP_DIR}_${data}"
    New-Item -ItemType Directory -Path $dest -Force | Out-Null

    Write-Host ""
    Write-Host "[1/1] Baixando uploads da Oracle para: $dest" -ForegroundColor Yellow

    scp -i $SSH_KEY -o StrictHostKeyChecking=no -r "ubuntu@${IP_ORACLE}:${ORACLE_UPLOADS}/" $dest

    $total = (Get-ChildItem -Path $dest -Recurse -File).Count
    Write-Host ""
    Write-Host "=== Backup concluido! $total arquivo(s) baixado(s) em: $dest ===" -ForegroundColor Green

} else {
    Write-Host "Opcao invalida. Execute o script novamente e escolha A ou B." -ForegroundColor Red
}
