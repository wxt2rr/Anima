#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_NOTES_TAG:-MacDesktop.Notes.Tag}"
run_shortcut_operation "notes.tag_note" "$shortcut" "usage: tag_note.sh <jsonPayload>" "${1:-}" 1
