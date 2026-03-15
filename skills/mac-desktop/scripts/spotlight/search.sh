#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

query="${1:-}"
limit="${2:-20}"
if [ -z "$query" ]; then
  json_err "usage: search.sh <query> [limit]"
  exit 0
fi
out="$(mdfind "$query" | head -n "$limit")"
json_ok "spotlight search finished" "\"results\":\"$(json_escape "$out")\""
