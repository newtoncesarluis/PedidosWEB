@echo off
chcp 65001 >nul 2>&1
title SysRepWeb

set "DIR=%~dp0"
set "PORT=3002"

set NODE_SKIP_PLATFORM_CHECK=1

set LICENSE_DB_HOST=147.15.106.135
set LICENSE_DB_PORT=3306
set LICENSE_DB_USER=nilton
set LICENSE_DB_PASSWORD=kzf010557f
set LICENSE_DB_NAME=sistema_licencas

if not exist "%DIR%logs" mkdir "%DIR%logs"

:: Mata TODOS os processos na porta (qualquer estado: LISTEN, TIME_WAIT, etc)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002 "') do taskkill /F /PID %%a >nul 2>&1

timeout /t 2 /nobreak >nul

start "" /B cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:%PORT%"

start "" /B powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%DIR%tray-icon.ps1" -Port %PORT%

cd /d "%DIR%"
echo [SysRepWeb] Iniciando servidor na porta %PORT%...
echo.
node server.js 2>&1

echo.
echo ============================================
echo  Servidor parado. Pressione qualquer tecla para fechar.
echo ============================================
pause >nul
