#!/usr/bin/env bash
# backup.sh — pg_dump → gzip → local + optional S3 upload
# ------------------------------------------------------------
# Env:
#   PGCONTAINER         (default: technokod-db)
#   POSTGRES_USER       (default: postgres)
#   POSTGRES_DB         (default: technokod)
#   BACKUP_DIR          (default: /home/ubuntu/backups/technokod)
#   LOCAL_RETENTION     (default: 14)
#   REMOTE_RETENTION    (default: 90)
#   BACKUP_S3_BUCKET    (optional — if set, upload)
#   BACKUP_S3_ENDPOINT  (optional — e.g. https://s3.eu-central-1.wasabisys.com)
#   BACKUP_S3_REGION    (default: auto)
#   BACKUP_S3_PREFIX    (default: technokod)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — for S3

set -euo pipefail

PGCONTAINER="${PGCONTAINER:-technokod-db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-technokod}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/technokod}"
LOCAL_RETENTION="${LOCAL_RETENTION:-14}"
REMOTE_RETENTION="${REMOTE_RETENTION:-90}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +"%Y%m%d-%H%M%S")"
FILE="$BACKUP_DIR/technokod-$STAMP.sql.gz"

log() { printf '[backup] %s\n' "$*" >&2; }

log "Dumping $POSTGRES_DB from container $PGCONTAINER -> $FILE"
docker exec "$PGCONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip -9 > "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
log "Wrote $FILE ($SIZE)"

# --- Local rotation ---
log "Rotating local (keep $LOCAL_RETENTION)"
ls -1t "$BACKUP_DIR"/technokod-*.sql.gz 2>/dev/null \
  | tail -n +"$((LOCAL_RETENTION + 1))" \
  | xargs -r rm -v

# --- Optional S3 upload ---
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    log "aws CLI not found — skipping S3 upload"
    exit 0
  fi
  PREFIX="${BACKUP_S3_PREFIX:-technokod}"
  ENDPOINT_FLAG=()
  if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
    ENDPOINT_FLAG=(--endpoint-url "$BACKUP_S3_ENDPOINT")
  fi
  REGION="${BACKUP_S3_REGION:-auto}"

  log "Uploading to s3://$BACKUP_S3_BUCKET/$PREFIX/$(basename "$FILE")"
  AWS_DEFAULT_REGION="$REGION" aws "${ENDPOINT_FLAG[@]}" s3 cp "$FILE" \
    "s3://$BACKUP_S3_BUCKET/$PREFIX/$(basename "$FILE")" \
    --only-show-errors

  # Remote rotation
  log "Rotating remote (keep $REMOTE_RETENTION)"
  KEEP="$REMOTE_RETENTION"
  mapfile -t OLD < <(
    AWS_DEFAULT_REGION="$REGION" aws "${ENDPOINT_FLAG[@]}" s3 ls \
      "s3://$BACKUP_S3_BUCKET/$PREFIX/" \
      | awk '{print $4}' \
      | grep -E '^technokod-.*\.sql\.gz$' \
      | sort -r \
      | tail -n +"$((KEEP + 1))"
  )
  for k in "${OLD[@]:-}"; do
    [[ -n "$k" ]] || continue
    AWS_DEFAULT_REGION="$REGION" aws "${ENDPOINT_FLAG[@]}" s3 rm \
      "s3://$BACKUP_S3_BUCKET/$PREFIX/$k" --only-show-errors
    log "Deleted remote $k"
  done
fi

log "Done."
