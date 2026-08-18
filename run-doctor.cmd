@echo off
setlocal
set SCRIPT_DIR=%~dp0
if "%SCRIPT_DIR:~-1%"=="\" set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%
set DOCTOR_JS=%SCRIPT_DIR%\doctor.js
set INSTALLER_ROOT=
if defined DSH_INSTALLER_ROOT if exist "%DSH_INSTALLER_ROOT%\app\package.json" set INSTALLER_ROOT=%DSH_INSTALLER_ROOT%
if not defined INSTALLER_ROOT if exist "%SCRIPT_DIR%\..\..\app\package.json" for %%D in ("%SCRIPT_DIR%\..\..") do set INSTALLER_ROOT=%%~fD
if not defined INSTALLER_ROOT if exist "%SCRIPT_DIR%\..\DeepSeekHarness\app\package.json" for %%D in ("%SCRIPT_DIR%\..\DeepSeekHarness") do set INSTALLER_ROOT=%%~fD
if not defined INSTALLER_ROOT if exist "%CD%\..\DeepSeekHarness\app\package.json" for %%D in ("%CD%\..\DeepSeekHarness") do set INSTALLER_ROOT=%%~fD
set NODE_EXE=
if defined INSTALLER_ROOT if exist "%INSTALLER_ROOT%\node\node.exe" set NODE_EXE=%INSTALLER_ROOT%\node\node.exe
if not defined NODE_EXE for /f "delims=" %%X in ('where node 2^>nul') do set NODE_EXE=%%X&goto nodeok
:nodeok
if not defined NODE_EXE (
  echo [dsh-doctor] ERROR: no Node found. Options:
  echo   - place wrapper in DeepSeekHarness\app\lib\
  echo   - set DSH_INSTALLER_ROOT to the DeepSeekHarness folder
  echo   - add Node 22.19+ to PATH
  exit /b 98
)
if not exist "%DOCTOR_JS%" (
  echo [dsh-doctor] ERROR: missing doctor.js
  exit /b 97
)
set RESOLVED_HOME=
if defined DSH_HOME set RESOLVED_HOME=%DSH_HOME%
if not defined RESOLVED_HOME if defined INSTALLER_ROOT if exist "%INSTALLER_ROOT%\..\dsh-home" for %%D in ("%INSTALLER_ROOT%\..\dsh-home") do set RESOLVED_HOME=%%~fD
set PROFILE=web
set REST=
set FIRST=%~1
if defined FIRST if not "%FIRST:~0,2%"=="--" (
  set "PROFILE=%FIRST%"
  shift
)
:restloop
if "%~1"=="" goto restdone
if defined REST (set "REST=%REST% %~1") else set "REST=%~1"
shift
goto restloop
:restdone
if defined INSTALLER_ROOT set DSH_INSTALLER_ROOT=%INSTALLER_ROOT%
if defined RESOLVED_HOME set DSH_HOME=%RESOLVED_HOME%
echo.
echo [dsh-doctor] node=%NODE_EXE%
echo [dsh-doctor] doctor=%DOCTOR_JS%
if defined INSTALLER_ROOT echo [dsh-doctor] installer=%INSTALLER_ROOT%
if defined RESOLVED_HOME  echo [dsh-doctor] dsh-home=%RESOLVED_HOME%
echo [dsh-doctor] profile=%PROFILE% rest=%REST%
echo.
"%NODE_EXE%" "%DOCTOR_JS%" --profile "%PROFILE%" %REST%
exit /b %ERRORLEVEL%