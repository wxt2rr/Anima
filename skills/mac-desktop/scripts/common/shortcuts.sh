#!/usr/bin/env bash
set -euo pipefail

SHORTCUTS_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SHORTCUTS_HELPER_DIR/.." && pwd)"

shortcut_exists() {
  local name="$1"
  if ! command -v shortcuts >/dev/null 2>&1; then
    return 1
  fi
  shortcuts list 2>/dev/null | grep -Fx -- "$name" >/dev/null 2>&1
}

ensure_shortcut_available() {
  local name="$1"
  local timeout="${MAC_SHORTCUT_AUTO_CREATE_TIMEOUT_SEC:-8}"
  local template_dir="${MAC_SHORTCUT_TEMPLATE_DIR:-$ROOT_DIR/../shortcuts/templates}"
  local template_path="$template_dir/$name.shortcut"
  local i="0"

  if shortcut_exists "$name"; then
    printf 'shortcut exists'
    return 0
  fi

  if [ "${MAC_SHORTCUT_AUTO_CREATE:-1}" != "1" ]; then
    printf 'shortcut not found: %s' "$name"
    return 1
  fi

  if [ ! -f "$template_path" ]; then
    printf 'shortcut not found and template missing: %s' "$template_path"
    return 1
  fi

  if ! open "$template_path" >/dev/null 2>&1; then
    printf 'failed to open shortcut template: %s' "$template_path"
    return 1
  fi

  while [ "$i" -lt "$timeout" ]; do
    if shortcut_exists "$name"; then
      printf 'shortcut imported from template: %s' "$template_path"
      return 0
    fi
    sleep 1
    i=$((i+1))
  done

  printf 'shortcut template opened but not available after %ss: %s' "$timeout" "$name"
  return 1
}
