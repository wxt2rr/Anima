#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_MAIL_DRAFT:-MacDesktop.Mail.DraftReply}"
run_shortcut_operation "mail.draft_reply" "$shortcut" "usage: draft_reply.sh <jsonPayload>" "${1:-}" 1
