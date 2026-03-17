#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

text="${1:-}"
shortcut="${MAC_SHORTCUT_CLIPBOARD_PASTE_TEMPLATE:-MacDesktop.Clipboard.PasteTemplate}"
if [ -z "$text" ]; then
  json_err "usage: paste_template.sh <templateText>"
  exit 0
fi

backend_applescript() {
  osascript -e "set the clipboard to \"${text//\"/\\\"}\"" >/dev/null 2>&1 || return 1
  printf 'template copied to clipboard'
}

backend_shell() {
  printf '%s' "$text" | pbcopy
  printf 'template copied to clipboard'
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$text"
}

run_fallback_operation "clipboard.paste_template" "applescript -> shell -> shortcut" applescript shell shortcut
