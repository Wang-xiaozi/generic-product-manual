@echo off
setlocal
chcp 65001 >nul
title Pre-installed Manual

cd /d "%~dp0"

if exist "%~dp0.venv\Scripts\python.exe" (
    set "MANUAL_PYTHON=%~dp0.venv\Scripts\python.exe"
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Python was not found. Install Python or create .venv first.
        pause
        exit /b 1
    )
    set "MANUAL_PYTHON=python"
)

echo Starting Pre-installed Manual...
"%MANUAL_PYTHON%" "%~dp0run.py" %*
set "MANUAL_EXIT_CODE=%ERRORLEVEL%"

if not "%MANUAL_EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Startup failed. Exit code: %MANUAL_EXIT_CODE%
    pause
)

exit /b %MANUAL_EXIT_CODE%
