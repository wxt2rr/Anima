#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

if [ "$#" -lt 2 ]; then
  json_err "usage: archive_items.sh <archiveDir> <path1> [path2 ...]"
  exit 0
fi

archive_dir="$1"
shift
items=("$@")
shortcut="${MAC_SHORTCUT_FILES_ARCHIVE:-MacDesktop.Files.ArchiveItems}"

backend_applescript() {
  printf 'no stable applescript backend for archive_items'
  return 1
}

backend_shell() {
  local moved="0"
  local p=""
  mkdir -p "$archive_dir"
  for p in "${items[@]}"; do
    if [ ! -e "$p" ]; then
      continue
    fi
    mv "$p" "$archive_dir/"
    moved=$((moved+1))
  done
  printf 'moved=%s archiveDir=%s' "$moved" "$archive_dir"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$(printf '{"archiveDir":"%s","items":"%s"}' "$(json_escape "$archive_dir")" "$(json_escape "${items[*]}")")"
}

run_fallback_operation "files.archive_items" "applescript -> shell -> shortcut" applescript shell shortcut
