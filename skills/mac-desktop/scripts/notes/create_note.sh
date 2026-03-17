#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_NOTES_CREATE:-MacDesktop.Notes.Create}"
run_shortcut_operation "notes.create_note" "$shortcut" "usage: create_note.sh <jsonPayload>" "${1:-}" 1
