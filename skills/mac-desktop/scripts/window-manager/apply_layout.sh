#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_WINDOW_LAYOUT:-MacDesktop.Window.ApplyLayout}"
run_shortcut_operation "window.apply_layout" "$shortcut" "usage: apply_layout.sh <layoutNameOrJson>" "${1:-}" 1
