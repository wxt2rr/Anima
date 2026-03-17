#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_NOTES_APPEND:-MacDesktop.Notes.Append}"
run_shortcut_operation "notes.append_note" "$shortcut" "usage: append_note.sh <jsonPayload>" "${1:-}" 1
