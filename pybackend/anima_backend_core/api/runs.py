from __future__ import annotations

import json
import uuid
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Tuple

from anima_backend_shared.chat import apply_attachments_inline
from anima_backend_shared.database import create_run, get_chat, get_chat_meta, merge_chat_meta, get_run, update_run
from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import load_settings
from anima_backend_shared.util import now_ms, preview_json

from ..llm.adapter import create_provider
from ..runtime.graph import build_system_prompt_text, inject_system_message
from ..tools.executor import execute_tool, make_tool_message, select_tools
from .runs_stream import _run_tool_loop, handle_post_runs_non_stream_via_stream_executor


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
        import json

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
                import json

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

    from ..llm.adapter import call_chat_completion

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


def _apply_persistent_compression(
    *,
    chat_id: str,
    messages: List[Dict[str, Any]],
    settings_obj: Dict[str, Any],
    provider: Any,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]],
    is_manual: bool = False,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]]]:
    s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
    s = s if isinstance(s, dict) else {}

    enabled = bool(s.get("enableAutoCompression"))
    if not enabled and not is_manual:
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
    if prev_summary and enabled:
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

    if total <= target_tokens and not is_manual:
        return window_msgs, working_composer, None

    if len(window_msgs) <= keep_recent:
        return window_msgs, working_composer, None

    dropped: List[Dict[str, Any]] = []
    remaining = list(window_msgs)
    while remaining and len(remaining) > keep_recent:
        if sys_tokens + sum(_estimate_message_tokens(m) for m in remaining) <= target_tokens and not is_manual:
            break
        dropped.append(remaining.pop(0))
        if is_manual and len(remaining) <= keep_recent:
            break

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

    tool_model_override = str(s.get("memoryToolModelId") or "").strip() or None
    new_summary = _summarize_incremental(
        provider=provider,
        composer=working_composer,
        extra_body=extra_body,
        prev_summary=prev_summary,
        chunk=chunk,
        max_tokens=summary_max_tokens,
        model_override=tool_model_override,
    )
    if not new_summary:
        return remaining, working_composer, None

    last_dropped_id = str((dropped[-1] or {}).get("id") or "").strip()
    now_ms = int(__import__("time").time() * 1000)
    next_comp = {
        "enabled": True,
        "summary": new_summary,
        "summaryUpdatedAt": now_ms,
        "summarizedUntilMessageId": last_dropped_id,
        "keepRecentMessages": keep_recent,
        "lastCompactReason": "manual" if is_manual else "auto",
    }
    merged = merge_chat_meta(chat_id, {"compression": next_comp})
    out_comp = merged.get("compression") if isinstance(merged.get("compression"), dict) else next_comp
    working_composer["historySummary"] = new_summary

    evt = {
        "mode": "manual" if is_manual else "auto",
        "summaryUpdatedAt": out_comp.get("summaryUpdatedAt"),
        "summarizedUntilMessageId": out_comp.get("summarizedUntilMessageId"),
        "summaryPreview": str(new_summary[:240]),
    }
    return remaining, working_composer, evt


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


def handle_post_runs_non_stream(body: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    return handle_post_runs_non_stream_via_stream_executor(body)


def handle_get_run(handler: Any, run_id: str) -> None:
    try:
        run = get_run(run_id)
        if run:
            json_response(handler, HTTPStatus.OK, {"ok": True, "run": run})
        else:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Run not found"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_run_resume(handler: Any, run_id: str) -> None:
    q = getattr(handler, "query", None) or {}
    stream = q.get("stream") == "1"

    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return

        run = get_run(run_id)
        if not run:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Run not found"})
            return

        if str(run.get("status") or "").strip() == "paused":
            run_output = run.get("output") if isinstance(run.get("output"), dict) else {}
            pause_ctx = run_output.get("pauseContext") if isinstance(run_output.get("pauseContext"), dict) else {}
            pending = pause_ctx.get("pendingToolCall") if isinstance(pause_ctx.get("pendingToolCall"), dict) else {}
            approval = pause_ctx.get("approval") if isinstance(pause_ctx.get("approval"), dict) else {}
            approval_id = str(pause_ctx.get("approvalId") or "").strip()
            req_approval_id = str(body.get("approvalId") or "").strip()
            if approval_id and req_approval_id and approval_id != req_approval_id:
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "approvalId mismatch"})
                return
            tool_call_id = str(pending.get("id") or "").strip()
            tool_name = str(pending.get("name") or "").strip()
            tool_args = pending.get("args") if isinstance(pending.get("args"), dict) else {}
            if not tool_call_id or not tool_name:
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid paused run context"})
                return

            decision = str(body.get("decision") or "approve_once").strip()
            if decision not in ("approve_once", "approve_thread", "reject"):
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid decision"})
                return

            paused_messages = pause_ctx.get("messages")
            if not isinstance(paused_messages, list):
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid paused messages"})
                return
            paused_traces = pause_ctx.get("traces") if isinstance(pause_ctx.get("traces"), list) else []
            paused_artifacts = pause_ctx.get("artifacts") if isinstance(pause_ctx.get("artifacts"), list) else []

            composer = pause_ctx.get("composer") if isinstance(pause_ctx.get("composer"), dict) else {}
            if not isinstance(composer, dict):
                composer = {}
            req_composer = body.get("composer")
            if isinstance(req_composer, dict):
                composer = {**composer, **req_composer}

            command = str(approval.get("command") or "").strip()
            if decision == "approve_thread":
                composer["dangerousCommandAllowForThread"] = True
            elif decision == "approve_once" and command:
                arr = composer.get("dangerousCommandApprovals")
                approvals = [str(x).strip() for x in (arr if isinstance(arr, list) else []) if str(x).strip()]
                if command not in approvals:
                    approvals.append(command)
                composer["dangerousCommandApprovals"] = approvals

            settings_obj = load_settings()
            provider = create_provider(settings_obj, composer)
            temperature = float(
                body.get("temperature")
                or pause_ctx.get("temperature")
                or (run.get("input") or {}).get("temperature")
                or (settings_obj.get("settings") or {}).get("temperature")
                or 0.7
            )
            max_tokens = int(
                body.get("maxTokens")
                or pause_ctx.get("maxTokens")
                or (run.get("input") or {}).get("maxTokens")
                or (settings_obj.get("settings") or {}).get("maxTokens")
                or 0
            )
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

            thread_id = run.get("threadId") or run_id
            workspace_dir = str(composer.get("workspaceDir") or "").strip()
            if not workspace_dir:
                workspace_dir = str(((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("workspaceDir") or "").strip()
            try:
                if workspace_dir:
                    from anima_backend_shared.util import norm_abs

                    workspace_dir = norm_abs(workspace_dir)
            except Exception:
                workspace_dir = ""

            if stream:
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
                    except Exception:
                        from anima_backend_shared.chat import ClientDisconnected

                        raise ClientDisconnected()

                def emit_event(obj: Any) -> None:
                    if not isinstance(obj, dict):
                        emit(obj)
                        return
                    t = obj.get("type")
                    if t == "model_delta":
                        emit({"type": "delta", "content": obj.get("content"), "step": obj.get("step")})
                        return
                    if t == "tool_trace":
                        emit({"type": "trace", "trace": obj.get("trace")})
                        return
                    if t == "reasoning_full":
                        emit({"type": "reasoning", "content": obj.get("content"), "step": obj.get("step")})
                        return
                    emit(obj)

                try:
                    emit({"type": "run", "status": "running"})
                except Exception:
                    return
            else:
                emit = None
                emit_event = None

            try:
                update_run(run_id, "running")
                traces_all = list(paused_traces)
                artifacts_all = list(paused_artifacts)
                resumed_messages = list(paused_messages)

                if decision == "reject":
                    tool_content = json.dumps({"ok": False, "error": "User rejected dangerous command approval"}, ensure_ascii=False)
                    trace = {
                        "id": f"tr_resume_{uuid.uuid4().hex[:8]}",
                        "toolCallId": tool_call_id,
                        "name": tool_name,
                        "status": "failed",
                        "startedAt": 0,
                        "endedAt": 0,
                        "durationMs": 0,
                        "error": {"message": "User rejected dangerous command approval"},
                    }
                else:
                    _tools_unused, mcp_index, _tool_choice_unused = select_tools(settings_obj, composer)
                    resume_trace_id = f"tr_resume_{uuid.uuid4().hex[:8]}"
                    running_trace = {
                        "id": resume_trace_id,
                        "toolCallId": tool_call_id,
                        "name": tool_name,
                        "status": "running",
                        "startedAt": now_ms(),
                        "argsPreview": preview_json(tool_args, max_chars=800),
                    }
                    if stream and callable(emit):
                        try:
                            emit({"type": "trace", "trace": running_trace})
                        except Exception:
                            return
                    tool_content, trace = execute_tool(
                        tool_name,
                        tool_args,
                        tool_call_id=tool_call_id,
                        workspace_dir=workspace_dir,
                        composer=composer,
                        mcp_index=mcp_index,
                        trace_id=resume_trace_id,
                    )

                traces_all.append(trace)
                tr_artifacts = trace.get("artifacts") if isinstance(trace, dict) else None
                if isinstance(tr_artifacts, list):
                    artifacts_all.extend([x for x in tr_artifacts if isinstance(x, dict)])
                resumed_messages.append(make_tool_message(tool_call_id=tool_call_id, content=tool_content))

                if stream and callable(emit):
                    try:
                        emit({"type": "trace", "trace": trace})
                    except Exception:
                        return

                out = _run_tool_loop(
                    provider=provider,
                    prepared=resumed_messages,
                    composer=composer,
                    settings_obj=settings_obj,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    extra_body=extra_body,
                    emit_event=emit_event,
                )

                traces_out = traces_all + list(out.get("traces") or [])
                artifacts_out = artifacts_all + list(out.get("artifacts") or [])
                if bool(out.get("paused")):
                    update_run(
                        run_id,
                        "paused",
                        {
                            "content": "",
                            "usage": out.get("usage"),
                            "traces": traces_out,
                            "artifacts": artifacts_out,
                            "reasoning": out.get("reasoning") or "",
                            "messages": out.get("messages"),
                            "pauseContext": out.get("pause_context"),
                        },
                    )
                    approval_next = out.get("approval") if isinstance(out.get("approval"), dict) else {}
                    if stream and callable(emit):
                        try:
                            emit({"type": "approval_required", "approval": approval_next})
                        except Exception:
                            return
                        return
                    json_response(
                        handler,
                        HTTPStatus.CONFLICT,
                        {"ok": False, "code": "approval_required", "runId": run_id, "threadId": thread_id, "approval": approval_next},
                    )
                    return

                content = str(out.get("final_content") or "")
                usage = out.get("usage")
                reasoning = str(out.get("reasoning") or "")
                rate_limit = out.get("rate_limit")
                output_messages = out.get("messages")

                update_run(
                    run_id,
                    "succeeded",
                    {
                        "content": content,
                        "usage": usage,
                        "traces": traces_out,
                        "artifacts": artifacts_out,
                        "reasoning": reasoning,
                        "messages": output_messages,
                    },
                )

                if stream and callable(emit):
                    done_payload: Dict[str, Any] = {
                        "type": "done",
                        "usage": usage,
                        "reasoning": reasoning,
                        "traces": traces_out,
                        "artifacts": artifacts_out,
                        "backendImpl": "stream-executor",
                    }
                    if isinstance(rate_limit, dict) and rate_limit:
                        done_payload["rateLimit"] = rate_limit
                    try:
                        emit(done_payload)
                    except Exception:
                        return
                    return

                payload: Dict[str, Any] = {
                    "ok": True,
                    "runId": run_id,
                    "threadId": thread_id,
                    "content": content,
                    "usage": usage,
                    "traces": traces_out,
                    "artifacts": artifacts_out,
                    "reasoning": reasoning,
                    "backendImpl": "stream-executor",
                }
                if isinstance(rate_limit, dict) and rate_limit:
                    payload["rateLimit"] = rate_limit
                json_response(handler, HTTPStatus.OK, payload)
                return
            except Exception as e:
                update_run(run_id, "failed", {"error": str(e)})
                if stream:
                    try:
                        emit({"type": "error", "error": str(e)})
                    except Exception:
                        return
                    return
                json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
                return

        base_input = run.get("output") or run.get("input") or {}
        base_messages = base_input.get("messages") if isinstance(base_input, dict) else None
        messages = list(base_messages) if isinstance(base_messages, list) else []
        new_messages = body.get("messages")
        if isinstance(new_messages, list):
            messages.extend([m for m in new_messages if not (isinstance(m, dict) and m.get("role") == "system")])
        if not messages:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "messages must be a list"})
            return

        composer = body.get("composer")
        if not isinstance(composer, dict):
            composer = base_input.get("composer") if isinstance(base_input, dict) else {}
        if not isinstance(composer, dict):
            composer = {}

        thread_id = run.get("threadId") or run_id

        settings_obj = load_settings()
        provider = create_provider(settings_obj, composer)

        temperature = float(
            body.get("temperature")
            or (base_input.get("temperature") if isinstance(base_input, dict) else None)
            or (settings_obj.get("settings") or {}).get("temperature")
            or 0.7
        )
        max_tokens = int(
            body.get("maxTokens")
            or (base_input.get("maxTokens") if isinstance(base_input, dict) else None)
            or (settings_obj.get("settings") or {}).get("maxTokens")
            or 0
        )
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

        has_system = any(isinstance(m, dict) and m.get("role") == "system" for m in messages)
        if not has_system:
            compression_evt = None
            if thread_id:
                messages, composer, compression_evt = _apply_persistent_compression(
                    chat_id=thread_id, messages=messages, settings_obj=settings_obj, provider=provider, composer=composer, extra_body=extra_body
                )
            messages = inject_system_message(messages, settings_obj, composer)
        prepared = apply_attachments_inline(messages, composer)

        update_run(run_id, "running")

        emit = None
        emit_event = None
        if stream:
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
                except Exception:
                    from anima_backend_shared.chat import ClientDisconnected

                    raise ClientDisconnected()

            def emit_event(obj: Any) -> None:
                if not isinstance(obj, dict):
                    emit(obj)
                    return
                t = obj.get("type")
                if t == "model_delta":
                    emit({"type": "delta", "content": obj.get("content"), "step": obj.get("step")})
                    return
                if t == "tool_trace":
                    emit({"type": "trace", "trace": obj.get("trace")})
                    return
                if t == "reasoning_full":
                    emit({"type": "reasoning", "content": obj.get("content"), "step": obj.get("step")})
                    return
                emit(obj)

            try:
                emit({"type": "run", "status": "running"})
            except Exception:
                return

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
            if stream and callable(emit):
                try:
                    emit({"type": "approval_required", "approval": approval})
                except Exception:
                    return
                return
            json_response(
                handler,
                HTTPStatus.CONFLICT,
                {"ok": False, "code": "approval_required", "runId": run_id, "threadId": thread_id, "approval": approval},
            )
            return

        content = str(out.get("final_content") or "")
        usage = out.get("usage")
        traces = out.get("traces")
        artifacts = out.get("artifacts")
        reasoning = str(out.get("reasoning") or "")
        rate_limit = out.get("rate_limit")
        output_messages = out.get("messages")

        update_run(
            run_id,
            "succeeded",
            {
                "content": content,
                "usage": usage,
                "traces": traces,
                "artifacts": artifacts,
                "reasoning": reasoning,
                "messages": output_messages,
            },
        )

        if stream and callable(emit):
            done_payload: Dict[str, Any] = {
                "type": "done",
                "usage": usage,
                "reasoning": reasoning,
                "traces": traces,
                "backendImpl": "stream-executor",
            }
            if isinstance(artifacts, list) and artifacts:
                done_payload["artifacts"] = artifacts
            if isinstance(rate_limit, dict) and rate_limit:
                done_payload["rateLimit"] = rate_limit
            try:
                emit(done_payload)
            except Exception:
                return
            return

        payload: Dict[str, Any] = {
            "ok": True,
            "runId": run_id,
            "threadId": thread_id,
            "content": content,
            "usage": usage,
            "traces": traces,
            "artifacts": artifacts,
            "reasoning": reasoning,
            "backendImpl": "stream-executor",
        }
        if isinstance(rate_limit, dict) and rate_limit:
            payload["rateLimit"] = rate_limit
        json_response(handler, HTTPStatus.OK, payload)
        return
    except Exception as e:
        try:
            update_run(run_id, "failed", {"error": str(e)})
        except Exception:
            pass
        try:
            json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
        except Exception:
            return

