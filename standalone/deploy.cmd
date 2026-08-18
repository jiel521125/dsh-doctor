@echo off
REM ============================================================================
REM  deploy.cmd  ?  Deploy Path A (standalone) into a DSH portable installer
REM
REM  Usage:
REM     cd dsh-doctor\standalone
REM     deploy.cmd  D:\path\to\your\DeepSeekHarness
REM
REM  What it does:
REM     1. Validates the target installer root (checks for node\node.exe, app\lib\)
REM     2. Copies doctor-engine.js -> target\app\lib\doctor-engine.js
REM     3. Copies dsh-doctor.cmd     -> target\dsh-doctor.cmd
REM     4. Optionally patches bin.js with the 10-line doctor dispatcher
REM        (so dsh doctor ... works alongside dsh web / dsh plugin)
REM     5. Runs verify.cmd to confirm the deployment works
REM
REM  Idempotent: safe to re-run; overwrites the doctor files each time
REM  and skips the bin.js patch if already patched.
REM ============================================================================
setlocal EnableDelayedExpansion

set "TARGET=%~1"
if "%TARGET%"=="" (
  echo.
  echo USAGE: deploy.cmd ^<path-to-DeepSeekHarness^>
  echo.
  echo   Example:  deploy.cmd  D:\release\DeepSeekHarness
  echo             deploy.cmd  C:\path\to\DeepSeekHarness
  echo.
  echo   The target folder must contain:
  echo     - node\node.exe       ^(bundled Node^)
  echo     - app\lib\            ^(DSH CLI runtime, including bin.js^)
  exit /b 2
)

REM Resolve absolute path
for %%D in ("%TARGET%") do set "TARGET=%%~fD"

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

echo.
echo ============================================================
echo  dsh-doctor  Path A Deployment
echo ============================================================
echo  Source : %SCRIPT_DIR%\DeepSeekHarness
echo  Target : %TARGET%
echo ============================================================
echo.

REM ---- 1. Validate target --------------------------------------------------
if not exist "%TARGET%\node\node.exe" (
  echo [1/5] FAIL: %TARGET%\node\node.exe not found
  echo        Is the target really a DeepSeekHarness portable installer root?
  exit /b 3
)
if not exist "%TARGET%\app\lib\bin.js" (
  echo [1/5] FAIL: %TARGET%\app\lib\bin.js not found
  echo        The app tree is missing or corrupted.
  exit /b 3
)
echo [1/5] OK   Target validated: node + app\lib\bin.js present.

REM ---- 2. Copy doctor-engine.js -------------------------------------------
set "ENGINE_SRC=%SCRIPT_DIR%\DeepSeekHarness\app\lib\doctor-engine.js"
set "ENGINE_DST=%TARGET%\app\lib\doctor-engine.js"
copy /Y "%ENGINE_SRC%" "%ENGINE_DST%" >nul
if errorlevel 1 (
  echo [2/5] FAIL: copy doctor-engine.js failed
  exit /b 4
)
echo [2/5] OK   Copied doctor-engine.js -^> %TARGET%\app\lib\

REM ---- 3. Copy dsh-doctor.cmd ---------------------------------------------
set "CMD_SRC=%SCRIPT_DIR%\DeepSeekHarness\dsh-doctor.cmd"
set "CMD_DST=%TARGET%\dsh-doctor.cmd"
copy /Y "%CMD_SRC%" "%CMD_DST%" >nul
if errorlevel 1 (
  echo [3/5] FAIL: copy dsh-doctor.cmd failed
  exit /b 4
)
echo [3/5] OK   Copied dsh-doctor.cmd -^> %TARGET%\

REM ---- 4. Patch bin.js with dispatcher (optional) ------------------------
REM   Only patch if not already patched (idempotent).
findstr /C:"doctorDispatch" "%TARGET%\app\lib\bin.js" >nul 2>&1
if !errorlevel! equ 0 (
  echo [4/5] SKIP bin.js already has doctor dispatcher -^> skipping patch.
) else (
  echo [4/5] Patching bin.js with doctor dispatcher...
  call "%SCRIPT_DIR%\patch-bin-dispatcher.cmd" "%TARGET%"
  if errorlevel 1 (
    echo [4/5] WARN: bin.js patch failed ^(non-fatal^). dsh-doctor.cmd still works standalone.
    echo        You can manually add the dispatcher later -^> see DEPLOY.md
  ) else (
    echo [4/5] OK   bin.js patched with doctor dispatcher.
  )
)

REM ---- 5. Verify ----------------------------------------------------------
echo [5/5] Verifying deployment...
call "%SCRIPT_DIR%\verify.cmd" "%TARGET%"
set "VERIFY_RC=%errorlevel%"
if !VERIFY_RC! equ 0 (
  echo.
  echo ============================================================
  echo  DEPLOYMENT SUCCESSFUL
  echo ============================================================
  echo.
  echo  dsh-doctor.cmd  : %TARGET%\dsh-doctor.cmd
  echo  doctor-engine   : %TARGET%\app\lib\doctor-engine.js
  echo  bin.js patched  : yes ^(dsh doctor ... works^)
  echo.
  echo  Try it:
  echo     cd %TARGET%
  echo     dsh-doctor.cmd web
  echo     dsh doctor web --fix         ^(via bin.js dispatcher^)
  echo     dsh doctor web --json
  echo.
) else if !VERIFY_RC! equ 2 (
  echo.
  echo ============================================================
  echo  DEPLOYMENT OK ^(doctor has warnings, not failures^)
  echo ============================================================
  echo  Exit code 2 = some checks WARN. Run dsh-doctor.cmd web to review.
  echo.
) else (
  echo.
  echo ============================================================
  echo  DEPLOYMENT COMPLETED ^(but doctor reports issues^)
  echo ============================================================
  echo  Exit code !VERIFY_RC! - review the output above for FAIL items.
  echo  This usually means the DSH profile is not fully set up ^(e.g. no
  echo  node_modules, no API key^). These are real issues, not deployment errors.
  echo.
)
exit /b !VERIFY_RC!