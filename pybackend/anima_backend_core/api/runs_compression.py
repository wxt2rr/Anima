from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional, Tuple

from anima_backend_shared.database import get_chat_meta, merge_chat_meta
from anima_backend_shared.util import now_ms, preview_json

from ..llm.adapter import call_chat_completion, call_chat_completion_stream
from ..runtime.graph import build_system_prompt_text
from .runs_common import extract_assistant_text
from .runs_common import find_message_index_by_id
from .runs_common import estimate_message_tokens
from .runs_common import estimate_tokens_text


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


def estimate_context_usage_total(
    *,
    settings_obj: Dict[str, Any],
    composer: Dict[str, Any],
    messages: List[Dict[str, Any]],
) -> int:
    usable = [m for m in messages if isinstance(m, dict) and str(m.get("role") or "") not in ("system", "tool")]
    user_msg = ""
    for m in reversed(usable):
        if str(m.get("role") or "") == "user" and isinstance(m.get("content"), str) and str(m.get("content") or "").strip():
            user_msg = str(m.get("content") or "").strip()
            break
    sys_text = build_system_prompt_text(settings_obj, composer, user_msg)
    sys_tokens = estimate_tokens_text(sys_text)
    msg_tokens = sum(estimate_message_tokens(m) for m in usable)
    return max(0, int(sys_tokens + msg_tokens))


def normalize_or_estimate_usage(
    *,
    usage: Any,
    settings_obj: Dict[str, Any],
    composer: Dict[str, Any],
    messages: List[Dict[str, Any]],
) -> Tuple[Dict[str, int], str]:
    out_usage = usage if isinstance(usage, dict) else {}
    prompt = _to_int(out_usage.get("prompt_tokens")) if isinstance(out_usage, dict) else None
    completion = _to_int(out_usage.get("completion_tokens")) if isinstance(out_usage, dict) else None
    total = _to_int(out_usage.get("total_tokens")) if isinstance(out_usage, dict) else None

    if total is None and prompt is not None and completion is not None:
        total = int(prompt + completion)

    source = "provider"
    if total is None:
        total = estimate_context_usage_total(settings_obj=settings_obj, composer=composer, messages=messages)
        prompt = int(total)
        completion = 0
        source = "estimated"

    if prompt is None:
        prompt = max(0, int(total))
    if completion is None:
        completion = max(0, int(total - prompt))

    normalized = {
        "prompt_tokens": max(0, int(prompt)),
        "completion_tokens": max(0, int(completion)),
        "total_tokens": max(0, int(total)),
    }
    return normalized, source


def build_usage_state(usage: Dict[str, int], source: str) -> Dict[str, Any]:
    total = max(0, int(usage.get("total_tokens") or 0))
    return {
        "currentTotalTokens": total,
        "source": str(source or "provider"),
        "updatedAt": now_ms(),
    }


def apply_thinking_level(
    provider: Any, composer: Dict[str, Any], extra_body: Optional[Dict[str, Any]], max_tokens: int
) -> tuple[Optional[Dict[str, Any]], int]:
    spec = getattr(provider, "_spec", None)
    provider_type = str(getattr(spec, "provider_type", "") or "").strip().lower() if spec is not None else ""
    provider_id = str(getattr(spec, "provider_id", "") or "").strip().lower() if spec is not None else ""
    base_url = str(getattr(spec, "base_url", "") or "").strip().lower() if spec is not None else ""

    level = str(composer.get("thinkingLevel") or "").strip().lower() or "default"
    if level not in ("default", "off", "low", "medium", "high", "xhigh"):
        level = "default"

    # Ollama/OpenAI-compatible实现的思考开关存在差异，这里同时下发常见字段做兼容。
    # 仅在Ollama本地端口/ID命中时启用，避免影响其他兼容提供商。
    is_ollama = provider_id.startswith("ollama") or "127.0.0.1:11434" in base_url or "localhost:11434" in base_url
    if is_ollama and level != "default":
        out_extra = dict(extra_body or {})
        effort_map = {
            "off": "none",
            "low": "low",
            "medium": "medium",
            "high": "high",
            "xhigh": "high",
        }
        effort = effort_map.get(level)
        if effort:
            out_extra["reasoning_effort"] = effort
            if effort == "none":
                out_extra["think"] = False
            else:
                out_extra["think"] = True
                out_extra["reasoning"] = {"effort": effort}
            return out_extra, max_tokens

    if provider_type != "deepseek":
        return extra_body, max_tokens

    if level == "default":
        return extra_body, max_tokens

    out_extra = dict(extra_body or {})
    if level == "off":
        out_extra["thinking"] = {"type": "disabled"}
        return out_extra, max_tokens

    out_extra["thinking"] = {"type": "enabled"}
    if level == "low":
        return out_extra, 4096
    if level == "medium":
        return out_extra, 16384
    if level == "xhigh":
        return out_extra, max_tokens
    return out_extra, max_tokens


def _build_summary_messages(prev_summary: str, chunk: List[Dict[str, Any]], focus: str = "") -> List[Dict[str, str]]:
    lines: List[str] = []
    for m in chunk:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip() or "unknown"
        content = m.get("content")
        if isinstance(content, str):
            txt = content
        else:
            try:
                txt = json.dumps(content, ensure_ascii=False)
            except Exception:
                txt = str(content)
        txt = str(txt).replace("\r\n", "\n").replace("\r", "\n").strip()
        if len(txt) > 4000:
            txt = txt[:4000] + "…"
        if txt:
            lines.append(f"{role}: {txt}")

    transcript = "\n".join(lines).strip()
    if not transcript:
        return []

    focus_line = f"额外要求：{focus}" if str(focus or "").strip() else ""
    sys_text = (
        "你正在为一个长对话做增量压缩摘要。要求："
        "1) 只保留关键事实/决定/约束/用户偏好/未完成事项；"
        "2) 不要编造；"
        "3) 尽量结构化（要点/列表）；"
        "4) 长度控制在 400-800 字。"
        + (f"\n{focus_line}" if focus_line else "")
    )
    user_text = (f"已有摘要：\n{prev_summary}\n\n" if prev_summary else "") + "新增对话片段：\n" + transcript
    return [{"role": "system", "content": sys_text}, {"role": "user", "content": user_text}]


def _summarize_incremental(
    *,
    provider: Any,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]],
    prev_summary: str,
    chunk: List[Dict[str, Any]],
    max_tokens: int,
    model_override: Optional[str],
) -> str:
    summary_messages = _build_summary_messages(prev_summary, chunk)
    if not summary_messages:
        return ""
    mo = str(model_override or "").strip() or (str(composer.get("modelOverride") or "").strip() or None)
    res = call_chat_completion(
        provider,
        summary_messages,
        temperature=0.2,
        max_tokens=max_tokens,
        tools=None,
        tool_choice=None,
        model_override=mo,
        extra_body=extra_body if isinstance(extra_body, dict) else None,
    )
    return extract_assistant_text(res)


def _summarize_incremental_stream(
    *,
    provider: Any,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]],
    prev_summary: str,
    chunk: List[Dict[str, Any]],
    max_tokens: int,
    model_override: Optional[str],
    emit_delta: Optional[Callable[[str], None]],
) -> str:
    summary_messages = _build_summary_messages(prev_summary, chunk)
    if not summary_messages:
        return ""
    mo = str(model_override or "").strip() or (str(composer.get("modelOverride") or "").strip() or None)
    acc: List[str] = []
    seen_events = 0
    sample: List[Dict[str, Any]] = []
    stream = call_chat_completion_stream(
        provider,
        summary_messages,
        temperature=0.2,
        max_tokens=max_tokens,
        tools=None,
        tool_choice=None,
        model_override=mo,
        extra_body=extra_body if isinstance(extra_body, dict) else None,
    )
    for evt in stream:
        if not isinstance(evt, dict):
            continue
        seen_events += 1
        if len(sample) < 3:
            try:
                choices = evt.get("choices")
                c0 = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
                d0 = c0.get("delta") if isinstance(c0, dict) else None
                sample.append(
                    {
                        "keys": sorted([str(k) for k in evt.keys()])[:18],
                        "type": str(evt.get("type") or ""),
                        "choices0_keys": sorted([str(k) for k in c0.keys()])[:18] if isinstance(c0, dict) else [],
                        "delta_keys": sorted([str(k) for k in d0.keys()])[:18] if isinstance(d0, dict) else [],
                    }
                )
            except Exception:
                pass

        delta_text = ""
        choices = evt.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            delta = choices[0].get("delta")
            if isinstance(delta, dict):
                if isinstance(delta.get("content"), str):
                    delta_text = str(delta.get("content") or "")
                elif isinstance(delta.get("text"), str):
                    delta_text = str(delta.get("text") or "")
        if not delta_text:
            t = str(evt.get("type") or "").strip()
            if t.endswith(".delta"):
                if isinstance(evt.get("delta"), str):
                    delta_text = str(evt.get("delta") or "")
                elif isinstance(evt.get("delta"), dict) and isinstance(evt["delta"].get("text"), str):
                    delta_text = str(evt["delta"].get("text") or "")
            elif t.endswith(".done") and isinstance(evt.get("text"), str):
                delta_text = str(evt.get("text") or "")
        if delta_text:
            acc.append(delta_text)
            if emit_delta is not None:
                try:
                    emit_delta(delta_text)
                except Exception:
                    pass

    if seen_events == 0:
        raise RuntimeError(f"compression stream returned 0 events (model={mo or ''})")
    if not acc:
        raise RuntimeError(
            f"compression stream had {seen_events} events but no text delta (model={mo or ''}) sample={preview_json(sample, max_chars=1200)}"
        )
    return "".join(acc).strip()


def apply_persistent_compression(
    *,
    chat_id: str,
    messages: List[Dict[str, Any]],
    settings_obj: Dict[str, Any],
    provider: Any,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]],
    is_manual: bool = False,
    emit_event: Optional[Callable[[Any], None]] = None,
    get_chat_meta_fn: Optional[Callable[[str], Any]] = None,
    merge_chat_meta_fn: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]]]:
    settings = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
    settings = settings if isinstance(settings, dict) else {}

    enabled = bool(settings.get("enableAutoCompression"))
    if not enabled and not is_manual:
        return messages, composer, None

    try:
        threshold_pct = int(settings.get("compressionThreshold") if settings.get("compressionThreshold") is not None else 80)
    except Exception:
        threshold_pct = 80
    threshold_pct = max(0, min(threshold_pct, 100))

    try:
        keep_recent = int(settings.get("keepRecentMessages") if settings.get("keepRecentMessages") is not None else 6)
    except Exception:
        keep_recent = 6
    keep_recent = max(2, min(keep_recent, 20))

    try:
        context_window = int(composer.get("contextWindowOverride") or 0)
    except Exception:
        context_window = 0
    if context_window <= 0:
        context_window = 128000
    context_window = max(1024, min(context_window, 400000))
    target_tokens = int(context_window * (threshold_pct / 100.0))
    target_tokens = max(512, min(target_tokens, context_window))

    _get_chat_meta = get_chat_meta_fn or get_chat_meta
    _merge_chat_meta = merge_chat_meta_fn or merge_chat_meta

    chat_meta = _get_chat_meta(chat_id) or {}
    compression = chat_meta.get("compression") if isinstance(chat_meta.get("compression"), dict) else {}
    prev_summary = str(compression.get("summary") or "").strip()
    summarized_until = str(compression.get("summarizedUntilMessageId") or "").strip()

    usable = [m for m in messages if isinstance(m, dict) and str(m.get("role") or "") not in ("system", "tool")]
    start_idx = find_message_index_by_id(usable, summarized_until)
    window_msgs = usable[start_idx + 1 :] if start_idx >= 0 else usable

    working_composer = dict(composer)
    if prev_summary and enabled:
        working_composer["historySummary"] = prev_summary
    else:
        working_composer.pop("historySummary", None)

    usage_state = chat_meta.get("usageState") if isinstance(chat_meta.get("usageState"), dict) else {}
    current_total = _to_int(usage_state.get("currentTotalTokens"))
    if current_total is None and isinstance(compression.get("usageState"), dict):
        current_total = _to_int((compression.get("usageState") or {}).get("currentTotalTokens"))

    if current_total is None and not is_manual:
        return window_msgs, working_composer, None
    if current_total is not None and current_total <= target_tokens and not is_manual:
        return window_msgs, working_composer, None
    if len(window_msgs) <= keep_recent:
        return window_msgs, working_composer, None

    dropped: List[Dict[str, Any]] = list(window_msgs[:-keep_recent]) if len(window_msgs) > keep_recent else []
    remaining: List[Dict[str, Any]] = list(window_msgs[-keep_recent:]) if len(window_msgs) > keep_recent else list(window_msgs)
    if not dropped:
        return remaining, working_composer, None

    cap = 80
    chunk = dropped[-cap:] if len(dropped) > cap else dropped
    omitted = max(0, len(dropped) - len(chunk))
    if omitted:
        chunk = [{"role": "system", "content": f"(更早的 {omitted} 条消息已省略)", "id": ""}] + chunk  # type: ignore[list-item]

    summary_max_tokens = 800
    try:
        summary_max_tokens = int(settings.get("maxTokens") or 800)
    except Exception:
        summary_max_tokens = 800
    summary_max_tokens = min(1200, max(256, summary_max_tokens))
    tool_model_override = str(settings.get("memoryToolModelId") or "").strip() or None

    if emit_event is not None:
        try:
            emit_event({"type": "compression_start", "at": now_ms(), "thresholdPct": threshold_pct, "keepRecent": keep_recent})
        except Exception:
            pass

    try:
        if emit_event is not None:
            def _emit_delta(txt: str) -> None:
                emit_event({"type": "compression_delta", "content": txt, "at": now_ms()})

            new_summary = _summarize_incremental_stream(
                provider=provider,
                composer=working_composer,
                extra_body=extra_body,
                prev_summary=prev_summary,
                chunk=chunk,
                max_tokens=summary_max_tokens,
                model_override=tool_model_override,
                emit_delta=_emit_delta,
            )
        else:
            new_summary = _summarize_incremental(
                provider=provider,
                composer=working_composer,
                extra_body=extra_body,
                prev_summary=prev_summary,
                chunk=chunk,
                max_tokens=summary_max_tokens,
                model_override=tool_model_override,
            )
        new_summary = str(new_summary or "").strip()
        if not new_summary:
            raise RuntimeError("compression summary is empty")
    except Exception as e:
        if emit_event is not None:
            try:
                err_text = str(e)
                reason = "runtime_error"
                low = err_text.lower()
                if "0 events" in low or "no text delta" in low:
                    reason = "empty_stream"
                elif "timeout" in low:
                    reason = "timeout"
                emit_event(
                    {
                        "type": "compression_end",
                        "at": now_ms(),
                        "ok": False,
                        "error": err_text,
                        "mode": "auto",
                        "recovery": {"reason": reason, "action": "skip_compression_and_continue"},
                    }
                )
            except Exception:
                pass
            return window_msgs, working_composer, None
        raise

    last_dropped_id = str((dropped[-1] or {}).get("id") or "").strip()
    next_comp = {
        "enabled": True,
        "summary": new_summary,
        "summaryUpdatedAt": now_ms(),
        "summarizedUntilMessageId": last_dropped_id,
        "keepRecentMessages": keep_recent,
        "lastCompactReason": "manual" if is_manual else "auto",
    }
    merged = _merge_chat_meta(chat_id, {"compression": next_comp})
    out_comp = merged.get("compression") if isinstance(merged.get("compression"), dict) else next_comp
    working_composer["historySummary"] = new_summary

    evt = {
        "mode": "manual" if is_manual else "auto",
        "summaryUpdatedAt": out_comp.get("summaryUpdatedAt"),
        "summarizedUntilMessageId": out_comp.get("summarizedUntilMessageId"),
        "summaryPreview": str(new_summary[:240]),
    }
    if emit_event is not None:
        try:
            emit_event({"type": "compression_end", "at": now_ms(), "ok": True, "summary": new_summary, **evt})
        except Exception:
            pass
    return remaining, working_composer, evt
