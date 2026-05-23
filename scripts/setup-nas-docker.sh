#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

ask() {
  label="$1"
  default_value="$2"
  printf "%s [%s]: " "$label" "$default_value"
  read -r value || value=""
  if [ -z "$value" ]; then
    printf "%s" "$default_value"
  else
    printf "%s" "$value"
  fi
}

make_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  else
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令：$1"
    echo "请先安装或启用 $1 后再运行。"
    exit 1
  fi
}

require_command docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose 不可用，请先在 NAS 上启用 docker compose。"
  exit 1
fi

DEFAULT_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "${DEFAULT_IP:-}" ]; then
  DEFAULT_IP="openclaw-nas"
fi

PANEL_PORT="${OPENCLAW_PANEL_PORT:-$(ask "面板端口，推荐 1314" "1314")}"
PUBLIC_BASE_URL="${OPENCLAW_PUBLIC_BASE_URL:-$(ask "手机访问地址" "http://${DEFAULT_IP}:${PANEL_PORT}")}"
WINDOWS_PROJECT_ROOT="${OPENCLAW_WINDOWS_PROJECT_ROOT:-$(ask "Win11 项目根目录" "D:/aixm")}"
DISPATCHER_TOKEN="${OPENCLAW_DISPATCHER_TOKEN:-$(make_token)}"
AGENT_TOKEN="${OPENCLAW_AGENT_TOKEN:-$(make_token)}"

mkdir -p config

cat > config/dispatcher.config.json <<EOF_CONFIG
{
  "server": {
    "host": "0.0.0.0",
    "port": 4318,
    "publicBaseUrl": "${PUBLIC_BASE_URL}"
  },
  "auth": {
    "dispatcherToken": "${DISPATCHER_TOKEN}",
    "agentToken": "${AGENT_TOKEN}"
  },
  "projects": [],
  "projectDiscovery": {
    "enabled": true,
    "roots": ["${WINDOWS_PROJECT_ROOT}"],
    "exclude": ["beifen"],
    "defaultMode": "codex",
    "allowedModes": ["codex", "dry-run"],
    "notify": true
  },
  "codex": {
    "command": "node",
    "args": [
      "${WINDOWS_PROJECT_ROOT}/openclaw/node_modules/@openai/codex/bin/codex.js",
      "exec",
      "--skip-git-repo-check",
      "--cd",
      "{{projectPath}}",
      "{{prompt}}"
    ],
    "promptStdin": false
  }
}
EOF_CONFIG

cat > .env <<EOF_ENV
OPENCLAW_PANEL_PORT=${PANEL_PORT}
OPENCLAW_LEGACY_PORT=4318
EOF_ENV

if [ ! -f docker-compose.yml ]; then
  cp docker-compose.example.yml docker-compose.yml
fi

docker compose up -d

cat > setup-output.txt <<EOF_OUTPUT
OpenClaw Codex NAS 配置完成

手机访问地址：
${PUBLIC_BASE_URL}

网页访问密码 dispatcherToken：
${DISPATCHER_TOKEN}

Win11 执行端 agentToken：
${AGENT_TOKEN}

Win11 一键配置命令：
powershell -ExecutionPolicy Bypass -File scripts/setup-windows-agent.ps1 -DispatcherUrl "${PUBLIC_BASE_URL}" -AgentToken "${AGENT_TOKEN}" -ProjectRoot "${WINDOWS_PROJECT_ROOT}"
EOF_OUTPUT

echo
cat setup-output.txt
