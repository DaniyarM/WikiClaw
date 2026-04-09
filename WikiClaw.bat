@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found in PATH.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Building WikiClaw...
call npm run build
if errorlevel 1 goto :fail

echo Starting WikiClaw on http://localhost:8787 ...
start "" "http://localhost:8787"
node dist-server\server\index.js
goto :eof

:fail
echo.
echo WikiClaw failed to start.
pause
exit /b 1
