@echo off
REM Start all KRAFILER services
cd /d C:\Users\ADMIN\Desktop\KRAFILER

echo Starting Redis...
start /B C:\Users\ADMIN\Desktop\KRAFILER\redis\redis-server.exe C:\Users\ADMIN\Desktop\KRAFILER\redis\redis-wsl.conf
timeout /t 3 /nobreak >nul

echo Starting Backend API...
start /B npm run dev:backend
timeout /t 2 /nobreak >nul

echo Starting Worker...
start /B npm run worker
timeout /t 2 /nobreak >nul

echo Starting Frontend...
start /B npm run dev:frontend

echo All services started!
