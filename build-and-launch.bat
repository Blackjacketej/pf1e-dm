@echo off
REM ============================================================
REM build-and-launch.bat
REM ------------------------------------------------------------
REM Step 1: build-verify via `npx vite build` — catches any
REM         syntax / import errors before play starts.
REM Step 2: if the build is clean, launch the dev server with
REM         HMR enabled so Claude's edits hot-reload while you
REM         play. No rebuild needed after each code change.
REM ============================================================
setlocal

cd /d "%~dp0"

echo.
echo ============================================================
echo   BUILD-VERIFY  (npx vite build)
echo ============================================================
echo.

call npx vite build
if errorlevel 1 (
    echo.
    echo ************************************************************
    echo   BUILD FAILED  -- fix the errors above before launching
    echo ************************************************************
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   BUILD OK  -- starting dev server with HMR
echo   Open http://localhost:5173 in your browser
echo   Press Ctrl+C in this window to stop the server
echo ============================================================
echo.

call npx vite

endlocal
