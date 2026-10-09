param([Parameter(Mandatory=$true)][string]$ExecutablePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$exeItem = Get-Item -LiteralPath $ExecutablePath
if ($exeItem.PSIsContainer -or $exeItem.Name -notmatch '^ledit(32|64)?\.exe$') {
    throw 'Specify an existing L-Edit executable file.'
}
$envPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    Copy-Item -LiteralPath $envPath -Destination (Join-Path $projectRoot '.env.local.bak') -Force
    $content = [IO.File]::ReadAllText($envPath)
} else {
    $content = [IO.File]::ReadAllText((Join-Path $projectRoot '.env.example'))
}
$setting = 'APP_LEDIT_EXE="' + $exeItem.FullName + '"'
if ($content -match '(?m)^APP_LEDIT_EXE=.*$') {
    $content = [regex]::Replace($content, '(?m)^APP_LEDIT_EXE=.*$', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $setting })
} else {
    $content = $content.TrimEnd() + "`n" + $setting + "`n"
}
[IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
Write-Host 'L-Edit configured in local .env. Restart start.bat to apply.'
