#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_MAIL_SUMMARY:-MacDesktop.Mail.ReadSummary}"
run_shortcut_operation "mail.read_summary" "$shortcut" "usage: read_summary.sh [jsonPayload]" "${1:-{}}" 0
