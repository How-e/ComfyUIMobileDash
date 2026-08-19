@echo off
setlocal
cd /d "%~dp0"
if not exist ".env.local" (
  echo Using automatic local ComfyUI detection at http://127.0.0.1:8188.
  echo Run configure-dashboard.bat first if ComfyUI uses another address.
  echo.
)
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
