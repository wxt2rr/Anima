#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

if [ "$#" -lt 3 ]; then
  json_err "usage: batch_rename.sh <dir> <search> <replace> [dryRun=true|false]"
  exit 0
fi

dir="$1"
search="$2"
replace="$3"
dry_run="${4:-true}"

if [ ! -d "$dir" ]; then
  json_err "directory not found: $dir"
  exit 0
fi

renamed=0
skipped=0
while IFS= read -r -d '' p; do
  b="$(basename "$p")"
  n="${b//${search}/${replace}}"
  if [ "$b" = "$n" ]; then
    skipped=$((skipped+1))
    continue
  fi
  t="$(dirname "$p")/$n"
  if [ -e "$t" ]; then
    skipped=$((skipped+1))
    continue
  fi
  if [ "$dry_run" != "true" ]; then
    mv "$p" "$t"
  fi
  renamed=$((renamed+1))
done < <(find "$dir" -maxdepth 1 -type f -print0)

json_ok "batch rename finished" "\"renamed\":$renamed,\"skipped\":$skipped,\"dryRun\":\"$(json_escape "$dry_run")\""
