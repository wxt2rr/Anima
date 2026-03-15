#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_CALENDAR_CREATE:-MacDesktop.Calendar.CreateEvent}"
payload="${1:-}"
if [ -z "$payload" ]; then
  echo '{"ok":false,"error":"usage: create_event.sh <jsonPayload>"}'
  exit 0
fi
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$payload"
