from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Tuple

from anima_backend_shared.database import get_chat


def prepare_messages_for_run(
    raw_messages: Any, use_thread_messages: bool, thread_id: str, chat_loader: Optional[Callable[[str], Any]] = None
) -> List[Dict[str, Any]]:
    messages = raw_messages
    if not isinstance(messages, list):
        if use_thread_messages:
            messages = []
        else:
            raise ValueError("messages must be a list")

    if use_thread_messages:
        loader = chat_loader or get_chat
        chat = loader(thread_id) if thread_id else None
        history = chat.get("messages") if isinstance(chat, dict) else []
        if not isinstance(history, list):
            history = []
        history = [m for m in history if isinstance(m, dict) and m.get("role") != "tool"]
        tail = [m for m in messages if isinstance(m, dict) and m.get("role") != "system"]
        if tail and history:
            last_tail = tail[-1]
            last_hist = history[-1]
            if last_tail.get("role") == last_hist.get("role") and str(last_tail.get("content") or "") == str(last_hist.get("content") or ""):
                history = history[:-1]
        return history + tail

    return [m for m in messages if isinstance(m, dict) and m.get("role") != "system"]


def parse_json_config(composer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    extra_body = composer.get("jsonConfig")
    if isinstance(extra_body, str):
        try:
            extra_body = json.loads(extra_body)
        except Exception:
            extra_body = {}
    if not isinstance(extra_body, dict):
        return None
    return extra_body


def resolve_runtime_options(
    *,
    body: Dict[str, Any],
    composer: Dict[str, Any],
    settings_obj: Dict[str, Any],
    fallback_temperature: Optional[float] = None,
    fallback_max_tokens: Optional[int] = None,
) -> Tuple[float, int, Optional[Dict[str, Any]]]:
    settings = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
    settings = settings if isinstance(settings, dict) else {}

    temperature = float(body.get("temperature") or fallback_temperature or settings.get("temperature") or 0.7)
    max_tokens = int(body.get("maxTokens") or fallback_max_tokens or settings.get("maxTokens") or 0)
    composer_max_tokens = int(composer.get("maxOutputTokens") or 0)
    if composer_max_tokens > 0:
        max_tokens = composer_max_tokens
    extra_body = parse_json_config(composer)
    return temperature, max_tokens, extra_body
