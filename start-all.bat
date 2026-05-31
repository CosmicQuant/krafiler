@echo off
title KRAFILER All Services
echo [%date% %time%] Starting KRAFILER services...

:: Start Redis (if not already running)
tasklist /FI "IMAGENAME eq redis-server.exe" 2>nul | find /I "redis-server" >nul
if errorlevel 1 (
    echo [%time%] Starting Redis...
    start /B redis-server.exe redis-local.conf
    timeout /t 3 /nobreak >nul
) else (
    echo [%time%] Redis already running
)

:: Start backend (loops on crash for ts-node-dev respawn)
echo [%time%] Starting Backend API...
start /B npm run dev:backend

:: Start worker
echo [%time%] Starting KRA Filing Worker...
start /B npm run worker

:: Start frontend
echo [%time%] Starting Frontend...
start /B npm run dev:frontend

echo [%time%] All services started
echo.
echo  Backend:  http://localhost:3001
echo  Frontend: http://localhost:3000
echo  Worker:   (background)
echo.
echo Close this window to stop all services.
echo.
pause
