@echo off
title Tunel SSH - Dev Local
chcp 65001 >nul

set GITBASH="C:\Program Files\Git\bin\bash.exe"
set KEY_ORACLE=/c/xampp/htdocs/Backup/ssh-key-2026-03-22.key
set KEY_HOST=/c/Users/nilton.cesar/.ssh/hostinger_key

echo.
echo  ==========================================
echo    TUNEL SSH - DESENVOLVIMENTO LOCAL
echo  ==========================================
echo.
echo   Qual servidor voce quer testar?
echo.
echo   [1] Oracle     (147.15.106.135)  porta 3307
echo   [2] Hostinger  (2.25.154.140)    porta 3308
echo   [0] Sair
echo.
set /p op="  Opcao: "

if "%op%"=="1" goto oracle
if "%op%"=="2" goto hostinger
if "%op%"=="0" goto sair
goto :eof

:oracle
echo.
echo  Abrindo tunel Oracle: localhost:3307 --> 147.15.106.135:3306
echo  Mantenha esta janela aberta enquanto estiver testando.
echo  Ctrl+C para fechar o tunel.
echo.
echo  No .env local use:
echo    CHAVE_LICENCA=XXXX-XXXX-XXXX-XXXX
echo    DB_HOST=127.0.0.1
echo    DB_PORT=3307
echo.
%GITBASH% -c "ssh -i %KEY_ORACLE% -o StrictHostKeyChecking=no -N -L 3307:localhost:3306 ubuntu@147.15.106.135"
goto sair

:hostinger
echo.
echo  Abrindo tunel Hostinger: localhost:3308 --> 2.25.154.140:3306
echo  Mantenha esta janela aberta enquanto estiver testando.
echo  Ctrl+C para fechar o tunel.
echo.
echo  No .env local use:
echo    CHAVE_LICENCA=XXXX-XXXX-XXXX-XXXX
echo    DB_HOST=127.0.0.1
echo    DB_PORT=3308
echo.
%GITBASH% -c "ssh -i %KEY_HOST% -o StrictHostKeyChecking=no -N -L 3308:localhost:3306 root@2.25.154.140"
goto sair

:sair
exit
