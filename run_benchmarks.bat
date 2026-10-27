@echo off
title Pravaah AI - Subsystem Latency and Real-Time Profiling Benchmark
color 0D

echo ======================================================================
echo    Pravaah AI - Computational Latency and Real-Time Profiling
echo ======================================================================
echo.
echo Running automated micro-benchmarks across 4 cameras...
echo.

python scripts/benchmark_latency.py

echo.
echo ======================================================================
echo Benchmark complete.
echo ======================================================================
pause
