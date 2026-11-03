@echo off
chcp 65001 >nul
setlocal
title Install Qingshi plugin into DeepSeek Harness
cd /d "%~dp0.."

echo.
echo ==================================================
echo   Install Qingshi plugin into DeepSeek Harness
echo ==================================================
echo.
echo Target profile : %USERPROFILE%\.dsh\profiles\desktop
echo Plugin folder  : %CD%
echo.

node install.mjs
if errorlevel 1 (
  echo.
  echo [FAILED] Install failed. Copy the red lines above and send them back.
  echo.
  pause
  exit /b 1
)

echo.
echo [OK] Installed.
echo.
echo Next:
echo   1. Quit DeepSeek Harness completely ^(not minimize^), then start it again.
echo   2. Say "open qingshi" in the chat.
echo   3. The window should open already signed in. No SMS code needed.
echo.
pause
