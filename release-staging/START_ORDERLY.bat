@echo off
REM Orderly launcher - starts the Orderly desktop app.
setlocal
cd /d "%~dp0"
if not exist "Orderly.exe" (
  echo ERROR: Orderly.exe was not found.
  echo Make sure you extracted the whole zip, keeping the folder structure.
  echo.
  pause
  exit /b 1
)
start "" "Orderly.exe"
if errorlevel 1 (
  echo ERROR: Orderly failed to start (error %errorlevel%).
  echo.
  pause
  exit /b 1
)
endlocal
