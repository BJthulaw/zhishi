@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo 未找到 Node.js。请先安装 Node 22。
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo 正在创建 Python 虚拟环境...
    where uv >nul 2>&1
    if errorlevel 1 (
        echo 未找到 uv。请先安装: https://docs.astral.sh/uv/
        pause
        exit /b 1
    )
    uv sync
)

if not exist "node_modules" (
    echo 正在安装前端依赖...
    call npm install
    if errorlevel 1 (
        echo npm install 失败。
        pause
        exit /b 1
    )
)

echo 正在构建界面并启动知拾...
call npm run dev
if errorlevel 1 (
    echo 启动失败。可先运行: uv run pytest  与  npm test
    pause
    exit /b 1
)
