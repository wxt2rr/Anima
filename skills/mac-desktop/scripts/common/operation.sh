#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/shortcuts.sh"

join_by() {
  local sep="$1"
  shift
  local out=""
  local first="1"
  local v=""
  for v in "$@"; do
    if [ "$first" = "1" ]; then
      out="$v"
      first="0"
    else
      out="$out$sep$v"
    fi
  done
  printf '%s' "$out"
}

run_shortcut_backend() {
  local shortcut_name="$1"
  local input_text="${2:-}"
  local ensure_msg=""
  local tmp_out=""
  local tmp_in=""
  local err=""
  local out=""

  if ! command -v shortcuts >/dev/null 2>&1; then
    printf 'shortcuts command not found'
    return 1
  fi

  if ! ensure_msg="$(ensure_shortcut_available "$shortcut_name")"; then
    printf '%s' "$ensure_msg"
    return 1
  fi

  tmp_out="$(mktemp)"
  if [ -n "$input_text" ]; then
    tmp_in="$(mktemp)"
    printf '%s' "$input_text" > "$tmp_in"
    if ! err=$(shortcuts run "$shortcut_name" --input-path "$tmp_in" --output-path "$tmp_out" 2>&1); then
      rm -f "$tmp_out" "$tmp_in"
      printf '%s' "$err"
      return 1
    fi
  else
    if ! err=$(shortcuts run "$shortcut_name" --output-path "$tmp_out" 2>&1); then
      rm -f "$tmp_out"
      printf '%s' "$err"
      return 1
    fi
  fi

  if [ -f "$tmp_out" ]; then
    out="$(cat "$tmp_out")"
  fi
  rm -f "$tmp_out" "$tmp_in"
  printf '%s' "$out"
}

run_shortcut_operation() {
  local operation="$1"
  local shortcut_name="$2"
  local usage="$3"
  local input_text="${4:-}"
  local require_input="${5:-1}"
  local output=""
  local attempts=()
  local compact_err=""

  if [ "$require_input" = "1" ] && [ -z "$input_text" ]; then
    json_err "$usage"
    return 0
  fi

  if declare -f backend_applescript >/dev/null 2>&1; then
    if output="$(backend_applescript 2>&1)"; then
      json_ok "operation completed" "\"operation\":\"$(json_escape "$operation")\",\"backend\":\"applescript\",\"strategy\":\"applescript -> shell -> shortcut\",\"output\":\"$(json_escape "$output")\",\"attempts\":\"$(json_escape "$(join_by ' -> ' "${attempts[@]}")")\""
      return 0
    fi
    compact_err="$(printf '%s' "$output" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    if [ -z "$compact_err" ]; then
      compact_err="failed"
    fi
    attempts+=("applescript:$compact_err")
  else
    attempts+=("applescript:unsupported")
  fi

  if declare -f backend_shell >/dev/null 2>&1; then
    if output="$(backend_shell 2>&1)"; then
      json_ok "operation completed" "\"operation\":\"$(json_escape "$operation")\",\"backend\":\"shell\",\"strategy\":\"applescript -> shell -> shortcut\",\"output\":\"$(json_escape "$output")\",\"attempts\":\"$(json_escape "$(join_by ' -> ' "${attempts[@]}")")\""
      return 0
    fi
    compact_err="$(printf '%s' "$output" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    if [ -z "$compact_err" ]; then
      compact_err="failed"
    fi
    attempts+=("shell:$compact_err")
  else
    attempts+=("shell:unsupported")
  fi

  if ! output="$(run_shortcut_backend "$shortcut_name" "$input_text")"; then
    compact_err="$(printf '%s' "$output" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    if [ -z "$compact_err" ]; then
      compact_err="failed"
    fi
    attempts+=("shortcut:$compact_err")
    json_err "all backends failed" "$(json_escape "$(join_by ' -> ' "${attempts[@]}")")"
    return 0
  fi

  json_ok "operation completed" "\"operation\":\"$(json_escape "$operation")\",\"backend\":\"shortcut\",\"strategy\":\"applescript -> shell -> shortcut\",\"shortcut\":\"$(json_escape "$shortcut_name")\",\"output\":\"$(json_escape "$output")\",\"attempts\":\"$(json_escape "$(join_by ' -> ' "${attempts[@]}")")\""
}

run_fallback_operation() {
  local operation="$1"
  local strategy_desc="$2"
  shift 2

  local methods=("$@")
  local attempts=()
  local method=""
  local fn=""
  local output=""
  local compact_err=""

  for method in "${methods[@]}"; do
    fn="backend_${method}"
    if ! declare -f "$fn" >/dev/null 2>&1; then
      attempts+=("${method}:unsupported")
      continue
    fi

    if output="$($fn 2>&1)"; then
      json_ok "operation completed" "\"operation\":\"$(json_escape "$operation")\",\"backend\":\"$(json_escape "$method")\",\"strategy\":\"$(json_escape "$strategy_desc")\",\"output\":\"$(json_escape "$output")\",\"attempts\":\"$(json_escape "$(join_by ' -> ' "${attempts[@]}")")\""
      return 0
    fi

    compact_err="$(printf '%s' "$output" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
    if [ -z "$compact_err" ]; then
      compact_err="failed"
    fi
    attempts+=("${method}:$compact_err")
  done

  json_err "all backends failed" "$(json_escape "$(join_by ' -> ' "${attempts[@]}")")"
}
