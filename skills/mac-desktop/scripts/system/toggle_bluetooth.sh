#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

state="${1:-}"
shortcut="${MAC_SHORTCUT_SYSTEM_BLUETOOTH:-MacDesktop.System.ToggleBluetooth}"

if [ -z "$state" ]; then
  json_err "usage: toggle_bluetooth.sh <on|off>"
  exit 0
fi
if [ "$state" != "on" ] && [ "$state" != "off" ]; then
  json_err "state must be on or off"
  exit 0
fi

backend_shell() {
  local value="0"
  if ! command -v blueutil >/dev/null 2>&1; then
    printf 'blueutil command not found'
    return 1
  fi
  if [ "$state" = "on" ]; then
    value="1"
  fi
  if ! blueutil --power "$value" >/dev/null 2>&1; then
    printf 'failed to update bluetooth'
    return 1
  fi
  printf 'state=%s' "$state"
}

backend_applescript() {
  printf 'no stable applescript backend for bluetooth on current macOS'
  return 1
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$state"
}

run_fallback_operation "system.toggle_bluetooth" "applescript -> shell -> shortcut" applescript shell shortcut
