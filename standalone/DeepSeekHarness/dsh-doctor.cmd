@echo off
setlocal
REM  ======================================================================
REM   dsh-doctor.cmd  ?  lives in DeepSeekHarness/ beside node/, app/, shell/
REM   Because it is placed INSIDE the installer root, no heuristic search
REM   is needed ? %~dp0 IS the installer root.
REM   ======================================================================
set INSTALLER_ROOT=%~dp0
if "%INSTALLER_ROOT:~-1%"=="\" set INSTALLER_ROOT=%INSTALLER_ROOT:~0,-1%
set NODE_EXE=%INSTALLER_ROOT%\node\node.exe
set ENGINE_JS=%INSTALLER_ROOT%\app\lib\doctor-engine.js

if not exist "%NODE_EXE%" (
  echo [dsh-doctor] ERROR: missing bundled node at %NODE_EXE%
  echo   Expected layout:  DeepSeekHarness\node\node.exe
  echo                      DeepSeekHarness\app\lib\doctor-engine.js
  exit /b 98
)
if not exist "%ENGINE_JS%" (
  echo [dsh-doctor] ERROR: missing engine at %ENGINE_JS%
  echo   Copy doctor-engine.js into DeepSeekHarness\app\lib\
  exit /b 97
)

REM -------- Resolve DSH_HOME -------------------------------------------------
if defined DSH_HOME (
  set "DSH_HOME_OUT=%DSH_HOME%"
) else if exist "%INSTALLER_ROOT%\..\dsh-home" (
  for %%D in ("%INSTALLER_ROOT%\..\dsh-home") do set DSH_HOME_OUT=%%~fD
) else (
  set "DSH_HOME_OUT="
)

REM -------- Parse profile (1st positional, default web) --------------------
set PROFILE=web
set REST=
set FIRST=%~1
if defined FIRST if not "%FIRST:~0,2%"=="--" (
  set "PROFILE=%FIRST%"
  shift
)
:rest_loop
if "%~1"=="" goto rest_done
if defined REST (set "REST=%REST% %~1") else set "REST=%~1"
shift
goto rest_loop
:rest_done

REM -------- Propagate paths the engine reads --------------------------------
set DSH_INSTALLER_ROOT=%INSTALLER_ROOT%
if defined DSH_HOME_OUT set DSH_HOME=%DSH_HOME_OUT%

REM -------- Echo config ------------------------------------------------------
echo.
echo [dsh-doctor]  Node   = %NODE_EXE%
echo [dsh-doctor]  Engine = %ENGINE_JS%
if defined DSH_HOME_OUT (echo [dsh-doctor]  HOME   = %DSH_HOME_OUT%) else (echo [dsh-doctor]  HOME   = ^(defaults to %USERPROFILE%\.dsh^))
echo [dsh-doctor]  Profile= %PROFILE%   flags =%REST%
echo.

"%NODE_EXE%" "%ENGINE_JS%" --profile "%PROFILE%" %REST%
exit /b %ERRORLEVEL%