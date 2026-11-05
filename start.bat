@echo off
title Hatsune Miku AI Voice Assistant

cd /d "%~dp0"

echo ================================================================
echo    HATSUNE MIKU // MULTILINGUAL AI VOICE ASSISTANT 39
echo ================================================================
echo.

:: Check local Ollama status on 127.0.0.1:11434
curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if %errorlevel% equ 0 (
    echo [AI ENGINE] Local Ollama is active with nchapman/dolphin3.0-qwen2.5:3b! (100%% Offline Ready)
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

:: Check if Apache port 80 is listening
netstat -ano | findstr ":80 " >nul
if %errorlevel% equ 0 (
    echo [INFO] Detected active local web server on port 80.
    echo Opening http://localhost/xampp/company%%20web/miku/index.html ...
    start "" "http://localhost/xampp/company%%20web/miku/index.html"
    exit /b
)

:: Check if port 8080 is already listening
netstat -ano | findstr ":8080 " >nul
if %errorlevel% equ 0 (
    echo [INFO] Detected active local web server on port 8080.
    echo Opening http://localhost:8080/index.html ...
    start "" "http://localhost:8080/index.html"
    exit /b
)

echo [INFO] Starting local server at http://localhost:8080 ...
start "" "http://localhost:8080/index.html"
python -m http.server 8080
