@echo off
title Hatsune Miku // Advanced 3D AI & PC Control Server

cd /d "%~dp0"

echo ================================================================
echo    HATSUNE MIKU // 3D HUMAN AI + FULL DESKTOP CONTROL ENGINE
echo ================================================================
echo.

:: Ensure Ollama is running on 127.0.0.1:11434
curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if %errorlevel% equ 0 (
    echo [AI BRAIN] Local Ollama active with miku-human:latest!
) else (
    echo [AI BRAIN] Starting local Ollama service...
    if exist "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe" (
        start "" "%LOCALAPPDATA%\Programs\Ollama\ollama app.exe"
    ) else (
        start "Ollama Service" /min ollama serve
    )
    timeout /t 2 /nobreak >nul
)

:: Open browser after 2 seconds once server binds port 8080 on your live Windows desktop
echo [PC CONTROL + VOICE SERVER] Attaching Miku to your live Windows Desktop on http://localhost:8080 ...
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080/index.html"
python server.py
