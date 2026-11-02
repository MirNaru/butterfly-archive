@echo off
rem Start the local Butterfly Archive launcher.
if not exist "%~dp0backend\.venv\Scripts\pythonw.exe" (
  echo Python environment not found. Please check README.md.
  pause
  exit /b 1
)
start "" "%~dp0backend\.venv\Scripts\pythonw.exe" "%~dp0start_app.py"
