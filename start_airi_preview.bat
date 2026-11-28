@echo off
:: AIRI Tamagotchi - Production Preview Starter
:: Builds packages, builds the app, and previews the production bundle via electron-vite.

echo [1/3] Building packages...
call pnpm run build:packages

echo [2/3] Building Tamagotchi production assets...
call pnpm -F @proj-airi/stage-tamagotchi run build

echo [3/3] Starting Tamagotchi in Preview Mode...
set ELECTRON_RUN_AS_NODE=
:: NOTICE: see start_airi.bat - host sandbox init fails without this.
set ELECTRON_DISABLE_SANDBOX=1
:: NOTICE: see start_airi.bat - keep the dev profile inside the workspace.
if not defined AIRI_USER_DATA_DIR set "AIRI_USER_DATA_DIR=%~dp0apps\stage-tamagotchi\.dev-userdata"
echo [profile] %AIRI_USER_DATA_DIR%
:: Try to use local config if it exists, otherwise use default
if exist "apps\stage-tamagotchi\electron.vite.config.local.ts" (
    call pnpm -F @proj-airi/stage-tamagotchi start --config electron.vite.config.local.ts
) else (
    call pnpm -F @proj-airi/stage-tamagotchi start
)
