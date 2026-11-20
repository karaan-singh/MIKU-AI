@echo off
title Hatsune Miku 3D Human AI Companion

cd /d "%~dp0"

echo ================================================================
echo    HATSUNE MIKU // 3D HUMAN-LIKE AI VOICE COMPANION
echo ================================================================
echo.

:: Check local Ollama status on 127.0.0.1:11434
curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if %errorlevel% equ 0 (
    echo [AI ENGINE] Local Ollama active with miku-human:latest! (100%% Local Ready)
) else (
    echo [AI ENGINE] Starting local Ollama service in background...
    if exist "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe" (
        start "" "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
    ) else (
        start "Ollama Service" /min ollama serve
    )
    timeout /t 2 /nobreak >nul
)
echo.

:: Check if port 8080 is already listening (Unified Neural/WAV + Static VRM Server)
netstat -ano | findstr ":8080 " >nul
if %errorlevel% equ 0 (
    echo [VOICE + 3D SERVER] Active server detected on http://localhost:8080
    echo Opening http://localhost:8080/index.html ...
    start "" "http://localhost:8080/index.html"
    exit /b
)

echo [VOICE + 3D SERVER] Starting Neural + Offline WAV Server at http://localhost:8080 ...
start "" "http://localhost:8080/index.html"
python server.py
