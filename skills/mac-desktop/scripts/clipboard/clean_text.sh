#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
raw="$(pbpaste 2>/dev/null || true)"
clean="$(printf '%s' "$raw" | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//')"
printf '%s' "$clean" | pbcopy
json_ok "clipboard cleaned" "\"text\":\"$(json_escape "$clean")\""
