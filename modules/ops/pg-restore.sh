#!/usr/bin/env bash
# restore.sh — restore a gzipped pg_dump into the running db container
# -------------------------------------------------------------------
# Usage: ./restore.sh <backup.sql.gz>
#        FORCE=1 ./restore.sh <backup.sql.gz>   # skip confirmation
set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  echo "Usage: $0 <backup.sql.gz>" >&2
  exit 2
fi
if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 2
fi

PGCONTAINER="${PGCONTAINER:-technokod-db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-technokod}"

echo "About to restore $FILE"
echo "  -> container: $PGCONTAINER"
echo "  -> database:  $POSTGRES_DB (will DROP and recreate)"

if [[ "${FORCE:-0}" != "1" ]]; then
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

echo "[restore] dropping & recreating database..."
docker exec -i "$PGCONTAINER" psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";"
docker exec -i "$PGCONTAINER" psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE \"$POSTGRES_DB\";"

echo "[restore] streaming $FILE..."
gunzip -c "$FILE" | docker exec -i "$PGCONTAINER" \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "[restore] done."
