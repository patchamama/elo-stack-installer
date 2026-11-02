#!/usr/bin/env bash
# elo-stack-installer - web wizard on http://localhost:3200 (Linux: Ubuntu/Debian, needs root for Docker).
# Installs the dependencies on first run and starts installer/server.js (see installer/start-installer.sh).
exec bash "$(dirname "$0")/installer/start-installer.sh" "$@"
