# Auto-sync de todos los sub-indices de CodeGraph del workspace (version PowerShell).
# Uso:  ./codegraph-sync-all.ps1        (silencioso)
#       ./codegraph-sync-all.ps1 -Verbose

param([switch]$Verbose)

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manifest = Join-Path $Root 'codegraph.workspace.json'

if (-not (Get-Command codegraph -ErrorAction SilentlyContinue)) {
    if ($Verbose) { Write-Host '[codegraph] CLI no encontrado en PATH, se omite sync' }
    exit 0
}

$projects = @('backend', 'frontend', 'lpr', 'vigilia-hub')
if (Test-Path $Manifest) {
    try {
        $json = Get-Content $Manifest -Raw | ConvertFrom-Json
        if ($json.projects) { $projects = $json.projects.path }
    } catch { }
}

# Sync del indice raiz unificado primero (si existe)
if (Test-Path (Join-Path $Root '.codegraph')) {
    if ($Verbose) {
        Write-Host '[codegraph] sync . (indice raiz)'
        codegraph sync $Root
    } else {
        codegraph sync -q $Root *> $null
    }
}

foreach ($p in $projects) {
    $proj = Join-Path $Root $p
    if (Test-Path (Join-Path $proj '.codegraph')) {
        if ($Verbose) {
            Write-Host "[codegraph] sync $p"
            codegraph sync $proj
        } else {
            codegraph sync -q $proj *> $null
        }
    }
}

if ($Verbose) { Write-Host '[codegraph] sync-all completo' }
