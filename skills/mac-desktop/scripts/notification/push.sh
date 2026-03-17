#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

title="${1:-}"
body="${2:-}"
subtitle="${3:-}"
shortcut="${MAC_SHORTCUT_NOTIFICATION_PUSH:-MacDesktop.Notification.Push}"
if [ -z "$title" ]; then
  json_err "usage: push.sh <title> [body] [subtitle]"
  exit 0
fi

backend_applescript() {
  if ! osascript -e "display notification \"${body//\"/\\\"}\" with title \"${title//\"/\\\"}\" subtitle \"${subtitle//\"/\\\"}\"" >/dev/null 2>&1; then
    printf 'failed to send notification via applescript'
    return 1
  fi
  printf 'notification sent'
}

backend_shell() {
  if ! command -v terminal-notifier >/dev/null 2>&1; then
    printf 'terminal-notifier command not found'
    return 1
  fi
  terminal-notifier -title "$title" -message "$body" -subtitle "$subtitle" >/dev/null 2>&1 || true
  printf 'notification sent'
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$(printf '{"title":"%s","body":"%s","subtitle":"%s"}' "$(json_escape "$title")" "$(json_escape "$body")" "$(json_escape "$subtitle")")"
}

run_fallback_operation "notification.push" "applescript -> shell -> shortcut" applescript shell shortcut
