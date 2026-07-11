param(
  [string]$Config = "config/dispatcher.config.json",
  [string]$DispatcherUrl = "http://192.168.101.8:1314",
  [string]$AgentId = $env:COMPUTERNAME,
  [int]$IntervalSeconds = 8
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RunAgent = Join-Path $ProjectRoot "scripts\run-agent.ps1"
$LogDir = Join-Path $ProjectRoot "logs"
$ConfigPath = if ([System.IO.Path]::IsPathRooted($Config)) { $Config } else { Join-Path $ProjectRoot $Config }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-CodexRunning {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path -match "\\OpenAI\.Codex_[^\\]+\\app\\(ChatGPT|Codex)\.exe$"
  }).Count -gt 0
}

function Test-AgentRunning {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and
    ($_.CommandLine -match [regex]::Escape($ProjectRoot)) -and
    ($_.CommandLine -match "src[\\/]agent[\\/]index\.ts|run-agent\.ps1|dev:agent")
  }).Count -gt 0
}

function Start-Agent {
  $out = Join-Path $LogDir "agent.out.log"
  $err = Join-Path $LogDir "agent.err.log"
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $RunAgent,
      "-Config",
      $ConfigPath,
      "-DispatcherUrl",
      $DispatcherUrl,
      "-AgentId",
      $AgentId
    ) `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err `
    -WindowStyle Hidden
}

while ($true) {
  try {
    if ((Test-CodexRunning) -and -not (Test-AgentRunning)) {
      Start-Agent
    }
  } catch {
    Add-Content -Path (Join-Path $LogDir "agent-watcher.err.log") -Value "$(Get-Date -Format s) $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $IntervalSeconds
}
