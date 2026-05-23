param(
  [string]$Config = "config/dispatcher.config.example.json"
)

$ErrorActionPreference = "Stop"
$env:OPENCLAW_CONFIG = $Config
npm run dev:server
