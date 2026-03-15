#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

days="${1:-30}"
dry_run="${2:-true}"
downloads="${3:-$HOME/Downloads}"

if [ ! -d "$downloads" ]; then
  json_err "downloads directory not found: $downloads"
  exit 0
fi

archive_dir="$downloads/.anima_cleanup/$(date +%Y%m%d_%H%M%S)"
count=0
while IFS= read -r -d '' p; do
  count=$((count+1))
  if [ "$dry_run" != "true" ]; then
    mkdir -p "$archive_dir"
    mv "$p" "$archive_dir/"
  fi
done < <(find "$downloads" -type f -mtime +"$days" -print0)

json_ok "clean downloads finished" "\"count\":$count,\"dryRun\":\"$(json_escape "$dry_run")\",\"archiveDir\":\"$(json_escape "$archive_dir")\""
