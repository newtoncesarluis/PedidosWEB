@echo off
chcp 65001 >nul
title Exportar banco MySQL - PedidosWeb

:: ─── CONFIGURE AQUI ────────────────────────────────────────
set DB_NAME=NOME_DO_BANCO
set DB_USER=root
set DB_PASS=
set IP_ORACLE=IP_DA_SUA_VM_ORACLE
set SSH_KEY=C:\xampp\htdocs\Backup\ssh-key-2026-03-22.key
:: ────────────────────────────────────────────────────────────

set DUMP_FILE=%TEMP%\pedidosweb-dump.sql
set MYSQLDUMP=C:\xampp\mysql\bin\mysqldump.exe

echo === Exportando banco %DB_NAME% do XAMPP ===
if "%DB_PASS%"=="" (
    "%MYSQLDUMP%" -u %DB_USER% --no-tablespaces --single-transaction --routines --triggers %DB_NAME% > "%DUMP_FILE%"
) else (
    "%MYSQLDUMP%" -u %DB_USER% -p%DB_PASS% --no-tablespaces --single-transaction --routines --triggers %DB_NAME% > "%DUMP_FILE%"
)

echo Dump gerado: %DUMP_FILE%
echo.
echo === Enviando dump para Oracle ===
scp -i "%SSH_KEY%" -o StrictHostKeyChecking=no "%DUMP_FILE%" ubuntu@%IP_ORACLE%:/home/ubuntu/dump.sql

echo.
echo === Pronto! ===
echo.
echo Agora na Oracle, importe o dump:
echo   ssh -i "%SSH_KEY%" ubuntu@%IP_ORACLE%
echo   mysql -u pedidosweb_user -p %DB_NAME% ^< /home/ubuntu/dump.sql
echo.
pause
