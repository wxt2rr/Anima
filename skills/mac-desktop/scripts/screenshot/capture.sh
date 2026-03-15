#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

out_path="${1:-$HOME/Desktop/Screenshot-$(date +%Y%m%d-%H%M%S).png}"
mode="${2:-full}"

if [ "$mode" = "interactive" ]; then
  if ! screencapture -i "$out_path" >/dev/null 2>&1; then
    json_err "capture canceled or failed"
    exit 0
  fi
else
  if ! screencapture -x "$out_path" >/dev/null 2>&1; then
    json_err "capture failed"
    exit 0
  fi
fi

json_ok "screenshot captured" "\"path\":\"$(json_escape "$out_path")\""
