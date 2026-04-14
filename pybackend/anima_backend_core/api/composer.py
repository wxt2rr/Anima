from __future__ import annotations

import json
import re
from http import HTTPStatus
from typing import Any, Dict, List

from anima_backend_shared.database import get_chat
from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import load_settings

from ..llm.adapter import call_chat_completion, create_provider
from .runs_common import extract_assistant_text

_APPEND_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z'-]{0,23}$")


def _to_plain_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    try:
        return json.dumps(content, ensure_ascii=False).strip()
    except Exception:
        return str(content).strip()


def _recent_context_messages(chat_id: str, limit: int = 4) -> List[Dict[str, str]]:
    cid = str(chat_id or "").strip()
    if not cid:
        return []
    chat = get_chat(cid)
    if not isinstance(chat, dict):
        return []
    messages = chat.get("messages")
    if not isinstance(messages, list):
        return []

    out: List[Dict[str, str]] = []
    for item in reversed(messages):
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role == "agent":
            role = "assistant"
        if role not in ("user", "assistant"):
            continue
        text = _to_plain_text(item.get("content"))
        if not text:
            continue
        out.append({"role": role, "content": text[:800]})
        if len(out) >= max(1, int(limit)):
            break
    out.reverse()
    return out


def _sanitize_single_line_text(text: str, *, limit: int = 240) -> str:
    s = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if "\n" in s:
        s = s.split("\n", 1)[0].strip()
    if len(s) > limit:
        s = s[:limit].rstrip()
    return s


def _strip_code_fence(raw: str) -> str:
    text = str(raw or "").strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if not lines:
        return text
    if lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _extract_raw_text_payload(raw: str) -> str:
    text = _strip_code_fence(raw)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            nested = obj.get("text")
            if nested is not None:
                return str(nested)
    except Exception:
        pass
    return text


def _normalize_complete_text(draft: str, raw_text: str) -> str:
    draft_s = str(draft or "")
    out = _sanitize_single_line_text(raw_text, limit=64)
    if not draft_s or not out:
        return ""

    draft_trim_end = draft_s.rstrip()
    suffix = out
    if out.startswith(draft_s):
        suffix = out[len(draft_s) :]
    elif draft_trim_end and out.startswith(draft_trim_end):
        suffix = out[len(draft_trim_end) :]

    suffix = suffix.strip()
    if not suffix:
        return ""
    token = suffix.split()[0].strip(".,!?;:，。；：")
    if not token:
        return ""
    if _APPEND_TOKEN_RE.fullmatch(token):
        return token
    return ""


def _normalize_translate_text(draft: str, raw_text: str) -> str:
    draft_s = str(draft or "").strip()
    out = _sanitize_single_line_text(raw_text, limit=240)
    if not out:
        return ""
    if out == draft_s:
        return ""
    return out


def _format_context_before_text(context: List[Dict[str, str]]) -> str:
    lines: List[str] = []
    for item in context:
        role = str(item.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = _sanitize_single_line_text(str(item.get("content") or ""), limit=160)
        if not content:
            continue
        lines.append(f"{role}: {content}")
    return " | ".join(lines)


def _build_completion_messages(*, context: List[Dict[str, str]], draft: str, tab_mode: str) -> List[Dict[str, str]]:
    mode = "translate" if str(tab_mode or "").strip().lower() == "translate" else "complete"
    if mode == "translate":
        system_text = (
            "You are an English inline translation assistant. Rewrite current_segment into concise natural English while preserving meaning."
            " Return only the rewritten text; return empty text if no change is needed."
        )
    else:
        system_text = (
            "You are an English inline completion assistant. For current_segment, return only the minimal English suffix to append."
            " Return empty text if there is no confident completion."
        )

    return [
        {"role": "system", "content": system_text},
        {
            "role": "user",
            "content": (
                f"mode: {mode}\n"
                f"context_before: {_format_context_before_text(context)}\n"
                f"current_segment: {draft}\n"
                "context_after: "
            ),
        },
    ]


def handle_post_composer_tab_complete(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return

        composer = body.get("composer")
        if not isinstance(composer, dict):
            composer = {}

        draft = str(body.get("input") or body.get("text") or "").strip()
        if not draft:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "input is required"})
            return

        tab_mode_raw = str(body.get("tabMode") or "").strip().lower()
        if tab_mode_raw in ("translate", "rewrite"):
            tab_mode = "translate"
        elif tab_mode_raw in ("complete", "completion", "append"):
            tab_mode = "complete"
        else:
            tab_mode = "complete"

        completion_enabled = bool(composer.get("completionEnabled", body.get("completionEnabled", True)))
        if not completion_enabled:
            json_response(
                handler,
                HTTPStatus.OK,
                {"ok": True, "mode": tab_mode, "text": "", "raw": "", "applied": False, "skipped": "disabled"},
            )
            return

        chat_id = str(body.get("chatId") or composer.get("chatId") or "").strip()

        context_limit_raw = body.get("contextLimit", composer.get("completionContextLimit", 4))
        try:
            context_limit = int(context_limit_raw) if context_limit_raw is not None else 4
        except Exception:
            context_limit = 4
        context_limit = max(0, min(context_limit, 12))
        context = _recent_context_messages(chat_id, limit=context_limit) if context_limit > 0 else []

        settings_obj = load_settings()
        settings_root = settings_obj.get("settings")
        if not isinstance(settings_root, dict):
            settings_root = {}
        completion_provider_id = (
            str(body.get("completionProviderId") or "").strip()
            or str(composer.get("completionProviderId") or "").strip()
            or str(settings_root.get("tabCompletionProviderId") or "").strip()
        )
        completion_model_id = (
            str(body.get("completionModelId") or "").strip()
            or str(composer.get("completionModelId") or "").strip()
            or str(settings_root.get("tabCompletionModelId") or "").strip()
        )
        provider_composer: Dict[str, Any] = composer
        if completion_provider_id:
            provider_composer = dict(composer)
            provider_composer["providerOverrideId"] = completion_provider_id
        provider = create_provider(settings_obj, provider_composer)
        if completion_provider_id or completion_model_id:
            model_override = completion_model_id or None
        else:
            model_override = str(composer.get("modelOverride") or "").strip() or None
        messages = _build_completion_messages(context=context, draft=draft, tab_mode=tab_mode)
        out = call_chat_completion(
            provider,
            messages,
            temperature=0.1,
            max_tokens=96,
            tools=None,
            tool_choice=None,
            model_override=model_override,
        )
        raw_text = extract_assistant_text(out)
        raw_payload = _extract_raw_text_payload(str(raw_text or ""))
        if tab_mode == "translate":
            text = _normalize_translate_text(draft, raw_payload)
        else:
            text = _normalize_complete_text(draft, raw_payload)
        json_response(
            handler,
            HTTPStatus.OK,
            {"ok": True, "mode": tab_mode, "text": text, "raw": str(raw_text or ""), "applied": bool(text)},
        )
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
