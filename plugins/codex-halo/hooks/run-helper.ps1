$ErrorActionPreference = 'SilentlyContinue'

$codexHome = $env:CODEX_HOME
if ([string]::IsNullOrWhiteSpace($codexHome)) {
    $home = $env:USERPROFILE
    if ([string]::IsNullOrWhiteSpace($home)) {
        $home = "$($env:HOMEDRIVE)$($env:HOMEPATH)"
    }
    if ([string]::IsNullOrWhiteSpace($home)) {
        $home = $HOME
    }
    if (-not [string]::IsNullOrWhiteSpace($home)) {
        $codexHome = Join-Path $home '.codex'
    }
}
if ([string]::IsNullOrWhiteSpace($codexHome)) {
    Write-Output '{}'
    exit 0
}

$helper = Join-Path (Join-Path $codexHome 'codex-halo') 'codex-halo-hook.exe'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
    Write-Output '{}'
    exit 0
}

& $helper --codex-halo
if ($LASTEXITCODE -ne 0) {
    Write-Output '{}'
}
exit 0
