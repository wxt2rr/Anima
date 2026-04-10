from __future__ import annotations

import json
import re
import time
import uuid
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from http import HTTPStatus
from typing import Any, Callable, Dict, List, Optional, Tuple

from anima_backend_shared.chat import ClientDisconnected, _ensure_tool_call_ids, parse_tool_args
from anima_backend_shared.constants import MAX_TOOL_STEPS
from anima_backend_shared.database import create_run, get_chat, get_chat_meta, merge_chat_meta, update_run
from anima_backend_shared.settings import load_settings
from anima_backend_shared.util import as_text, extract_reasoning_text, norm_abs, now_ms, preview_json, preview_tool_result

from ..llm.adapter import call_chat_completion, call_chat_completion_stream, create_provider, get_last_rate_limit
from ..tools.executor import execute_tool, make_tool_message, select_tools
from ..runtime.graph import inject_system_message
from ..runtime.sanitize import sanitize_history_messages
from .runs_compression import apply_persistent_compression, apply_thinking_level, build_usage_state, normalize_or_estimate_usage
from .runs_request import prepare_messages_for_run, resolve_runtime_options

_DANGEROUS_APPROVAL_PREFIX = "ANIMA_DANGEROUS_COMMAND_APPROVAL:"
_PATCH_FILE_LINE_RE = re.compile(r"^\*\*\* (?:Add|Delete|Update) File: (.+)$")


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


def _resolve_workspace_dir(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> str:
    cdir = str((composer or {}).get("workspaceDir") or "").strip()
    s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
    if not isinstance(s, dict):
        s = {}
    sdir = str(s.get("workspaceDir") or "").strip()
    return cdir or sdir


def _workspace_preflight_warning(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    ws = _resolve_workspace_dir(settings_obj, composer)
    if ws:
        return None
    return {
        "code": "workspace_missing",
        "message": "No workspace directory selected; workspace tools (e.g. memory_add/read_file/bash) may fail.",
    }


def _classify_recovery_reason(error_text: str) -> str:
    t = str(error_text or "").lower()
    if "timeout" in t or "timed out" in t:
        return "timeout"
    if "context" in t or "token" in t or "max_output_tokens" in t:
        return "context_budget"
    return "runtime_error"


def _resolve_guard_path(workspace_dir: str, path: Any) -> str:
    raw = str(path or "").strip()
    if not workspace_dir or not raw:
        return ""
    try:
        return norm_abs(str(Path(workspace_dir) / raw))
    except Exception:
        return ""


def _extract_apply_patch_guard_paths(workspace_dir: str, args: Dict[str, Any]) -> List[str]:
    patch_text = str((args or {}).get("patch") or "")
    if not patch_text.strip():
        return []
    out: List[str] = []
    seen: set[str] = set()
    for line in patch_text.splitlines():
        m = _PATCH_FILE_LINE_RE.match(line.strip())
        if not m:
            continue
        resolved = _resolve_guard_path(workspace_dir, m.group(1))
        if resolved and resolved not in seen:
            seen.add(resolved)
            out.append(resolved)
    return out


def _build_edit_guard_state(existing_traces: Optional[List[Dict[str, Any]]], workspace_dir: str) -> Dict[str, set[str]]:
    state: Dict[str, set[str]] = {"blocked_paths": set()}
    if not isinstance(existing_traces, list) or not workspace_dir:
        return state
    for tr in existing_traces:
        if not isinstance(tr, dict):
            continue
        name = str(tr.get("name") or "").strip()
        status = str(tr.get("status") or "").strip()
        if name == "apply_patch" and status == "failed":
            err = str(((tr.get("error") or {}) if isinstance(tr.get("error"), dict) else {}).get("message") or "")
            if "CONFLICT" not in err and "source block occurrences" not in err:
                continue
            for p in _extract_apply_patch_guard_paths(workspace_dir, tr.get("args") if isinstance(tr.get("args"), dict) else {}):
                state["blocked_paths"].add(p)
        elif name == "read_file" and status == "succeeded":
            path = _resolve_guard_path(workspace_dir, ((tr.get("args") or {}) if isinstance(tr.get("args"), dict) else {}).get("path"))
            if path:
                state["blocked_paths"].discard(path)
    return state


def _make_edit_guard_blocked_result(*, tool_name: str, args: Dict[str, Any], tool_call_id: str, trace_id: str, blocked_paths: List[str]) -> Tuple[str, Dict[str, Any]]:
    started_at = now_ms()
    msg = "EDIT_GUARD: apply_patch 在上次 CONFLICT 后必须先对同一文件成功执行 read_file，再生成新的 patch。"
    if blocked_paths:
        msg += " 受影响文件: " + ", ".join(blocked_paths)
    tool_content = json.dumps({"ok": False, "error": msg}, ensure_ascii=False)
    trace: Dict[str, Any] = {
        "id": trace_id,
        "toolCallId": tool_call_id,
        "name": tool_name,
        "status": "failed",
        "startedAt": started_at,
        "endedAt": started_at,
        "durationMs": 0,
        "argsPreview": preview_json(args, max_chars=800),
        "error": {"message": msg},
        "resultPreview": preview_tool_result(tool_content, max_chars=1200),
    }
    return tool_content, trace


def _execute_tool_with_edit_guard(
    *,
    tool_name: str,
    tool_args: Dict[str, Any],
    tool_call_id: str,
    workspace_dir: str,
    composer: Dict[str, Any],
    mcp_index: Dict[str, Dict[str, Any]],
    trace_id: str,
    edit_guard_state: Dict[str, set[str]],
) -> Tuple[str, Dict[str, Any]]:
    blocked_paths = edit_guard_state.setdefault("blocked_paths", set())
    if tool_name == "apply_patch":
        touched_paths = _extract_apply_patch_guard_paths(workspace_dir, tool_args)
        pending_paths = [p for p in touched_paths if p in blocked_paths]
        if pending_paths:
            return _make_edit_guard_blocked_result(
                tool_name=tool_name,
                args=tool_args,
                tool_call_id=tool_call_id,
                trace_id=trace_id,
                blocked_paths=pending_paths,
            )
        tool_content, trace = execute_tool(
            tool_name,
            tool_args,
            tool_call_id=tool_call_id,
            workspace_dir=workspace_dir,
            composer=composer,
            mcp_index=mcp_index,
            trace_id=trace_id,
        )
        err = str(((trace.get("error") or {}) if isinstance(trace.get("error"), dict) else {}).get("message") or "")
        if str(trace.get("status") or "") == "failed" and ("CONFLICT" in err or "source block occurrences" in err):
            blocked_paths.update(touched_paths)
        return tool_content, trace

    tool_content, trace = execute_tool(
        tool_name,
        tool_args,
        tool_call_id=tool_call_id,
        workspace_dir=workspace_dir,
        composer=composer,
        mcp_index=mcp_index,
        trace_id=trace_id,
    )
    if tool_name == "read_file" and str(trace.get("status") or "") == "succeeded":
        path = _resolve_guard_path(workspace_dir, tool_args.get("path"))
        if path:
            blocked_paths.discard(path)
    return tool_content, trace


def _make_recovery_trace(*, reason: str, action: str, detail: str, step: int, index: int) -> Dict[str, Any]:
    started = now_ms()
    return {
        "id": f"tr_recover_{started}_{index}",
        "toolCallId": f"recovery_{step}_{index}",
        "name": "recovery/model_fallback",
        "status": "succeeded",
        "startedAt": started,
        "endedAt": started,
        "durationMs": 0,
        "argsPreview": preview_json({"reason": reason, "action": action, "step": step}, max_chars=800),
        "resultPreview": preview_tool_result(detail, max_chars=1200),
    }


def _build_verification(*, traces: List[Dict[str, Any]], require_evidence: bool) -> Dict[str, Any]:
    evidences: List[Dict[str, Any]] = []
    succeeded = [t for t in traces if isinstance(t, dict) and str(t.get("status") or "") == "succeeded" and not str(t.get("name") or "").startswith("recovery/")]
    failed = [t for t in traces if isinstance(t, dict) and str(t.get("status") or "") == "failed"]
    for tr in succeeded[:3]:
        rp = tr.get("resultPreview") if isinstance(tr.get("resultPreview"), dict) else {}
        evidences.append(
            {
                "type": "tool_receipt",
                "tool": str(tr.get("name") or ""),
                "summary": str(rp.get("text") or "")[:200],
            }
        )
    if evidences:
        return {"status": "passed", "evidence": evidences}
    if failed and require_evidence:
        top = failed[0]
        err = top.get("error") if isinstance(top.get("error"), dict) else {}
        return {
            "status": "failed",
            "evidence": [
                {
                    "type": "tool_failure",
                    "tool": str(top.get("name") or ""),
                    "summary": str(err.get("message") or "")[:200],
                }
            ],
        }
    if require_evidence:
        return {"status": "unverified", "evidence": []}
    return {"status": "passed", "evidence": [{"type": "skipped", "summary": "verification not required"}]}


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


def _isolate_worker_messages(messages: List[Dict[str, Any]], composer: Dict[str, Any]) -> List[Dict[str, Any]]:
    role = str((composer or {}).get("agentRole") or "").strip().lower()
    if role != "worker":
        return messages
    if not isinstance(messages, list) or not messages:
        return []
    last_user = None
    for m in reversed(messages):
        if isinstance(m, dict) and str(m.get("role") or "") == "user":
            last_user = m
            break
    if isinstance(last_user, dict):
        return [last_user]
    return [messages[-1]] if isinstance(messages[-1], dict) else []


def _collect_worker_tasks(composer: Dict[str, Any]) -> List[Any]:
    raw = composer.get("__workerTasksInternal")
    if not isinstance(raw, list):
        return []
    out: List[Any] = []
    for item in raw:
        if isinstance(item, dict):
            out.append(dict(item))
            continue
        s = str(item or "").strip()
        if s:
            out.append(s)
    return out


def _extract_json_object(text: str) -> Dict[str, Any]:
    s = str(text or "").strip()
    if not s:
        return {}
    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        pass
    left = s.find("{")
    right = s.rfind("}")
    if left < 0 or right <= left:
        return {}
    try:
        obj = json.loads(s[left : right + 1])
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _plan_worker_execution(
    *,
    provider: Any,
    messages: List[Dict[str, Any]],
    composer: Dict[str, Any],
    temperature: float,
    max_tokens: int,
    extra_body: Optional[Dict[str, Any]],
    emit_event: Optional[Callable[[Any], None]] = None,
) -> Dict[str, Any]:
    if str((composer or {}).get("agentRole") or "").strip().lower() == "worker":
        return {"tasks": [], "parallelism": 1, "retryMax": 0, "timeoutMs": 0}

    last_user = ""
    for m in reversed(messages or []):
        if not isinstance(m, dict):
            continue
        if str(m.get("role") or "").strip() != "user":
            continue
        text = str(m.get("content") or "").strip()
        if text:
            last_user = text
            break
    if not last_user:
        return {"tasks": [], "parallelism": 1, "retryMax": 0, "timeoutMs": 0}

    force_orchestration = bool((composer or {}).get("orchestrationForce"))
    if not force_orchestration:
        low = last_user.lower()
        likely_complex = (
            len(last_user) >= 80
            or "\n" in last_user
            or " and " in low
            or " step " in low
            or " tasks " in low
            or "并且" in last_user
            or "同时" in last_user
            or "分别" in last_user
            or "分成" in last_user
            or "步骤" in last_user
        )
        if not likely_complex:
            return {"tasks": [], "parallelism": 1, "retryMax": 0, "timeoutMs": 0}

    if callable(emit_event):
        try:
            emit_event({"type": "stage", "stage": "planner_start", "step": 0})
        except Exception:
            pass

    planner_messages = [
        {
            "role": "system",
            "content": (
                "你是任务编排器。目标是判断是否需要并行子任务执行。"
                "只输出一个 JSON 对象，不要输出其他文字。"
                'JSON schema: {"shouldParallelize": boolean, "tasks": [{"prompt": string, "modelOverride": string, "timeoutMs": number}], '
                '"parallelism": number, "retryMax": number, "timeoutMs": number}.'
                "只有在任务可并行拆分时才 shouldParallelize=true，且 tasks 至少 2 项。"
                "如果不需要并行，返回 shouldParallelize=false 且 tasks=[]。"
            ),
        },
        {"role": "user", "content": f"用户任务:\n{last_user}"},
    ]

    try:
        planner_res = call_chat_completion(
            provider,
            planner_messages,
            temperature=min(float(temperature), 0.2),
            max_tokens=max(256, min(int(max_tokens or 0) or 600, 1200)),
            tools=None,
            tool_choice=None,
            model_override=str(composer.get("modelOverride") or "").strip() or None,
            extra_body=extra_body,
        )
        planner_choice = ((planner_res.get("choices") or [{}])[0]) if isinstance(planner_res, dict) else {}
        planner_msg = (planner_choice.get("message") or {}) if isinstance(planner_choice, dict) else {}
        planner_text = str(planner_msg.get("content") or "")
        planner_obj = _extract_json_object(planner_text)
    except Exception as e:
        planner_obj = {}
        if callable(emit_event):
            try:
                tr = _make_recovery_trace(
                    reason="runtime_error",
                    action="planner_fallback",
                    detail=f"planner failed: {str(e)}",
                    step=0,
                    index=0,
                )
                emit_event({"type": "tool_trace", "trace": tr})
            except Exception:
                pass

    should_parallelize = bool(planner_obj.get("shouldParallelize"))
    raw_tasks = planner_obj.get("tasks") if isinstance(planner_obj.get("tasks"), list) else []
    if not should_parallelize or len(raw_tasks) < 2:
        if callable(emit_event):
            try:
                emit_event({"type": "stage", "stage": "planner_done:skip", "step": 0})
            except Exception:
                pass
        return {"tasks": [], "parallelism": 1, "retryMax": 0, "timeoutMs": 0}

    timeout_ms = _clamp_int(planner_obj.get("timeoutMs"), 0, 0, 300_000)
    tasks = [
        _normalize_worker_task(
            item,
            index=i,
            default_model_override="",
            default_timeout_ms=timeout_ms,
        )
        for i, item in enumerate(raw_tasks, start=1)
    ]
    tasks = [t for t in tasks if str(t.get("prompt") or "").strip()]
    if len(tasks) < 2:
        if callable(emit_event):
            try:
                emit_event({"type": "stage", "stage": "planner_done:skip", "step": 0})
            except Exception:
                pass
        return {"tasks": [], "parallelism": 1, "retryMax": 0, "timeoutMs": 0}

    parallelism = _clamp_int(planner_obj.get("parallelism"), min(4, len(tasks)), 1, 8)
    retry_max = _clamp_int(planner_obj.get("retryMax"), 1, 0, 3)
    if callable(emit_event):
        try:
            emit_event({"type": "stage", "stage": f"planner_done:{len(tasks)}", "step": 0})
        except Exception:
            pass
    return {
        "tasks": tasks,
        "parallelism": parallelism,
        "retryMax": retry_max,
        "timeoutMs": timeout_ms,
    }


def _clamp_int(raw: Any, default_v: int, min_v: int, max_v: int) -> int:
    try:
        v = int(raw)
    except Exception:
        v = int(default_v)
    return max(min_v, min(max_v, v))


def _normalize_worker_task(
    item: Any,
    *,
    index: int,
    default_model_override: str,
    default_timeout_ms: int,
) -> Dict[str, Any]:
    if isinstance(item, dict):
        prompt = str(item.get("prompt") or item.get("task") or item.get("content") or "").strip()
        model_override = str(item.get("modelOverride") or default_model_override or "").strip()
        timeout_ms = _clamp_int(item.get("timeoutMs"), default_timeout_ms, 0, 300_000)
    else:
        prompt = str(item or "").strip()
        model_override = str(default_model_override or "").strip()
        timeout_ms = _clamp_int(default_timeout_ms, default_timeout_ms, 0, 300_000)
    return {
        "index": index,
        "prompt": prompt,
        "modelOverride": model_override,
        "timeoutMs": timeout_ms,
    }


def _run_coordinator_workers(
    *,
    provider: Any,
    settings_obj: Dict[str, Any],
    composer: Dict[str, Any],
    temperature: float,
    max_tokens: int,
    extra_body: Optional[Dict[str, Any]],
    emit_event: Optional[Callable[[Any], None]] = None,
    plan: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    plan_obj = plan if isinstance(plan, dict) else {}
    normalized_plan_tasks = plan_obj.get("tasks") if isinstance(plan_obj.get("tasks"), list) else []
    if not normalized_plan_tasks:
        return {
            "reportsText": "",
            "traces": [],
            "artifacts": [],
            "verification": {"status": "passed", "evidence": []},
            "orchestration": {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}},
        }

    from anima_backend_shared.chat import apply_attachments_inline

    default_timeout_ms = _clamp_int(plan_obj.get("timeoutMs"), 0, 0, 300_000)
    parallelism = _clamp_int(plan_obj.get("parallelism"), 1, 1, 8)
    retry_max = _clamp_int(plan_obj.get("retryMax"), 1, 0, 3)
    tasks = [t for t in normalized_plan_tasks if isinstance(t, dict)]
    tasks = [t for t in tasks if str(t.get("prompt") or "").strip()]
    if not tasks:
        return {
            "reportsText": "",
            "traces": [],
            "artifacts": [],
            "verification": {"status": "passed", "evidence": []},
            "orchestration": {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}},
        }

    def _execute_one(task_def: Dict[str, Any]) -> Dict[str, Any]:
        i = int(task_def.get("index") or 0)
        task = str(task_def.get("prompt") or "").strip()
        timeout_ms = _clamp_int(task_def.get("timeoutMs"), default_timeout_ms, 0, 300_000)
        task_model_override = str(task_def.get("modelOverride") or "").strip()

        local_traces: List[Dict[str, Any]] = []
        local_artifacts: List[Dict[str, Any]] = []
        local_retries = 0
        local_failure_reasons: Dict[str, int] = {}
        out: Dict[str, Any] = {}

        worker_composer = dict(composer)
        worker_composer.pop("workerTasks", None)
        worker_composer.pop("workerParallelism", None)
        worker_composer.pop("workerRetryMax", None)
        worker_composer.pop("workerTimeoutMs", None)
        worker_composer.pop("workerModelOverride", None)
        worker_composer["agentRole"] = "worker"
        worker_composer["verificationRequired"] = True
        if task_model_override:
            worker_composer["modelOverride"] = task_model_override
        worker_messages = [{"role": "user", "content": task}]
        worker_messages = inject_system_message(worker_messages, settings_obj, worker_composer)
        prepared = apply_attachments_inline(worker_messages, worker_composer)
        if callable(emit_event):
            try:
                emit_event({"type": "stage", "stage": f"worker_start:{i}", "step": i})
            except Exception:
                pass
        attempt = 0
        while True:
            worker_provider = create_provider(settings_obj, worker_composer)
            holder: Dict[str, Any] = {}

            def _call() -> None:
                holder["out"] = _run_tool_loop(
                    provider=worker_provider,
                    prepared=prepared,
                    composer=worker_composer,
                    settings_obj=settings_obj,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    extra_body=extra_body,
                    emit_event=emit_event,
                )

            if timeout_ms > 0:
                t = threading.Thread(target=_call, name=f"worker-loop-{i}", daemon=True)
                t.start()
                t.join(timeout_ms / 1000.0)
                if t.is_alive():
                    timeout_trace = _make_recovery_trace(
                        reason="timeout",
                        action="worker_timeout",
                        detail=f"worker-{i} exceeded timeoutMs={timeout_ms}",
                        step=i,
                        index=len(local_traces),
                    )
                    local_traces.append(timeout_trace)
                    out = {
                        "paused": False,
                        "final_content": "",
                        "usage": None,
                        "traces": [],
                        "artifacts": [],
                        "reasoning": "",
                        "messages": [{"role": "assistant", "content": ""}],
                        "rate_limit": None,
                        "stop_reason": "timeout",
                        "verification": {"status": "failed", "evidence": [{"type": "timeout", "summary": f"worker timeout {timeout_ms}ms"}]},
                    }
                else:
                    out = holder.get("out") if isinstance(holder.get("out"), dict) else {}
            else:
                _call()
                out = holder.get("out") if isinstance(holder.get("out"), dict) else {}

            verification = out.get("verification") if isinstance(out.get("verification"), dict) else {}
            v_status = str(verification.get("status") or "").strip() or "unverified"
            stop_reason = str(out.get("stop_reason") or "completed").strip() or "completed"
            ok = stop_reason == "completed" and v_status == "passed"
            if not ok:
                local_failure_reasons[stop_reason] = int(local_failure_reasons.get(stop_reason) or 0) + 1
            if ok or attempt >= retry_max:
                break
            attempt += 1
            local_retries += 1
            retry_trace = _make_recovery_trace(
                reason=stop_reason,
                action="worker_retry",
                detail=f"worker-{i} retry attempt={attempt} task={task[:120]}",
                step=i,
                index=len(local_traces),
            )
            local_traces.append(retry_trace)
            if callable(emit_event):
                try:
                    emit_event({"type": "tool_trace", "trace": retry_trace})
                except Exception:
                    pass
        local_traces.extend([x for x in (out.get("traces") or []) if isinstance(x, dict)])
        local_artifacts.extend([x for x in (out.get("artifacts") or []) if isinstance(x, dict)])
        verification = out.get("verification") if isinstance(out.get("verification"), dict) else {}
        v_status = str(verification.get("status") or "").strip() or "unverified"
        stop_reason = str(out.get("stop_reason") or "completed").strip()
        content = str(out.get("final_content") or "").strip()
        report = f"[worker-{i}] task={task}\nstatus={stop_reason}/{v_status}\nresult={content}"
        if callable(emit_event):
            try:
                emit_event({"type": "stage", "stage": f"worker_done:{i}", "step": i})
            except Exception:
                pass
        return {
            "index": i,
            "report": report,
            "ok": (stop_reason == "completed" and v_status == "passed"),
            "traces": local_traces,
            "artifacts": local_artifacts,
            "retries": local_retries,
            "failureReasons": local_failure_reasons,
        }

    results: List[Dict[str, Any]] = []
    if parallelism <= 1 or len(tasks) <= 1:
        for task in tasks:
            results.append(_execute_one(task))
    else:
        with ThreadPoolExecutor(max_workers=parallelism) as pool:
            futs = [pool.submit(_execute_one, t) for t in tasks]
            for fut in as_completed(futs):
                try:
                    r = fut.result()
                    if isinstance(r, dict):
                        results.append(r)
                except Exception as e:
                    results.append(
                        {
                            "index": 0,
                            "report": f"[worker-unknown] status=runtime_error/failed result={str(e)}",
                            "ok": False,
                            "traces": [],
                            "artifacts": [],
                            "retries": 0,
                            "failureReasons": {"runtime_error": 1},
                        }
                    )

    results.sort(key=lambda x: int(x.get("index") or 0))
    traces: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []
    reports: List[str] = []
    total_retries = 0
    failure_reasons: Dict[str, int] = {}
    failed_workers = 0
    for r in results:
        reports.append(str(r.get("report") or ""))
        traces.extend([x for x in (r.get("traces") or []) if isinstance(x, dict)])
        artifacts.extend([x for x in (r.get("artifacts") or []) if isinstance(x, dict)])
        total_retries += int(r.get("retries") or 0)
        if not bool(r.get("ok")):
            failed_workers += 1
        fr = r.get("failureReasons") if isinstance(r.get("failureReasons"), dict) else {}
        for k, v in fr.items():
            kk = str(k or "").strip() or "runtime_error"
            try:
                vv = int(v)
            except Exception:
                vv = 0
            failure_reasons[kk] = int(failure_reasons.get(kk) or 0) + max(0, vv)
    failed = failed_workers > 0

    return {
        "reportsText": "\n\n".join(reports).strip(),
        "traces": traces,
        "artifacts": artifacts,
        "verification": {
            "status": "failed" if failed else "passed",
            "evidence": [
                {"type": "worker_report", "summary": f"workers={len(tasks)} failed={1 if failed else 0}"},
            ],
        },
        "orchestration": {
            "workers": len(tasks),
            "failedWorkers": failed_workers,
            "totalRetries": total_retries,
            "failureReasons": failure_reasons,
        },
    }


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
    existing_traces: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    def _emit(obj: Any) -> None:
        if not callable(emit_event):
            return
        emit_event(obj)

    tools, mcp_index, tool_choice = select_tools(settings_obj, composer)
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
    stop_reason = "completed"
    verification_required = bool(composer.get("verificationRequired"))
    initial_workspace_dir = ""
    cdir = str(composer.get("workspaceDir") or "").strip()
    sdir = str(((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("workspaceDir") or "").strip()
    initial_workspace_dir = cdir or sdir
    try:
        if initial_workspace_dir:
            initial_workspace_dir = norm_abs(initial_workspace_dir)
    except Exception:
        initial_workspace_dir = ""
    edit_guard_state = _build_edit_guard_state(existing_traces, initial_workspace_dir)

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

    try:
        _emit({"type": "stage", "stage": "prepare", "step": 0})
    except Exception:
        pass

    for step in range(MAX_TOOL_STEPS):
        try:
            _emit({"type": "stage", "stage": "model", "step": step})
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
                    message = (choice.get("message") or {}) if isinstance(choice, dict) else {}
                    top_message = evt.get("message") if isinstance(evt, dict) else {}
                    if not isinstance(delta, dict):
                        delta = {}
                    if not isinstance(message, dict):
                        message = {}
                    if not isinstance(top_message, dict):
                        top_message = {}

                    part = as_text(delta.get("content")) or as_text(message.get("content")) or as_text(top_message.get("content"))
                    if isinstance(part, str) and part:
                        content_parts.append(part)
                        try:
                            _emit({"type": "model_delta", "content": part, "step": step})
                            emitted_any_delta = True
                        except Exception:
                            pass
                    for rk in ("reasoning_content", "thinking", "reasoning"):
                        rc_part = (
                            as_text(delta.get(rk))
                            or as_text(message.get(rk))
                            or as_text(top_message.get(rk))
                            or as_text(choice.get(rk) if isinstance(choice, dict) else None)
                            or as_text(evt.get(rk) if isinstance(evt, dict) else None)
                        )
                        if not rc_part:
                            continue
                        reasoning_content_parts.append(rc_part)
                        emitted_reasoning_deltas = True
                        try:
                            _emit({"type": "reasoning_delta", "content": rc_part, "step": step})
                        except Exception:
                            pass
                    tc_list = delta.get("tool_calls")
                    if not isinstance(tc_list, list):
                        tc_list = message.get("tool_calls") if isinstance(message.get("tool_calls"), list) else None
                    if not isinstance(tc_list, list):
                        tc_list = top_message.get("tool_calls") if isinstance(top_message.get("tool_calls"), list) else None
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
                reason = _classify_recovery_reason("stream_failed")
                detail = "stream path failed; fallback to non-stream chat_completion"
                recover_trace = _make_recovery_trace(reason=reason, action="fallback_non_stream", detail=detail, step=step, index=len(traces))
                traces.append(recover_trace)
                try:
                    _emit({"type": "stage", "stage": "recover", "step": step})
                    _emit({"type": "tool_trace", "trace": recover_trace})
                except Exception:
                    pass
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
            if not emitted_any_delta and not str(content or "").strip():
                raise RuntimeError("Model returned no text and no tool calls")
            final_content = str(content or "")
            break

        next_messages = list(cur)
        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": str(content or ""), "tool_calls": tool_calls}
        if getattr(provider, "include_reasoning_content_in_messages", False):
            rc = msg.get("reasoning_content")
            if isinstance(rc, str) and rc.strip():
                assistant_msg["reasoning_content"] = rc
        next_messages.append(assistant_msg)
        try:
            _emit({"type": "stage", "stage": "tools", "step": step})
        except Exception:
            pass

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

            tool_content, trace = _execute_tool_with_edit_guard(
                tool_name=fn_name,
                tool_args=fn_args,
                tool_call_id=tc_id,
                workspace_dir=workspace_dir,
                composer=composer,
                mcp_index=mcp_index,
                trace_id=trace_id,
                edit_guard_state=edit_guard_state,
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
                    "stop_reason": "blocked_by_approval",
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
                    "verification": {"status": "unverified", "evidence": []},
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
        stop_reason = "exhausted"

    rate_limit = get_last_rate_limit(provider)
    output_messages = list(cur)
    verification = _build_verification(traces=traces, require_evidence=verification_required or bool(traces))
    if verification_required and str(verification.get("status") or "") != "passed":
        stop_reason = "verification_failed"
    output_messages.append({"role": "assistant", "content": str(final_content or "")})
    try:
        _emit({"type": "stage", "stage": "verify", "step": MAX_TOOL_STEPS})
    except Exception:
        pass

    return {
        "paused": False,
        "final_content": str(final_content or ""),
        "stop_reason": stop_reason,
        "usage": usage,
        "traces": traces,
        "artifacts": artifacts,
        "reasoning": "\n\n".join([r for r in reasoning_parts if str(r).strip()]).strip(),
        "messages": output_messages,
        "rate_limit": rate_limit,
        "verification": verification,
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
    workspace_warning = _workspace_preflight_warning(settings_obj, composer)
    try:
        provider = create_provider(settings_obj, composer)
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        if "no provider configured" in low:
            payload: Dict[str, Any] = {"ok": False, "error": msg, "code": "provider_not_configured"}
            if isinstance(workspace_warning, dict):
                payload["warnings"] = [workspace_warning]
            return int(HTTPStatus.BAD_REQUEST), payload
        payload = {"ok": False, "error": msg}
        if isinstance(workspace_warning, dict):
            payload["warnings"] = [workspace_warning]
        return int(HTTPStatus.INTERNAL_SERVER_ERROR), payload
    temperature, max_tokens, extra_body = resolve_runtime_options(body=body, composer=composer, settings_obj=settings_obj)

    extra_body, max_tokens = _apply_thinking_level(provider, composer, extra_body, max_tokens)

    from anima_backend_shared.chat import apply_attachments_inline

    compression_evt = None
    if use_thread_messages and thread_id:
        messages, composer, compression_evt = _apply_persistent_compression(
            chat_id=thread_id, messages=messages, settings_obj=settings_obj, provider=provider, composer=composer, extra_body=extra_body
        )
    orchestration_plan = _plan_worker_execution(
        provider=provider,
        messages=messages,
        composer=composer,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        emit_event=None,
    )
    worker_ctx = _run_coordinator_workers(
        provider=provider,
        settings_obj=settings_obj,
        composer=composer,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        emit_event=None,
        plan=orchestration_plan,
    )
    worker_reports_text = str(worker_ctx.get("reportsText") or "").strip()
    if worker_reports_text:
        messages = list(messages) + [{"role": "assistant", "content": "Worker reports:\n" + worker_reports_text}]
    messages = _isolate_worker_messages(messages, composer)
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
                    "stopReason": out.get("stop_reason") or "blocked_by_approval",
                    "verification": out.get("verification"),
                },
            )
            return int(HTTPStatus.CONFLICT), {
                "ok": False,
                "code": "approval_required",
                "runId": run_id,
                "threadId": thread_id,
                "approval": approval,
                "warnings": [workspace_warning] if isinstance(workspace_warning, dict) else [],
            }

        usage_final, usage_source = normalize_or_estimate_usage(
            usage=out.get("usage"),
            settings_obj=settings_obj,
            composer=composer,
            messages=out.get("messages") if isinstance(out.get("messages"), list) else prepared,
        )
        worker_traces = [x for x in (worker_ctx.get("traces") or []) if isinstance(x, dict)]
        worker_artifacts = [x for x in (worker_ctx.get("artifacts") or []) if isinstance(x, dict)]
        orchestration = worker_ctx.get("orchestration") if isinstance(worker_ctx.get("orchestration"), dict) else {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}}
        merged_traces = worker_traces + [x for x in (out.get("traces") or []) if isinstance(x, dict)]
        merged_artifacts = worker_artifacts + [x for x in (out.get("artifacts") or []) if isinstance(x, dict)]
        worker_ver = worker_ctx.get("verification") if isinstance(worker_ctx.get("verification"), dict) else {"status": "passed", "evidence": []}
        final_ver = out.get("verification") if isinstance(out.get("verification"), dict) else {"status": "unverified", "evidence": []}
        final_ver_status = str(final_ver.get("status") or "").strip() or "unverified"
        worker_ver_status = str(worker_ver.get("status") or "").strip() or "unverified"
        if worker_ver_status != "passed" and final_ver_status == "passed":
            final_ver_status = "failed"
        final_ver["status"] = final_ver_status
        final_ver["evidence"] = [x for x in (worker_ver.get("evidence") or []) if isinstance(x, dict)] + [x for x in (final_ver.get("evidence") or []) if isinstance(x, dict)]
        out_stop_reason = str(out.get("stop_reason") or "completed").strip() or "completed"
        if worker_ver_status != "passed" and out_stop_reason == "completed":
            out_stop_reason = "verification_failed"
        try:
            merge_chat_meta(thread_id, {"usageState": build_usage_state(usage_final, usage_source)})
        except Exception:
            pass

        update_run(
            run_id,
            "succeeded",
            {
                "content": out.get("final_content") or "",
                "usage": usage_final,
                "traces": merged_traces,
                "artifacts": merged_artifacts,
                "reasoning": out.get("reasoning") or "",
                "messages": out.get("messages"),
                "compression": compression_evt,
                "stopReason": out_stop_reason,
                "verification": final_ver,
                "orchestration": orchestration,
            },
        )

        payload: Dict[str, Any] = {
            "ok": True,
            "runId": run_id,
            "threadId": thread_id,
            "content": str(out.get("final_content") or ""),
            "usage": usage_final,
            "traces": merged_traces,
            "artifacts": merged_artifacts,
            "reasoning": str(out.get("reasoning") or ""),
            "backendImpl": "stream-executor",
            "stopReason": out_stop_reason,
            "verification": final_ver,
            "orchestration": orchestration,
        }
        if isinstance(compression_evt, dict) and compression_evt:
            payload["compression"] = compression_evt
        rate_limit = out.get("rate_limit")
        if isinstance(rate_limit, dict) and rate_limit:
            payload["rateLimit"] = rate_limit
        if isinstance(workspace_warning, dict):
            payload["warnings"] = [workspace_warning]
        return int(HTTPStatus.OK), payload
    except Exception as e:
        try:
            update_run(run_id, "failed", {"error": str(e)})
        except Exception:
            pass
        payload = {"ok": False, "error": str(e)}
        if isinstance(workspace_warning, dict):
            payload["warnings"] = [workspace_warning]
        return int(HTTPStatus.INTERNAL_SERVER_ERROR), payload


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
    workspace_warning = _workspace_preflight_warning(settings_obj, composer)
    try:
        provider = create_provider(settings_obj, composer)
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        if "no provider configured" in low:
            status = HTTPStatus.BAD_REQUEST
            payload = {"ok": False, "error": msg, "code": "provider_not_configured"}
        else:
            status = HTTPStatus.INTERNAL_SERVER_ERROR
            payload = {"ok": False, "error": msg}
        if isinstance(workspace_warning, dict):
            payload["warnings"] = [workspace_warning]
        handler.send_response(status)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.end_headers()
        handler.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        return
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

    if isinstance(workspace_warning, dict):
        try:
            emit({"type": "warning", "warning": workspace_warning})
        except Exception:
            return

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
    orchestration_plan = _plan_worker_execution(
        provider=provider,
        messages=messages,
        composer=composer,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        emit_event=emit,
    )
    worker_ctx = _run_coordinator_workers(
        provider=provider,
        settings_obj=settings_obj,
        composer=composer,
        temperature=temperature,
        max_tokens=max_tokens,
        extra_body=extra_body,
        emit_event=emit,
        plan=orchestration_plan,
    )
    worker_reports_text = str(worker_ctx.get("reportsText") or "").strip()
    if worker_reports_text:
        messages = list(messages) + [{"role": "assistant", "content": "Worker reports:\n" + worker_reports_text}]
    messages = _isolate_worker_messages(messages, composer)
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
                "stopReason": obj.get("stopReason"),
                "verification": obj.get("verification"),
                "orchestration": obj.get("orchestration"),
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
                    "stopReason": out.get("stop_reason") or "blocked_by_approval",
                    "verification": out.get("verification"),
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

        usage_final, usage_source = normalize_or_estimate_usage(
            usage=out.get("usage"),
            settings_obj=settings_obj,
            composer=composer,
            messages=out.get("messages") if isinstance(out.get("messages"), list) else prepared,
        )
        worker_traces = [x for x in (worker_ctx.get("traces") or []) if isinstance(x, dict)]
        worker_artifacts = [x for x in (worker_ctx.get("artifacts") or []) if isinstance(x, dict)]
        orchestration = worker_ctx.get("orchestration") if isinstance(worker_ctx.get("orchestration"), dict) else {"workers": 0, "failedWorkers": 0, "totalRetries": 0, "failureReasons": {}}
        merged_traces = worker_traces + [x for x in (out.get("traces") or []) if isinstance(x, dict)]
        merged_artifacts = worker_artifacts + [x for x in (out.get("artifacts") or []) if isinstance(x, dict)]
        worker_ver = worker_ctx.get("verification") if isinstance(worker_ctx.get("verification"), dict) else {"status": "passed", "evidence": []}
        final_ver = out.get("verification") if isinstance(out.get("verification"), dict) else {"status": "unverified", "evidence": []}
        final_ver_status = str(final_ver.get("status") or "").strip() or "unverified"
        worker_ver_status = str(worker_ver.get("status") or "").strip() or "unverified"
        if worker_ver_status != "passed" and final_ver_status == "passed":
            final_ver_status = "failed"
        final_ver["status"] = final_ver_status
        final_ver["evidence"] = [x for x in (worker_ver.get("evidence") or []) if isinstance(x, dict)] + [x for x in (final_ver.get("evidence") or []) if isinstance(x, dict)]
        out_stop_reason = str(out.get("stop_reason") or "completed").strip() or "completed"
        if worker_ver_status != "passed" and out_stop_reason == "completed":
            out_stop_reason = "verification_failed"
        try:
            merge_chat_meta(thread_id, {"usageState": build_usage_state(usage_final, usage_source)})
        except Exception:
            pass

        update_run(
            run_id,
            "succeeded",
            {
                "content": out.get("final_content") or "",
                "usage": usage_final,
                "traces": merged_traces,
                "artifacts": merged_artifacts,
                "reasoning": out.get("reasoning") or "",
                "messages": out.get("messages"),
                "stopReason": out_stop_reason,
                "verification": final_ver,
                "orchestration": orchestration,
            },
        )

        try:
            emit_event(
                {
                    "type": "run_done",
                    "usage": usage_final,
                    "reasoning": out.get("reasoning") or "",
                    "traces": merged_traces,
                    "artifacts": merged_artifacts,
                    "rateLimit": out.get("rate_limit"),
                    "stopReason": out_stop_reason,
                    "verification": final_ver,
                    "orchestration": orchestration,
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
