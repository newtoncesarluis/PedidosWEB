# SysRepWeb — Ícone na bandeja do sistema
# REQUER: powershell.exe -Sta (single-threaded apartment) para Windows Forms funcionar

param([int]$Port = 3002)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Ícone personalizado (círculo azul com letra S) ───────────────────────────
function New-TrayIcon {
  $bmp = New-Object System.Drawing.Bitmap(16, 16)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(67, 97, 238))
  $g.FillEllipse($brush, 0, 0, 15, 15)

  $font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment     = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString("S", $font, $white, (New-Object System.Drawing.RectangleF(0, 1, 16, 15)), $sf)

  $g.Dispose(); $brush.Dispose(); $white.Dispose(); $font.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

function Test-Server([int]$p) {
  try {
    Invoke-WebRequest -Uri "http://localhost:$p" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop | Out-Null
    return $true
  } catch { return $false }
}

# ── ApplicationContext mantém o processo vivo sem Form visível ───────────────
$appCtx = New-Object System.Windows.Forms.ApplicationContext

# ── NotifyIcon ───────────────────────────────────────────────────────────────
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon    = New-TrayIcon
$ni.Text    = "SysRepWeb — porta $Port"
$ni.Visible = $true

# ── Menu de contexto ─────────────────────────────────────────────────────────
$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itmAbrir = $menu.Items.Add("  Abrir no navegador")
$itmAbrir.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$itmAbrir.add_Click({ Start-Process "http://localhost:$Port" })

$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null

$itmStatus = $menu.Items.Add("  Verificar status")
$itmStatus.add_Click({
  if (Test-Server $Port) {
    $ni.BalloonTipTitle = "SysRepWeb — Online"
    $ni.BalloonTipText  = "Servidor respondendo em http://localhost:$Port"
    $ni.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
  } else {
    $ni.BalloonTipTitle = "SysRepWeb — Offline"
    $ni.BalloonTipText  = "Servidor nao esta respondendo na porta $Port"
    $ni.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Error
  }
  $ni.ShowBalloonTip(3000)
})

$itmReiniciar = $menu.Items.Add("  Reiniciar servidor")
$itmReiniciar.add_Click({
  $ni.BalloonTipTitle = "SysRepWeb"
  $ni.BalloonTipText  = "Reiniciando..."
  $ni.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
  $ni.ShowBalloonTip(2000)

  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  $dir = $PSScriptRoot
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $dir -WindowStyle Hidden
  Start-Sleep -Seconds 2

  if (Test-Server $Port) {
    $ni.BalloonTipTitle = "SysRepWeb"
    $ni.BalloonTipText  = "Servidor reiniciado com sucesso!"
    $ni.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
  } else {
    $ni.BalloonTipTitle = "SysRepWeb"
    $ni.BalloonTipText  = "Verifique o Node.js e tente novamente."
    $ni.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Warning
  }
  $ni.ShowBalloonTip(3000)
})

$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null

$itmParar = $menu.Items.Add("  Parar servidor e sair")
$itmParar.ForeColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$itmParar.add_Click({
  $ni.Visible = $false
  $ni.Dispose()
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $appCtx.ExitThread()   # encerra o Application::Run de forma limpa
})

$ni.ContextMenuStrip = $menu

# Duplo clique abre o navegador
$ni.add_DoubleClick({ Start-Process "http://localhost:$Port" })

# ── Balloon de boas-vindas ───────────────────────────────────────────────────
$ni.BalloonTipTitle = "SysRepWeb iniciado!"
$ni.BalloonTipText  = "http://localhost:$Port — clique duplo para abrir"
$ni.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
$ni.ShowBalloonTip(4000)

# ── Mantém o processo rodando (STA obrigatório) ──────────────────────────────
[System.Windows.Forms.Application]::Run($appCtx)

$ni.Visible = $false
$ni.Dispose()
