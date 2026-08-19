@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing Comfy Deck for first use...
  call npm install
  if errorlevel 1 exit /b 1
)
echo.
echo Comfy Deck is starting. Open the Network address shown below on your phone or tablet.
echo Keep this window open while using the dashboard.
echo.
call npm run dev
