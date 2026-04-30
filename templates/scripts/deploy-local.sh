#!/usr/bin/env bash
# Пересобирает til-kural и рестартует standalone next-server на :3015.
# Использование: bash scripts/deploy-local.sh
#
# Почему нужен этот скрипт:
#   output: 'standalone' НЕ копирует public/ и .next/static в standalone/,
#   а next build пересоздаёт standalone/ с нуля (теряются симлинки).
#   Скрипт ставит их после сборки и рестартует процесс.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3015}"

echo ">> build"
npm run build 2>&1 | tail -3

echo ">> linking public + static into .next/standalone"
# Если Turbopack создал .next/standalone/public как директорию (например, чтобы
# положить туда fonts из /public/fonts/*), ln -sfn создаёт symlink ВНУТРИ неё,
# получается кривая вложенность. Удаляем, потом создаём правильный symlink.
if [[ -d "$ROOT/.next/standalone/public" && ! -L "$ROOT/.next/standalone/public" ]]; then
  rm -rf "$ROOT/.next/standalone/public"
fi
ln -sfn "$ROOT/public" "$ROOT/.next/standalone/public"
mkdir -p "$ROOT/.next/standalone/.next"
ln -sfn "$ROOT/.next/static" "$ROOT/.next/standalone/.next/static"

echo ">> stopping existing standalone server on :$PORT"
PIDS=$(fuser "$PORT/tcp" 2>/dev/null || true)
if [[ -n "$PIDS" ]]; then
  kill $PIDS 2>/dev/null || true
  sleep 2
fi

echo ">> loading env from .env.local"
if [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env.local"
  set +a
fi

echo ">> starting server on :$PORT"
PORT="$PORT" nohup node "$ROOT/.next/standalone/server.js" > /tmp/til-kural-"$PORT".log 2>&1 &
disown
sleep 3

if fuser "$PORT/tcp" 2>/dev/null >/dev/null; then
  echo "✓ running on :$PORT"
  tail -3 /tmp/til-kural-"$PORT".log
else
  echo "✗ server failed to start; see /tmp/til-kural-$PORT.log"
  tail -20 /tmp/til-kural-"$PORT".log
  exit 1
fi
