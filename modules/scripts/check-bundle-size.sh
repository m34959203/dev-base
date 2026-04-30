#!/usr/bin/env bash
#
# Bundle-size guard — P4.2.
#
# Scans Next.js production chunks (the files that actually ship to browsers)
# and fails the build if any single chunk exceeds the budget. We only check
# files under `.next/static/chunks/` because that's what the app ships to
# browsers — server-only bundles under `.next/server` can be as large as they
# need to be.
#
# Usage (after `next build`):
#   scripts/ci/check-bundle-size.sh
#   scripts/ci/check-bundle-size.sh --budget 350  # override in KB
#
# Exit 0 = all chunks under budget; exit 1 = at least one violation.

set -euo pipefail

BUDGET_KB="${BUNDLE_BUDGET_KB:-300}"
DIR="${1:-.next/static/chunks}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --budget)
      BUDGET_KB="$2"
      shift 2
      ;;
    *)
      DIR="$1"
      shift
      ;;
  esac
done

if [[ ! -d "$DIR" ]]; then
  echo "bundle-check: directory '$DIR' not found — did you run 'next build'?" >&2
  exit 2
fi

echo "Bundle-size guard: budget = ${BUDGET_KB}KB per chunk"
echo "Scanning: $DIR"
echo ""

# Emit size + path, newline-separated. sort biggest first so the log is useful.
violations=0
scanned=0
# Use `find … -printf` on GNU coreutils (CI); fall back to stat on macOS-like
# environments where printf may not be supported.
if find "$DIR" -maxdepth 8 -type f -name '*.js' -printf '%s %p\n' > /tmp/bundle-sizes.$$.txt 2>/dev/null; then
  :
else
  : > /tmp/bundle-sizes.$$.txt
  while IFS= read -r f; do
    sz=$(wc -c < "$f")
    printf '%s %s\n' "$sz" "$f" >> /tmp/bundle-sizes.$$.txt
  done < <(find "$DIR" -maxdepth 8 -type f -name '*.js')
fi
sort -nr /tmp/bundle-sizes.$$.txt > /tmp/bundle-sizes-sorted.$$.txt

printf '%-10s %-10s %s\n' "SIZE(KB)" "STATUS" "FILE"
printf '%-10s %-10s %s\n' "--------" "------" "----"
while read -r bytes path; do
  [[ -z "$bytes" ]] && continue
  scanned=$((scanned + 1))
  size_kb=$(( (bytes + 1023) / 1024 ))
  if [[ $size_kb -gt $BUDGET_KB ]]; then
    status="FAIL"
    violations=$((violations + 1))
  else
    status="ok"
  fi
  printf '%-10s %-10s %s\n' "$size_kb" "$status" "$path"
done < /tmp/bundle-sizes-sorted.$$.txt

rm -f /tmp/bundle-sizes.$$.txt /tmp/bundle-sizes-sorted.$$.txt

echo ""
echo "Scanned $scanned chunk(s), $violations violation(s) over ${BUDGET_KB}KB budget."

if [[ $violations -gt 0 ]]; then
  echo "bundle-check: FAIL — reduce chunk size via dynamic import, tree-shake, or code-split." >&2
  exit 1
fi
