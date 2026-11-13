@echo off
setlocal

set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%.."
set PROJECT_ROOT=%CD%

if not exist "%PROJECT_ROOT%\data" mkdir "%PROJECT_ROOT%\data"

docker rm -f pm-app >nul 2>&1

docker build -t pm-app .
if errorlevel 1 (
    popd
    exit /b 1
)

if exist "%PROJECT_ROOT%\.env" (
    docker run -d --name pm-app -p 8000:8000 -v "%PROJECT_ROOT%\data:/app/data" --env-file "%PROJECT_ROOT%\.env" pm-app >nul
) else (
    docker run -d --name pm-app -p 8000:8000 -v "%PROJECT_ROOT%\data:/app/data" pm-app >nul
)

echo Server started at http://localhost:8000
popd
endlocal
