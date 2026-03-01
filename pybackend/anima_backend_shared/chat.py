import json
import base64
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List

from .constants import MAX_FILE_BYTES_INLINE, MAX_IMAGE_BYTES_INLINE
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
    existing_content = messages[idx].get("content")
    base_text = ""
    existing_blocks: List[Dict[str, Any]] = []
    if isinstance(existing_content, list):
        for b in existing_content:
            if isinstance(b, dict):
                existing_blocks.append(dict(b))
        for b in existing_blocks:
            if str(b.get("type") or "").strip() == "text" and isinstance(b.get("text"), str):
                base_text = b.get("text") or ""
                break
    else:
        base_text = str(existing_content or "")

    text_blocks = []
    image_blocks: List[Dict[str, Any]] = []
    for a in atts:
        if not isinstance(a, dict):
            continue
        mode = str(a.get("mode") or "inline").strip()
        if mode != "inline":
            continue
        path = str(a.get("path") or "").strip()
        if not path:
            continue
        is_abs = Path(path).is_absolute()
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
            if not candidate:
                text_blocks.append(f"- {Path(path).name}: Invalid path")
                continue
            if (not is_abs) and (not is_within(workspace_dir, candidate)):
                text_blocks.append(f"- {Path(path).name}: Path outside workspace")
                continue
            target = candidate
        else:
            if not Path(path).is_absolute():
                text_blocks.append(f"- {Path(path).name}: No workspace selected")
                continue
            target = path

        mime = mimetypes.guess_type(target)[0] or ""
        if mime.startswith("image/"):
            try:
                size = int(os.path.getsize(target))
            except Exception:
                size = 0
            if size <= 0:
                text_blocks.append(f"- {Path(path).name}: File not found")
                continue
            if size > MAX_IMAGE_BYTES_INLINE:
                text_blocks.append(f"- {Path(path).name}: Image too large to inline ({size} bytes)")
                continue
            try:
                raw = b""
                with open(target, "rb") as f:
                    raw = f.read(MAX_IMAGE_BYTES_INLINE + 1)
                if len(raw) > MAX_IMAGE_BYTES_INLINE:
                    text_blocks.append(f"- {Path(path).name}: Image too large to inline")
                    continue
                b64 = base64.b64encode(raw).decode("ascii")
                image_blocks.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
            except Exception as e:
                text_blocks.append(f"- {Path(path).name}: {str(e)}")
            continue

        try:
            text, meta = read_text_file(target, max_bytes=MAX_FILE_BYTES_INLINE)
        except Exception as e:
            text_blocks.append(f"- {Path(path).name}: {str(e)}")
            continue
        title = Path(meta.get("path") or path).name
        text_blocks.append(f"File: {title}\n\n{text}")

    if not text_blocks and not image_blocks:
        return messages

    addon = ""
    if text_blocks:
        addon = "\n\nAttachments:\n\n" + "\n\n---\n\n".join(text_blocks)

    next_messages = [dict(m) for m in messages]
    combined_text = base_text + addon

    if image_blocks:
        content_blocks = []
        content_blocks.append({"type": "text", "text": combined_text})
        content_blocks.extend(image_blocks)
        next_messages[idx] = {**next_messages[idx], "content": content_blocks}
    else:
        next_messages[idx] = {**next_messages[idx], "content": combined_text}
    return next_messages
