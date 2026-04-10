from __future__ import annotations

import threading
import time
import uuid
from http import HTTPStatus
from typing import Any, Dict, Optional

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.oauth_flows import cleanup_expired, delete_flow, find_flow_by_kind_state, get_flow, patch_flow_data, upsert_flow
from anima_backend_shared.provider_credentials import delete_credential, list_profiles, upsert_oauth_credential
from anima_backend_shared.openai_codex_oauth import (
    build_authorize_url as codex_build_authorize_url,
    exchange_authorization_code as codex_exchange_authorization_code,
    extract_chatgpt_account_id as codex_extract_chatgpt_account_id,
    generate_pkce_verifier_challenge as codex_generate_pkce_verifier_challenge,
)
from anima_backend_shared.codex_models import DEFAULT_CODEX_SELECTED_MODEL, build_openai_codex_models
from anima_backend_shared.qwen_portal_oauth import (
    QWEN_COMPATIBLE_BASE_URL,
    generate_pkce_verifier_challenge as qwen_generate_pkce_verifier_challenge,
    normalize_qwen_resource_url,
    poll_device_token,
    request_device_code,
)
from anima_backend_shared.settings import load_settings, save_settings


_FLOW_LOCK = threading.Lock()
_CODEX_CB_LOCK = threading.Lock()
_CODEX_CB_SERVER: Any = None
_CODEX_CB_THREAD: Any = None


def _resolve_provider_kind(provider_record_id: str) -> str:
    rid = str(provider_record_id or "").strip()
    if not rid:
        return "qwen"
    try:
        settings_obj = load_settings()
        providers = settings_obj.get("providers") if isinstance(settings_obj, dict) else None
        if isinstance(providers, list):
            for p in providers:
                if not isinstance(p, dict):
                    continue
                if str(p.get("id") or "").strip() != rid:
                    continue
                t = str(p.get("type") or "").strip().lower()
                name = str(p.get("name") or "").strip().lower()
                if t == "openai_codex" or "codex" in name:
                    return "openai_codex"
                return "qwen"
    except Exception:
        return "qwen"
    return "qwen"


def _ensure_codex_callback_server() -> None:
    global _CODEX_CB_SERVER, _CODEX_CB_THREAD
    with _CODEX_CB_LOCK:
        if _CODEX_CB_SERVER is not None and _CODEX_CB_THREAD is not None:
            return
        import http.server
        import socketserver
        import urllib.parse

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return

            def do_GET(self) -> None:
                try:
                    parsed = urllib.parse.urlsplit(self.path or "")
                    if parsed.path != "/auth/callback":
                        self.send_response(HTTPStatus.NOT_FOUND)
                        self.send_header("Content-Type", "text/plain; charset=utf-8")
                        self.end_headers()
                        self.wfile.write(b"not found")
                        return
                    q = urllib.parse.parse_qs(parsed.query or "")
                    code = str((q.get("code") or [""])[0] or "").strip()
                    state = str((q.get("state") or [""])[0] or "").strip()
                    ok = False
                    if code and state:
                        now_ms = int(time.time() * 1000)
                        with _FLOW_LOCK:
                            cleanup_expired(now_ms)
                            flow = find_flow_by_kind_state("openai_codex", state)
                            if flow:
                                patch_flow_data(
                                    str(flow.get("flowId") or ""),
                                    {"code": code, "codeReceivedAt": now_ms},
                                )
                                ok = True
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.end_headers()
                    body = "OK. You may close this tab." if ok else "Invalid callback. You may close this tab."
                    self.wfile.write(body.encode("utf-8"))
                except Exception:
                    try:
                        self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
                        self.send_header("Content-Type", "text/plain; charset=utf-8")
                        self.end_headers()
                        self.wfile.write(b"error")
                    except Exception:
                        return

        class ReusableTCPServer(socketserver.TCPServer):
            allow_reuse_address = True

        try:
            srv = ReusableTCPServer(("127.0.0.1", 1455), Handler)
        except OSError as e:
            raise RuntimeError(f"Failed to start OAuth callback server on http://localhost:1455: {e}")
        t = threading.Thread(target=srv.serve_forever, name="openai_codex_oauth_callback", daemon=True)
        t.start()
        _CODEX_CB_SERVER = srv
        _CODEX_CB_THREAD = t


def handle_post_provider_auth_start(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        provider_id = str(body.get("providerId") or "").strip()
        if not provider_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "providerId is required"})
            return
        profile_id = str(body.get("profileId") or "").strip() or "default"

        now_ms = int(time.time() * 1000)
        kind = _resolve_provider_kind(provider_id)

        if kind == "openai_codex":
            _ensure_codex_callback_server()
            verifier, challenge = codex_generate_pkce_verifier_challenge()
            state = uuid.uuid4().hex
            verification_url = codex_build_authorize_url(challenge, state)
            expires_at = now_ms + 10 * 60 * 1000
            poll_interval_ms = 1000

            flow_id = uuid.uuid4().hex
            with _FLOW_LOCK:
                cleanup_expired(now_ms)
                upsert_flow(
                    flow_id=flow_id,
                    kind="openai_codex",
                    state=state,
                    expires_at=expires_at,
                    data={
                        "providerRecordId": provider_id,
                        "profileId": profile_id,
                        "verifier": verifier,
                        "code": "",
                        "verificationUrl": verification_url,
                        "expiresAt": expires_at,
                        "pollIntervalMs": poll_interval_ms,
                        "createdAt": now_ms,
                    },
                )

            json_response(
                handler,
                HTTPStatus.OK,
                {
                    "ok": True,
                    "flowId": flow_id,
                    "verificationUrl": verification_url,
                    "userCode": "",
                    "expiresAt": expires_at,
                    "pollIntervalMs": poll_interval_ms,
                },
            )
            return

        verifier, challenge = qwen_generate_pkce_verifier_challenge()
        device = request_device_code(challenge)
        verification_url = str(device.get("verification_uri_complete") or device.get("verification_uri") or "").strip()
        user_code = str(device.get("user_code") or "").strip()
        expires_in = int(device.get("expires_in") or 0)
        interval = int(device.get("interval") or 0)
        if not verification_url or not user_code or not expires_in:
            json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Invalid device code payload"})
            return
        expires_at = now_ms + expires_in * 1000
        poll_interval_ms = max(500, (interval * 1000) if interval > 0 else 2000)

        flow_id = uuid.uuid4().hex
        with _FLOW_LOCK:
            cleanup_expired(now_ms)
            upsert_flow(
                flow_id=flow_id,
                kind="qwen",
                state="",
                expires_at=expires_at,
                data={
                    "providerRecordId": provider_id,
                    "profileId": profile_id,
                    "verifier": verifier,
                    "deviceCode": str(device.get("device_code") or "").strip(),
                    "userCode": user_code,
                    "verificationUrl": verification_url,
                    "expiresAt": expires_at,
                    "pollIntervalMs": poll_interval_ms,
                    "createdAt": now_ms,
                    "lastPollAt": 0,
                },
            )

        json_response(
            handler,
            HTTPStatus.OK,
            {
                "ok": True,
                "flowId": flow_id,
                "verificationUrl": verification_url,
                "userCode": user_code,
                "expiresAt": expires_at,
                "pollIntervalMs": poll_interval_ms,
            },
        )
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def _apply_qwen_config_patch(resource_url: Optional[str], profile_id: str, provider_record_id: str) -> Dict[str, Any]:
    base_url = normalize_qwen_resource_url(resource_url) or QWEN_COMPATIBLE_BASE_URL
    models = [
        {"id": "coder-model", "isEnabled": True, "config": {"id": "coder-model", "contextWindow": 128000}},
        {"id": "vision-model", "isEnabled": True, "config": {"id": "vision-model", "contextWindow": 128000}},
    ]
    settings_obj = load_settings()
    providers = settings_obj.get("providers")
    if not isinstance(providers, list):
        return {}
    target_id = str(provider_record_id or "").strip().lower()
    updated = False
    next_providers = []
    for p in providers:
        if not isinstance(p, dict):
            next_providers.append(p)
            continue
        pid = str(p.get("id") or "").strip().lower()
        if target_id:
            if pid != target_id:
                next_providers.append(p)
                continue
        else:
            if pid not in ("qwen_auth", "qwen", "qwen-portal"):
                next_providers.append(p)
                continue
        name = str(p.get("name") or "").strip()
        if not target_id and "qwen" not in (name.lower() if name else ""):
            next_providers.append(p)
            continue
        cfg = p.get("config")
        cfg = cfg if isinstance(cfg, dict) else {}
        auth = p.get("auth")
        auth = auth if isinstance(auth, dict) else {}
        auth = {"mode": "oauth_device_code", "profileId": profile_id}

        next_cfg = dict(cfg)
        next_cfg["baseUrl"] = base_url
        next_cfg["apiFormat"] = next_cfg.get("apiFormat") or "chat_completions"
        next_cfg["models"] = models
        next_cfg["modelsFetched"] = True
        if not str(next_cfg.get("selectedModel") or "").strip():
            next_cfg["selectedModel"] = "coder-model"
        if "apiKey" in next_cfg:
            next_cfg.pop("apiKey", None)

        next_p = dict(p)
        next_p["type"] = "openai_compatible"
        next_p["config"] = next_cfg
        next_p["auth"] = auth
        next_providers.append(next_p)
        updated = True
    if not updated:
        return {}
    save_settings({"providers": next_providers})
    return {"baseUrl": base_url, "models": models, "selectedModel": "coder-model"}


def _apply_openai_codex_config_patch(profile_id: str, provider_record_id: str) -> Dict[str, Any]:
    base_url = "https://chatgpt.com/backend-api"
    models = build_openai_codex_models()
    settings_obj = load_settings()
    providers = settings_obj.get("providers")
    if not isinstance(providers, list):
        return {}
    target_id = str(provider_record_id or "").strip()
    if not target_id:
        return {}
    updated = False
    next_providers = []
    for p in providers:
        if not isinstance(p, dict):
            next_providers.append(p)
            continue
        pid = str(p.get("id") or "").strip()
        if pid != target_id:
            next_providers.append(p)
            continue
        cfg = p.get("config")
        cfg = cfg if isinstance(cfg, dict) else {}
        next_cfg = dict(cfg)
        next_cfg["baseUrl"] = base_url
        next_cfg["apiFormat"] = "responses"
        next_cfg["models"] = models
        next_cfg["modelsFetched"] = True
        if not str(next_cfg.get("selectedModel") or "").strip():
            next_cfg["selectedModel"] = DEFAULT_CODEX_SELECTED_MODEL
        if "apiKey" in next_cfg:
            next_cfg.pop("apiKey", None)

        next_p = dict(p)
        next_p["type"] = "openai_codex"
        next_p["config"] = next_cfg
        next_p["auth"] = {"mode": "oauth_openai_codex", "profileId": profile_id}
        next_providers.append(next_p)
        updated = True
    if not updated:
        return {}
    save_settings({"providers": next_providers})
    return {"baseUrl": base_url, "models": models, "selectedModel": DEFAULT_CODEX_SELECTED_MODEL}


def handle_get_provider_auth_status(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        flow_id = str(q.get("flowId") or "").strip()
        if not flow_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "flowId is required"})
            return

        now_ms = int(time.time() * 1000)
        with _FLOW_LOCK:
            cleanup_expired(now_ms)
            flow = get_flow(flow_id)
        if not flow:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "flow not found (backend restarted or wrong port)"})
            return
        expires_at = int(flow.get("expiresAt") or 0)
        if expires_at and now_ms >= expires_at:
            with _FLOW_LOCK:
                delete_flow(flow_id)
            kind = str(flow.get("kind") or "").strip()
            msg = "OAuth timed out"
            if kind == "qwen":
                msg = "Qwen OAuth timed out"
            elif kind == "openai_codex":
                msg = "OpenAI Codex OAuth timed out"
            json_response(handler, HTTPStatus.OK, {"ok": True, "state": "error", "error": msg})
            return

        kind = str(flow.get("kind") or "qwen").strip()
        data = flow.get("data") if isinstance(flow.get("data"), dict) else {}
        final_state = str(data.get("finalState") or "").strip()
        if final_state:
            if final_state == "success":
                json_response(handler, HTTPStatus.OK, {"ok": True, "state": "success"})
                return
            if final_state == "error":
                json_response(
                    handler,
                    HTTPStatus.OK,
                    {"ok": True, "state": "error", "error": str(data.get("finalError") or "OAuth failed")},
                )
                return
        if kind == "openai_codex":
            verifier = str(data.get("verifier") or "").strip()
            code = str(data.get("code") or "").strip()
            if not verifier:
                json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "invalid flow state"})
                return
            if not code:
                json_response(handler, HTTPStatus.OK, {"ok": True, "state": "pending"})
                return
            if bool(data.get("exchanging") is True):
                json_response(handler, HTTPStatus.OK, {"ok": True, "state": "pending"})
                return

            profile_id = str(data.get("profileId") or "").strip() or "default"
            provider_record_id = str(data.get("providerRecordId") or "").strip()
            with _FLOW_LOCK:
                patch_flow_data(flow_id, {"exchanging": True})

            try:
                token = codex_exchange_authorization_code(code, verifier)
            except Exception as e:
                msg = str(e) or "OAuth failed"
                with _FLOW_LOCK:
                    patch_flow_data(flow_id, {"finalState": "error", "finalError": msg, "exchanging": False})
                json_response(handler, HTTPStatus.OK, {"ok": True, "state": "error", "error": msg})
                return

            account_id = codex_extract_chatgpt_account_id(str(token.get("accessToken") or ""))
            if not account_id:
                with _FLOW_LOCK:
                    patch_flow_data(flow_id, {"finalState": "error", "finalError": "missing chatgpt account id", "exchanging": False})
                json_response(handler, HTTPStatus.OK, {"ok": True, "state": "error", "error": "missing chatgpt account id"})
                return
            try:
                upsert_oauth_credential(
                    {
                        "providerId": "openai_codex",
                        "profileId": profile_id,
                        "accessToken": token.get("accessToken"),
                        "refreshToken": token.get("refreshToken"),
                        "expiresAt": token.get("expiresAt"),
                        "resourceUrl": account_id,
                    }
                )
                config_patch = _apply_openai_codex_config_patch(profile_id, provider_record_id)
            except Exception as e:
                msg = str(e) or "OAuth failed"
                with _FLOW_LOCK:
                    patch_flow_data(flow_id, {"finalState": "error", "finalError": msg, "exchanging": False})
                json_response(handler, HTTPStatus.OK, {"ok": True, "state": "error", "error": msg})
                return

            with _FLOW_LOCK:
                patch_flow_data(flow_id, {"finalState": "success", "exchanging": False})
            json_response(
                handler,
                HTTPStatus.OK,
                {
                    "ok": True,
                    "state": "success",
                    "authSummary": {"providerId": "openai_codex", "profileId": profile_id, "expiresAt": token.get("expiresAt")},
                    "configPatch": config_patch,
                },
            )
            return

        device_code = str(data.get("deviceCode") or "").strip()
        verifier = str(data.get("verifier") or "").strip()
        if not device_code or not verifier:
            json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "invalid flow state"})
            return

        result = poll_device_token(device_code, verifier)
        status = str(result.get("status") or "").strip().lower()
        if status == "pending":
            slow_down = bool(result.get("slowDown") is True)
            with _FLOW_LOCK:
                patch = {"lastPollAt": now_ms}
                if slow_down:
                    cur = int(data.get("pollIntervalMs") or 2000)
                    patch["pollIntervalMs"] = min(int(cur * 1.5), 10_000)
                patch_flow_data(flow_id, patch)
            json_response(handler, HTTPStatus.OK, {"ok": True, "state": "pending"})
            return

        if status == "error":
            msg = str(result.get("message") or "Qwen OAuth failed").strip()
            with _FLOW_LOCK:
                patch_flow_data(flow_id, {"finalState": "error", "finalError": msg})
            json_response(handler, HTTPStatus.OK, {"ok": True, "state": "error", "error": msg})
            return

        if status != "success":
            json_response(handler, HTTPStatus.OK, {"ok": True, "state": "pending"})
            return

        token = result.get("token")
        if not isinstance(token, dict):
            json_response(handler, HTTPStatus.OK, {"ok": True, "state": "error", "error": "token missing"})
            return

        provider_id = "qwen"
        profile_id = str(data.get("profileId") or "").strip() or "default"
        provider_record_id = str(data.get("providerRecordId") or "").strip()
        upsert_oauth_credential(
            {
                "providerId": provider_id,
                "profileId": profile_id,
                "accessToken": token.get("accessToken"),
                "refreshToken": token.get("refreshToken"),
                "expiresAt": token.get("expiresAt"),
                "resourceUrl": token.get("resourceUrl"),
            }
        )

        config_patch = _apply_qwen_config_patch(token.get("resourceUrl"), profile_id, provider_record_id)

        with _FLOW_LOCK:
            patch_flow_data(flow_id, {"finalState": "success"})

        json_response(
            handler,
            HTTPStatus.OK,
            {"ok": True, "state": "success", "authSummary": {"providerId": provider_id, "profileId": profile_id, "expiresAt": token.get("expiresAt")}, "configPatch": config_patch},
        )
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_provider_auth_logout(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        provider_record_id = str(body.get("providerId") or "").strip()
        profile_id = str(body.get("profileId") or "").strip() or "default"
        kind = _resolve_provider_kind(provider_record_id) if provider_record_id else "qwen"
        if kind == "openai_codex":
            delete_credential("openai_codex", profile_id)
        else:
            delete_credential("qwen", profile_id)
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_provider_auth_profiles(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        provider_record_id = str(q.get("providerId") or "").strip()
        kind = _resolve_provider_kind(provider_record_id) if provider_record_id else "qwen"
        profiles = list_profiles("openai_codex" if kind == "openai_codex" else "qwen")
        json_response(handler, HTTPStatus.OK, {"ok": True, "profiles": profiles})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
