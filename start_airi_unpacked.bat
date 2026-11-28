@echo off
:: AIRI Tamagotchi - Unpacked Production Starter
:: Builds, copies production dependencies, unpacks the application, and runs the executable directly.

echo [1/4] Building packages...
call pnpm run build:packages

echo [2/4] Building Tamagotchi production assets...
call pnpm -F @proj-airi/stage-tamagotchi run build

echo [3/4] Copying external production dependencies...
call pnpm -F @proj-airi/stage-tamagotchi exec tsx scripts/copy-deps.ts

echo [4/4] Packaging unpacked application...
call pnpm -F @proj-airi/stage-tamagotchi exec electron-builder --win --dir

echo Starting unpacked production application...
set ELECTRON_RUN_AS_NODE=
:: NOTICE: see start_airi.bat - host sandbox init fails without this.
set ELECTRON_DISABLE_SANDBOX=1

:: electron-builder names the binary after win.executableName (airi-dasilva333),
:: not after package.json "name" (airi). Fall back to the old name for stale dists.
set "APP_EXE=apps\stage-tamagotchi\dist\win-unpacked\airi-dasilva333.exe"
if not exist "%APP_EXE%" set "APP_EXE=apps\stage-tamagotchi\dist\win-unpacked\airi.exe"
if not exist "%APP_EXE%" (
    echo [ERROR] Unpacked executable not found under apps\stage-tamagotchi\dist\win-unpacked.
    pause
    exit /b 1
)
start "" "%APP_EXE%"
