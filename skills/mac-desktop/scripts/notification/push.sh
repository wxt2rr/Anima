#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

title="${1:-}"
body="${2:-}"
subtitle="${3:-}"
if [ -z "$title" ]; then
  json_err "usage: push.sh <title> [body] [subtitle]"
  exit 0
fi

if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "$title" -message "$body" -subtitle "$subtitle" >/dev/null 2>&1 || true
  json_ok "notification sent"
  exit 0
fi

if osascript -e "display notification \"${body//\"/\\\"}\" with title \"${title//\"/\\\"}\"" >/dev/null 2>&1; then
  json_ok "notification sent"
else
  json_err "failed to send notification"
fi
