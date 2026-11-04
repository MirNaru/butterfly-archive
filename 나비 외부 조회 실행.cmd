@echo off
chcp 65001 >nul
cd /d "%~dp0"
"backend\.venv\Scripts\python.exe" start_viewer.py
"backend\.venv\Scripts\python.exe" start_viewer.py --https
pause
