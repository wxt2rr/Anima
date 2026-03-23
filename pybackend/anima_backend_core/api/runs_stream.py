from __future__ import annotations

import json
import time
import uuid
from http import HTTPStatus
from typing import Any, Callable, Dict, List, Optional, Tuple

from anima_backend_shared.chat import ClientDisconnected, _ensure_tool_call_ids, parse_tool_args
from anima_backend_shared.constants import MAX_TOOL_STEPS
from anima_backend_shared.database import create_run, get_chat, get_chat_meta, merge_chat_meta, update_run
from anima_backend_shared.settings import load_settings
from anima_backend_shared.util import extract_reasoning_text, now_ms, preview_json, preview_tool_result

from ..llm.adapter import call_chat_completion, call_chat_completion_stream, create_provider, get_last_rate_limit
from ..tools.executor import execute_tool, make_tool_message, select_tools
from ..runtime.graph import build_system_prompt_text, inject_system_message
from ..runtime.sanitize import sanitize_history_messages

_DANGEROUS_APPROVAL_PREFIX = "ANIMA_DANGEROUS_COMMAND_APPROVAL:"


def _parse_dangerous_approval_error(message: Any) -> Optional[Dict[str, Any]]:
    text = str(message or "").strip()
    if not text.startswith(_DANGEROUS_APPROVAL_PREFIX):
        return None
    payload_text = text[len(_DANGEROUS_APPROVAL_PREFIX) :].strip()
    if not payload_text:
        return None
    try:
        obj = json.loads(payload_text)
    except Exception:
        return None
    if not isinstance(obj, dict):
        return None
    command = str(obj.get("command") or "").strip()
    if not command:
        return None
    return {
        "code": str(obj.get("code") or "").strip() or "dangerous_command_requires_approval",
        "command": command,
        "matchedPattern": str(obj.get("matchedPattern") or "").strip() or "",
    }


def _apply_thinking_level(provider: Any, composer: Dict[str, Any], extra_body: Optional[Dict[str, Any]], max_tokens: int) -> tuple[Optional[Dict[str, Any]], int]:
    spec = getattr(provider, "_spec", None)
    provider_type = str(getattr(spec, "provider_type", "") or "").strip().lower() if spec is not None else ""
    if provider_type != "deepseek":
        return extra_body, max_tokens

    level = str(composer.get("thinkingLevel") or "").strip().lower() or "default"
    if level not in ("default", "off", "low", "medium", "high"):
        level = "default"
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
    return out_extra, max_tokens


def _estimate_tokens_text(text: str) -> int:
    s = str(text or "")
    if not s:
        return 0
    ascii_count = sum(1 for ch in s if ord(ch) < 128)
    non_ascii = max(0, len(s) - ascii_count)
    return int(ascii_count / 4) + int(non_ascii / 1.6) + 4


def _estimate_message_tokens(msg: Dict[str, Any]) -> int:
    if not isinstance(msg, dict):
        return 0
    content = msg.get("content")
    if isinstance(content, str):
        return _estimate_tokens_text(content)
    try:
        return _estimate_tokens_text(json.dumps(content, ensure_ascii=False))
    except Exception:
        return _estimate_tokens_text(str(content))


def _find_message_index_by_id(messages: List[Dict[str, Any]], msg_id: str) -> int:
    target = str(msg_id or "").strip()
    if not target:
        return -1
    for i, m in enumerate(messages):
        if isinstance(m, dict) and str(m.get("id") or "").strip() == target:
            return i
    return -1


def _extract_assistant_text(obj: Any) -> str:
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

    if isinstance(obj.get("content"), str):
        return str(obj.get("content") or "").strip()

    return ""


def _summarize_incremental(
    *,
    provider: Any,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]],
    prev_summary: str,
    chunk: List[Dict[str, Any]],
    focus: str = "",
    max_tokens: int = 800,
    model_override: Optional[str] = None,
) -> str:
    lines: List[str] = []
    for m in chunk:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip() or "unknown"
        c = m.get("content")
        if isinstance(c, str):
            txt = c
        else:
            try:
                txt = json.dumps(c, ensure_ascii=False)
            except Exception:
                txt = str(c)
        txt = str(txt).replace("\r\n", "\n").replace("\r", "\n").strip()
        if len(txt) > 4000:
            txt = txt[:4000] + "…"
        if txt:
            lines.append(f"{role}: {txt}")
    transcript = "\n".join(lines).strip()
    if not transcript:
        return ""

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
    summary_messages = [{"role": "system", "content": sys_text}, {"role": "user", "content": user_text}]

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
    return _extract_assistant_text(res)


def _summarize_incremental_stream(
    *,
    provider: Any,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]],
    prev_summary: str,
    chunk: List[Dict[str, Any]],
    focus: str = "",
    max_tokens: int = 800,
    model_override: Optional[str] = None,
    emit_delta: Optional[Callable[[str], None]] = None,
) -> str:
    lines: List[str] = []
    for m in chunk:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip() or "unknown"
        c = m.get("content")
        if isinstance(c, str):
            txt = c
        else:
            try:
                txt = json.dumps(c, ensure_ascii=False)
            except Exception:
                txt = str(c)
        txt = str(txt).replace("\r\n", "\n").replace("\r", "\n").strip()
        if len(txt) > 4000:
            txt = txt[:4000] + "…"
        if txt:
            lines.append(f"{role}: {txt}")
    transcript = "\n".join(lines).strip()
    if not transcript:
        return ""

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
    summary_messages = [{"role": "system", "content": sys_text}, {"role": "user", "content": user_text}]

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
        raise RuntimeError(f"compression stream had {seen_events} events but no text delta (model={mo or ''}) sample={preview_json(sample, max_chars=1200)}")

    return "".join(acc).strip()


def _apply_persistent_compression(
    *,
    chat_id: str,
    messages: List[Dict[str, Any]],
    settings_obj: Dict[str, Any],
    provider: Any,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]],
    emit_event: Optional[Callable[[Any], None]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]]]:
    s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
    s = s if isinstance(s, dict) else {}

    enabled = bool(s.get("enableAutoCompression"))
    if not enabled:
        return messages, composer, None

    try:
        threshold_pct = int(s.get("compressionThreshold") if s.get("compressionThreshold") is not None else 80)
    except Exception:
        threshold_pct = 80
    threshold_pct = max(0, min(threshold_pct, 100))

    try:
        keep_recent = int(s.get("keepRecentMessages") if s.get("keepRecentMessages") is not None else 6)
    except Exception:
        keep_recent = 6
    keep_recent = max(2, min(keep_recent, 20))

    try:
        context_window = int(composer.get("contextWindowOverride") or 0)
    except Exception:
        context_window = 0
    if context_window <= 0:
        context_window = 8192
    context_window = max(1024, min(context_window, 400000))
    target_tokens = int(context_window * (threshold_pct / 100.0))
    target_tokens = max(512, min(target_tokens, context_window))

    chat_meta = get_chat_meta(chat_id) or {}
    comp = chat_meta.get("compression") if isinstance(chat_meta.get("compression"), dict) else {}
    prev_summary = str(comp.get("summary") or "").strip()
    summarized_until = str(comp.get("summarizedUntilMessageId") or "").strip()

    usable = [m for m in messages if isinstance(m, dict) and str(m.get("role") or "") not in ("system", "tool")]
    start_idx = _find_message_index_by_id(usable, summarized_until)
    window_msgs = usable[start_idx + 1 :] if start_idx >= 0 else usable

    working_composer = dict(composer)
    if prev_summary:
        working_composer["historySummary"] = prev_summary
    else:
        working_composer.pop("historySummary", None)

    user_msg = ""
    for m in reversed(window_msgs):
        if str(m.get("role") or "") == "user" and isinstance(m.get("content"), str) and str(m.get("content") or "").strip():
            user_msg = str(m.get("content") or "").strip()
            break
    sys_text = build_system_prompt_text(settings_obj, working_composer, user_msg)
    sys_tokens = _estimate_tokens_text(sys_text)
    msg_tokens = sum(_estimate_message_tokens(m) for m in window_msgs)
    total = sys_tokens + msg_tokens

    if total <= target_tokens:
        return window_msgs, working_composer, None

    if len(window_msgs) <= keep_recent:
        return window_msgs, working_composer, None

    dropped: List[Dict[str, Any]] = []
    remaining = list(window_msgs)
    while remaining and len(remaining) > keep_recent:
        if sys_tokens + sum(_estimate_message_tokens(m) for m in remaining) <= target_tokens:
            break
        dropped.append(remaining.pop(0))

    if not dropped:
        return remaining, working_composer, None

    cap = 80
    chunk = dropped[-cap:] if len(dropped) > cap else dropped
    omitted = max(0, len(dropped) - len(chunk))
    if omitted:
        chunk = [{"role": "system", "content": f"(更早的 {omitted} 条消息已省略)", "id": ""}] + chunk  # type: ignore[list-item]

    summary_max_tokens = 800
    try:
        summary_max_tokens = int(s.get("maxTokens") or 800)
    except Exception:
        summary_max_tokens = 800
    summary_max_tokens = min(1200, max(256, summary_max_tokens))

    if emit_event is not None:
        try:
            emit_event({"type": "compression_start", "at": now_ms(), "thresholdPct": threshold_pct, "keepRecent": keep_recent})
        except Exception:
            pass

    tool_model_override = str(s.get("memoryToolModelId") or "").strip() or None
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
                emit_event(
                    {
                        "type": "compression_end",
                        "at": now_ms(),
                        "ok": False,
                        "error": str(e),
                        "mode": "auto",
                    }
                )
            except Exception:
                pass
        return window_msgs, working_composer, None

    last_dropped_id = str((dropped[-1] or {}).get("id") or "").strip()
    now = int(__import__("time").time() * 1000)
    next_comp = {
        "enabled": True,
        "summary": new_summary,
        "summaryUpdatedAt": now,
        "summarizedUntilMessageId": last_dropped_id,
        "keepRecentMessages": keep_recent,
        "lastCompactReason": "auto",
    }
    merged = merge_chat_meta(chat_id, {"compression": next_comp})
    out_comp = merged.get("compression") if isinstance(merged.get("compression"), dict) else next_comp
    working_composer["historySummary"] = new_summary

    evt = {
        "mode": "auto",
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


def _run_tool_loop(
    *,
    provider: Any,
    prepared: List[Dict[str, Any]],
    composer: Dict[str, Any],
    settings_obj: Dict[str, Any],
    temperature: float,
    max_tokens: int,
    extra_body: Optional[Dict[str, Any]],
    emit_event: Optional[Callable[[Any], None]] = None,
) -> Dict[str, Any]:
    def _emit(obj: Any) -> None:
        if not callable(emit_event):
            return
        emit_event(obj)

    tools, mcp_index, tool_choice = select_tools(settings_obj, composer)
    try:
        spec_obj = getattr(provider, "_spec", None)
        if str(getattr(spec_obj, "provider_type", "") or "").strip().lower() == "openai_codex":
            tools = []
            tool_choice = None
    except Exception:
        pass
    mo = str(composer.get("modelOverride") or "").strip() or None

    cur, dropped_traces = sanitize_history_messages(prepared)
    traces: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []
    if dropped_traces:
        traces.extend(dropped_traces)
        for tr in dropped_traces:
            try:
                _emit({"type": "tool_trace", "trace": tr})
            except Exception:
                pass
    reasoning_parts: List[str] = []
    usage: Optional[Dict[str, Any]] = None
    final_content = ""

    def _append_reasoning(prev: str, nxt: str) -> str:
        p = str(prev or "").strip()
        n = str(nxt or "").strip()
        if not n:
            return p
        if not p:
            return n
        if p.endswith(n):
            return p
        return p + "\n\n" + n

    for step in range(MAX_TOOL_STEPS):
        try:
            _emit({"type": "stage", "stage": "model_call", "step": step})
        except Exception:
            pass

        tool_calls = None
        content = ""
        msg: Dict[str, Any] = {}
        emitted_any_delta = False
        emitted_reasoning_deltas = False

        if hasattr(provider, "chat_completion_stream"):
            content_parts: List[str] = []
            reasoning_content_parts: List[str] = []
            tool_acc: Dict[int, Dict[str, Any]] = {}
            stream_failed = False
            try:
                for evt in provider.chat_completion_stream(  # type: ignore[attr-defined]
                    cur,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    tools=tools if tools else None,
                    tool_choice=tool_choice,
                    model_override=mo,
                    extra_body=extra_body,
                ):
                    if isinstance(evt, dict) and isinstance(evt.get("usage"), dict):
                        usage = evt.get("usage")
                    choice = ((evt.get("choices") or [{}])[0]) if isinstance(evt, dict) else {}
                    delta = (choice.get("delta") or {}) if isinstance(choice, dict) else {}
                    part = delta.get("content")
                    if isinstance(part, str) and part:
                        content_parts.append(part)
                        try:
                            _emit({"type": "model_delta", "content": part, "step": step})
                            emitted_any_delta = True
                        except Exception:
                            pass
                    rc_part = delta.get("reasoning_content")
                    if isinstance(rc_part, str) and rc_part:
                        reasoning_content_parts.append(rc_part)
                        emitted_reasoning_deltas = True
                        try:
                            _emit({"type": "reasoning_delta", "content": rc_part, "step": step})
                        except Exception:
                            pass
                    tc_list = delta.get("tool_calls")
                    if isinstance(tc_list, list):
                        for tc in tc_list:
                            if not isinstance(tc, dict):
                                continue
                            idx = tc.get("index")
                            if not isinstance(idx, int):
                                continue
                            cur_tc = tool_acc.get(idx) or {"id": "", "type": "", "function": {"name": "", "arguments": ""}}
                            if isinstance(tc.get("id"), str) and tc.get("id"):
                                cur_tc["id"] = tc.get("id")
                            if isinstance(tc.get("type"), str) and tc.get("type"):
                                cur_tc["type"] = tc.get("type")
                            fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                            if isinstance(fn.get("name"), str) and fn.get("name"):
                                cur_tc["function"]["name"] = fn.get("name")
                            if isinstance(fn.get("arguments"), str) and fn.get("arguments"):
                                cur_tc["function"]["arguments"] = (cur_tc["function"].get("arguments") or "") + fn.get("arguments")
                            tool_acc[idx] = cur_tc
            except Exception:
                stream_failed = True

            if not stream_failed:
                content = "".join(content_parts)
                tool_calls = [tool_acc[i] for i in sorted(tool_acc.keys())] if tool_acc else None
                msg = {"content": content, "tool_calls": tool_calls}
                if reasoning_content_parts:
                    msg["reasoning_content"] = "".join(reasoning_content_parts)
            else:
                res = call_chat_completion(
                    provider,
                    cur,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    tools=tools if tools else None,
                    tool_choice=tool_choice,
                    model_override=mo,
                    extra_body=extra_body,
                )
                usage = res.get("usage") if isinstance(res, dict) else usage
                choice = ((res.get("choices") or [{}])[0]) if isinstance(res, dict) else {}
                msg = (choice.get("message") or {}) if isinstance(choice, dict) else {}
                tool_calls = msg.get("tool_calls")
                content = msg.get("content")
        else:
            res = call_chat_completion(
                provider,
                cur,
                temperature=temperature,
                max_tokens=max_tokens,
                tools=tools if tools else None,
                tool_choice=tool_choice,
                model_override=mo,
                extra_body=extra_body,
            )
            usage = res.get("usage") if isinstance(res, dict) else usage
            choice = ((res.get("choices") or [{}])[0]) if isinstance(res, dict) else {}
            msg = (choice.get("message") or {}) if isinstance(choice, dict) else {}
            tool_calls = msg.get("tool_calls")
            content = msg.get("content")

        extracted_reasoning = extract_reasoning_text(msg)
        if extracted_reasoning:
            reasoning = extracted_reasoning
            if not reasoning_parts or reasoning_parts[-1] != reasoning:
                reasoning_parts.append(reasoning)
                if not emitted_reasoning_deltas:
                    try:
                        _emit({"type": "reasoning_full", "content": reasoning, "step": step})
                    except Exception:
                        pass

        if isinstance(content, str) and content.strip() and not tool_calls:
            if not emitted_any_delta:
                text = content
                chunk_size = 48
                for i in range(0, len(text), max(1, chunk_size)):
                    part = text[i : i + max(1, chunk_size)]
                    try:
                        _emit({"type": "model_delta", "content": part, "step": step})
                    except Exception:
                        pass
            final_content = content
            break

        tool_calls = _ensure_tool_call_ids(tool_calls, step)
        if not tool_calls:
            if not emitted_any_delta and isinstance(content, str) and content:
                try:
                    _emit({"type": "model_delta", "content": content, "step": step})
                except Exception:
                    pass
            final_content = str(content or "")
            break

        next_messages = list(cur)
        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": str(content or ""), "tool_calls": tool_calls}
        if getattr(provider, "include_reasoning_content_in_messages", False):
            rc = msg.get("reasoning_content")
            if isinstance(rc, str) and rc.strip():
                assistant_msg["reasoning_content"] = rc
        next_messages.append(assistant_msg)

        workspace_dir = ""
        cdir = str(composer.get("workspaceDir") or "").strip()
        sdir = str(((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("workspaceDir") or "").strip()
        workspace_dir = cdir or sdir
        try:
            if workspace_dir:
                from anima_backend_shared.util import norm_abs

                workspace_dir = norm_abs(workspace_dir)
        except Exception:
            workspace_dir = ""

        for tc in tool_calls:
            tc_id = str(tc.get("id") or "")
            fn = (tc.get("function") or {}) if isinstance(tc.get("function"), dict) else {}
            fn_name = str(fn.get("name") or "").strip()
            fn_args = parse_tool_args(fn.get("arguments"))

            trace_id = f"tr_{int(time.time() * 1000)}_{len(traces)}"
            started_at = now_ms()
            try:
                _emit({"type": "stage", "stage": f"tool_start:{fn_name}", "step": step})
            except Exception:
                pass
            running_trace: Dict[str, Any] = {
                "id": trace_id,
                "toolCallId": tc_id,
                "name": fn_name,
                "status": "running",
                "startedAt": started_at,
                "argsPreview": preview_json(fn_args, max_chars=800),
            }
            try:
                _emit({"type": "tool_trace", "trace": running_trace})
            except Exception:
                pass

            tool_content, trace = execute_tool(
                fn_name,
                fn_args,
                tool_call_id=tc_id,
                workspace_dir=workspace_dir,
                composer=composer,
                mcp_index=mcp_index,
                trace_id=trace_id,
            )
            try:
                _emit({"type": "stage", "stage": f"tool_done:{fn_name}", "step": step})
            except Exception:
                pass
            if isinstance(trace, dict) and trace.get("status") != "running":
                ended_at = int(trace.get("endedAt") or now_ms())
                running_trace.update(
                    {
                        "status": trace.get("status"),
                        "endedAt": ended_at,
                        "durationMs": int(trace.get("durationMs") or max(0, ended_at - started_at)),
                        "resultPreview": trace.get("resultPreview") or preview_tool_result(tool_content, max_chars=1200),
                    }
                )
                if isinstance(trace.get("diffs"), list):
                    running_trace["diffs"] = trace.get("diffs")
                if isinstance(trace.get("error"), dict):
                    running_trace["error"] = trace.get("error")
                if isinstance(trace.get("artifacts"), list):
                    running_trace["artifacts"] = trace.get("artifacts")
                    artifacts.extend([x for x in trace.get("artifacts") if isinstance(x, dict)])

            approval_payload = _parse_dangerous_approval_error((running_trace.get("error") or {}).get("message"))
            if approval_payload:
                approval_id = str(uuid.uuid4())
                return {
                    "paused": True,
                    "approval": {
                        **approval_payload,
                        "approvalId": approval_id,
                        "toolCallId": tc_id,
                        "toolName": fn_name,
                    },
                    "pause_context": {
                        "approvalId": approval_id,
                        "approval": approval_payload,
                        "pendingToolCall": {
                            "id": tc_id,
                            "name": fn_name,
                            "args": fn_args,
                        },
                        "messages": next_messages,
                        "traces": traces,
                        "artifacts": artifacts,
                        "step": step,
                        "composer": composer,
                        "temperature": temperature,
                        "maxTokens": max_tokens,
                        "extraBody": extra_body,
                    },
                    "messages": next_messages,
                    "traces": traces,
                    "artifacts": artifacts,
                    "usage": usage,
                    "reasoning": "\n\n".join([r for r in reasoning_parts if str(r).strip()]).strip(),
                    "rate_limit": get_last_rate_limit(provider),
                }

            traces.append(running_trace)
            try:
                _emit({"type": "tool_trace", "trace": running_trace})
            except Exception:
                pass

            next_messages.append(make_tool_message(tool_call_id=tc_id, content=tool_content))

        cur, hist_dropped_traces = sanitize_history_messages(next_messages)
        if hist_dropped_traces:
            traces.extend(hist_dropped_traces)
            for tr in hist_dropped_traces:
                try:
                    _emit({"type": "tool_trace", "trace": tr})
                except Exception:
                    pass
    else:
        final_content = "Tool execution limit reached."

    rate_limit = get_last_rate_limit(provider)
    output_messages = list(cur)
    output_messages.append({"role": "assistant", "content": str(final_content or "")})

    return {
        "paused": False,
        "final_content": str(final_content or ""),
        "usage": usage,
        "traces": traces,
        "artifacts": artifacts,
        "reasoning": "\n\n".join([r for r in reasoning_parts if str(r).strip()]).strip(),
        "messages": output_messages,
        "rate_limit": rate_limit,
    }


def handle_post_runs_non_stream_via_stream_executor(body: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    run_id = str(body.get("runId") or "").strip() or str(uuid.uuid4())
    thread_id = str(body.get("threadId") or "").strip() or run_id

    messages = body.get("messages")
    use_thread_messages = bool(body.get("useThreadMessages"))
    if not isinstance(messages, list):
        if use_thread_messages:
            messages = []
        else:
            return int(HTTPStatus.BAD_REQUEST), {"ok": False, "error": "messages must be a list"}

    if use_thread_messages:
        chat = get_chat(thread_id) if thread_id else None
        history = chat.get("messages") if isinstance(chat, dict) else []
        if not isinstance(history, list):
            history = []
        history = [m for m in history if not (isinstance(m, dict) and m.get("role") == "tool")]
        tail_messages = [m for m in messages if isinstance(m, dict) and m.get("role") != "system"]
        if tail_messages and history:
            last_tail = tail_messages[-1]
            last_hist = history[-1]
            if last_tail.get("role") == last_hist.get("role") and str(last_tail.get("content") or "") == str(last_hist.get("content") or ""):
                history = history[:-1]
        messages = history + tail_messages
    else:
        messages = [m for m in messages if not (isinstance(m, dict) and m.get("role") == "system")]

    composer = body.get("composer")
    if not isinstance(composer, dict):
        composer = {}

    settings_obj = load_settings()
    provider = create_provider(settings_obj, composer)

    temperature = float(body.get("temperature") or (settings_obj.get("settings") or {}).get("temperature") or 0.7)
    max_tokens = int(body.get("maxTokens") or (settings_obj.get("settings") or {}).get("maxTokens") or 0)
    composer_max_tokens = int(composer.get("maxOutputTokens") or 0)
    if composer_max_tokens > 0:
        max_tokens = composer_max_tokens

    extra_body = composer.get("jsonConfig")
    if isinstance(extra_body, str):
        try:
            extra_body = json.loads(extra_body)
        except Exception:
            extra_body = {}
    if not isinstance(extra_body, dict):
        extra_body = None

    extra_body, max_tokens = _apply_thinking_level(provider, composer, extra_body, max_tokens)

    from anima_backend_shared.chat import apply_attachments_inline

    compression_evt = None
    if use_thread_messages and thread_id:
        messages, composer, compression_evt = _apply_persistent_compression(
            chat_id=thread_id, messages=messages, settings_obj=settings_obj, provider=provider, composer=composer, extra_body=extra_body
        )
    messages = inject_system_message(messages, settings_obj, composer)
    prepared = apply_attachments_inline(messages, composer)

    create_run(
        run_id,
        thread_id,
        {
            "messages": prepared,
            "composer": composer,
            "temperature": temperature,
            "maxTokens": max_tokens,
            "extraBody": extra_body,
        },
    )

    try:
        out = _run_tool_loop(
            provider=provider,
            prepared=prepared,
            composer=composer,
            settings_obj=settings_obj,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=extra_body,
            emit_event=None,
        )
        if bool(out.get("paused")):
            approval = out.get("approval") if isinstance(out.get("approval"), dict) else {}
            pause_context = out.get("pause_context") if isinstance(out.get("pause_context"), dict) else {}
            update_run(
                run_id,
                "paused",
                {
                    "content": "",
                    "usage": out.get("usage"),
                    "traces": out.get("traces"),
                    "artifacts": out.get("artifacts"),
                    "reasoning": out.get("reasoning") or "",
                    "messages": out.get("messages"),
                    "pauseContext": pause_context,
                },
            )
            return int(HTTPStatus.CONFLICT), {
                "ok": False,
                "code": "approval_required",
                "runId": run_id,
                "threadId": thread_id,
                "approval": approval,
            }

        update_run(
            run_id,
            "succeeded",
            {
                "content": out.get("final_content") or "",
                "usage": out.get("usage"),
                "traces": out.get("traces"),
                "artifacts": out.get("artifacts"),
                "reasoning": out.get("reasoning") or "",
                "messages": out.get("messages"),
                "compression": compression_evt,
            },
        )

        payload: Dict[str, Any] = {
            "ok": True,
            "runId": run_id,
            "threadId": thread_id,
            "content": str(out.get("final_content") or ""),
            "usage": out.get("usage"),
            "traces": out.get("traces"),
            "artifacts": out.get("artifacts"),
            "reasoning": str(out.get("reasoning") or ""),
            "backendImpl": "stream-executor",
        }
        if isinstance(compression_evt, dict) and compression_evt:
            payload["compression"] = compression_evt
        rate_limit = out.get("rate_limit")
        if isinstance(rate_limit, dict) and rate_limit:
            payload["rateLimit"] = rate_limit
        return int(HTTPStatus.OK), payload
    except Exception as e:
        try:
            update_run(run_id, "failed", {"error": str(e)})
        except Exception:
            pass
        return int(HTTPStatus.INTERNAL_SERVER_ERROR), {"ok": False, "error": str(e)}


def handle_post_runs_stream(handler: Any, body: Dict[str, Any]) -> None:
    run_id = str(body.get("runId") or "").strip() or str(uuid.uuid4())
    thread_id = str(body.get("threadId") or "").strip() or run_id

    messages = body.get("messages")
    use_thread_messages = bool(body.get("useThreadMessages"))
    if not isinstance(messages, list):
        if use_thread_messages:
            messages = []
        else:
            handler.send_response(HTTPStatus.BAD_REQUEST)
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.send_header("Content-Type", "application/json; charset=utf-8")
            handler.end_headers()
            handler.wfile.write(json.dumps({"ok": False, "error": "messages must be a list"}, ensure_ascii=False).encode("utf-8"))
            return

    if use_thread_messages:
        chat = get_chat(thread_id) if thread_id else None
        history = chat.get("messages") if isinstance(chat, dict) else []
        if not isinstance(history, list):
            history = []
        history = [m for m in history if not (isinstance(m, dict) and m.get("role") == "tool")]
        tail_messages = [m for m in messages if isinstance(m, dict) and m.get("role") != "system"]
        if tail_messages and history:
            last_tail = tail_messages[-1]
            last_hist = history[-1]
            if last_tail.get("role") == last_hist.get("role") and str(last_tail.get("content") or "") == str(last_hist.get("content") or ""):
                history = history[:-1]
        messages = history + tail_messages
    else:
        messages = [m for m in messages if not (isinstance(m, dict) and m.get("role") == "system")]

    composer = body.get("composer")
    if not isinstance(composer, dict):
        composer = {}

    settings_obj = load_settings()
    provider = create_provider(settings_obj, composer)

    temperature = float(body.get("temperature") or (settings_obj.get("settings") or {}).get("temperature") or 0.7)
    max_tokens = int(body.get("maxTokens") or (settings_obj.get("settings") or {}).get("maxTokens") or 0)
    composer_max_tokens = int(composer.get("maxOutputTokens") or 0)
    if composer_max_tokens > 0:
        max_tokens = composer_max_tokens

    extra_body = composer.get("jsonConfig")
    if isinstance(extra_body, str):
        try:
            extra_body = json.loads(extra_body)
        except Exception:
            extra_body = {}
    if not isinstance(extra_body, dict):
        extra_body = None

    extra_body, max_tokens = _apply_thinking_level(provider, composer, extra_body, max_tokens)

    from anima_backend_shared.chat import apply_attachments_inline

    handler.send_response(HTTPStatus.OK)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("X-Accel-Buffering", "no")
    handler.send_header("Connection", "keep-alive")
    handler.end_headers()

    def emit(obj: Any) -> None:
        try:
            if isinstance(obj, dict):
                obj["runId"] = run_id
                obj["threadId"] = thread_id
            data = json.dumps(obj, ensure_ascii=False)
            handler.wfile.write(f"data: {data}\n\n".encode("utf-8"))
            handler.wfile.flush()
        except Exception as e:
            raise ClientDisconnected() from e

    compression_evt = None
    if use_thread_messages and thread_id:
        messages, composer, compression_evt = _apply_persistent_compression(
            chat_id=thread_id,
            messages=messages,
            settings_obj=settings_obj,
            provider=provider,
            composer=composer,
            extra_body=extra_body,
            emit_event=emit,
        )
    messages = inject_system_message(messages, settings_obj, composer)
    prepared = apply_attachments_inline(messages, composer)
    create_run(
        run_id,
        thread_id,
        {
            "messages": prepared,
            "composer": composer,
            "temperature": temperature,
            "maxTokens": max_tokens,
            "extraBody": extra_body,
        },
    )

    def _to_sse_event(obj: Any) -> Any:
        if not isinstance(obj, dict):
            return obj
        t = obj.get("type")
        if t == "run_status":
            return {"type": "run", "status": obj.get("status")}
        if t == "model_delta":
            return {"type": "delta", "content": obj.get("content"), "step": obj.get("step")}
        if t == "tool_trace":
            return {"type": "trace", "trace": obj.get("trace")}
        if t == "run_done":
            out: Dict[str, Any] = {
                "type": "done",
                "usage": obj.get("usage"),
                "reasoning": obj.get("reasoning"),
                "traces": obj.get("traces"),
                "backendImpl": "stream-executor",
            }
            if isinstance(obj.get("artifacts"), list) and obj.get("artifacts"):
                out["artifacts"] = obj.get("artifacts")
            if isinstance(obj.get("rateLimit"), dict) and obj.get("rateLimit"):
                out["rateLimit"] = obj.get("rateLimit")
            return out
        if t == "reasoning_full":
            return {"type": "reasoning", "content": obj.get("content"), "step": obj.get("step")}
        return obj

    def emit_event(obj: Any) -> None:
        emit(_to_sse_event(obj))

    try:
        emit_event({"type": "run_status", "status": "running"})
    except ClientDisconnected:
        return
    except Exception:
        pass

    try:
        out = _run_tool_loop(
            provider=provider,
            prepared=prepared,
            composer=composer,
            settings_obj=settings_obj,
            temperature=temperature,
            max_tokens=max_tokens,
            extra_body=extra_body,
            emit_event=emit_event,
        )
        if bool(out.get("paused")):
            approval = out.get("approval") if isinstance(out.get("approval"), dict) else {}
            pause_context = out.get("pause_context") if isinstance(out.get("pause_context"), dict) else {}
            update_run(
                run_id,
                "paused",
                {
                    "content": "",
                    "usage": out.get("usage"),
                    "traces": out.get("traces"),
                    "artifacts": out.get("artifacts"),
                    "reasoning": out.get("reasoning") or "",
                    "messages": out.get("messages"),
                    "pauseContext": pause_context,
                },
            )
            try:
                emit_event(
                    {
                        "type": "approval_required",
                        "approval": approval,
                    }
                )
            except Exception:
                return
            return

        update_run(
            run_id,
            "succeeded",
            {
                "content": out.get("final_content") or "",
                "usage": out.get("usage"),
                "traces": out.get("traces"),
                "artifacts": out.get("artifacts"),
                "reasoning": out.get("reasoning") or "",
                "messages": out.get("messages"),
            },
        )

        try:
            emit_event(
                {
                    "type": "run_done",
                    "usage": out.get("usage"),
                    "reasoning": out.get("reasoning") or "",
                    "traces": out.get("traces"),
                    "artifacts": out.get("artifacts"),
                    "rateLimit": out.get("rate_limit"),
                }
            )
        except Exception:
            return
    except ClientDisconnected:
        return
    except Exception as e:
        try:
            update_run(run_id, "failed", {"error": str(e)})
        except Exception:
            pass
        try:
            emit_event({"type": "error", "error": str(e)})
        except Exception:
            return
