#!/bin/sh
set -eu

cd /home/leinas/openclaw-codex-dispatcher
mkdir -p logs
docker compose up -d >> logs/autostart-dispatcher.log 2>&1
