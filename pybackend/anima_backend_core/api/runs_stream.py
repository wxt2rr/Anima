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
from ..runtime.graph import inject_system_message
from ..runtime.sanitize import sanitize_history_messages
from .runs_compression import apply_persistent_compression, apply_thinking_level
from .runs_request import prepare_messages_for_run, resolve_runtime_options

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
    return apply_thinking_level(provider, composer, extra_body, max_tokens)


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
    return apply_persistent_compression(
        chat_id=chat_id,
        messages=messages,
        settings_obj=settings_obj,
        provider=provider,
        composer=composer,
        extra_body=extra_body,
        is_manual=False,
        emit_event=emit_event,
        get_chat_meta_fn=get_chat_meta,
        merge_chat_meta_fn=merge_chat_meta,
    )


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

    use_thread_messages = bool(body.get("useThreadMessages"))
    try:
        messages = prepare_messages_for_run(body.get("messages"), use_thread_messages, thread_id, chat_loader=get_chat)
    except ValueError:
        return int(HTTPStatus.BAD_REQUEST), {"ok": False, "error": "messages must be a list"}

    composer = body.get("composer")
    if not isinstance(composer, dict):
        composer = {}

    settings_obj = load_settings()
    provider = create_provider(settings_obj, composer)
    temperature, max_tokens, extra_body = resolve_runtime_options(body=body, composer=composer, settings_obj=settings_obj)

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

    use_thread_messages = bool(body.get("useThreadMessages"))
    try:
        messages = prepare_messages_for_run(body.get("messages"), use_thread_messages, thread_id, chat_loader=get_chat)
    except ValueError:
        handler.send_response(HTTPStatus.BAD_REQUEST)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.end_headers()
        handler.wfile.write(json.dumps({"ok": False, "error": "messages must be a list"}, ensure_ascii=False).encode("utf-8"))
        return

    composer = body.get("composer")
    if not isinstance(composer, dict):
        composer = {}

    settings_obj = load_settings()
    provider = create_provider(settings_obj, composer)
    temperature, max_tokens, extra_body = resolve_runtime_options(body=body, composer=composer, settings_obj=settings_obj)

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
