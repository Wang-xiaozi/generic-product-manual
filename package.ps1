param([string]$OutputZip)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'package.py'
if ([string]::IsNullOrWhiteSpace($OutputZip)) {
    python $scriptPath
} else {
    python $scriptPath $OutputZip
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
