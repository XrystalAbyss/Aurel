@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Aurel — System Status Check

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\check.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXIT_CODE%
