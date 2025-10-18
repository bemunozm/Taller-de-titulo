$ErrorActionPreference = 'Stop'

Write-Host "Iniciando script de arranque del servidor de medios de prueba..."

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
    Write-Error "No se encontró un ejecutable (rtsp-simple-server.exe o mediamtx.exe) en la raíz ni en 'bin/'. Puedes colocar el binario en la carpeta del proyecto."
    exit 1
}

Write-Host "Ejecutable detectado: $($exe.Name) at $($exe.FullName)"

# Seleccionar archivo de config preferido en la raíz o en bin
$configCandidate = Join-Path -Path $root -ChildPath 'rtsp-simple.yml'
if (-Not (Test-Path $configCandidate)) { $configCandidate = Join-Path -Path $root -ChildPath 'mediamtx.yml' }
if (-Not (Test-Path $configCandidate) -and (Test-Path $binDir)) {
    $candidateBin = Join-Path -Path $binDir -ChildPath 'rtsp-simple.yml'
    if (Test-Path $candidateBin) { $configCandidate = $candidateBin }
    else {
        $candidateBin2 = Join-Path -Path $binDir -ChildPath 'mediamtx.yml'
        if (Test-Path $candidateBin2) { $configCandidate = $candidateBin2 }
    }
}

if (-Not (Test-Path $configCandidate)) {
    Write-Warning "No se encontró un archivo de configuración esperado; arrancaré el ejecutable sin argumentos." 
    Write-Host "Comando: & '$($exe.FullName)'"
    & $exe.FullName
} else {
    Write-Host "Usando archivo de configuración: $configCandidate"
    # mediamtx/rtsp-simple-server aceptan la ruta del config como argumento posicional
    & $exe.FullName $configCandidate
}
