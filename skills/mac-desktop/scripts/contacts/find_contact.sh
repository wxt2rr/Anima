#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
shortcut="${MAC_SHORTCUT_CONTACTS_FIND:-MacDesktop.Contacts.Find}"
payload="${1:-}"
if [ -z "$payload" ]; then
  echo '{"ok":false,"error":"usage: find_contact.sh <keywordOrJson>"}'
  exit 0
fi
bash "$ROOT_DIR/shortcuts/run_shortcut.sh" "$shortcut" "$payload"
