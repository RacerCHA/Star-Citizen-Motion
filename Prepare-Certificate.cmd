@echo off
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-LocalCertificate.ps1"
echo.
pause
