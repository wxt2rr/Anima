#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

path="${1:-}"
if [ -z "$path" ]; then
  json_err "usage: open_path.sh <pathOrApp>"
  exit 0
fi
if open "$path" >/dev/null 2>&1; then
  json_ok "opened" "\"target\":\"$(json_escape "$path")\""
else
  json_err "failed to open: $path"
fi
