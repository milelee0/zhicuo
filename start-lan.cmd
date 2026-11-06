@echo off
chcp 65001 >nul
cd /d "%~dp0"
set HOST=0.0.0.0
set PORT=8787
where node >nul 2>nul
if errorlevel 1 (
  echo [知错] 未找到 Node.js，请先安装 Node.js 20+：https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo [知错] 正在启动「手机可访问」模式...
echo [知错] 请让手机和电脑连接同一个 Wi-Fi。
echo [知错] 启动后，在下方日志中查看「手机访问」地址，用手机浏览器打开。
echo.
node server/index.mjs
pause
