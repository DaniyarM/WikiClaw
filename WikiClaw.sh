#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found in PATH."
  echo "Install Node.js 20+ and run this script again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Building WikiClaw..."
npm run build

echo "Starting WikiClaw on http://localhost:8787 ..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:8787" >/dev/null 2>&1 || true
fi

exec node dist-server/server/index.js
