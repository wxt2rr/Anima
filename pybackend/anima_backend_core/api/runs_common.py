from __future__ import annotations

import json
from typing import Any, Dict, List


def estimate_tokens_text(text: str) -> int:
    s = str(text or "")
    if not s:
        return 0
    ascii_count = sum(1 for ch in s if ord(ch) < 128)
    non_ascii = max(0, len(s) - ascii_count)
    return int(ascii_count / 4) + int(non_ascii / 1.6) + 4


def estimate_message_tokens(msg: Dict[str, Any]) -> int:
    if not isinstance(msg, dict):
        return 0
    content = msg.get("content")
    if isinstance(content, str):
        return estimate_tokens_text(content)
    try:
        return estimate_tokens_text(json.dumps(content, ensure_ascii=False))
    except Exception:
        return estimate_tokens_text(str(content))


def find_message_index_by_id(messages: List[Dict[str, Any]], msg_id: str) -> int:
    target = str(msg_id or "").strip()
    if not target:
        return -1
    for i, m in enumerate(messages):
        if isinstance(m, dict) and str(m.get("id") or "").strip() == target:
            return i
    return -1


def extract_assistant_text(obj: Any) -> str:
    if not isinstance(obj, dict):
        return ""

    choices = obj.get("choices")
    if isinstance(choices, list) and choices:
        c0 = choices[0] if isinstance(choices[0], dict) else {}
        msg = c0.get("message") if isinstance(c0, dict) else None
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            return str(msg.get("content") or "").strip()

    if isinstance(obj.get("output_text"), str):
        return str(obj.get("output_text") or "").strip()

    out = obj.get("output")
    if isinstance(out, list) and out:
        parts: List[str] = []
        for it in out:
            if not isinstance(it, dict):
                continue
            if str(it.get("type") or "").strip() != "message":
                continue
            content = it.get("content")
            if isinstance(content, str):
                if content.strip():
                    parts.append(content.strip())
                continue
            if isinstance(content, list):
                for blk in content:
                    if not isinstance(blk, dict):
                        continue
                    t = str(blk.get("type") or "").strip()
                    if t not in ("output_text", "text"):
                        continue
                    txt = blk.get("text")
                    if isinstance(txt, str) and txt.strip():
                        parts.append(txt)
        return "\n".join(parts).strip()

    msg = obj.get("message")
    if isinstance(msg, dict) and isinstance(msg.get("content"), str):
        return str(msg.get("content") or "").strip()

    c = obj.get("content")
    if isinstance(c, str):
        return c.strip()
    return ""
