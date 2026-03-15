#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

if [ "$#" -lt 2 ]; then
  json_err "usage: move_items.sh <targetDir> <path1> [path2 ...]"
  exit 0
fi

target_dir="$1"
shift
mkdir -p "$target_dir"

moved=0
for p in "$@"; do
  if [ ! -e "$p" ]; then
    continue
  fi
  mv "$p" "$target_dir/"
  moved=$((moved+1))
done

json_ok "move finished" "\"moved\":$moved,\"targetDir\":\"$(json_escape "$target_dir")\""
