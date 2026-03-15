#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
text="${1:-}"
if [ -z "$text" ]; then
  json_err "usage: paste_template.sh <templateText>"
  exit 0
fi
printf '%s' "$text" | pbcopy
json_ok "template copied to clipboard"
