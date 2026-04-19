from __future__ import annotations

from typing import Any, Dict, List, Optional

from anima_backend_shared.util import norm_abs


def normalize_permission_mode(value: Any) -> str:
    return "full_access" if str(value or "").strip() == "full_access" else "workspace_whitelist"


def resolve_workspace_dir(*, composer: Optional[Dict[str, Any]], settings_obj: Optional[Dict[str, Any]]) -> str:
    c = composer if isinstance(composer, dict) else {}
    s = settings_obj if isinstance(settings_obj, dict) else {}
    raw = str(c.get("workspaceDir") or "").strip()
    if not raw:
        ss = s.get("settings")
        if isinstance(ss, dict):
            raw = str(ss.get("workspaceDir") or "").strip()
    if not raw:
        return ""
    try:
        return norm_abs(raw)
    except Exception:
        return ""


def resolve_workspace_roots(*, composer: Optional[Dict[str, Any]], settings_obj: Optional[Dict[str, Any]]) -> List[str]:
    c = composer if isinstance(composer, dict) else {}
    s = settings_obj if isinstance(settings_obj, dict) else {}
    out: List[str] = []
    seen = set()

    raw_roots = c.get("workspaceRoots")
    if isinstance(raw_roots, list):
        for item in raw_roots:
            raw = str(item or "").strip()
            if not raw:
                continue
            try:
                ap = norm_abs(raw)
            except Exception:
                continue
            if ap in seen:
                continue
            seen.add(ap)
            out.append(ap)

    base = resolve_workspace_dir(composer=c, settings_obj=s)
    if base and base not in seen:
        out.insert(0, base)

    return out


def normalize_composer_sandbox_fields(*, composer: Optional[Dict[str, Any]], settings_obj: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    c = dict(composer) if isinstance(composer, dict) else {}
    c["permissionMode"] = normalize_permission_mode(c.get("permissionMode"))
    c["workspaceDir"] = resolve_workspace_dir(composer=c, settings_obj=settings_obj)
    c["workspaceRoots"] = resolve_workspace_roots(composer=c, settings_obj=settings_obj)
    approvals = c.get("dangerousCommandApprovals")
    if isinstance(approvals, list):
        out = []
        seen = set()
        for item in approvals:
            cmd = str(item or "").strip()
            if not cmd:
                continue
            key = cmd.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(cmd)
        c["dangerousCommandApprovals"] = out
    c["dangerousCommandAllowForThread"] = bool(c.get("dangerousCommandAllowForThread"))
    return c
