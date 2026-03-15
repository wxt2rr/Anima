#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_MAIL_SUMMARY:-MacDesktop.Mail.ReadSummary}"
payload="${1:-{}}"
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$payload"
