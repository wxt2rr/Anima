#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_CALENDAR_CONFLICT:-MacDesktop.Calendar.DetectConflicts}"
run_shortcut_operation "calendar.detect_conflicts" "$shortcut" "usage: detect_conflicts.sh [jsonPayload]" "${1:-{}}" 0
