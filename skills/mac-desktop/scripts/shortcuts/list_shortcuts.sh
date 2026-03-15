#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

if ! command -v shortcuts >/dev/null 2>&1; then
  json_err "shortcuts command not found"
  exit 0
fi

out="$(shortcuts list --show-identifiers 2>&1 || true)"
json_ok "shortcuts listed" "\"output\":\"$(json_escape "$out")\""
