@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Aurel — Shutdown Utility

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\stop.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
