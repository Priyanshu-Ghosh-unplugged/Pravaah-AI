@echo off
title Pravaah AI - Automated Safety and Property Tests
color 0E

echo ======================================================================
echo    Pravaah AI - Automated Safety Invariant and Property Test Suite
echo ======================================================================
echo.
echo Running 7 formal tests:
echo   - 50,000-tick zero conflicting greens assertion
echo   - Empty approach 0s instant skip verification
echo   - Mathematical anti-starvation ceiling (under 95 seconds)
echo   - 20:1 load skew heavy arterial vs side-lane test
echo   - Multi-modal ambulance preemption with 3s Amber + 2s All-Red
echo   - Corridor platoon P2P kinematic priority bonus
echo.

python -m pytest tests/ -v

echo.
echo ======================================================================
echo Test execution complete.
echo ======================================================================
pause
