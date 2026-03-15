#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_SCREENSHOT_OCR:-MacDesktop.Screenshot.OCR}"
img_path="${1:-}"
if [ -z "$img_path" ]; then
  echo '{"ok":false,"error":"usage: ocr.sh <imagePath>"}'
  exit 0
fi
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$img_path"
