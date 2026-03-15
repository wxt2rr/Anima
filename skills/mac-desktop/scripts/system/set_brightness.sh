#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_SYSTEM_BRIGHTNESS:-MacDesktop.System.SetBrightness}"
level="${1:-}"
if [ -z "$level" ]; then
  echo '{"ok":false,"error":"usage: set_brightness.sh <0-100>"}'
  exit 0
fi
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$level"
