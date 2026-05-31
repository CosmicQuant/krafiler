@echo off
:loop
echo [%date% %time%] Starting backend...
start /B /WAIT npm run dev:backend
echo [%date% %time%] Backend exited with code %errorlevel%, restarting in 2s...
timeout /t 2 /nobreak >nul
goto loop
