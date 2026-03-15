#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_MAIL_DRAFT:-MacDesktop.Mail.DraftReply}"
payload="${1:-}"
if [ -z "$payload" ]; then
  echo '{"ok":false,"error":"usage: draft_reply.sh <jsonPayload>"}'
  exit 0
fi
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$payload"
