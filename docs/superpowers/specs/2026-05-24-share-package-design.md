# Share Package Design

## Goal

Make this project safe and easy to share through Git or a zip source package. A beginner should know what information to prepare, how to start the NAS dispatcher, how to start the Win11 agent, and how to avoid publishing secrets.

## Scope

Add public-safe templates, Chinese beginner documentation, NAS and Win11 setup scripts, and a packaging script that excludes runtime folders and local secret files.

## Decisions

- Keep `config/dispatcher.config.json` local-only.
- Add `config/dispatcher.config.template.json` for public examples.
- Use `setup-nas-docker.sh` to generate tokens and start Docker Compose.
- Use `setup-windows-agent.ps1` to generate a local Win11 agent config and start the agent.
- Use `package-share.ps1` to create a clean source zip under `release/`.

## Verification

Tests check that the docs, templates, setup scripts, and packaging exclusions exist. Full verification is `npm test`, `npm run build`, and running the packaging script.
