@echo off
REM ============================================================================
REM  verify.cmd  ?  Verify the Path A deployment by running the doctor once
REM
REM  Usage:
REM     verify.cmd  D:\path\to\DeepSeekHarness
REM
REM  Exits with the doctor's own exit code:
REM     0 = all pass
REM     1 = at least one FAIL
REM     2 = warnings only
REM     97/98/99 = runner error
REM ============================================================================

setlocal
set "TARGET=%~1"
if "%TARGET%"=="" (
  echo USAGE: verify.cmd ^<path-to-DeepSeekHarness^>
  exit /b 2
)
for %%D in ("%TARGET%") do set "TARGET=%%~fD"

set "NODE_EXE=%TARGET%\node\node.exe"
set "ENGINE_JS=%TARGET%\app\lib\doctor-engine.js"

if not exist "%NODE_EXE%" (
  echo [verify] ERROR: %NODE_EXE% not found
  exit /b 98
)
if not exist "%ENGINE_JS%" (
  echo [verify] ERROR: %ENGINE_JS% not found
  exit /b 97
)

echo [verify] Running doctor with profile=web ...
echo.

REM Detect DSH_HOME if it sits beside the installer
set "DSH_HOME_OUT="
if exist "%TARGET%\..\dsh-home" (
  for %%D in ("%TARGET%\..\dsh-home") do set "DSH_HOME_OUT=%%~fD"
)

set "DSH_INSTALLER_ROOT=%TARGET%"
if defined DSH_HOME_OUT set "DSH_HOME=%DSH_HOME_OUT%"

"%NODE_EXE%" "%ENGINE_JS%" --profile web
exit /b %errorlevel%