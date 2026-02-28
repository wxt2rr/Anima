from __future__ import annotations

import json
import uuid
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Tuple

from anima_backend_shared.chat import apply_attachments_inline
from anima_backend_shared.database import create_run, get_chat, get_run, update_run
from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import load_settings

from ..llm.adapter import create_provider
from ..runtime.graph import build_run_graph, inject_system_message


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

    graph = build_run_graph(provider)
    init_state = {
        "run_id": run_id,
        "thread_id": thread_id,
        "messages": prepared,
        "composer": composer,
        "settings": settings_obj,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "extra_body": extra_body,
        "step": 0,
        "traces": [],
        "artifacts": [],
        "usage": None,
        "rate_limit": None,
        "reasoning": "",
        "final_content": "",
    }

    try:
        out = graph.invoke(init_state)
        content = str((out or {}).get("final_content") or "")
        usage = (out or {}).get("usage")
        traces = (out or {}).get("traces")
        artifacts = (out or {}).get("artifacts")
        reasoning = str((out or {}).get("reasoning") or "")
        rate_limit = (out or {}).get("rate_limit")
        output_messages = (out or {}).get("messages")

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

        payload: Dict[str, Any] = {
            "ok": True,
            "runId": run_id,
            "threadId": thread_id,
            "content": content,
            "usage": usage,
            "traces": traces,
            "artifacts": artifacts,
            "reasoning": reasoning,
            "backendImpl": "langgraph",
        }
        if isinstance(rate_limit, dict) and rate_limit:
            payload["rateLimit"] = rate_limit
        return int(HTTPStatus.OK), payload
    except Exception as e:
        try:
            update_run(run_id, "failed", {"error": str(e)})
        except Exception:
            pass
        return int(HTTPStatus.INTERNAL_SERVER_ERROR), {"ok": False, "error": str(e)}


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
            messages = inject_system_message(messages, settings_obj, composer)
        prepared = apply_attachments_inline(messages, composer)

        update_run(run_id, "running")

        graph = build_run_graph(provider)

        if not stream:
            init_state = {
                "run_id": run_id,
                "thread_id": thread_id,
                "messages": prepared,
                "composer": composer,
                "settings": settings_obj,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "extra_body": extra_body,
                "step": 0,
                "traces": [],
                "artifacts": [],
                "usage": None,
                "rate_limit": None,
                "reasoning": "",
                "final_content": "",
            }

            out = graph.invoke(init_state)
            content = str((out or {}).get("final_content") or "")
            usage = (out or {}).get("usage")
            traces = (out or {}).get("traces")
            artifacts = (out or {}).get("artifacts")
            reasoning = str((out or {}).get("reasoning") or "")
            rate_limit = (out or {}).get("rate_limit")
            output_messages = (out or {}).get("messages")

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

            payload: Dict[str, Any] = {
                "ok": True,
                "runId": run_id,
                "threadId": thread_id,
                "content": content,
                "usage": usage,
                "traces": traces,
                "artifacts": artifacts,
                "reasoning": reasoning,
                "backendImpl": "langgraph",
            }
            if isinstance(rate_limit, dict) and rate_limit:
                payload["rateLimit"] = rate_limit
            json_response(handler, HTTPStatus.OK, payload)
            return

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

        try:
            emit({"type": "run", "status": "running"})
        except Exception:
            return

        try:
            init_state = {
                "run_id": run_id,
                "thread_id": thread_id,
                "messages": prepared,
                "composer": composer,
                "settings": settings_obj,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "extra_body": extra_body,
                "step": 0,
                "traces": [],
                "usage": None,
                "rate_limit": None,
                "reasoning": "",
                "final_content": "",
            }

            out = graph.invoke(init_state)
            content = str((out or {}).get("final_content") or "")
            usage = (out or {}).get("usage")
            traces = (out or {}).get("traces")
            reasoning = str((out or {}).get("reasoning") or "")
            rate_limit = (out or {}).get("rate_limit")
            output_messages = (out or {}).get("messages")

            update_run(
                run_id,
                "succeeded",
                {
                    "content": content,
                    "usage": usage,
                    "traces": traces,
                    "reasoning": reasoning,
                    "messages": output_messages,
                },
            )

            if content:
                try:
                    emit({"type": "delta", "content": content, "step": 0})
                except Exception:
                    return

            done_payload: Dict[str, Any] = {
                "type": "done",
                "usage": usage,
                "reasoning": reasoning,
                "traces": traces,
                "backendImpl": "langgraph",
            }
            if isinstance(rate_limit, dict) and rate_limit:
                done_payload["rateLimit"] = rate_limit
            try:
                emit(done_payload)
            except Exception:
                return
        except Exception as e:
            from anima_backend_shared.chat import ClientDisconnected

            if isinstance(e, ClientDisconnected):
                return
            update_run(run_id, "failed", {"error": str(e)})
            try:
                json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            except Exception:
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


def handle_post_chat_prepare(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        messages = body.get("messages")
        if not isinstance(messages, list):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "messages must be a list"})
            return
        messages = [m for m in messages if not (isinstance(m, dict) and m.get("role") == "system")]
        composer = body.get("composer")
        if not isinstance(composer, dict):
            composer = {}
        prepared = apply_attachments_inline(messages, composer)
        json_response(handler, HTTPStatus.OK, {"ok": True, "messages": prepared})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_chat(handler: Any) -> None:
    q = getattr(handler, "query", None) or {}
    stream = q.get("stream") == "1"

    from anima_backend_shared.chat import ClientDisconnected
    from anima_backend_shared.database import db_path, get_app_settings_info
    from anima_backend_shared.providers import create_chat_provider, get_provider_spec

    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        messages = body.get("messages")
        if not isinstance(messages, list):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "messages must be a list"})
            return
        composer = body.get("composer")
        if not isinstance(composer, dict):
            composer = {}

        turn_id = str(body.get("turnId") or "").strip()
        local_run_id = turn_id or str(uuid.uuid4())

        settings_obj = load_settings()
        messages = inject_system_message(messages, settings_obj, composer)
        db_path_str = str(db_path())
        app_settings_updated_at = None
        try:
            _, app_settings_updated_at = get_app_settings_info()
        except Exception:
            app_settings_updated_at = None
        provider_override_id = str(composer.get("providerOverrideId") or "").strip()
        spec = get_provider_spec(settings_obj, provider_override_id or None)
        if not spec:
            if provider_override_id:
                providers_list = settings_obj.get("providers", [])
                found_provider = next((p for p in providers_list if str(p.get("id")) == provider_override_id), None)
                provider_dump = None
                if found_provider:
                    provider_dump = found_provider.copy()
                    if "config" in provider_dump and isinstance(provider_dump["config"], dict):
                        cfg = provider_dump["config"].copy()
                        if "apiKey" in cfg:
                            k = str(cfg["apiKey"])
                            if len(k) > 8:
                                cfg["apiKey"] = k[:4] + "..." + k[-4:]
                            else:
                                cfg["apiKey"] = "***"
                        provider_dump["config"] = cfg

                debug_info = {
                    "providerOverrideId": provider_override_id,
                    "foundInSettings": bool(found_provider),
                    "providerDump": provider_dump,
                    "allProviderIds": [str(p.get("id")) for p in providers_list],
                    "dbPath": db_path_str,
                    "appSettingsUpdatedAt": app_settings_updated_at,
                }

                json_response(
                    handler,
                    HTTPStatus.BAD_REQUEST,
                    {
                        "ok": False,
                        "error": f"Provider not configured: {provider_override_id}",
                        "debug": debug_info,
                        "settings": settings_obj,
                        "dbPath": db_path_str,
                        "appSettingsUpdatedAt": app_settings_updated_at,
                    },
                )
            else:
                json_response(
                    handler,
                    HTTPStatus.BAD_REQUEST,
                    {
                        "ok": False,
                        "error": "No active provider configured",
                        "settings": settings_obj,
                        "dbPath": db_path_str,
                        "appSettingsUpdatedAt": app_settings_updated_at,
                    },
                )
            return
        provider = create_chat_provider(spec)

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

        prepared = apply_attachments_inline(messages, composer)

        if not stream:
            graph = build_run_graph(provider)
            init_state = {
                "run_id": local_run_id,
                "thread_id": local_run_id,
                "messages": prepared,
                "composer": composer,
                "settings": settings_obj,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "extra_body": extra_body,
                "step": 0,
                "traces": [],
                "artifacts": [],
                "usage": None,
                "rate_limit": None,
                "reasoning": "",
                "final_content": "",
            }
            out = graph.invoke(init_state)
            content = str((out or {}).get("final_content") or "")
            usage = (out or {}).get("usage")
            traces = (out or {}).get("traces")
            artifacts = (out or {}).get("artifacts")
            reasoning = str((out or {}).get("reasoning") or "")
            rate_limit = (out or {}).get("rate_limit") or getattr(provider, "last_rate_limit", None)
            payload: Dict[str, Any] = {"ok": True, "content": content, "usage": usage, "traces": traces, "artifacts": artifacts, "reasoning": reasoning}
            if isinstance(rate_limit, dict) and rate_limit:
                payload["rateLimit"] = rate_limit
            json_response(handler, HTTPStatus.OK, payload)
            return

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
                if isinstance(obj, dict) and turn_id:
                    obj["turnId"] = turn_id
                data = json.dumps(obj, ensure_ascii=False)
                handler.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                handler.wfile.flush()
            except Exception as e:
                raise ClientDisconnected() from e

        from anima_backend_shared.chat import _ensure_tool_call_ids, parse_tool_args
        from anima_backend_shared.constants import MAX_TOOL_STEPS
        from anima_backend_shared.util import extract_reasoning_text, now_ms, preview_json, preview_tool_result

        from ..llm.adapter import call_chat_completion, get_last_rate_limit
        from ..runtime.sanitize import sanitize_history_messages
        from ..tools.executor import execute_tool, make_tool_message, select_tools

        tools, mcp_index, tool_choice = select_tools(settings_obj, composer)
        mo = str(composer.get("modelOverride") or "").strip() or None

        cur, dropped_traces = sanitize_history_messages(prepared)
        traces: List[Dict[str, Any]] = []
        if dropped_traces:
            traces.extend(dropped_traces)
            for tr in dropped_traces:
                try:
                    emit({"type": "trace", "trace": tr})
                except ClientDisconnected:
                    return
                except Exception:
                    pass
        reasoning_parts: List[str] = []
        usage = None
        final_content = ""
        artifacts: List[Dict[str, Any]] = []

        try:
            import time

            for step in range(MAX_TOOL_STEPS):
                tool_calls = None
                content = ""
                msg: Dict[str, Any] = {}
                emitted_any_delta = False

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
                                    emit({"type": "delta", "content": part})
                                    emitted_any_delta = True
                                except ClientDisconnected:
                                    return
                                except Exception:
                                    pass
                            rc_part = delta.get("reasoning_content")
                            if isinstance(rc_part, str) and rc_part:
                                reasoning_content_parts.append(rc_part)
                                try:
                                    emit({"type": "reasoning_delta", "content": rc_part})
                                except ClientDisconnected:
                                    return
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
                        if isinstance(res.get("usage"), dict):
                            usage = res.get("usage")
                        choice = ((res.get("choices") or [{}])[0]) if isinstance(res, dict) else {}
                        msg = (choice.get("message") or {}) if isinstance(choice, dict) else {}
                        content = str(msg.get("content") or "")
                        tool_calls = msg.get("tool_calls")
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
                    if isinstance(res.get("usage"), dict):
                        usage = res.get("usage")
                    choice = ((res.get("choices") or [{}])[0]) if isinstance(res, dict) else {}
                    msg = (choice.get("message") or {}) if isinstance(choice, dict) else {}
                    content = str(msg.get("content") or "")
                    tool_calls = msg.get("tool_calls")

                extracted_reasoning = extract_reasoning_text(msg)
                if extracted_reasoning:
                    reasoning_parts.append(extracted_reasoning)

                if isinstance(content, str) and content.strip() and not tool_calls:
                    if not emitted_any_delta:
                        text = content
                        chunk_size = 48
                        for i in range(0, len(text), max(1, chunk_size)):
                            part = text[i : i + max(1, chunk_size)]
                            try:
                                emit({"type": "delta", "content": part})
                            except ClientDisconnected:
                                return
                            except Exception:
                                pass
                    final_content = content
                    break

                tool_calls = _ensure_tool_call_ids(tool_calls, step)
                if not tool_calls:
                    if not emitted_any_delta and isinstance(content, str) and content:
                        try:
                            emit({"type": "delta", "content": content})
                        except ClientDisconnected:
                            return
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
                    running_trace: Dict[str, Any] = {
                        "id": trace_id,
                        "toolCallId": tc_id,
                        "name": fn_name,
                        "status": "running",
                        "startedAt": started_at,
                        "argsPreview": preview_json(fn_args, max_chars=800),
                    }
                    try:
                        emit({"type": "trace", "trace": running_trace})
                    except ClientDisconnected:
                        return
                    except Exception:
                        pass

                    tool_content, trace = execute_tool(
                        fn_name,
                        fn_args,
                        tool_call_id=tc_id,
                        workspace_dir=workspace_dir,
                        mcp_index=mcp_index,
                        trace_id=trace_id,
                    )
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

                    traces.append(running_trace)
                    try:
                        emit({"type": "trace", "trace": running_trace})
                    except ClientDisconnected:
                        return
                    except Exception:
                        pass

                    next_messages.append(make_tool_message(tool_call_id=tc_id, content=tool_content))

                cur, hist_dropped_traces = sanitize_history_messages(next_messages)
                if hist_dropped_traces:
                    traces.extend(hist_dropped_traces)
                    for tr in hist_dropped_traces:
                        try:
                            emit({"type": "trace", "trace": tr})
                        except ClientDisconnected:
                            return
                        except Exception:
                            pass
            else:
                final_content = "Tool execution limit reached."

            rate_limit = get_last_rate_limit(provider)
            done_payload: Dict[str, Any] = {
                "type": "done",
                "usage": usage,
                "artifacts": artifacts,
                "reasoning": "\n\n".join([r for r in reasoning_parts if str(r).strip()]).strip(),
                "backendImpl": "langgraph",
            }
            if isinstance(rate_limit, dict) and rate_limit:
                done_payload["rateLimit"] = rate_limit
            try:
                emit(done_payload)
            except ClientDisconnected:
                return
            except Exception:
                return
        except ClientDisconnected:
            return
        except Exception as e:
            try:
                emit(
                    {
                        "type": "error",
                        "error": str(e),
                        "settings": settings_obj,
                        "dbPath": db_path_str,
                        "appSettingsUpdatedAt": app_settings_updated_at,
                    }
                )
            except Exception:
                return
            return
    except Exception as e:
        try:
            s_obj = settings_obj
        except UnboundLocalError:
            try:
                s_obj = load_settings()
            except Exception:
                s_obj = {}

        db_path_str = str(db_path())
        app_settings_updated_at = None
        try:
            _, app_settings_updated_at = get_app_settings_info()
        except Exception:
            app_settings_updated_at = None

        if stream:
            try:
                data = json.dumps(
                    {
                        "type": "error",
                        "error": str(e),
                        "settings": s_obj,
                        "dbPath": db_path_str,
                        "appSettingsUpdatedAt": app_settings_updated_at,
                    },
                    ensure_ascii=False,
                )
                handler.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                handler.wfile.flush()
            except Exception:
                return
            return
        json_response(
            handler,
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {
                "ok": False,
                "error": str(e),
                "settings": s_obj,
                "dbPath": db_path_str,
                "appSettingsUpdatedAt": app_settings_updated_at,
            },
        )
