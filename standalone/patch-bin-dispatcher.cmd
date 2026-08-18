@echo off
REM ============================================================================
REM  patch-bin-dispatcher.cmd  ?  Inserts a 10-line doctor dispatcher at the
REM  TOP of DeepSeekHarness\app\lib\bin.js so that dsh doctor ... works as
REM  a native subcommand WITHOUT recompiling DSH.
REM
REM  Usage:
REM     patch-bin-dispatcher.cmd  D:\path\to\DeepSeekHarness
REM
REM  - Backs up bin.js -> bin.js.bak (only first time, preserves original)
REM  - Idempotent: skips if dispatcher already present
REM  - Leaves all existing DSH code intact below the dispatcher
REM ============================================================================

setlocal
set "TARGET=%~1"
if "%TARGET%"=="" (
  echo USAGE: patch-bin-dispatcher.cmd ^<path-to-DeepSeekHarness^>
  exit /b 2
)
for %%D in ("%TARGET%") do set "TARGET=%%~fD"

set "BIN_JS=%TARGET%\app\lib\bin.js"

if not exist "%BIN_JS%" (
  echo [patch] ERROR: %BIN_JS% not found
  exit /b 3
)

REM Idempotent: check for the dispatcher marker
findstr /C:"doctorDispatch" "%BIN_JS%" >nul 2>&1
if %errorlevel% equ 0 (
  echo [patch] Already patched -^> skipping.
  exit /b 0
)

REM Backup original (only first time)
if not exist "%BIN_JS%.bak" (
  copy /Y "%BIN_JS%" "%BIN_JS%.bak" >nul
  echo [patch] Backup saved: %BIN_JS%.bak
) else (
  echo [patch] Backup already exists: %BIN_JS%.bak ^(preserving original^)
)

REM Build the dispatcher block as a temp file, then prepend to bin.js
set "TMP_BLOCK=%TEMP%\dsh-doctor-dispatcher-%RANDOM%.js"
>""%TMP_BLOCK%"" echo // ============================================================================
>>"%TMP_BLOCK%" echo // doctor dispatcher - runs BEFORE the normal DSH commander parser.
>>"%TMP_BLOCK%" echo // Recognises dsh doctor ... and forwards to app/lib/doctor-engine.js.
>>"%TMP_BLOCK%" echo // Remove this block if you switch to native Path B integration.
>>"%TMP_BLOCK%" echo // ============================================================================
>>"%TMP_BLOCK%" echo ;^(function doctorDispatch ^(^) {
>>"%TMP_BLOCK%" echo   var first = process.argv[2]
>>"%TMP_BLOCK%" echo   if ^(first !== 'doctor'^) return
>>"%TMP_BLOCK%" echo   var childArgv = process.argv.slice^(3^)
>>"%TMP_BLOCK%" echo   var spawnSync = require^('node:child_process'^).spawnSync
>>"%TMP_BLOCK%" echo   var resolve   = require^('node:path'^).resolve
>>"%TMP_BLOCK%" echo   var engine = resolve^(__dirname, 'doctor-engine.js'^)
>>"%TMP_BLOCK%" echo   var fs = require^('node:fs'^)
>>"%TMP_BLOCK%" echo   if ^(!fs.existsSync^(engine^)^) {
>>"%TMP_BLOCK%" echo     process.stderr.write^('[dsh doctor] FATAL: doctor-engine.js not found at ' + engine + '\n'^)
>>"%TMP_BLOCK%" echo     process.exit^(97^)
>>"%TMP_BLOCK%" echo   }
>>"%TMP_BLOCK%" echo   var r = spawnSync^(process.execPath, [engine].concat^(childArgv^), {
>>"%TMP_BLOCK%" echo     stdio: 'inherit', env: process.env,
>>"%TMP_BLOCK%" echo   }^)
>>"%TMP_BLOCK%" echo   process.exit^(r.status === null ? 99 : r.status^)
>>"%TMP_BLOCK%" echo }^)^(^)
>>"%TMP_BLOCK%" echo // -------------------------- end doctor dispatcher --------------------------
>>"%TMP_BLOCK%" echo.

REM Prepend: copy dispatcher + original bin.js -> bin.js.new, then replace
set "NEW_BIN=%BIN_JS%.new"
copy /b "%TMP_BLOCK%"+"%BIN_JS%" "%NEW_BIN%" >nul
if errorlevel 1 (
  echo [patch] ERROR: failed to prepend dispatcher block
  del "%TMP_BLOCK%" 2>nul
  del "%NEW_BIN%"  2>nul
  exit /b 4
)
del "%TMP_BLOCK%" 2>nul
move /Y "%NEW_BIN%" "%BIN_JS%" >nul
if errorlevel 1 (
  echo [patch] ERROR: failed to replace bin.js
  exit /b 4
)

echo [patch] OK   bin.js patched with doctor dispatcher.
exit /b 0