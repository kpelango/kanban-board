@echo off
setlocal EnableDelayedExpansion

set SCRIPT_DIR=%~dp0
pushd "%SCRIPT_DIR%.."
set PROJECT_ROOT=%CD%
set ENV_FILE=%PROJECT_ROOT%\.env

if not exist "%ENV_FILE%" (
    echo Error: .env not found. Copy .env.example to .env and fill it in.
    goto :fail
)

set DATABASE_URL=
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
    if "%%A"=="DATABASE_URL" set "DATABASE_URL=%%B"
)
if "!DATABASE_URL!"=="" (
    echo Error: DATABASE_URL is not set in .env. See .env.example.
    goto :fail
)

rem A local database is reached from inside the container through host.docker.internal
set "LOCAL_URL=!DATABASE_URL:@127.0.0.1:=@host.docker.internal:!"
set "LOCAL_URL=!LOCAL_URL:@localhost:=@host.docker.internal:!"
if not "!LOCAL_URL!"=="!DATABASE_URL!" (
    for /f "tokens=2 delims=:/" %%P in ("!DATABASE_URL:*@=!") do set DB_PORT=%%P
    powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', !DB_PORT!) } catch { exit 1 }" >nul 2>&1
    if errorlevel 1 (
        echo Error: nothing is listening on port !DB_PORT!, so the local database is not running.
        echo Start it with: npx supabase start
        goto :fail
    )
)

docker rm -f pm-app >nul 2>&1

docker build -t pm-app .
if errorlevel 1 goto :fail

docker run -d --name pm-app -p 8000:8000 --add-host=host.docker.internal:host-gateway --env-file "%ENV_FILE%" -e "DATABASE_URL=!LOCAL_URL!" pm-app >nul
if errorlevel 1 goto :fail

echo Server started at http://localhost:8000
popd
endlocal
exit /b 0

:fail
popd
endlocal
exit /b 1
