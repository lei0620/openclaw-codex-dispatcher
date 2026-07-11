param(
  [string]$DispatcherUrl = "",
  [string]$AgentToken = "",
  [string]$ProjectRoot = "D:\aixm",
  [string]$AgentId = $env:COMPUTERNAME,
  [switch]$StartHidden,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Read-WithDefault {
  param(
    [string]$Prompt,
    [string]$Default
  )
  $value = Read-Host "$Prompt [$Default]"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Default
  }
  return $value.Trim()
}

if ([string]::IsNullOrWhiteSpace($DispatcherUrl)) {
  $DispatcherUrl = Read-WithDefault "NAS dispatcher URL, for example http://openclaw-nas:1314" "http://openclaw-nas:1314"
}
if ([string]::IsNullOrWhiteSpace($AgentToken)) {
  $AgentToken = Read-Host "Paste the agentToken printed by the NAS setup script"
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Read-WithDefault "Win11 project root" "D:\aixm"
}
if ([string]::IsNullOrWhiteSpace($AgentId)) {
  $AgentId = Read-WithDefault "Agent name" $env:COMPUTERNAME
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node was not found. Install Node.js first, then run this script again."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js first, then run this script again."
}

if (-not $SkipInstall -and -not (Test-Path -LiteralPath (Join-Path $Root "node_modules"))) {
  npm install
}

$ProjectRootForJson = $ProjectRoot.Replace("\", "/")
$CodexBin = (Join-Path $Root "node_modules\@openai\codex\bin\codex.js").Replace("\", "/")
$ConfigPath = Join-Path $Root "config\agent.local.config.json"

$config = [ordered]@{
  server = [ordered]@{
    host = "0.0.0.0"
    port = 4318
    publicBaseUrl = $DispatcherUrl.TrimEnd("/")
  }
  auth = [ordered]@{
    dispatcherToken = "not-used-by-agent"
    agentToken = $AgentToken
  }
  projects = @()
  projectDiscovery = [ordered]@{
    enabled = $true
    roots = @($ProjectRootForJson)
    exclude = @("beifen")
    defaultMode = "codex"
    allowedModes = @("codex", "dry-run")
    notify = $true
  }
  codex = [ordered]@{
    command = "node"
    args = @($CodexBin, "exec", "--skip-git-repo-check", "--cd", "{{projectPath}}", "{{prompt}}")
    promptStdin = $false
  }
  codexAppServer = [ordered]@{
    enabled = $true
    url = "ws://127.0.0.1:18765"
    startupTimeoutMs = 60000
    requestTimeoutMs = 30000
    turnTimeoutMs = 120000
    supervisorIntervalMs = 5000
    heartbeatIntervalMs = 10000
    refreshDesktopAfterTurn = $true
    refreshScriptPath = "scripts/refresh-codex-desktop.ps1"
    refreshWindowTitlePattern = "Codex|OpenAI|ChatGPT"
    refreshTimeoutMs = 8000
  }
  desktopInput = [ordered]@{
    enabled = $false
    allowUnsafeForegroundRouting = $false
    scriptPath = "scripts/send-codex-desktop-input.ps1"
    clickYOffset = 92
    windowTitlePattern = "Codex|OpenAI|ChatGPT"
    responseTimeoutMs = 180000
  }
}

$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

$StartScript = Join-Path $Root "scripts\start-agent.local.ps1"
@"
`$ErrorActionPreference = "Stop"
Set-Location "$Root"
`$env:OPENCLAW_CONFIG = "$ConfigPath"
`$env:OPENCLAW_DISPATCHER_URL = "$($DispatcherUrl.TrimEnd("/"))"
`$env:OPENCLAW_AGENT_ID = "$AgentId"
npm run dev:agent
"@ | Set-Content -LiteralPath $StartScript -Encoding UTF8

Write-Host ""
Write-Host "Win11 agent configured."
Write-Host "Config file: $ConfigPath"
Write-Host "Next time run: powershell -ExecutionPolicy Bypass -File scripts\start-agent.local.ps1"
Write-Host ""

if ($StartHidden) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", $StartScript) -WorkingDirectory $Root -WindowStyle Hidden
  Write-Host "Agent started in the background."
} else {
  Write-Host "Starting agent in this window. Closing the window stops the agent."
  & powershell.exe -ExecutionPolicy Bypass -File $StartScript
}
