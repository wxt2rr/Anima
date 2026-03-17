#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

if [ "$#" -lt 2 ]; then
  json_err "usage: move_items.sh <targetDir> <path1> [path2 ...]"
  exit 0
fi

target_dir="$1"
shift
items=("$@")
shortcut="${MAC_SHORTCUT_FILES_MOVE:-MacDesktop.Files.MoveItems}"

backend_applescript() {
  printf 'no stable applescript backend for move_items'
  return 1
}

backend_shell() {
  local moved="0"
  local p=""
  mkdir -p "$target_dir"
  for p in "${items[@]}"; do
    if [ ! -e "$p" ]; then
      continue
    fi
    mv "$p" "$target_dir/"
    moved=$((moved+1))
  done
  printf 'moved=%s targetDir=%s' "$moved" "$target_dir"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$(printf '{"targetDir":"%s","items":"%s"}' "$(json_escape "$target_dir")" "$(json_escape "${items[*]}")")"
}

run_fallback_operation "files.move_items" "applescript -> shell -> shortcut" applescript shell shortcut
