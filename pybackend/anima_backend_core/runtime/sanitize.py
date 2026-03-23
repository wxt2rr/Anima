from __future__ import annotations

from typing import Any, Dict, List, Tuple

from anima_backend_shared.util import now_ms, preview_json, preview_tool_result


def sanitize_history_messages(messages: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not isinstance(messages, list):
        return [], []

    sanitized: List[Dict[str, Any]] = []
    dropped_traces: List[Dict[str, Any]] = []
    seen_tool_call_ids: set[str] = set()

    def _drop_trace(*, i: int, message: Dict[str, Any], error: str) -> None:
        ts = now_ms()
        trace_id = f"tr_histdrop_{ts}_{i}"
        dropped_traces.append(
            {
                "id": trace_id,
                "toolCallId": f"history_{i}",
                "name": "history_message",
                "status": "failed",
                "startedAt": ts,
                "endedAt": ts,
                "durationMs": 0,
                "argsPreview": preview_json(message, max_chars=800),
                "resultPreview": preview_tool_result(str(message.get("content") or ""), max_chars=1200),
                "error": {"message": error},
            }
        )

    for i, m in enumerate(messages):
        if not isinstance(m, dict):
            sanitized.append(m)
            continue

        role = m.get("role")
        if role == "assistant":
            tool_calls = m.get("tool_calls")
            if not isinstance(tool_calls, list) or not tool_calls:
                sanitized.append(m)
                continue

            kept_tool_calls: List[Dict[str, Any]] = []
            for tc in tool_calls:
                if not isinstance(tc, dict):
                    continue
                tc_id = tc.get("id")
                if isinstance(tc_id, str) and tc_id.strip():
                    kept_tool_calls.append(tc)
                    seen_tool_call_ids.add(tc_id.strip())
                    continue
                _drop_trace(i=i, message={"role": "assistant", "tool_calls": [tc]}, error="Dropped assistant tool_call missing id")

            next_m = dict(m)
            if kept_tool_calls:
                next_m["tool_calls"] = kept_tool_calls
            else:
                next_m.pop("tool_calls", None)
            sanitized.append(next_m)
            continue

        if role != "tool":
            sanitized.append(m)
            continue

        tc_id = m.get("tool_call_id")
        if isinstance(tc_id, str) and tc_id.strip():
            if tc_id.strip() in seen_tool_call_ids:
                sanitized.append(m)
            else:
                _drop_trace(i=i, message=m, error="Dropped tool message with unmatched tool_call_id")
            continue

        meta = m.get("meta")
        if isinstance(meta, dict):
            traces = meta.get("toolTraces")
            if isinstance(traces, list) and traces:
                first = traces[0]
                if isinstance(first, dict):
                    tc_id = first.get("toolCallId")
                    if isinstance(tc_id, str) and tc_id.strip():
                        if tc_id.strip() in seen_tool_call_ids:
                            next_m = dict(m)
                            next_m["tool_call_id"] = tc_id.strip()
                            sanitized.append(next_m)
                        else:
                            _drop_trace(
                                i=i,
                                message={"role": "tool", "content": str(m.get("content") or ""), "tool_call_id": tc_id.strip(), "meta": meta},
                                error="Dropped tool message recovered tool_call_id not found in prior tool_calls",
                            )
                        continue

        _drop_trace(i=i, message={"role": "tool", "content": str(m.get("content") or ""), "meta": meta}, error="Dropped tool message missing tool_call_id")

    return sanitized, dropped_traces
