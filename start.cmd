@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [知错] 未找到 Node.js，请先安装 Node.js 20+：https://nodejs.org/
  pause
  exit /b 1
)
echo [知错] 正在启动智能错题本...
echo [知错] 启动后访问：http://127.0.0.1:8787
start "" /b cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:8787"
node server/index.mjs
pause
