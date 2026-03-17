#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_CALENDAR_CREATE:-MacDesktop.Calendar.CreateEvent}"
run_shortcut_operation "calendar.create_event" "$shortcut" "usage: create_event.sh <jsonPayload>" "${1:-}" 1
