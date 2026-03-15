#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

if [ "$#" -lt 2 ]; then
  json_err "usage: archive_items.sh <archiveDir> <path1> [path2 ...]"
  exit 0
fi

archive_dir="$1"
shift
mkdir -p "$archive_dir"

moved=0
for p in "$@"; do
  if [ ! -e "$p" ]; then
    continue
  fi
  mv "$p" "$archive_dir/"
  moved=$((moved+1))
done

json_ok "archive finished" "\"moved\":$moved,\"archiveDir\":\"$(json_escape "$archive_dir")\""
