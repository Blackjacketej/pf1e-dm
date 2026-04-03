@echo off
echo ============================================
echo   PF1e DM - GitHub Pages Deployment Setup
echo ============================================
echo.

:: Check for git
where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Git is not installed. Download from https://git-scm.com/download/win
    pause
    exit /b 1
)

:: Check for Node
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed. Download from https://nodejs.org
    pause
    exit /b 1
)

echo [1/5] Cleaning old lock file and installing dependencies...
if exist "package-lock.json" del package-lock.json
call npm install --legacy-peer-deps
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)

echo [2/5] Building for GitHub Pages...
set GITHUB_PAGES=true
call npx vite build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed
    pause
    exit /b 1
)

echo [3/5] Initializing git repository...
if not exist ".git" (
    git init -b main
)
git add -A
git commit -m "Initial commit - PF1e DM App"

echo.
echo ============================================
echo   BUILD COMPLETE! Now do these steps:
echo ============================================
echo.
echo 1. Go to https://github.com/new
echo 2. Create a repo named "pf1e-dm" (keep it public)
echo 3. Do NOT add a README or .gitignore
echo 4. Run these commands (replace YOUR_USERNAME):
echo.
echo    git remote add origin https://github.com/YOUR_USERNAME/pf1e-dm.git
echo    git push -u origin main
echo.
echo 5. After pushing, go to your repo Settings ^> Pages
echo 6. Under "Build and deployment", set Source to "GitHub Actions"
echo 7. The workflow will auto-run and deploy your app!
echo 8. Your app URL will be: https://YOUR_USERNAME.github.io/pf1e-dm/
echo.
echo Then on your iPhone:
echo   - Open that URL in Safari
echo   - Tap Share ^> "Add to Home Screen"
echo   - Done! It works offline after first load.
echo.
pause
