@echo off
title J2ME Emulator - Chay Ngam 24/7
cd /d "%~dp0"

echo ========================================================
echo    DANG KHOI CHAY J2ME EMULATOR (CHAY NGAM KHAY HE THONG)
echo ========================================================

if not exist dist\index.html (
    echo [1/2] Dang chuan bi goi ung dung (npm run build)...
    call npm.cmd run build
)

echo [2/2] Dang khoi chay ung dung Desktop...
start "" npx.cmd electron electron-main.cjs
exit
