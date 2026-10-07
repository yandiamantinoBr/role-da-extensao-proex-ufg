@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 22.13 ou superior. & pause & exit /b 1)
if not exist node_modules\vite (
  call npx.cmd --yes pnpm@11.25.0 install --frozen-lockfile
  if errorlevel 1 (pause & exit /b 1)
)
call npm.cmd run dev:pages -- --port 5173 --strictPort --open
pause
