@echo off
rem Open the Qingshi desktop window directly (outside the DSH sandbox, so no permission issues).
setlocal
if "%QINGSHI_ROUTE%"=="" set "QINGSHI_ROUTE=/pages/career/career"
node "%~dp0open.mjs"
if errorlevel 1 pause
exit /b 0
