#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
level="${1:-}"
if [ -z "$level" ]; then
  json_err "usage: set_volume.sh <0-100>"
  exit 0
fi
if ! [[ "$level" =~ ^[0-9]+$ ]] || [ "$level" -lt 0 ] || [ "$level" -gt 100 ]; then
  json_err "volume must be 0-100"
  exit 0
fi
if osascript -e "set volume output volume $level" >/dev/null 2>&1; then
  json_ok "volume updated" "\"volume\":$level"
else
  json_err "failed to set volume"
fi
