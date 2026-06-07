param(
  [string]$ApkPath = ".\release\openclaw-codex-android-debug.apk",
  [long]$VersionCode = 7,
  [string]$VersionName = "1.1.5",
  [string]$Notes = "Use native Android HTTP for NAS API calls and add reset buttons for local settings.",
  [string]$WebDavEndpoint = $env:ANDROID_WEBDAV_UPDATE_ENDPOINT,
  [string]$Username = $env:ANDROID_WEBDAV_UPDATE_USERNAME,
  [string]$RemoteFolder = $env:ANDROID_WEBDAV_UPDATE_REMOTE_FOLDER,
  [string]$Password = "",
  [string]$AppFileName = "",
  [string]$HistoryFolder = "history"
)

$ErrorActionPreference = "Stop"

$Publisher = Join-Path $env:USERPROFILE ".codex\skills\android-webdav-self-update\scripts\publish-android-webdav-update.ps1"
if (!(Test-Path -LiteralPath $Publisher)) {
  throw "publish-android-webdav-update.ps1 not found: $Publisher"
}
if ([string]::IsNullOrWhiteSpace($WebDavEndpoint)) {
  throw "WebDavEndpoint is required. Pass -WebDavEndpoint or set ANDROID_WEBDAV_UPDATE_ENDPOINT."
}
if ([string]::IsNullOrWhiteSpace($Username)) {
  throw "Username is required. Pass -Username or set ANDROID_WEBDAV_UPDATE_USERNAME."
}
if ([string]::IsNullOrWhiteSpace($RemoteFolder)) {
  $RemoteFolder = "codexapp"
}

$sanitizedVersionName = (($VersionName -replace "[^A-Za-z0-9._-]", "-").Trim("-")).Trim()
if ([string]::IsNullOrWhiteSpace($sanitizedVersionName)) {
  $sanitizedVersionName = "release";
}
$releaseTag = Get-Date -Format "yyyyMMdd_HHmm";
if (-not $AppFileName) {
  $AppFileName = "openclaw-codex-v$sanitizedVersionName-$VersionCode-$releaseTag.apk";
}
$localReleasePath = (Resolve-Path $ApkPath).Path
$localHistoryDir = Join-Path (Split-Path -Parent $localReleasePath) "history"
New-Item -ItemType Directory -Path $localHistoryDir -Force | Out-Null
Copy-Item -LiteralPath $localReleasePath -Destination (Join-Path $localHistoryDir $AppFileName) -Force

& $Publisher `
  -ApkPath $ApkPath `
  -VersionCode $VersionCode `
  -VersionName $VersionName `
  -WebDavEndpoint $WebDavEndpoint `
  -Username $Username `
  -Password $Password `
  -RemoteFolder $RemoteFolder `
  -HistoryFolder $HistoryFolder `
  -AppFileName $AppFileName `
  -Notes $Notes
