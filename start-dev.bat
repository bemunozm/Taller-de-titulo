@echo off
REM start-dev.bat - descarga MediaMTX (si falta) y arranca Backend, Frontend y MediaMTX en ventanas separadas

REM Ubicación del script (raíz del repo)
set ROOT=%~dp0

echo Working directory: %ROOT%

REM Asegurarse de que la carpeta mediamtx existe
if not exist "%ROOT%mediamtx" (
  mkdir "%ROOT%mediamtx"
)
REM IMPORTANT: place mediamtx.exe inside the mediamtx folder manually before running this script.
if not exist "%ROOT%mediamtx\mediamtx.exe" (
  echo WARNING: mediamtx.exe not found in %ROOT%mediamtx
  echo Please download the Windows binary and place it in the mediamtx folder before running MediaMTX.
)

REM Fase 4 - P6.M: MediaMTX corre con authMethod http y le pregunta al backend
REM (POST /api/v1/internal/mediamtx/auth) por cada lectura y por cada llamada a
REM su Control API. El backend se autentica ante MediaMTX con MEDIAMTX_AUTH_SECRET,
REM que vive SOLO en backend\.env (nunca en mediamtx.yml). Sin ese secreto el
REM backend no arranca (si MEDIAMTX_URL o CAMERAS_REGISTER_IN_MEDIAMTX=true) y
REM ninguna camara se puede ver. Genera uno con: openssl rand -base64 32
REM Las camaras se registran solas en MediaMTX al arrancar el backend y cuando
REM MediaMTX se reinicia (no hace falta POST /cameras/:id/register a mano).
if exist "%ROOT%backend\.env" (
  findstr /R /C:"^MEDIAMTX_AUTH_SECRET=..*" "%ROOT%backend\.env" >nul 2>&1
  if errorlevel 1 (
    echo WARNING: MEDIAMTX_AUTH_SECRET no esta definido en backend\.env. El backend no arrancara y MediaMTX negara los streams.
    echo          Genera uno con: openssl rand -base64 32  ^(ver backend\.env.example^)
  )
) else (
  echo WARNING: no existe backend\.env ^(copia backend\.env.example y completa los secretos^).
)

REM Iniciar backend (en una ventana separada)
echo Starting backend (npm run start:dev)...
start "backend" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%ROOT%backend'; if (-not (Test-Path 'node_modules')) { npm install }; npm run start:dev"

REM Iniciar frontend (en una ventana separada)
echo Starting frontend (npm run dev)...
start "frontend" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%ROOT%frontend'; if (-not (Test-Path 'node_modules')) { npm install }; npm run dev"

REM Iniciar MediaMTX (en una ventana separada)
echo Starting MediaMTX (mediamtx.exe with mediamtx.yml)...
set MTX_EXE=%ROOT%mediamtx\mediamtx.exe
set MTX_CFG=%ROOT%mediamtx\mediamtx.yml
if exist "%MTX_EXE%" (
  if exist "%MTX_CFG%" (
    echo Launching MediaMTX using config: %MTX_CFG%
    start "mediamtx" powershell -NoExit -ExecutionPolicy Bypass -Command "& '%MTX_EXE%' '%MTX_CFG%'"
  ) else (
    echo WARNING: mediamtx.yml not found at %MTX_CFG%. Opening mediamtx folder for manual action
    start "mediamtx-folder" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%ROOT%mediamtx'; ls"
  )
) else (
  echo mediamtx.exe not found — opening mediamtx folder for manual action
  start "mediamtx-folder" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%ROOT%mediamtx'; ls"
)

echo La orden para iniciar los servicios se ha enviado. Revisa las ventanas separadas para ver salidas.
pause
