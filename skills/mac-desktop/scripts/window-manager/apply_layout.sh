#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_WINDOW_LAYOUT:-MacDesktop.Window.ApplyLayout}"
layout="${1:-}"
if [ -z "$layout" ]; then
  echo '{"ok":false,"error":"usage: apply_layout.sh <layoutNameOrJson>"}'
  exit 0
fi
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$layout"
