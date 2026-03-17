#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_MAIL_ARCHIVE:-MacDesktop.Mail.ArchiveByRule}"
run_shortcut_operation "mail.archive_by_rule" "$shortcut" "usage: archive_by_rule.sh <jsonPayload>" "${1:-}" 1
