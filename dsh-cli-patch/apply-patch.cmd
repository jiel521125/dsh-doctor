@echo off
REM ============================================================================
REM   apply-patch.cmd  ?  One-step DSH source-tree patcher for Windows
REM   Usage:
REM     cd dsh-doctor\dsh-cli-patch
REM     apply-patch.cmd  D:\path\to\your\DeepSeek\staging
REM
REM   What it does:
REM     1. Copies src\doctor.ts and src\doctor-engine.js ? apps\cli\src\
REM     2. OVERWRITES apps\cli\src\args.ts and bin.ts with reference\ versions
REM        (reference files are fully-patched; user can diff first if preferred)
REM     3. Prints the exact build command the user needs to run after.
REM ============================================================================
setlocal
set "STAGING=%~1"
if "%STAGING%"=="" (
  echo USAGE: apply-patch.cmd ^<path-to-dsh-staging^>
  echo   staging = the folder that contains apps\cli\src\args.ts
  echo   Example:  apply-patch.cmd  E:\repos\DeepSeek\staging
  exit /b 2
)
if not exist "%STAGING%\apps\cli\src\args.ts" (
  echo [apply-patch] ERROR: cannot find args.ts at %STAGING%\apps\cli\src\args.ts
  echo   Is STAGING set to the right directory?
  exit /b 2
)
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "TARGET_SRC=%STAGING%\apps\cli\src"

echo.
echo [apply-patch] Target  = %TARGET_SRC%
echo [apply-patch] Source  = %SCRIPT_DIR%
echo.

REM ---- 1. Copy thin wrapper and engine -----------------------------------
copy /Y "%SCRIPT_DIR%\src\doctor.ts"         "%TARGET_SRC%\doctor.ts"         >nul
copy /Y "%SCRIPT_DIR%\src\doctor-engine.js"   "%TARGET_SRC%\doctor-engine.js"   >nul
echo [apply-patch]  - copied doctor.ts / doctor-engine.js  -^> apps\cli\src\

REM ---- 2. Overwrite args.ts + bin.ts with our reference/ versions --------
echo [apply-patch]  - OVERWRITING apps\cli\src\args.ts with reference\args.ts (contains DoctorInvocation + subcommand)
echo [apply-patch]  - OVERWRITING apps\cli\src\bin.ts  with reference\bin.ts  (contains case 'doctor' branch)
REM     save backups first, just in case
if not exist "%TARGET_SRC%\args.ts.bak" copy /Y "%TARGET_SRC%\args.ts" "%TARGET_SRC%\args.ts.bak" >nul
if not exist "%TARGET_SRC%\bin.ts.bak"  copy /Y "%TARGET_SRC%\bin.ts"  "%TARGET_SRC%\bin.ts.bak"  >nul
copy /Y "%SCRIPT_DIR%\reference\args.ts"  "%TARGET_SRC%\args.ts" >nul
copy /Y "%SCRIPT_DIR%\reference\bin.ts"   "%TARGET_SRC%\bin.ts"  >nul

REM ---- 3. Report + build instructions ------------------------------------
echo.
echo [apply-patch] DONE.
echo.
echo Backups were created at:
echo   - %TARGET_SRC%\args.ts.bak
echo   - %TARGET_SRC%\bin.ts.bak
echo.
echo NEXT STEPS:
echo   1. Diff the patched files against the backups if you want to verify:
echo        git diff --no-index apps\cli\src\args.ts.bak apps\cli\src\args.ts
echo   2. Build DSH from the repo root (NOT staging root ? check your project docs):
echo        pnpm install
echo        pnpm build
echo   3. After build, apps\cli\lib\ will contain:
echo        bin.js  doctor.js  doctor-engine.js   dump-config.js   plugin.js   profile-boot.js  ...
echo   4. Copy the contents of apps\cli\lib\ into DeepSeekHarness\app\lib\ in your
echo      released installer, and also ship DeepSeekHarness\dsh-doctor.cmd from
echo      dsh-doctor\standalone\ for the zero-build companion entry point.
echo.
exit /b 0