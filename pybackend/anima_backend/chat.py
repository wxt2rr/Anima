import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from .constants import MAX_FILE_BYTES_INLINE, MAX_TOOL_STEPS
from .providers import ChatProvider
from .tools import builtin_tools, execute_builtin_tool, execute_mcp_tool, mcp_tools
from .util import extract_reasoning_text, is_within, maybe_truncate_text, norm_abs, now_ms, preview_json, preview_tool_result, read_text_file


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
    user_content = str(messages[idx].get("content") or "")
    blocks = []
    for a in atts:
        if not isinstance(a, dict):
            continue
        mode = str(a.get("mode") or "inline").strip()
        if mode != "inline":
            continue
        path = str(a.get("path") or "").strip()
        if not path:
            continue
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
            if candidate and is_within(workspace_dir, candidate):
                target = candidate
            else:
                blocks.append(f"- {Path(path).name}: Path outside workspace")
                continue
        else:
            if not Path(path).is_absolute():
                blocks.append(f"- {Path(path).name}: No workspace selected")
                continue
            target = path
        try:
            text, meta = read_text_file(target, max_bytes=MAX_FILE_BYTES_INLINE)
        except Exception as e:
            blocks.append(f"- {Path(path).name}: {str(e)}")
            continue
        title = Path(meta.get("path") or path).name
        snippet = text
        blocks.append(f"File: {title}\n\n{snippet}")
    if not blocks:
        return messages
    addon = "\n\nAttachments:\n\n" + "\n\n---\n\n".join(blocks)
    next_messages = [dict(m) for m in messages]
    next_messages[idx] = {**next_messages[idx], "content": user_content + addon}
    return next_messages


def get_workspace_dir(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> str:
    cdir = str((composer or {}).get("workspaceDir") or "").strip()
    sdir = str(((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("workspaceDir") or "").strip()
    d = cdir or sdir
    if not d:
        return ""
    try:
        return norm_abs(d)
    except Exception:
        return ""


def tool_mode(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> str:
    mode = composer.get("toolMode")
    if isinstance(mode, str) and mode.strip():
        return mode.strip()
    s = (settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}
    m = s.get("defaultToolMode")
    return str(m or "auto")


def model_override(composer: Dict[str, Any]) -> str:
    m = composer.get("modelOverride")
    return str(m or "").strip()


def select_tools(
    settings_obj: Dict[str, Any], composer: Dict[str, Any]
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]], Union[str, Dict[str, Any], None]]:
    mode = tool_mode(settings_obj, composer)
    builtin = builtin_tools()
    mcp, mcp_index = mcp_tools(settings_obj, composer)
    all_tools = builtin + mcp

    if mode == "disabled":
        return [], {}, None
    if mode == "all":
        return all_tools, mcp_index, "auto"

    enabled_ids = composer.get("enabledToolIds")
    if enabled_ids is None:
        enabled_ids = ((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("toolsEnabledIds") or []
    enabled = set([str(x) for x in enabled_ids]) if isinstance(enabled_ids, list) else set()
    if not enabled:
        return all_tools, mcp_index, "auto"
    filtered = []
    for t in all_tools:
        fn = ((t.get("function") or {}) if isinstance(t, dict) else {}).get("name")
        if isinstance(fn, str) and fn in enabled:
            filtered.append(t)
    return filtered, mcp_index, "auto"


def chat_with_tools(
    provider: ChatProvider,
    settings_obj: Dict[str, Any],
    messages: List[Dict[str, Any]],
    temperature: float,
    max_tokens: int,
    composer: Dict[str, Any],
    extra_body: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Any, List[Dict[str, Any]], str]:
    tools, mcp_index, tool_choice = select_tools(settings_obj, composer)
    mo = model_override(composer) or None
    cur = messages
    usage = None
    traces: List[Dict[str, Any]] = []
    reasoning_parts: List[str] = []
    for step in range(MAX_TOOL_STEPS):
        res = provider.chat_completion(
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
        reasoning = extract_reasoning_text(msg)
        if reasoning:
            reasoning, _ = maybe_truncate_text(reasoning, max_chars=50000)
            if not reasoning_parts or reasoning_parts[-1] != reasoning:
                reasoning_parts.append(reasoning)
        tool_calls = msg.get("tool_calls")
        content = msg.get("content")
        if isinstance(content, str) and content.strip() and not tool_calls:
            return content, usage, traces, "\n\n".join(reasoning_parts).strip()
        tool_calls = _ensure_tool_call_ids(tool_calls, step)
        if not tool_calls:
            return str(content or ""), usage, traces, "\n\n".join(reasoning_parts).strip()

        next_messages = list(cur)
        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": str(content or ""), "tool_calls": tool_calls}
        if getattr(provider, "include_reasoning_content_in_messages", False):
            rc = msg.get("reasoning_content")
            if isinstance(rc, str) and rc.strip():
                assistant_msg["reasoning_content"] = rc
        next_messages.append(assistant_msg)
        workspace_dir = get_workspace_dir(settings_obj, composer)
        for tc in tool_calls:
            if not isinstance(tc, dict):
                continue
            tc_id = str(tc.get("id") or "")
            fn = (tc.get("function") or {}) if isinstance(tc.get("function"), dict) else {}
            fn_name = str(fn.get("name") or "").strip()
            fn_args = parse_tool_args(fn.get("arguments"))
            trace_id = f"tr_{int(time.time() * 1000)}_{len(traces)}"
            started_at = now_ms()
            trace: Dict[str, Any] = {
                "id": trace_id,
                "toolCallId": tc_id,
                "name": fn_name,
                "status": "running",
                "startedAt": started_at,
                "argsPreview": preview_json(fn_args, max_chars=800),
            }
            try:
                if fn_name.startswith("mcp__"):
                    out = execute_mcp_tool(fn_name, fn_args, mcp_index)
                else:
                    out = execute_builtin_tool(fn_name, fn_args, workspace_dir=workspace_dir)
                tool_content = out
                ended_at = now_ms()
                trace.update(
                    {
                        "status": "succeeded",
                        "endedAt": ended_at,
                        "durationMs": max(0, ended_at - started_at),
                        "resultPreview": preview_tool_result(tool_content, max_chars=1200),
                    }
                )
                try:
                    res_json = json.loads(tool_content)
                    if isinstance(res_json, dict) and "diffs" in res_json:
                        trace["diffs"] = res_json["diffs"]
                except Exception:
                    pass
            except Exception as e:
                if fn_name == "TodoWrite" and "Chat ID missing in tool context" in str(e):
                    todos = fn_args.get("todos") if isinstance(fn_args.get("todos"), list) else []
                    tool_content = json.dumps({"ok": True, "todos": todos, "merge": bool(fn_args.get("merge"))}, ensure_ascii=False)
                    ended_at = now_ms()
                    trace.update(
                        {
                            "status": "succeeded",
                            "endedAt": ended_at,
                            "durationMs": max(0, ended_at - started_at),
                            "resultPreview": preview_tool_result(tool_content, max_chars=1200),
                        }
                    )
                else:
                    tool_content = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)
                    ended_at = now_ms()
                    trace.update(
                        {
                            "status": "failed",
                            "endedAt": ended_at,
                            "durationMs": max(0, ended_at - started_at),
                            "error": {"message": str(e)},
                            "resultPreview": preview_tool_result(tool_content, max_chars=1200),
                        }
                    )
            traces.append(trace)
            tool_msg: Dict[str, Any] = {"role": "tool", "content": tool_content}
            tool_msg["tool_call_id"] = tc_id
            next_messages.append(tool_msg)
        cur = next_messages
    return "Tool execution limit reached.", usage, traces, "\n\n".join(reasoning_parts).strip()


def chat_with_tools_stream(
    provider: ChatProvider,
    settings_obj: Dict[str, Any],
    messages: List[Dict[str, Any]],
    temperature: float,
    max_tokens: int,
    composer: Dict[str, Any],
    emit: Any,
    extra_body: Optional[Dict[str, Any]] = None,
) -> Tuple[str, Any, List[Dict[str, Any]], str]:
    tools, mcp_index, tool_choice = select_tools(settings_obj, composer)
    mo = model_override(composer) or None
    cur = messages
    usage = None
    traces: List[Dict[str, Any]] = []
    reasoning_parts: List[str] = []
    for step in range(MAX_TOOL_STEPS):
        try:
            emit({"type": "stage", "stage": "model_call", "step": step})
        except ClientDisconnected:
            raise
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
                            emit({"type": "delta", "content": part, "step": step})
                            emitted_any_delta = True
                        except ClientDisconnected:
                            raise
                        except Exception:
                            pass
                    rc_part = delta.get("reasoning_content")
                    if isinstance(rc_part, str) and rc_part:
                        reasoning_content_parts.append(rc_part)
                        emitted_reasoning_deltas = True
                        try:
                            emit({"type": "reasoning_delta", "content": rc_part, "step": step})
                        except ClientDisconnected:
                            raise
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
                res = provider.chat_completion(
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
            res = provider.chat_completion(
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

        reasoning = extract_reasoning_text(msg)
        if reasoning:
            reasoning, _ = maybe_truncate_text(reasoning, max_chars=50000)
            if not reasoning_parts or reasoning_parts[-1] != reasoning:
                reasoning_parts.append(reasoning)
                if not emitted_reasoning_deltas:
                    try:
                        emit({"type": "reasoning", "content": reasoning, "step": step})
                    except ClientDisconnected:
                        raise
                    except Exception:
                        pass

        if isinstance(content, str) and content.strip() and not tool_calls:
            if not emitted_any_delta:
                text = content
                chunk_size = 48
                for i in range(0, len(text), max(1, chunk_size)):
                    part = text[i : i + max(1, chunk_size)]
                    try:
                        emit({"type": "delta", "content": part, "step": step})
                    except ClientDisconnected:
                        raise
                    except Exception:
                        pass
            return content, usage, traces, "\n\n".join(reasoning_parts).strip()
        tool_calls = _ensure_tool_call_ids(tool_calls, step)
        if not tool_calls:
            if not emitted_any_delta and isinstance(content, str) and content:
                try:
                    emit({"type": "delta", "content": content, "step": step})
                except ClientDisconnected:
                    raise
                except Exception:
                    pass
            return str(content or ""), usage, traces, "\n\n".join(reasoning_parts).strip()

        next_messages = list(cur)
        assistant_msg = {"role": "assistant", "content": str(content or ""), "tool_calls": tool_calls}
        if getattr(provider, "include_reasoning_content_in_messages", False):
            rc = msg.get("reasoning_content")
            if isinstance(rc, str) and rc.strip():
                assistant_msg["reasoning_content"] = rc
        next_messages.append(assistant_msg)
        workspace_dir = get_workspace_dir(settings_obj, composer)
        for tc in tool_calls:
            if not isinstance(tc, dict):
                continue
            tc_id = str(tc.get("id") or "")
            fn = (tc.get("function") or {}) if isinstance(tc.get("function"), dict) else {}
            fn_name = str(fn.get("name") or "").strip()
            fn_args = parse_tool_args(fn.get("arguments"))
            trace_id = f"tr_{int(time.time() * 1000)}_{len(traces)}"
            started_at = now_ms()
            trace: Dict[str, Any] = {
                "id": trace_id,
                "toolCallId": tc_id,
                "name": fn_name,
                "status": "running",
                "startedAt": started_at,
                "argsPreview": preview_json(fn_args, max_chars=800),
            }
            try:
                emit({"type": "trace", "trace": trace})
            except ClientDisconnected:
                raise
            except Exception:
                pass
            try:
                if fn_name.startswith("mcp__"):
                    out = execute_mcp_tool(fn_name, fn_args, mcp_index)
                else:
                    out = execute_builtin_tool(fn_name, fn_args, workspace_dir=workspace_dir)
                tool_content = out
                ended_at = now_ms()
                trace.update(
                    {
                        "status": "succeeded",
                        "endedAt": ended_at,
                        "durationMs": max(0, ended_at - started_at),
                        "resultPreview": preview_tool_result(tool_content, max_chars=1200),
                    }
                )
                try:
                    res_json = json.loads(tool_content)
                    if isinstance(res_json, dict) and "diffs" in res_json:
                        trace["diffs"] = res_json["diffs"]
                except Exception:
                    pass
                try:
                    emit({"type": "trace", "trace": trace})
                except ClientDisconnected:
                    raise
                except Exception:
                    pass
            except Exception as e:
                if fn_name == "TodoWrite" and "Chat ID missing in tool context" in str(e):
                    todos = fn_args.get("todos") if isinstance(fn_args.get("todos"), list) else []
                    tool_content = json.dumps({"ok": True, "todos": todos, "merge": bool(fn_args.get("merge"))}, ensure_ascii=False)
                    ended_at = now_ms()
                    trace.update(
                        {
                            "status": "succeeded",
                            "endedAt": ended_at,
                            "durationMs": max(0, ended_at - started_at),
                            "resultPreview": preview_tool_result(tool_content, max_chars=1200),
                        }
                    )
                else:
                    tool_content = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)
                    ended_at = now_ms()
                    trace.update(
                        {
                            "status": "failed",
                            "endedAt": ended_at,
                            "durationMs": max(0, ended_at - started_at),
                            "error": {"message": str(e)},
                            "resultPreview": preview_tool_result(tool_content, max_chars=1200),
                        }
                    )
                try:
                    emit({"type": "trace", "trace": trace})
                except ClientDisconnected:
                    raise
                except Exception:
                    pass
            traces.append(trace)
            tool_msg: Dict[str, Any] = {"role": "tool", "content": tool_content}
            tool_msg["tool_call_id"] = tc_id
            next_messages.append(tool_msg)
        cur = next_messages
    return "Tool execution limit reached.", usage, traces, "\n\n".join(reasoning_parts).strip()
