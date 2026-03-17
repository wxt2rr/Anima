#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_SCREENSHOT_OCR:-MacDesktop.Screenshot.OCR}"
run_shortcut_operation "screenshot.ocr" "$shortcut" "usage: ocr.sh <imagePath>" "${1:-}" 1
