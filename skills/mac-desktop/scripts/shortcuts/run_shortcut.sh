#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"

if [ "$#" -lt 1 ]; then
  json_err "usage: run_shortcut.sh <shortcutName> [inputText]"
  exit 0
fi

name="$1"
input_text="${2:-}"

if ! command -v shortcuts >/dev/null 2>&1; then
  json_err "shortcuts command not found"
  exit 0
fi

tmp_out="$(mktemp)"
tmp_in=""
trap 'rm -f "$tmp_out" "$tmp_in"' EXIT

if [ -n "$input_text" ]; then
  tmp_in="$(mktemp)"
  printf '%s' "$input_text" > "$tmp_in"
  if ! err=$(shortcuts run "$name" --input-path "$tmp_in" --output-path "$tmp_out" 2>&1); then
    json_err "$err"
    exit 0
  fi
else
  if ! err=$(shortcuts run "$name" --output-path "$tmp_out" 2>&1); then
    json_err "$err"
    exit 0
  fi
fi

out=""
if [ -f "$tmp_out" ]; then
  out="$(cat "$tmp_out")"
fi
json_ok "shortcut completed" "\"shortcut\":\"$(json_escape "$name")\",\"output\":\"$(json_escape "$out")\""
