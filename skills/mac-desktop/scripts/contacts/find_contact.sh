#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/common/operation.sh"
shortcut="${MAC_SHORTCUT_CONTACTS_FIND:-MacDesktop.Contacts.Find}"
run_shortcut_operation "contacts.find_contact" "$shortcut" "usage: find_contact.sh <keywordOrJson>" "${1:-}" 1
