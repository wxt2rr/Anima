import json
from typing import Any, Dict

from anima_backend_lg.runtime.graph import build_run_graph


class MockProvider:
    include_reasoning_content_in_messages = False

    def __init__(self) -> None:
        self._calls = 0
        self.last_rate_limit = None

    def chat_completion(
        self,
        messages,
        *,
        temperature,
        max_tokens,
        tools=None,
        tool_choice=None,
        model_override=None,
        extra_body=None,
    ):
        self._calls += 1
        if self._calls == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "type": "function",
                                    "function": {
                                        "name": "TodoWrite",
                                        "arguments": '{"todos":[{"id":"t1","content":"x","status":"pending","priority":"low"}],"merge":true}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        return {"choices": [{"message": {"role": "assistant", "content": "ok"}}]}


def _run_legacy(body: Dict[str, Any]) -> Dict[str, Any]:
    _ = body
    return {"ok": False, "error": "legacy backend removed"}


def _run_langgraph(body: Dict[str, Any]) -> Dict[str, Any]:
    provider = MockProvider()
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    composer = body.get("composer") if isinstance(body.get("composer"), dict) else {}
    temperature = float(body.get("temperature") or 0.7)
    max_tokens = int(body.get("maxTokens") or 128)
    extra_body = body.get("extraBody") if isinstance(body.get("extraBody"), dict) else None

    graph = build_run_graph(provider)
    init_state = {
        "run_id": "r1",
        "thread_id": "t1",
        "messages": messages,
        "composer": composer,
        "settings": {"settings": {"defaultToolMode": "all"}},
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
    return {
        "ok": True,
        "content": str((out or {}).get("final_content") or ""),
        "usage": (out or {}).get("usage"),
        "traces": (out or {}).get("traces") or [],
        "reasoning": str((out or {}).get("reasoning") or ""),
        "messages": (out or {}).get("messages") or [],
    }


def compare_once(body: Dict[str, Any]) -> Dict[str, Any]:
    legacy_payload = _run_legacy(body)
    lg_payload = _run_langgraph(body)

    result: Dict[str, Any] = {
        "legacy": legacy_payload,
        "langgraph": lg_payload,
    }

    if (
        isinstance(legacy_payload, dict)
        and isinstance(lg_payload, dict)
        and legacy_payload.get("ok") is True
        and lg_payload.get("ok") is True
    ):
        result["sameContent"] = str(legacy_payload.get("content") or "") == str(lg_payload.get("content") or "")
    return result


def main() -> None:
    body: Dict[str, Any] = {
        "messages": [{"role": "user", "content": "用一句话介绍一下 Anima 是什么？"}],
        "composer": {"toolMode": "disabled"},
        "useThreadMessages": False,
    }
    out = compare_once(body)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
