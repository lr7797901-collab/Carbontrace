@echo off
rem CarbonTrace Pro - local launcher (Windows). Needs Python 3; otherwise just double-click index.html.
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python not found - opening index.html directly in your browser.
  start "" "%~dp0index.html"
  goto :eof
)
echo CarbonTrace Pro running at http://127.0.0.1:8090/   (Ctrl+C to stop)
start "" "http://127.0.0.1:8090/"
python -m http.server 8090 --bind 127.0.0.1
