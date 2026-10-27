@echo off
title Pravaah AI - Edge-Native Adaptive Traffic Signal System
color 0A

echo ======================================================================
echo           PRAVAAH AI - SMART SIGNALLING AND CIVIC MOBILITY
echo     Edge-Native Adaptive Traffic Signal and Civic Telemetry Platform
echo ======================================================================
echo.
echo [1/3] Checking Python environment...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    pause
    exit /b 1
)

echo [2/3] Launching Pravaah AI Edge Engine and Telemetry Server (Port 8000)...
echo       - 10 Hz Deterministic Safety Finite State Machine
echo       - Zero-Lag Frame Capture and Polygon ROI Queue Analyzer
echo       - Parallel Shadow Fixed-Timer KPI Counterfactual Simulator
echo       - SQLite WAL Local Telemetry and Citizen Ticket Store
echo       - FastAPI REST and WebSocket Live Digital Twin Broadcaster
echo.

start "" "http://localhost:8000"

echo [3/3] Opening browser at http://localhost:8000 ...
echo.
echo ======================================================================
echo System is LIVE. Press Ctrl+C in this terminal to stop the engine.
echo ======================================================================
echo.

python -m edge_engine.main

pause
