# LEGACY / SOLO DESARROLLO (ver README.md). Arranca el servidor de medios de
# prueba (MediaMTX con rtsp-simple.yml), solo en loopback, con una contraseña
# aleatoria por ejecución para el usuario "devlocal" (nunca queda en el repo).
$ErrorActionPreference = 'Stop'

Write-Warning "rtsp-simple-server es LEGACY y solo para desarrollo local: no usar en el piloto."

$root = $PSScriptRoot
$binDir = Join-Path -Path $root -ChildPath 'bin'

Write-Host "Buscando ejecutables en raíz y en 'bin/' (si existe)..."

# Colección de lugares a buscar (root primero, luego bin si existe)
$searchPaths = @($root)
if (Test-Path $binDir) { $searchPaths += $binDir }

$exe = $null
foreach ($p in $searchPaths) {
    $c = Get-ChildItem -Path $p -Include '*rtsp*','*mediamtx*','*rtsp-simple-server*' -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '.exe' } | Select-Object -First 1
    if ($c) { $exe = $c; break }
}

if (-Not $exe) {
    Write-Error "No se encontró un ejecutable (rtsp-simple-server.exe o mediamtx.exe) en la raíz ni en 'bin/'."
    exit 1
}

$configCandidate = Join-Path -Path $root -ChildPath 'rtsp-simple.yml'
if (-Not (Test-Path $configCandidate)) {
    # Sin el yml endurecido NO se arranca: los defaults de MediaMTX dan permisos
    # al usuario anónimo "any" desde cualquier IP.
    Write-Error "No se encontró rtsp-simple.yml junto al script; no se arranca con la configuración por defecto."
    exit 1
}

# Contraseña aleatoria para "devlocal" (solo vive en el entorno de este proceso).
$bytes = New-Object byte[] 18
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$devPassword = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').Replace('=', '')
# MediaMTX reemplaza el elemento 0 de la lista COMPLETO con las variables de
# entorno (verificado en v1.15.2): hay que dar usuario, clave, IPs y permisos.
$env:MTX_AUTHINTERNALUSERS_0_USER = 'devlocal'
$env:MTX_AUTHINTERNALUSERS_0_PASS = $devPassword
$env:MTX_AUTHINTERNALUSERS_0_IPS = '127.0.0.1,::1'
$env:MTX_AUTHINTERNALUSERS_0_PERMISSIONS_0_ACTION = 'publish'
$env:MTX_AUTHINTERNALUSERS_0_PERMISSIONS_1_ACTION = 'read'

Write-Host "Ejecutable: $($exe.FullName)"
Write-Host "Configuración: $configCandidate"
Write-Host ""
Write-Host "Usuario de prueba (solo loopback): devlocal / $devPassword"
Write-Host "Publicar:  .\publish-test.ps1 -Url 'rtsp://devlocal:$devPassword@127.0.0.1:8556/mystream'"
Write-Host ""

& $exe.FullName $configCandidate
