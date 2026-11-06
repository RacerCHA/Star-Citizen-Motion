@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply-DBox.ps1" -Apply
echo.
pause
