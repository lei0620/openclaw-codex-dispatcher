param(
  [string]$Config = "config/dispatcher.config.example.json",
  [string]$DispatcherUrl = "http://192.168.101.8:1314",
  [string]$AgentId = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"
$env:OPENCLAW_CONFIG = $Config
$env:OPENCLAW_DISPATCHER_URL = $DispatcherUrl
$env:OPENCLAW_AGENT_ID = $AgentId
npm run dev:agent
