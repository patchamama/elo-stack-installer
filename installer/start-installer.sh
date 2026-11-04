#!/bin/bash
# ELO Docker installer on Linux (Ubuntu/Debian): needs Node.js 18+ and root (Docker, sysctl).
# Playwright (for the EULA/Web Client tests) is optional: npm i playwright && npx playwright install --with-deps chromium
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 18+ first (e.g. apt install nodejs npm)"; exit 1; }
[ -d node_modules/express ] || npm install --no-fund --no-audit
[ "$(id -u)" = 0 ] || exec sudo -E "$0" "$@"
export ELO_OPEN_BROWSER=1   # the installer prints and opens the URL of the port it finally got
exec node server.js
