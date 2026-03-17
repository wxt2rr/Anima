#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

out_path="${1:-$HOME/Desktop/Screenshot-$(date +%Y%m%d-%H%M%S).png}"
mode="${2:-full}"
shortcut="${MAC_SHORTCUT_SCREENSHOT_CAPTURE:-MacDesktop.Screenshot.Capture}"

backend_applescript() {
  printf 'no stable applescript backend for screenshot capture'
  return 1
}

backend_shell() {
  if [ "$mode" = "interactive" ]; then
    if ! screencapture -i "$out_path" >/dev/null 2>&1; then
      printf 'capture canceled or failed'
      return 1
    fi
  else
    if ! screencapture -x "$out_path" >/dev/null 2>&1; then
      printf 'capture failed'
      return 1
    fi
  fi
  printf 'path=%s mode=%s' "$out_path" "$mode"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$(printf '{"outputPath":"%s","mode":"%s"}' "$(json_escape "$out_path")" "$(json_escape "$mode")")"
}

run_fallback_operation "screenshot.capture" "applescript -> shell -> shortcut" applescript shell shortcut
