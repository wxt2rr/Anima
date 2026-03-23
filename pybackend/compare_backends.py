import json
from typing import Any, Dict


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


def _run_core(body: Dict[str, Any]) -> Dict[str, Any]:
    _ = body
    return {"ok": False, "error": "offline compare removed after core migration"}


def compare_once(body: Dict[str, Any]) -> Dict[str, Any]:
    legacy_payload = _run_legacy(body)
    lg_payload = _run_core(body)

    result: Dict[str, Any] = {
        "legacy": legacy_payload,
        "core": lg_payload,
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
