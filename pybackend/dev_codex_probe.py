import json
import os
import time

from anima_backend_shared.database import config_root, db_path, get_app_settings, init_db
from anima_backend_shared.openai_codex_auth_runtime import resolve_openai_codex_access_token
from anima_backend_shared.providers import OpenAICodexChatProvider, ProviderSpec


def _load_settings_json() -> dict:
    p = config_root() / "settings.json"
    try:
        raw = p.read_text(encoding="utf-8")
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def main() -> int:
    init_db()
    print("config_root:", str(config_root()))
    print("db_path:", str(db_path()))

    settings = get_app_settings() or {}
    if settings:
        print("app_settings: ok")
    else:
        print("app_settings: missing; falling back to settings.json")
        settings = _load_settings_json()

    settings_block = settings.get("settings") if isinstance(settings, dict) else {}
    proxy_url = str(os.environ.get("ANIMA_PROXY_URL") or "")
    if not proxy_url and isinstance(settings_block, dict):
        proxy_url = str(settings_block.get("proxyUrl") or "")
    proxy_url = proxy_url.strip()

    try:
        token, account_id = resolve_openai_codex_access_token("openai_codex", "default")
        print("codex_oauth: ok")
    except Exception as e:
        print("codex_oauth: error:", str(e))
        return 2

    spec = ProviderSpec(
        provider_id="dev_codex_probe",
        provider_type="openai_codex",
        base_url="https://chatgpt.com/backend-api",
        api_key=token,
        model="gpt-5.2-codex",
        proxy_url=proxy_url,
        thinking_enabled=False,
        api_format="responses",
        use_max_completion_tokens=False,
        extra_headers={
            "chatgpt-account-id": account_id,
            "OpenAI-Beta": "responses=experimental",
            "originator": "codex_cli_rs",
        },
    )

    p = OpenAICodexChatProvider(spec)
    start = time.time()
    acc = ""
    try:
        for i, evt in enumerate(p.chat_completion_stream([{"role": "user", "content": "hi"}], temperature=0.2, max_tokens=16)):
            choice = (evt.get("choices") or [{}])[0] if isinstance(evt, dict) else {}
            delta = (choice.get("delta") or {}) if isinstance(choice, dict) else {}
            c = delta.get("content")
            if isinstance(c, str) and c:
                acc += c
            if i >= 50:
                break
        print("result_len:", len(acc))
        print("elapsed_s:", round(time.time() - start, 2))
        return 0
    except Exception as e:
        print("error:", str(e))
        print("elapsed_s:", round(time.time() - start, 2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

