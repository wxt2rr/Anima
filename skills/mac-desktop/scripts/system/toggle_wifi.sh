#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

state="${1:-}"
shortcut="${MAC_SHORTCUT_SYSTEM_WIFI:-MacDesktop.System.ToggleWifi}"

if [ -z "$state" ]; then
  json_err "usage: toggle_wifi.sh <on|off>"
  exit 0
fi
if [ "$state" != "on" ] && [ "$state" != "off" ]; then
  json_err "state must be on or off"
  exit 0
fi

backend_shell() {
  local iface=""
  if ! command -v networksetup >/dev/null 2>&1; then
    printf 'networksetup command not found'
    return 1
  fi
  iface="$(networksetup -listallhardwareports | awk '/Wi-Fi|AirPort/{getline; print $2; exit}')"
  if [ -z "$iface" ]; then
    printf 'wifi interface not found'
    return 1
  fi
  if ! networksetup -setairportpower "$iface" "$state" >/dev/null 2>&1; then
    printf 'failed to update wifi'
    return 1
  fi
  printf 'interface=%s state=%s' "$iface" "$state"
}

backend_applescript() {
  printf 'no stable applescript backend for wifi on current macOS'
  return 1
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$state"
}

run_fallback_operation "system.toggle_wifi" "applescript -> shell -> shortcut" applescript shell shortcut
