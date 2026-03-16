#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

state="${1:-}"
shortcut="${MAC_SHORTCUT_SYSTEM_DND:-MacDesktop.System.ToggleDND}"

if [ -z "$state" ]; then
  json_err "usage: toggle_do_not_disturb.sh <on|off>"
  exit 0
fi
if [ "$state" != "on" ] && [ "$state" != "off" ]; then
  json_err "state must be on or off"
  exit 0
fi

backend_shell() {
  printf 'no stable shell backend for dnd on current macOS'
  return 1
}

backend_applescript() {
  printf 'no stable applescript backend for dnd on current macOS'
  return 1
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$state"
}

run_fallback_operation "system.toggle_do_not_disturb" "applescript -> shell -> shortcut" applescript shell shortcut
