#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

query="${1:-}"
limit="${2:-20}"
shortcut="${MAC_SHORTCUT_SPOTLIGHT_SEARCH:-MacDesktop.Spotlight.Search}"
if [ -z "$query" ]; then
  json_err "usage: search.sh <query> [limit]"
  exit 0
fi

backend_applescript() {
  printf 'no stable applescript backend for spotlight search'
  return 1
}

backend_shell() {
  local out=""
  out="$(mdfind "$query" | head -n "$limit")"
  printf '%s' "$out"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$(printf '{"query":"%s","limit":"%s"}' "$(json_escape "$query")" "$(json_escape "$limit")")"
}

run_fallback_operation "spotlight.search" "applescript -> shell -> shortcut" applescript shell shortcut
