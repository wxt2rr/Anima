#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

if [ "$#" -lt 3 ]; then
  json_err "usage: batch_rename.sh <dir> <search> <replace> [dryRun=true|false]"
  exit 0
fi

dir="$1"
search="$2"
replace="$3"
dry_run="${4:-true}"
shortcut="${MAC_SHORTCUT_FILES_BATCH_RENAME:-MacDesktop.Files.BatchRename}"

if [ ! -d "$dir" ]; then
  json_err "directory not found: $dir"
  exit 0
fi

backend_applescript() {
  printf 'no stable applescript backend for batch_rename'
  return 1
}

backend_shell() {
  local renamed="0"
  local skipped="0"
  local p=""
  local b=""
  local n=""
  local t=""
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
  printf 'renamed=%s skipped=%s dryRun=%s' "$renamed" "$skipped" "$dry_run"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$(printf '{"dir":"%s","search":"%s","replace":"%s","dryRun":"%s"}' "$(json_escape "$dir")" "$(json_escape "$search")" "$(json_escape "$replace")" "$(json_escape "$dry_run")")"
}

run_fallback_operation "files.batch_rename" "applescript -> shell -> shortcut" applescript shell shortcut
