#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

level="${1:-}"
shortcut="${MAC_SHORTCUT_SYSTEM_BRIGHTNESS:-MacDesktop.System.SetBrightness}"

if [ -z "$level" ]; then
  json_err "usage: set_brightness.sh <0-100>"
  exit 0
fi
if ! [[ "$level" =~ ^[0-9]+$ ]] || [ "$level" -lt 0 ] || [ "$level" -gt 100 ]; then
  json_err "brightness must be 0-100"
  exit 0
fi

backend_shell() {
  local normalized=""
  if ! command -v brightness >/dev/null 2>&1; then
    printf 'brightness command not found'
    return 1
  fi
  normalized="$(awk -v n="$level" 'BEGIN { printf "%.2f", n/100 }')"
  if ! brightness "$normalized" >/dev/null 2>&1; then
    printf 'failed to set brightness'
    return 1
  fi
  printf 'brightness=%s' "$level"
}

backend_applescript() {
  printf 'no stable applescript backend for brightness on current macOS'
  return 1
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$level"
}

run_fallback_operation "system.set_brightness" "applescript -> shell -> shortcut" applescript shell shortcut
