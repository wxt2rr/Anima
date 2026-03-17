#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_CALENDAR_LIST:-MacDesktop.Calendar.ListEvents}"
run_shortcut_operation "calendar.list_events" "$shortcut" "usage: list_events.sh [jsonPayload]" "${1:-{}}" 0
