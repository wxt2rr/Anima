#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"

days="${1:-30}"
dry_run="${2:-true}"
downloads="${3:-$HOME/Downloads}"
shortcut="${MAC_SHORTCUT_FILES_CLEAN_DOWNLOADS:-MacDesktop.Files.CleanDownloads}"

if [ ! -d "$downloads" ]; then
  json_err "downloads directory not found: $downloads"
  exit 0
fi

backend_applescript() {
  printf 'no stable applescript backend for clean_downloads'
  return 1
}

backend_shell() {
  local archive_dir=""
  local count="0"
  local p=""
  archive_dir="$downloads/.anima_cleanup/$(date +%Y%m%d_%H%M%S)"
  while IFS= read -r -d '' p; do
    count=$((count+1))
    if [ "$dry_run" != "true" ]; then
      mkdir -p "$archive_dir"
      mv "$p" "$archive_dir/"
    fi
  done < <(find "$downloads" -type f -mtime +"$days" -print0)
  printf 'count=%s dryRun=%s archiveDir=%s' "$count" "$dry_run" "$archive_dir"
}

backend_shortcut() {
  run_shortcut_backend "$shortcut" "$(printf '{"days":"%s","dryRun":"%s","downloads":"%s"}' "$(json_escape "$days")" "$(json_escape "$dry_run")" "$(json_escape "$downloads")")"
}

run_fallback_operation "files.clean_downloads" "applescript -> shell -> shortcut" applescript shell shortcut
