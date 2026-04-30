#!/usr/bin/env bash
# rotate-secrets.sh — generate + atomically write new secrets into .env
# Rotates: AUTH_SECRET, CRON_SECRET, METRICS_TOKEN, SOCIAL_ENCRYPTION_KEY
# Leaves API keys (GEMINI, OPENROUTER, SENTRY_DSN) untouched unless --all
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
ALL=0
if [[ "${1:-}" == "--all" ]]; then ALL=1; fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "no $ENV_FILE — creating from template" >&2
  if [[ -f ".env.template" ]]; then cp .env.template "$ENV_FILE"; else : > "$ENV_FILE"; fi
fi

gen_hex()    { openssl rand -hex 32; }
gen_b64()    { openssl rand -base64 48 | tr -d '\n'; }
gen_urlsafe() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }

declare -A NEW
NEW[AUTH_SECRET]="$(gen_hex)"
NEW[CRON_SECRET]="$(gen_urlsafe)"
NEW[METRICS_TOKEN]="$(gen_urlsafe)"
NEW[SOCIAL_ENCRYPTION_KEY]="$(gen_b64)"

if [[ "$ALL" == "1" ]]; then
  NEW[ADMIN_EMAIL]="${ADMIN_EMAIL:-admin@technokod.kz}"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Update or append each
cp "$ENV_FILE" "$TMP"
for K in "${!NEW[@]}"; do
  V="${NEW[$K]}"
  if grep -qE "^${K}=" "$TMP"; then
    # escape slashes/ampersands for sed
    ESC=$(printf '%s' "$V" | sed -e 's/[\/&]/\\&/g')
    sed -i.bak -E "s/^${K}=.*/${K}=${ESC}/" "$TMP"
    rm -f "${TMP}.bak"
  else
    printf '%s=%s\n' "$K" "$V" >> "$TMP"
  fi
  echo "rotated: $K"
done

# Atomic swap
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
trap - EXIT

echo
echo "Done. Restart the app container to pick up new secrets:"
echo "  docker compose -f docker-compose.prod.yml up -d --force-recreate app"
