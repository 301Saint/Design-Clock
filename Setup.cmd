@echo off
rem One-time setup on a new computer: installs dependencies, builds the app,
rem and creates the Desktop / Start menu shortcut.
setlocal
cd /d "%~dp0"
title Design Clock setup

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Installing Node.js LTS with winget...
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js installed. Close this window and double-click Setup.cmd again to finish.
  pause
  exit /b 0
)

node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo Design Clock needs Node.js 22.5 or newer. Update it with:
  echo   winget upgrade --id OpenJS.NodeJS.LTS -e
  pause
  exit /b 1
)

echo Installing dependencies...
call npm install --no-fund --no-audit || goto :fail
echo Building the app...
call npm run build || goto :fail
echo Creating shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Create Desktop Shortcut.ps1" || goto :fail

echo.
echo Done! Open "Design Clock" from your Desktop or Start menu.
pause
exit /b 0

:fail
echo.
echo Setup did not finish - see the messages above.
pause
exit /b 1
