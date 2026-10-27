@echo off
title Pravaah AI — Frontend Dashboard (Vite Dev Server)
color 03

echo ======================================================================
echo    Pravaah AI — Frontend Dashboard (React + TypeScript + Tailwind)
echo ======================================================================
echo.
echo Launching Vite Dev Server on port 3000...
echo.

cd /d "%~dp0frontend_dashboard"
call npm.cmd run dev -- --open

pause
