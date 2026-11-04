@echo off
REM Orderly launcher - starts the Orderly desktop app.
setlocal
cd /d "%~dp0"
if not exist "win-unpacked\Orderly.exe" (
  echo ERROR: win-unpacked\Orderly.exe was not found.
  echo Make sure you extracted the whole zip, keeping the folder structure.
  echo.
  pause
  exit /b 1
)
start "" "win-unpacked\Orderly.exe"
if errorlevel 1 (
  echo ERROR: Orderly failed to start (error %errorlevel%).
  echo.
  pause
  exit /b 1
)
endlocal
