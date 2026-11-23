@echo off
title Nexvora Gmail Vault Local Server
cd /d "%~dp0"
echo Starting Nexvora Gmail Vault Local Server...
echo Data is safely stored in: "%~dp0data\gmail-accounts.json"
echo.
start "" "http://127.0.0.1:3000"
node server.js
pause
