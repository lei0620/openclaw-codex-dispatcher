# OpenClaw Codex Dispatcher

NAS-hosted web panel + Win11 agent for controlling Codex CLI from a phone.

中文用户请先看：[README.zh-CN.md](README.zh-CN.md)

## What It Does

- Runs a dispatcher web panel on a NAS.
- Runs a lightweight agent on Win11.
- Lets a phone send Codex tasks through the NAS panel.
- Keeps Win11 behind an outbound WebSocket connection.
- Restricts Codex work to configured project roots.

## Quick Links

- [Beginner quickstart](docs/QUICKSTART.zh-CN.md)
- [Required information checklist](docs/REQUIRED_INFO.zh-CN.md)
- [Security notes](docs/SECURITY.zh-CN.md)
- [Git sharing guide](docs/GIT_SHARE.zh-CN.md)

## Development

```powershell
npm install
npm test
npm run build
```

## Create A Safe Source Zip

```powershell
npm run package:share
```

The zip is written to `release/openclaw-codex-dispatcher-source.zip` and excludes local secrets, logs, runtime data, build output, and dependencies.
