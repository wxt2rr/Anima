from __future__ import annotations

import json
import uuid
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Tuple

from anima_backend_shared.chat import apply_attachments_inline
from anima_backend_shared.database import create_run, get_chat, get_run, update_run
from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import load_settings
from anima_backend_shared.util import now_ms, preview_json

from ..llm.adapter import create_provider
from ..runtime.graph import inject_system_message
from ..tools.executor import execute_tool, make_tool_message, select_tools
from .runs_compression import apply_persistent_compression, apply_thinking_level
from .runs_request import resolve_runtime_options
from .runs_stream import _run_tool_loop, handle_post_runs_non_stream_via_stream_executor


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
    return apply_persistent_compression(
        chat_id=chat_id,
        messages=messages,
        settings_obj=settings_obj,
        provider=provider,
        composer=composer,
        extra_body=extra_body,
        is_manual=is_manual,
    )


def _apply_thinking_level(provider: Any, composer: Dict[str, Any], extra_body: Optional[Dict[str, Any]], max_tokens: int) -> tuple[Optional[Dict[str, Any]], int]:
    return apply_thinking_level(provider, composer, extra_body, max_tokens)


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
            temperature, max_tokens, extra_body = resolve_runtime_options(
                body=body,
                composer=composer,
                settings_obj=settings_obj,
                fallback_temperature=float(pause_ctx.get("temperature") or (run.get("input") or {}).get("temperature") or 0.7),
                fallback_max_tokens=int(pause_ctx.get("maxTokens") or (run.get("input") or {}).get("maxTokens") or 0),
            )
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

        temperature, max_tokens, extra_body = resolve_runtime_options(
            body=body,
            composer=composer,
            settings_obj=settings_obj,
            fallback_temperature=float((base_input.get("temperature") if isinstance(base_input, dict) else None) or 0.7),
            fallback_max_tokens=int((base_input.get("maxTokens") if isinstance(base_input, dict) else None) or 0),
        )
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
