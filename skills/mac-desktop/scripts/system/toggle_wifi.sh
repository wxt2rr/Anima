#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/json.sh"
state="${1:-}"
if [ -z "$state" ]; then
  json_err "usage: toggle_wifi.sh <on|off>"
  exit 0
fi
if [ "$state" != "on" ] && [ "$state" != "off" ]; then
  json_err "state must be on or off"
  exit 0
fi
if ! command -v networksetup >/dev/null 2>&1; then
  json_err "networksetup command not found"
  exit 0
fi
iface="$(networksetup -listallhardwareports | awk '/Wi-Fi|AirPort/{getline; print $2; exit}')"
if [ -z "$iface" ]; then
  json_err "wifi interface not found"
  exit 0
fi
if networksetup -setairportpower "$iface" "$state" >/dev/null 2>&1; then
  json_ok "wifi updated" "\"interface\":\"$(json_escape "$iface")\",\"state\":\"$state\""
else
  json_err "failed to update wifi"
fi
