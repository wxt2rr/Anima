from __future__ import annotations

import os
import re
from typing import Any, Dict

from .errors import McpConfigError

_VAR_PATTERN = re.compile(r"\$\{([^}]+)\}")


class VariableResolver:
    def __init__(self, *, inputs: Dict[str, str] | None = None, env: Dict[str, str] | None = None) -> None:
        self._inputs = dict(inputs or {})
        self._env = dict(env or os.environ)

    def resolve_string(self, value: str) -> str:
        raw = str(value or "")

        def _replace(match: re.Match[str]) -> str:
            expr = str(match.group(1) or "").strip()
            if not expr:
                return ""
            if expr.startswith("input:"):
                key = expr[6:].strip()
                if key not in self._inputs:
                    raise McpConfigError(f"Missing required input variable: {key}")
                return str(self._inputs.get(key) or "")
            if expr.startswith("env:"):
                key = expr[4:].strip()
                return str(self._env.get(key) or "")
            if ":-" in expr:
                key, default = expr.split(":-", 1)
                key = key.strip()
                if not key:
                    return default
                val = self._env.get(key)
                return str(val if val is not None and str(val) != "" else default)
            return str(self._env.get(expr) or "")

        return _VAR_PATTERN.sub(_replace, raw)

    def resolve_string_map(self, data: Dict[str, Any] | None) -> Dict[str, str]:
        if not isinstance(data, dict):
            return {}
        out: Dict[str, str] = {}
        for k, v in data.items():
            out[str(k)] = self.resolve_string(str(v or ""))
        return out
