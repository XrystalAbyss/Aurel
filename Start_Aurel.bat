@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Aurel — Platform Launcher

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\start.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [ERROR] Aurel startup failed with exit code %EXIT_CODE%.
    echo Please review the diagnostic messages above.
    echo Detailed logs can be found in .aurel-runtime\logs\
    echo.
    pause
    exit /b %EXIT_CODE%
)

echo.
pause
exit /b 0
