@echo off
chcp 65001 >nul 2>&1
title SysRepWeb

set "DIR=%~dp0"
set "PORT=3002"

:: Inicia o servidor Node.js (janela minimizada)
start "SysRepWeb-Node" /MIN cmd /c "cd /d "%DIR%" && node server.js"

:: Aguarda 3 segundos para o servidor subir
timeout /t 3 /nobreak >nul

:: Abre no navegador
start http://localhost:%PORT%

:: Inicia ícone na bandeja (modo STA obrigatório para Windows Forms)
powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DIR%tray-icon.ps1" -Port %PORT%
