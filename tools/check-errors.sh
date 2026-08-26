#!/usr/bin/env bash
set -euo pipefail

LIMIT=50
SKIP=0
ALL_ERROR_IDS=()
PAGE=0
SINCE_FLAG=""

usage() {
  echo "Usage: $0 [--hours N]"
  echo "  --hours N   Only check activations from the last N hours (e.g. --hours 15)"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hours)
      HOURS="${2:?--hours requires a value}"
      SINCE_MS=$(( ($(date +%s) - HOURS * 3600) * 1000 ))
      SINCE_FLAG="--since $SINCE_MS"
      shift 2
      ;;
    *) usage ;;
  esac
done

echo "=== Fetching activations (paginating) ==="
if [ -n "$SINCE_FLAG" ]; then
  echo "Filtering: since $HOURS hours ago"
fi

while true; do
  PAGE=$((PAGE + 1))
  echo "--- Page $PAGE (skip=$SKIP, limit=$LIMIT) ---"

  # shellcheck disable=SC2086
  ACTIVATIONS=$(aio rt activation list --limit "$LIMIT" --skip "$SKIP" $SINCE_FLAG --json 2>&1)

  COUNT=$(echo "$ACTIVATIONS" | jq 'length')
  echo "Fetched $COUNT activations."

  while IFS= read -r id; do
    [ -n "$id" ] && ALL_ERROR_IDS+=("$id")
  done < <(echo "$ACTIVATIONS" | jq -r '.[] | select(.statusCode != 0) | .activationId')

  if [ "$COUNT" -lt "$LIMIT" ]; then
    break
  fi

  SKIP=$((SKIP + LIMIT))
done

echo
if [ "${#ALL_ERROR_IDS[@]}" -eq 0 ]; then
  echo "No error activations found."
  exit 0
fi

echo "=== Error activation IDs ==="
printf '%s\n' "${ALL_ERROR_IDS[@]}"
echo

for ID in "${ALL_ERROR_IDS[@]}"; do
  echo "========================================"
  echo "Activation: $ID"
  echo "========================================"

  echo "--- aio rt activation get $ID ---"
  aio rt activation get "$ID" 2>&1 || true
  echo

  echo "--- aio rt activation logs $ID ---"
  aio rt activation logs "$ID" 2>&1 || true
  echo
done
