#!/usr/bin/env bash
# Build the Moshe app without node on the host: everything runs in node:22 via Docker.
# Output lands in ./dist, which the server serves at /.
set -euo pipefail
cd "$(dirname "$0")"
REPO=$(cd .. && pwd)
run() {
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$REPO":/repo -w /repo/frontend node:22 npm "$@"
}
STAMP=node_modules/.moshe-lock
LOCK=$( [ -f package-lock.json ] && sha1sum package-lock.json | cut -d' ' -f1 || echo none)
if [ ! -d node_modules ] || [ "${1:-}" = "--install" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$LOCK" ]; then
  if [ -f package-lock.json ]; then run ci --no-audit --no-fund; else run install --no-audit --no-fund; fi
  LOCK=$(sha1sum package-lock.json | cut -d' ' -f1)
  echo "$LOCK" > "$STAMP"
fi
run run build
echo "built: $(du -sh dist | cut -f1) in $PWD/dist"
