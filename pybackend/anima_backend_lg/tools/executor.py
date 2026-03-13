from __future__ import annotations

import json
import mimetypes
import os
import time
from typing import Any, Dict, List, Optional, Tuple, Union

from anima_backend_shared.tools import builtin_tools as legacy_builtin_tools
from anima_backend_shared.tools import execute_builtin_tool, execute_mcp_tool, mcp_tools as legacy_mcp_tools
from anima_backend_shared.util import is_within, norm_abs, now_ms, preview_json, preview_tool_result


def _sanitize_artifacts(
    artifacts: Any,
    *,
    workspace_dir: str,
    tool_name: str,
    tool_call_id: str,
    trace_id: str,
) -> List[Dict[str, Any]]:
    if not isinstance(artifacts, list) or not artifacts:
        return []
    wdir = str(workspace_dir or "").strip()
    if not wdir:
        return []
    try:
        wdir = norm_abs(wdir)
    except Exception:
        return []

    out: List[Dict[str, Any]] = []
    for i, a in enumerate(artifacts):
        if not isinstance(a, dict):
            continue
        kind = str(a.get("kind") or "").strip()
        if kind not in ("image", "video", "file"):
            continue
        raw_path = str(a.get("path") or "").strip()
        if not raw_path:
            continue
        p = raw_path
        if not os.path.isabs(p):
            p = os.path.join(wdir, p)
        try:
            ap = norm_abs(p)
        except Exception:
            continue
        if not is_within(wdir, ap):
            continue
        if not os.path.isfile(ap):
            continue

        try:
            size_bytes = int(os.path.getsize(ap))
        except Exception:
            size_bytes = 0
        mime = str(a.get("mime") or "").strip() or (mimetypes.guess_type(ap)[0] or "")
        if kind == "image" and not mime:
            mime = "image/png"
        if kind == "video" and not mime:
            mime = "video/mp4"

        item: Dict[str, Any] = {
            "id": str(a.get("id") or "").strip() or f"ar_{int(time.time() * 1000)}_{i}",
            "kind": kind,
            "path": ap,
            "mime": mime,
            "sizeBytes": size_bytes,
        }
        title = str(a.get("title") or "").strip()
        caption = str(a.get("caption") or "").strip()
        if title:
            item["title"] = title
        if caption:
            item["caption"] = caption
        item["source"] = {"toolName": tool_name, "toolCallId": tool_call_id, "traceId": trace_id}
        out.append(item)
    return out


def tool_mode(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> str:
    mode = composer.get("toolMode")
    if isinstance(mode, str) and mode.strip():
        return mode.strip()
    s = (settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}
    m = s.get("defaultToolMode")
    return str(m or "auto")


def select_tools(
    settings_obj: Dict[str, Any], composer: Dict[str, Any]
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], Union[str, Dict[str, Any], None]]:
    mode = tool_mode(settings_obj, composer)
    builtin = legacy_builtin_tools()
    cron_allowed = False
    try:
        s = settings_obj.get("settings")
        if not isinstance(s, dict):
            s = {}
        cron = s.get("cron")
        if not isinstance(cron, dict):
            cron = {}
        cron_allowed = bool(cron.get("allowAgentManage"))
    except Exception:
        cron_allowed = False
    if not cron_allowed:
        builtin = [t for t in builtin if str(((t.get("function") or {}) if isinstance(t, dict) else {}).get("name") or "") not in ("cron_list", "cron_upsert", "cron_delete", "cron_run")]
    mcp, mcp_index = legacy_mcp_tools(settings_obj, composer)
    all_tools = builtin + mcp

    if mode == "disabled":
        return [], {}, None
    if mode == "all":
        return all_tools, mcp_index, "auto"

    enabled_ids = composer.get("enabledToolIds")
    if enabled_ids is None:
        enabled_ids = ((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("toolsEnabledIds") or []
    enabled = set([str(x) for x in enabled_ids]) if isinstance(enabled_ids, list) else set()
    if not enabled:
        return all_tools, mcp_index, "auto"

    filtered = []
    for t in all_tools:
        fn = ((t.get("function") or {}) if isinstance(t, dict) else {}).get("name")
        if isinstance(fn, str) and fn in enabled:
            filtered.append(t)
    return filtered, mcp_index, "auto"


def execute_tool(
    tool_name: str,
    args: Dict[str, Any],
    *,
    tool_call_id: str,
    workspace_dir: str,
    composer: Optional[Dict[str, Any]] = None,
    mcp_index: Dict[str, Dict[str, Any]],
    trace_id: Optional[str] = None,
) -> Tuple[str, Dict[str, Any]]:
    if not trace_id:
        trace_id = f"tr_{int(time.time() * 1000)}"
    started_at = now_ms()
    trace: Dict[str, Any] = {
        "id": trace_id,
        "toolCallId": tool_call_id,
        "name": tool_name,
        "status": "running",
        "startedAt": started_at,
        "argsPreview": preview_json(args, max_chars=800),
    }

    try:
        if tool_name.startswith("mcp__"):
            out = execute_mcp_tool(tool_name, args, mcp_index)
        else:
            mode = str(((composer or {}).get("permissionMode") or "workspace_whitelist")).strip() or "workspace_whitelist"
            tool_args = dict(args or {})
            tool_args["_animaPermissionMode"] = mode
            approvals = (composer or {}).get("dangerousCommandApprovals")
            if isinstance(approvals, list):
                tool_args["_animaDangerousCommandApprovals"] = [str(x) for x in approvals if str(x).strip()]
            if bool((composer or {}).get("dangerousCommandAllowForThread")):
                tool_args["_animaDangerousCommandAllowForThread"] = True
            out = execute_builtin_tool(tool_name, tool_args, workspace_dir=workspace_dir)
        tool_content = out
        ended_at = now_ms()
        trace.update(
            {
                "status": "succeeded",
                "endedAt": ended_at,
                "durationMs": max(0, ended_at - started_at),
                "resultPreview": preview_tool_result(tool_content, max_chars=1200),
            }
        )
        try:
            res_json = json.loads(tool_content)
            if isinstance(res_json, dict) and "diffs" in res_json:
                trace["diffs"] = res_json["diffs"]
            if isinstance(res_json, dict) and "artifacts" in res_json:
                trace["artifacts"] = _sanitize_artifacts(
                    res_json.get("artifacts"),
                    workspace_dir=workspace_dir,
                    tool_name=tool_name,
                    tool_call_id=tool_call_id,
                    trace_id=trace_id,
                )
        except Exception:
            pass
        return tool_content, trace
    except Exception as e:
        tool_content = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)
        ended_at = now_ms()
        trace.update(
            {
                "status": "failed",
                "endedAt": ended_at,
                "durationMs": max(0, ended_at - started_at),
                "error": {"message": str(e)},
                "resultPreview": preview_tool_result(tool_content, max_chars=1200),
            }
        )
        return tool_content, trace


def make_tool_message(*, tool_call_id: str, content: str) -> Dict[str, Any]:
    return {"role": "tool", "content": content, "tool_call_id": tool_call_id}
