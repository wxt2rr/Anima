#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

text="${1:-}"
shortcut="${MAC_SHORTCUT_CLIPBOARD_SET_TEXT:-MacDesktop.Clipboard.SetText}"
if [ -z "$text" ]; then
  json_err "usage: set_text.sh <text>"
  exit 0
fi

backend_applescript() {
  osascript -e "set the clipboard to \"${text//\"/\\\"}\"" >/dev/null 2>&1 || return 1
  printf 'clipboard updated'
}

backend_shell() {
  printf '%s' "$text" | pbcopy
  printf 'clipboard updated'
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$text"
}

run_fallback_operation "clipboard.set_text" "applescript -> shell -> shortcut" applescript shell shortcut
