import json
from pathlib import Path
from typing import Any, Dict, List

from .constants import MAX_FILE_BYTES_INLINE
from .util import is_within, norm_abs, read_text_file


class ClientDisconnected(Exception):
    pass


def parse_tool_args(arg_text: Any) -> Dict[str, Any]:
    if isinstance(arg_text, dict):
        return arg_text
    if not isinstance(arg_text, str):
        return {}
    s = arg_text.strip()
    if not s:
        return {}
    try:
        v = json.loads(s)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _ensure_tool_call_ids(tool_calls: Any, step: int) -> List[Dict[str, Any]]:
    if not isinstance(tool_calls, list):
        return []
    out: List[Dict[str, Any]] = []
    for i, tc in enumerate(tool_calls):
        if not isinstance(tc, dict):
            continue
        next_tc = dict(tc)
        tc_id = next_tc.get("id")
        if not isinstance(tc_id, str) or not tc_id.strip():
            next_tc["id"] = f"call_{step}_{i}"
        tc_type = next_tc.get("type")
        if not isinstance(tc_type, str) or not tc_type.strip():
            next_tc["type"] = "function"
        fn = next_tc.get("function")
        if not isinstance(fn, dict):
            next_tc["function"] = {"name": "", "arguments": ""}
        else:
            next_fn = dict(fn)
            if not isinstance(next_fn.get("name"), str):
                next_fn["name"] = str(next_fn.get("name") or "")
            if not isinstance(next_fn.get("arguments"), str):
                next_fn["arguments"] = str(next_fn.get("arguments") or "")
            next_tc["function"] = next_fn
        out.append(next_tc)
    return out


def apply_attachments_inline(messages: List[Dict[str, Any]], composer: Dict[str, Any]) -> List[Dict[str, Any]]:
    atts = composer.get("attachments")
    if not isinstance(atts, list) or not atts:
        return messages
    workspace_dir = str(composer.get("workspaceDir") or "").strip()
    if workspace_dir:
        try:
            workspace_dir = norm_abs(workspace_dir)
        except Exception:
            workspace_dir = ""
    idx = None
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "user":
            idx = i
            break
    if idx is None:
        return messages
    user_content = str(messages[idx].get("content") or "")
    blocks = []
    for a in atts:
        if not isinstance(a, dict):
            continue
        mode = str(a.get("mode") or "inline").strip()
        if mode != "inline":
            continue
        path = str(a.get("path") or "").strip()
        if not path:
            continue
        target = ""
        if workspace_dir:
            p = Path(path)
            if p.is_absolute():
                try:
                    candidate = norm_abs(str(p))
                except Exception:
                    candidate = ""
            else:
                try:
                    candidate = norm_abs(str(Path(workspace_dir) / path))
                except Exception:
                    candidate = ""
            if candidate and is_within(workspace_dir, candidate):
                target = candidate
            else:
                blocks.append(f"- {Path(path).name}: Path outside workspace")
                continue
        else:
            if not Path(path).is_absolute():
                blocks.append(f"- {Path(path).name}: No workspace selected")
                continue
            target = path
        try:
            text, meta = read_text_file(target, max_bytes=MAX_FILE_BYTES_INLINE)
        except Exception as e:
            blocks.append(f"- {Path(path).name}: {str(e)}")
            continue
        title = Path(meta.get("path") or path).name
        blocks.append(f"File: {title}\n\n{text}")
    if not blocks:
        return messages
    addon = "\n\nAttachments:\n\n" + "\n\n---\n\n".join(blocks)
    next_messages = [dict(m) for m in messages]
    next_messages[idx] = {**next_messages[idx], "content": user_content + addon}
    return next_messages
