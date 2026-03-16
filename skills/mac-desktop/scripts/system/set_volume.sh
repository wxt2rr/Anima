#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

level="${1:-}"
shortcut="${MAC_SHORTCUT_SYSTEM_VOLUME:-MacDesktop.System.SetVolume}"
if [ -z "$level" ]; then
  json_err "usage: set_volume.sh <0-100>"
  exit 0
fi
if ! [[ "$level" =~ ^[0-9]+$ ]] || [ "$level" -lt 0 ] || [ "$level" -gt 100 ]; then
  json_err "volume must be 0-100"
  exit 0
fi

backend_applescript() {
  if ! osascript -e "set volume output volume $level" >/dev/null 2>&1; then
    printf 'failed to set volume via applescript'
    return 1
  fi
  printf 'volume=%s' "$level"
}

backend_shell() {
  printf 'no stable shell backend for volume on current macOS'
  return 1
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$level"
}

run_fallback_operation "system.set_volume" "applescript -> shell -> shortcut" applescript shell shortcut
