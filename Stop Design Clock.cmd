@echo off
rem Stops the background Design Clock server (your data is already saved).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "127.0.0.1:5178" ^| findstr LISTENING') do taskkill /PID %%p /F >nul
echo Design Clock stopped.
