from __future__ import annotations

from typing import Any, Dict, List


DEFAULT_CODEX_CONTEXT_WINDOW = 128000
DEFAULT_CODEX_SELECTED_MODEL = "gpt-5.2-codex"
CODEX_MODEL_IDS = [
    "gpt-5.4",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.2-codex-low",
    "gpt-5.2-codex-medium",
    "gpt-5.2-codex-high",
    "gpt-5.2-codex-xhigh",
]


def build_openai_codex_models() -> List[Dict[str, Any]]:
    return [
        {
            "id": model_id,
            "isEnabled": True,
            "config": {
                "id": model_id,
                "contextWindow": DEFAULT_CODEX_CONTEXT_WINDOW,
            },
        }
        for model_id in CODEX_MODEL_IDS
    ]
