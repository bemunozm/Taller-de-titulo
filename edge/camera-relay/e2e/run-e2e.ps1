<#
.SYNOPSIS
    E2E del relay de cámaras en Windows (edge/camera-relay).

.DESCRIPTION
    Levanta dos NVR falsos con MediaMTX v1.15.2, cada uno con el path
    Streaming/Channels/102 publicado por ffmpeg testsrc:
      - Digest (fake-nvr.yml), como el Hikvision. Clave con @#$ y "$G1":
        MediaMTX no admite ':', '/' ni '%' en sus claves internas.
      - Basic + auth HTTP (fake-nvr-basic.yml + fake_nvr_auth.py), con una
        clave con @/#%$. ':' no se puede probar con un NVR hecho con MediaMTX
        (su parser Basic lo descarta): lo cubren los tests unitarios.
    El relay corre con la config que genera vigilia_relay.py: `porton` en modo
    nvr: (NVR Basic) y `digest` en modo url: (NVR Digest).
    Casos:
      1. probe real: OK con Digest y con Basic (@/#%$); con una clave mala,
         CLAVE (exit 3) y corta en el primer 401;
      2. ffprobe al relay con credenciales: OK (h264) por nvr: y por url:;
      3. sin credenciales: 401;
      4. desde la IP LAN del PC, fuera de `ips` (solo loopback): 401;
      5. on-demand: sin lectores el relay no tira de los NVR (API del NVR);
         con un lector, sí; al irse, los suelta tras sourceOnDemandCloseAfter;
      6. apply real: cameras.conf nuevo -> recarga en caliente verificada;
      7. ninguna clave aparece en el log del relay ni en la salida del CLI,
         tampoco con una clave de NVR mala y un lector pidiendo video (8).
    Todas las claves son FALSAS. Al terminar no deja procesos vivos.

.PARAMETER MediamtxBin
    mediamtx.exe v1.15.2 (default: mediamtx\mediamtx.exe del repo).
.PARAMETER FfmpegDir
    Carpeta con ffmpeg.exe y ffprobe.exe (default: los del PATH).
.PARAMETER Python
    Intérprete de Python >= 3.11 (default: python del PATH).
.PARAMETER KeepWorkDir
    No borra la carpeta temporal (logs y config generada) al terminar.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File edge\camera-relay\e2e\run-e2e.ps1 -Python C:\Python314\python.exe
#>
[CmdletBinding()]
param(
    [string]$MediamtxBin = '',
    [string]$FfmpegDir = '',
    [string]$Python = 'python',
    [switch]$KeepWorkDir
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$KitDir = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $KitDir)
if (-not $MediamtxBin) { $MediamtxBin = Join-Path $RepoRoot 'mediamtx\mediamtx.exe' }
$RelayCli = Join-Path $KitDir 'vigilia_relay.py'

# Puertos fijos (los de fake-nvr.yml, fake-nvr-basic.yml y fake_nvr_auth.py).
$DigestRtspPort = 18554
$DigestApiPort = 19997
$BasicRtspPort = 18555
$BasicApiPort = 19998
$AuthPort = 19999
$RelayRtspPort = 28554
$RelayApiPort = 29997

# Claves FALSAS. Siempre entre comillas simples: en PowerShell "$G1" se expandiría.
$NvrUser = 'nvr-viewer'
$DigestPass = 'E2e@#$G1-fake'
$FullPass = 'E2e@/#%$G1-fake'
$WrongPass = 'Wrong@:/#%$-fake'
$NvrAdminUser = 'nvr-admin'
$NvrAdminPass = 'fake-nvr-admin-e2e'
$NvrPath = 'Streaming/Channels/102'

$Work = Join-Path ([IO.Path]::GetTempPath()) ('vigilia-relay-e2e-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$Etc = Join-Path $Work 'etc'
$EtcBad = Join-Path $Work 'etc-bad'
$EtcDigest = Join-Path $Work 'etc-digest'
$Processes = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$Results = New-Object System.Collections.Generic.List[object]
$CliOutput = New-Object System.Text.StringBuilder
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# --- utilidades -----------------------------------------------------------------
function Add-Result([string]$Case, [string]$Result, [string]$Detail = '') {
    $Results.Add([pscustomobject]@{ Caso = $Case; Resultado = $Result; Detalle = $Detail })
    $color = 'Green'
    if ($Result -eq 'FAIL') { $color = 'Red' } elseif ($Result -eq 'SKIP') { $color = 'Yellow' }
    Write-Host ('  [{0}] {1} ({2})' -f $Result, $Case, $Detail) -ForegroundColor $color
}

function Assert-Case([string]$Case, [bool]$Ok, [string]$Detail = '') {
    if ($Ok) { Add-Result $Case 'OK' $Detail } else { Add-Result $Case 'FAIL' $Detail }
}

function Resolve-Tool([string]$Name) {
    if ($FfmpegDir) {
        $candidate = Join-Path $FfmpegDir "$Name.exe"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
        throw "no existe $candidate"
    }
    $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "no se encontró $Name.exe: instala ffmpeg o usa -FfmpegDir"
}

# Línea de comandos según las reglas de CommandLineToArgvW (sin cmd.exe: los
# caracteres %, &, $ y @ no tienen significado especial).
function ConvertTo-ArgumentString([string[]]$Arguments) {
    $parts = foreach ($argument in $Arguments) {
        if ($argument.Length -gt 0 -and $argument -notmatch '[\s"]') { $argument; continue }
        $escaped = [regex]::Replace($argument, '(\\*)"', '$1$1\"')
        $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
        '"' + $escaped + '"'
    }
    return ($parts -join ' ')
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments, [int]$TimeoutSec = 60) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $FilePath
    $info.Arguments = ConvertTo-ArgumentString $Arguments
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    $info.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::Start($info)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutSec * 1000)
    if ($timedOut) {
        try { $process.Kill() } catch { }
    }
    $process.WaitForExit()
    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        StdOut   = $stdout.Result
        StdErr   = $stderr.Result
        TimedOut = $timedOut
    }
}

function Start-Background([string]$FilePath, [string[]]$Arguments, [string]$LogName) {
    $log = Join-Path $Work "$LogName.log"
    $process = Start-Process -FilePath $FilePath -ArgumentList (ConvertTo-ArgumentString $Arguments) `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
    $Processes.Add($process)
    return $process
}

function Stop-Background([System.Diagnostics.Process]$Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        $Process.WaitForExit(5000) | Out-Null
    }
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSec) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try { if (& $Condition) { return $true } } catch { }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

function Invoke-MtxApi([int]$Port, [string]$Path, [string]$User, [string]$Pass) {
    $token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($User + ':' + $Pass))
    return Invoke-RestMethod -Uri ('http://127.0.0.1:{0}{1}' -f $Port, $Path) -Headers @{ Authorization = "Basic $token" } -TimeoutSec 3
}

function Get-NvrReaderCount([int]$ApiPort) {
    $item = Invoke-MtxApi $ApiPort "/v3/paths/get/$NvrPath" $NvrAdminUser $NvrAdminPass
    if ($null -eq $item.readers) { return 0 }
    return @($item.readers).Count
}

function Get-TotalNvrReaders {
    return (Get-NvrReaderCount $DigestApiPort) + (Get-NvrReaderCount $BasicApiPort)
}

function Invoke-Relay([string]$EtcDir, [string[]]$CliArgs, [int]$TimeoutSec = 180) {
    $result = Invoke-Native $Python (@('-I', '-X', 'utf8', $RelayCli, '--etc-dir', $EtcDir) + $CliArgs) $TimeoutSec
    [void]$CliOutput.Append($result.StdOut).Append($result.StdErr)
    return $result
}

function Invoke-ReaderProbe([string]$Url) {
    return Invoke-Native $Ffprobe @('-hide_banner', '-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '8000000',
        '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', $Url) 40
}

# $NvrKey es una clave FALSA de prueba (por eso un string y no SecureString).
function Write-RelayEnv([string]$Dir, [int]$NvrPort, [string]$NvrKey) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    $lines = @(
        "NVR_HOST='127.0.0.1'",
        "NVR_PORT='$NvrPort'",
        "NVR_USER='$NvrUser'",
        ("NVR_PASS='" + $NvrKey + "'"),
        "READER_ALLOWED_IPS='127.0.0.1'",
        "RTSP_PORT='$RelayRtspPort'",
        "API_PORT='$RelayApiPort'"
    )
    [IO.File]::WriteAllText((Join-Path $Dir 'relay.env'), ($lines -join "`n") + "`n", $Utf8NoBom)
}

function Write-CamerasConf([string]$Dir, [string[]]$Lines) {
    [IO.File]::WriteAllText((Join-Path $Dir 'cameras.conf'), ($Lines -join "`n") + "`n", $Utf8NoBom)
}

function Get-LanIPv4 {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
    if (-not $route) { return $null }
    $address = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '127.*' } | Select-Object -First 1
    if ($address) { return $address.IPAddress }
    return $null
}

function Test-PortFree([int]$Port) {
    $listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    return -not $listening
}

function Start-FakeNvr([string]$ConfigName, [int]$RtspPort, [int]$ApiPort) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $ConfigName) -Destination (Join-Path $Work $ConfigName)
    Start-Background $MediamtxBin @((Join-Path $Work $ConfigName)) $ConfigName | Out-Null
    if (-not (Wait-Until { Invoke-MtxApi $ApiPort '/v3/config/global/get' $NvrAdminUser $NvrAdminPass | Out-Null; $true } 15)) {
        throw "el NVR falso $ConfigName no levantó"
    }
    Start-Background $Ffmpeg @('-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi',
        '-i', 'testsrc=size=640x360:rate=15', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-g', '15', '-pix_fmt', 'yuv420p', '-f', 'rtsp', '-rtsp_transport', 'tcp',
        "rtsp://127.0.0.1:$RtspPort/$NvrPath") "publisher-$RtspPort" | Out-Null
    if (-not (Wait-Until { (Invoke-MtxApi $ApiPort "/v3/paths/get/$NvrPath" $NvrAdminUser $NvrAdminPass).ready } 20)) {
        throw "el testsrc no quedó publicado en $ConfigName"
    }
}

# --- ejecución ------------------------------------------------------------------
$exitCode = 1
try {
    Write-Host 'E2E del relay de cámaras (NVR falsos -> relay)' -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $MediamtxBin)) { throw "no existe $MediamtxBin" }
    $Ffmpeg = Resolve-Tool 'ffmpeg'
    $Ffprobe = Resolve-Tool 'ffprobe'
    $pythonCommand = Get-Command $Python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { throw "no se encontró Python: $Python" }
    $Python = $pythonCommand.Source
    $env:VIGILIA_RELAY_FFPROBE = $Ffprobe
    $version = (Invoke-Native $MediamtxBin @('--version') 10).StdOut.Trim()
    if ($version -ne 'v1.15.2') { throw "se esperaba MediaMTX v1.15.2 y hay $version" }
    foreach ($port in @($DigestRtspPort, $DigestApiPort, $BasicRtspPort, $BasicApiPort, $AuthPort, $RelayRtspPort, $RelayApiPort)) {
        if (-not (Test-PortFree $port)) { throw "el puerto $port está ocupado" }
    }
    New-Item -ItemType Directory -Force -Path $Work | Out-Null
    Write-Host "Carpeta temporal: $Work"

    # NVR falsos + publicadores testsrc
    Start-Background $Python @('-I', (Join-Path $PSScriptRoot 'fake_nvr_auth.py'), "$AuthPort") 'fake-nvr-auth' | Out-Null
    Start-FakeNvr 'fake-nvr.yml' $DigestRtspPort $DigestApiPort
    Start-FakeNvr 'fake-nvr-basic.yml' $BasicRtspPort $BasicApiPort
    Write-Host 'NVR falsos listos (Digest :18554 y Basic :18555, Streaming/Channels/102)'

    # 1. CLI: init, clave del lector y probe real
    Write-RelayEnv $Etc $BasicRtspPort $FullPass
    $digestUrl = 'rtsp://' + $NvrUser + ':' + [Uri]::EscapeDataString($DigestPass) + "@127.0.0.1:$DigestRtspPort/$NvrPath"
    Write-CamerasConf $Etc @('porton nvr:1', "digest url:$digestUrl")
    $init = Invoke-Relay $Etc @('init')
    if ($init.ExitCode -ne 0) { throw "init falló: $($init.StdErr)" }
    $readerFile = Join-Path $Work 'reader.txt'
    $rotate = Invoke-Relay $Etc @('rotate-password', '--no-apply', '--out', $readerFile)
    if ($rotate.ExitCode -ne 0) { throw "rotate-password falló: $($rotate.StdErr)" }
    $ReaderPass = (Get-Content -LiteralPath $readerFile -Raw).Trim()
    $ApiSecret = (Get-Content -LiteralPath (Join-Path $Etc 'api.secret') -Raw).Trim()

    $probe = Invoke-Relay $Etc @('probe', '--channels', '1')
    Assert-Case 'probe real con Basic, clave con @/#%$G1 (modo nvr:)'($probe.ExitCode -eq 0 -and $probe.StdOut -match 'OK\s+h264') "exit $($probe.ExitCode)"

    Write-RelayEnv $EtcDigest $DigestRtspPort $DigestPass
    $digestProbe = Invoke-Relay $EtcDigest @('probe', '--channels', '1')
    Assert-Case 'probe real con Digest, clave con @#$G1' ($digestProbe.ExitCode -eq 0 -and $digestProbe.StdOut -match 'OK\s+h264') "exit $($digestProbe.ExitCode)"

    Write-RelayEnv $EtcBad $BasicRtspPort $WrongPass
    $badProbe = Invoke-Relay $EtcBad @('probe', '--channels', '1-3')
    $badText = $badProbe.StdOut + $badProbe.StdErr
    $stoppedAtFirst = ($badText -match 'canal 1 ') -and ($badText -notmatch 'canal 2 ')
    Assert-Case 'probe real con clave mala: CLAVE, exit 3, corta en el primer 401' ($badProbe.ExitCode -eq 3 -and $badText -match 'CLAVE' -and $stoppedAtFirst) "exit $($badProbe.ExitCode)"

    # Relay con la config renderizada
    $render = Invoke-Relay $Etc @('render', '--out', (Join-Path $Etc 'mediamtx.yml'))
    if ($render.ExitCode -ne 0) { throw "render falló: $($render.StdErr)" }
    $relay = Start-Background $MediamtxBin @((Join-Path $Etc 'mediamtx.yml')) 'relay'
    if (-not (Wait-Until { Invoke-MtxApi $RelayApiPort '/v3/config/global/get' 'vigilia-admin' $ApiSecret | Out-Null; $true } 15)) {
        throw 'el relay no levantó'
    }
    Write-Host 'Relay listo (:28554)'

    # 5a. on-demand en reposo
    Start-Sleep -Seconds 3
    $idleReaders = Get-TotalNvrReaders
    Assert-Case 'on-demand: sin lectores el relay no tira de los NVR' ($idleReaders -eq 0) "lectores en los NVR: $idleReaders"

    # 2. OK con credenciales
    $relayBase = "rtsp://relay-reader:$ReaderPass@127.0.0.1:$RelayRtspPort"
    $ok = Invoke-ReaderProbe "$relayBase/porton"
    Assert-Case 'ffprobe al relay con credenciales (porton, nvr: -> Basic @/#%$G1)'($ok.ExitCode -eq 0 -and $ok.StdOut.Trim() -eq 'h264') ("exit {0}, codec '{1}'" -f $ok.ExitCode, $ok.StdOut.Trim())
    $okDigest = Invoke-ReaderProbe "$relayBase/digest"
    Assert-Case 'ffprobe al relay con credenciales (digest, url: -> Digest @#$G1)' ($okDigest.ExitCode -eq 0 -and $okDigest.StdOut.Trim() -eq 'h264') ("exit {0}, codec '{1}'" -f $okDigest.ExitCode, $okDigest.StdOut.Trim())

    # 3. sin credenciales
    $noAuth = Invoke-ReaderProbe "rtsp://127.0.0.1:$RelayRtspPort/porton"
    Assert-Case 'sin credenciales: 401' ($noAuth.ExitCode -ne 0 -and $noAuth.StdErr -match '401') "exit $($noAuth.ExitCode)"

    # 4. desde la IP LAN (fuera de ips)
    $lanIp = Get-LanIPv4
    if ($lanIp) {
        $lan = Invoke-ReaderProbe "rtsp://relay-reader:$ReaderPass@${lanIp}:$RelayRtspPort/porton"
        Assert-Case 'desde la IP LAN del PC (fuera de ips): 401' ($lan.ExitCode -ne 0 -and $lan.StdErr -match '401') "IP $lanIp, exit $($lan.ExitCode)"
    } else {
        Add-Result 'desde la IP LAN del PC (fuera de ips): 401' 'SKIP' 'no hay IPv4 LAN con ruta por defecto'
    }

    # 5b. on-demand con un lector
    $reader = Start-Background $Ffmpeg @('-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', "$relayBase/porton",
        '-t', '8', '-f', 'null', '-') 'reader'
    $activeOk = Wait-Until { (Get-NvrReaderCount $BasicApiPort) -ge 1 } 15
    Assert-Case 'on-demand: con un lector el relay tira del NVR' $activeOk "lectores en el NVR Basic: $(Get-NvrReaderCount $BasicApiPort)"
    $reader.WaitForExit(20000) | Out-Null

    # 6. apply real (recarga en caliente)
    Write-CamerasConf $Etc @('porton nvr:1', "digest url:$digestUrl", 'puerta nvr:1')
    $apply = Invoke-Relay $Etc @('apply')
    $puerta = Invoke-ReaderProbe "$relayBase/puerta"
    Assert-Case 'apply real: recarga en caliente y path nuevo OK' ($apply.ExitCode -eq 0 -and $puerta.ExitCode -eq 0 -and $puerta.StdOut.Trim() -eq 'h264') ("apply exit {0}, puerta exit {1}" -f $apply.ExitCode, $puerta.ExitCode)
    Assert-Case 'apply real: la config anterior quedó en mediamtx.yml.prev' (Test-Path -LiteralPath (Join-Path $Etc 'mediamtx.yml.prev'))
    Assert-Case 'apply real: sin reinicio del relay (recarga en caliente)' (-not $relay.HasExited)

    # 5c. on-demand: suelta los orígenes tras sourceOnDemandCloseAfter (30 s)
    Write-Host 'Esperando que el relay suelte los NVR (sourceOnDemandCloseAfter = 30 s)...'
    $releasedOk = Wait-Until { (Get-TotalNvrReaders) -eq 0 } 60
    Assert-Case 'on-demand: sin lectores, el relay suelta los NVR' $releasedOk "lectores en los NVR: $(Get-TotalNvrReaders)"

    # 8. clave del NVR mala + un lector: MediaMTX reintenta el origen con la
    #    clave mala (401 del NVR) y su log no debe citarla.
    Write-RelayEnv $Etc $BasicRtspPort $WrongPass
    $applyBad = Invoke-Relay $Etc @('apply', '--skip-probe')
    $badRead = Invoke-ReaderProbe "$relayBase/porton"
    Start-Sleep -Seconds 3
    Assert-Case 'clave de NVR mala: apply --skip-probe la aplica y el lector no recibe video' ($applyBad.ExitCode -eq 0 -and $badRead.ExitCode -ne 0) ("apply exit {0}, lector exit {1}" -f $applyBad.ExitCode, $badRead.ExitCode)

    # 7. ninguna clave en el log del relay ni en la salida del CLI
    Stop-Background $relay
    $relayLog = ''
    foreach ($name in @('relay.log', 'relay.log.err')) {
        $path = Join-Path $Work $name
        if (Test-Path -LiteralPath $path) { $relayLog += [IO.File]::ReadAllText($path) }
    }
    $cliText = $CliOutput.ToString()
    $secrets = @($FullPass, [Uri]::EscapeDataString($FullPass), $DigestPass, [Uri]::EscapeDataString($DigestPass),
        $WrongPass, [Uri]::EscapeDataString($WrongPass), $ReaderPass, $ApiSecret)
    $leaksLog = @($secrets | Where-Object { $relayLog.Contains($_) }).Count
    $leaksCli = @($secrets | Where-Object { $cliText.Contains($_) }).Count
    Assert-Case 'ninguna clave en el log del relay' ($leaksLog -eq 0 -and $relayLog.Length -gt 0) "$leaksLog coincidencias en $($relayLog.Length) bytes"
    Assert-Case 'ninguna clave en la salida del CLI' ($leaksCli -eq 0 -and $cliText.Length -gt 0) "$leaksCli coincidencias en $($cliText.Length) bytes"

    $failed = @($Results | Where-Object { $_.Resultado -eq 'FAIL' }).Count
    if ($failed -eq 0) { $exitCode = 0 }
}
catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
}
finally {
    foreach ($process in @($Processes)) { Stop-Background $process }
    $alive = @($Processes | Where-Object { -not $_.HasExited }).Count
    if ($alive -gt 0) { Write-Host "AVISO: quedaron $alive procesos vivos" -ForegroundColor Red; $exitCode = 1 }
    Write-Host ''
    Write-Host '================ Resumen del E2E ================' -ForegroundColor Cyan
    $Results | Format-Table -AutoSize | Out-String -Width 220 | Write-Host
    $okCount = @($Results | Where-Object { $_.Resultado -eq 'OK' }).Count
    $failCount = @($Results | Where-Object { $_.Resultado -eq 'FAIL' }).Count
    $skipCount = @($Results | Where-Object { $_.Resultado -eq 'SKIP' }).Count
    Write-Host ('{0} OK, {1} FAIL, {2} SKIP' -f $okCount, $failCount, $skipCount)
    if ($KeepWorkDir) {
        Write-Host "Logs y config en $Work (claves FALSAS; bórrala al terminar)"
    } elseif (Test-Path -LiteralPath $Work) {
        Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
exit $exitCode
