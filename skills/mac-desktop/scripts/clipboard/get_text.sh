#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

shortcut="${MAC_SHORTCUT_CLIPBOARD_GET_TEXT:-MacDesktop.Clipboard.GetText}"

backend_applescript() {
  osascript -e 'the clipboard as text' 2>/dev/null || return 1
}

backend_shell() {
  pbpaste 2>/dev/null || true
}

backend_shortcut() {
  run_shortcut_backend "$shortcut"
}

run_fallback_operation "clipboard.get_text" "applescript -> shell -> shortcut" applescript shell shortcut
