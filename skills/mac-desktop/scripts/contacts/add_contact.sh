#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_CONTACTS_ADD:-MacDesktop.Contacts.Add}"
run_shortcut_operation "contacts.add_contact" "$shortcut" "usage: add_contact.sh <jsonPayload>" "${1:-}" 1
