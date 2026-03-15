#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_SYSTEM_BLUETOOTH:-MacDesktop.System.ToggleBluetooth}"
state="${1:-}"
if [ -z "$state" ]; then
  echo '{"ok":false,"error":"usage: toggle_bluetooth.sh <on|off>"}'
  exit 0
fi
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$state"
