@echo off
title Pravaah AI — Standalone 4-Way Traffic Simulator
color 0B

echo ======================================================================
echo    Pravaah AI — Standalone Fullscreen Interactive Simulator
echo    (Zero-Install, Zero-NPM, 100%% Offline Presentation & Demo Mode)
echo ======================================================================
echo.
echo Opening traffic_demo.html in default browser...

start "" "%~dp0traffic_demo.html"

echo.
echo Simulator launched successfully!
echo - Features: Instant 0s Skip, IRC:106 PCU Weights, Anti-Starvation, East Ambulance
echo.
timeout /t 3 >nul
exit /b 0
