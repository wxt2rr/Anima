#!/usr/bin/env bash
set -euo pipefail

json_escape() {
  printf '%s' "${1:-}" | perl -pe 's/\\/\\\\/g; s/"/\\"/g; s/\r/\\r/g; s/\n/\\n/g'
}

json_ok() {
  local msg="${1:-ok}"
  local extra="${2:-}"
  if [ -n "$extra" ]; then
    printf '{"ok":true,"message":"%s",%s}\n' "$(json_escape "$msg")" "$extra"
  else
    printf '{"ok":true,"message":"%s"}\n' "$(json_escape "$msg")"
  fi
}

json_err() {
  local msg="${1:-error}"
  local code="${2:-}"
  if [ -n "$code" ]; then
    printf '{"ok":false,"error":"%s","code":"%s"}\n' "$(json_escape "$msg")" "$(json_escape "$code")"
  else
    printf '{"ok":false,"error":"%s"}\n' "$(json_escape "$msg")"
  fi
}
