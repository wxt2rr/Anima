#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_CALENDAR_RESCHEDULE:-MacDesktop.Calendar.RescheduleEvent}"
run_shortcut_operation "calendar.reschedule_event" "$shortcut" "usage: reschedule_event.sh <jsonPayload>" "${1:-}" 1
