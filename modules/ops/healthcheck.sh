#!/usr/bin/env bash
# healthcheck.sh — curl the app /api/health, exit non-zero on failure
set -euo pipefail

URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
TIMEOUT="${TIMEOUT:-5}"

RESP="$(curl -fsS --max-time "$TIMEOUT" "$URL")" || {
  echo "unhealthy: curl failed" >&2
  exit 1
}

echo "$RESP"

# Parse status=ok via grep (no jq dep)
if echo "$RESP" | grep -q '"status":"ok"'; then
  exit 0
fi

echo "unhealthy: non-ok status" >&2
exit 1
