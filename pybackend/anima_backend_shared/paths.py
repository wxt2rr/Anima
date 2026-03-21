from __future__ import annotations

import os
import sys
from pathlib import Path

from .constants import APP_NAME


def config_root_by_platform() -> Path:
    if sys.platform.startswith("win"):
        appdata = str(os.environ.get("APPDATA") or "").strip()
        if appdata:
            return Path(appdata) / APP_NAME
        return Path.home() / "AppData" / "Roaming" / APP_NAME
    return Path.home() / ".config" / APP_NAME

