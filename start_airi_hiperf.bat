@echo off
:: AIRI Tamagotchi - Local Dev Starter
:: Use this to force a specific port to recover settings or models.

set /p PORT_NUM="Enter port (e.g. 5173, 5174, 5175) or press Enter for 5174: "
if "%PORT_NUM%"=="" set PORT_NUM=5174

echo [1/2] Building packages...
set NODE_OPTIONS=--max-old-space-size=8192
call pnpm run build:packages

echo [2/2] Starting Tamagotchi on Port %PORT_NUM%...
set AIRI_RENDERER_PORT=%PORT_NUM%
set AIRI_FORCE_HIGH_PERFORMANCE_GPU=1
set ELECTRON_RUN_AS_NODE=
:: NOTICE: see start_airi.bat - host sandbox init fails without this.
set ELECTRON_DISABLE_SANDBOX=1
:: NOTICE: see start_airi.bat - keep the dev profile inside the workspace.
if not defined AIRI_USER_DATA_DIR set "AIRI_USER_DATA_DIR=%~dp0apps\stage-tamagotchi\.dev-userdata"
echo [profile] %AIRI_USER_DATA_DIR%

:: Ensure electron path is configured
call node apps\stage-tamagotchi\scripts\ensure-electron.js

:: Note: This uses the local config shim that is gitignored to force the renderer port.
if exist "apps\stage-tamagotchi\electron.vite.config.local.ts" (
    call pnpm -F @proj-airi/stage-tamagotchi exec electron-vite dev --config electron.vite.config.local.ts
) else (
    call pnpm -F @proj-airi/stage-tamagotchi exec electron-vite dev
)
