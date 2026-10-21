# LEGACY / SOLO DESARROLLO (ver README.md). Publica un stream de prueba en el
# servidor local con ffmpeg. La URL lleva el usuario "devlocal" y la contraseña
# que imprime start-server.ps1 (cambia en cada ejecución).
param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

if ($Url -notmatch '^rtsp://[^@/]+@127\.0\.0\.1:8556/') {
  Write-Warning "La URL esperada es rtsp://devlocal:<clave>@127.0.0.1:8556/<path> (el servidor solo escucha en loopback y exige usuario)."
}

Write-Host "Publicando con ffmpeg (Ctrl+C para detener)"
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i anullsrc -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -f rtsp $Url
