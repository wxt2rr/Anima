from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


def _to_scope(value: Any) -> str:
    s = str(value or "").strip().lower()
    if s in ("workspace", "global", "auto"):
        return s
    return ""


def _has_any(text: str, words: List[str]) -> bool:
    t = str(text or "").lower()
    if not t:
        return False
    for w in words:
        if w and w in t:
            return True
    return False


def _looks_like_project_content(text: str) -> bool:
    t = str(text or "")
    if not t:
        return False
    if re.search(r"(?:^|[\s`'\"])(?:src/|app/|docs/|tests?/|package\.json|pyproject\.toml|go\.mod|Cargo\.toml)(?:[\s`'\"]|$)", t, flags=re.I):
        return True
    if re.search(r"\b(?:bug|fix|pr|mr|commit|branch|repo|workspace|build|deploy|ticket)\b", t, flags=re.I):
        return True
    if re.search(r"(项目|工作区|仓库|分支|提交|需求|代码|接口|测试|发布|部署|目录|路径)", t):
        return True
    return False


def _looks_like_global_content(text: str) -> bool:
    t = str(text or "")
    if not t:
        return False
    if re.search(r"\b(?:preference|prefer|habit|personality|timezone|language|name|identity|profile|long[- ]?term)\b", t, flags=re.I):
        return True
    if re.search(r"(偏好|习惯|称呼|身份|职业|时区|语言|长期|喜欢|讨厌|风格|口头禅|个人信息)", t):
        return True
    return False


def decide_memory_scope(
    *,
    requested_scope: Any,
    content: str,
    memory_type: str,
    tags: Optional[List[str]],
    workspace_dir: str,
    settings_obj: Dict[str, Any],
) -> Tuple[str, str]:
    st = settings_obj if isinstance(settings_obj, dict) else {}
    auto_enabled = bool(st.get("memoryScopeAutoEnabled", False))
    default_scope = _to_scope(st.get("memoryDefaultWriteScope")) or "workspace"
    req = _to_scope(requested_scope)
    if req in ("workspace", "global"):
        return req, "explicit_scope"
    if not auto_enabled:
        return default_scope, "auto_disabled_default_scope"

    mt = str(memory_type or "semantic").strip().lower()
    joined_tags = " ".join([str(x or "").strip() for x in (tags or []) if str(x or "").strip()])
    text = f"{content}\n{joined_tags}".strip()

    if mt in ("working", "episodic"):
        return "workspace", f"type_{mt}"

    project_hit = _looks_like_project_content(text)
    global_hit = _looks_like_global_content(text)

    if project_hit and not global_hit:
        return "workspace", "project_signal"
    if global_hit and not project_hit:
        return "global", "global_signal"
    if project_hit and global_hit:
        if str(workspace_dir or "").strip():
            return "workspace", "mixed_signal_workspace_preferred"
        return "global", "mixed_signal_no_workspace"

    if default_scope == "workspace" and not str(workspace_dir or "").strip():
        global_enabled = bool(st.get("memoryGlobalEnabled", False))
        global_write_enabled = bool(st.get("memoryGlobalWriteEnabled", True))
        if global_enabled and global_write_enabled:
            return "global", "default_workspace_but_no_workspace_fallback_global"
    return default_scope, "default_scope"
