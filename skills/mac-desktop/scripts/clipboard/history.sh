#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_CLIPBOARD_HISTORY:-MacDesktop.Clipboard.History}"
run_shortcut_operation "clipboard.history" "$shortcut" "usage: history.sh [jsonPayload]" "${1:-{}}" 0
