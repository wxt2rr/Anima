#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

path="${1:-}"
shortcut="${MAC_SHORTCUT_SPOTLIGHT_OPEN_PATH:-MacDesktop.Spotlight.OpenPath}"
if [ -z "$path" ]; then
  json_err "usage: open_path.sh <pathOrApp>"
  exit 0
fi

backend_applescript() {
  printf 'no stable applescript backend for open_path'
  return 1
}

backend_shell() {
  if ! open "$path" >/dev/null 2>&1; then
    printf 'failed to open: %s' "$path"
    return 1
  fi
  printf 'target=%s' "$path"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$path"
}

run_fallback_operation "spotlight.open_path" "applescript -> shell -> shortcut" applescript shell shortcut
