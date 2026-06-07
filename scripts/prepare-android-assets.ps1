$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidDownloads = Join-Path $projectRoot "android\app\src\main\assets\public\downloads"

if (Test-Path -LiteralPath $androidDownloads) {
  Remove-Item -LiteralPath $androidDownloads -Recurse -Force
  Write-Host "Removed Android bundled downloads: $androidDownloads"
} else {
  Write-Host "No Android bundled downloads found."
}
