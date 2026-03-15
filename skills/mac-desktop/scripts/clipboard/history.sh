#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_CLIPBOARD_HISTORY:-MacDesktop.Clipboard.History}"
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "${1:-{}}"
