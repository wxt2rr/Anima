#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

shortcut="${MAC_SHORTCUT_CLIPBOARD_CLEAN_TEXT:-MacDesktop.Clipboard.CleanText}"

backend_applescript() {
  local raw=""
  local clean=""
  raw="$(osascript -e 'the clipboard as text' 2>/dev/null)" || return 1
  clean="$(printf '%s' "$raw" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
  osascript -e "set the clipboard to \"${clean//\"/\\\"}\"" >/dev/null 2>&1 || return 1
  printf '%s' "$clean"
}

backend_shell() {
  local raw=""
  local clean=""
  raw="$(pbpaste 2>/dev/null || true)"
  clean="$(printf '%s' "$raw" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
  printf '%s' "$clean" | pbcopy
  printf '%s' "$clean"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut"
}

run_fallback_operation "clipboard.clean_text" "applescript -> shell -> shortcut" applescript shell shortcut
