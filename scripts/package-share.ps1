param(
  [string]$OutputDir = "release",
  [string]$PackageName = "openclaw-codex-dispatcher-source.zip"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$OutputPath = Join-Path $Root $OutputDir
$StagePath = Join-Path $OutputPath "stage"
$ZipPath = Join-Path $OutputPath $PackageName

$excludedPathParts = @(
  ".git",
  ".gradle",
  ".learnings",
  ".codex-ssh-tmp",
  "node_modules",
  "build",
  "dist",
  "logs",
  "data",
  "release",
  "todo"
)

$excludedFiles = @(
  ".env",
  "docker-compose.yml",
  "config/dispatcher.config.json",
  "config/agent.local.config.json",
  "android/local.properties",
  "android/app/src/main/assets/capacitor.config.json",
  "android/app/src/main/assets/capacitor.plugins.json",
  "scripts/start-agent.local.ps1",
  "setup-output.txt"
)

function Convert-ToUnixPath {
  param([string]$Path)
  return $Path.Replace("\", "/")
}

function Get-LocalRelativePath {
  param(
    [string]$BasePath,
    [string]$FullPath
  )

  $base = [System.IO.Path]::GetFullPath($BasePath).TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
  $full = [System.IO.Path]::GetFullPath($FullPath)
  if (-not $full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside the project: $FullPath"
  }
  return $full.Substring($base.Length)
}

function Should-Exclude {
  param([string]$RelativePath)

  $unixPath = Convert-ToUnixPath $RelativePath
  if ($excludedFiles -contains $unixPath) {
    return $true
  }
  if ($unixPath.StartsWith("public/downloads/")) {
    return $true
  }
  if ($unixPath.StartsWith("android/app/src/main/assets/public/")) {
    return $true
  }
  if ($unixPath.EndsWith(".zip") -or $unixPath.EndsWith(".apk") -or $unixPath.EndsWith(".aab") -or $unixPath.EndsWith(".aar")) {
    return $true
  }

  $parts = $unixPath.Split("/", [System.StringSplitOptions]::RemoveEmptyEntries)
  foreach ($part in $parts) {
    if ($excludedPathParts -contains $part) {
      return $true
    }
  }
  return $false
}

if (Test-Path -LiteralPath $StagePath) {
  Remove-Item -LiteralPath $StagePath -Recurse -Force
}
New-Item -ItemType Directory -Path $StagePath -Force | Out-Null
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

Get-ChildItem -LiteralPath $Root -Recurse -Force -File | ForEach-Object {
  $relative = Get-LocalRelativePath $Root $_.FullName
  if (Should-Exclude $relative) {
    return
  }

  $target = Join-Path $StagePath $relative
  $targetDir = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  }
  Copy-Item -LiteralPath $_.FullName -Destination $target -Force
}

if (Test-Path -LiteralPath $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

Compress-Archive -Path (Join-Path $StagePath "*") -DestinationPath $ZipPath -Force
Remove-Item -LiteralPath $StagePath -Recurse -Force

Write-Host ("Share package created: {0}" -f $ZipPath)
