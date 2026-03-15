#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
out="$(pbpaste 2>/dev/null || true)"
json_ok "clipboard read" "\"text\":\"$(json_escape "$out")\""
