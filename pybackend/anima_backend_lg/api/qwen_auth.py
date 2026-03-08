from __future__ import annotations

import threading
import time
import uuid
from http import HTTPStatus
from typing import Any, Dict, Optional

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.provider_credentials import delete_credential, list_profiles, upsert_oauth_credential
from anima_backend_shared.qwen_portal_oauth import (
    generate_pkce_verifier_challenge,
    normalize_qwen_resource_url,
    poll_device_token,
    request_device_code,
)
from anima_backend_shared.settings import load_settings, save_settings


_FLOW_LOCK = threading.Lock()
_FLOWS: Dict[str, Dict[str, Any]] = {}


def _cleanup_flows(now_ms: int) -> None:
    stale: list[str] = []
    for fid, f in _FLOWS.items():
        exp = int(f.get("expiresAt") or 0)
        if exp and now_ms > exp + 30_000:
            stale.append(fid)
    for fid in stale:
        _FLOWS.pop(fid, None)


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

        verifier, challenge = generate_pkce_verifier_challenge()
        device = request_device_code(challenge)
        verification_url = str(device.get("verification_uri_complete") or device.get("verification_uri") or "").strip()
        user_code = str(device.get("user_code") or "").strip()
        expires_in = int(device.get("expires_in") or 0)
        interval = int(device.get("interval") or 0)
        if not verification_url or not user_code or not expires_in:
            json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Invalid device code payload"})
            return
        now_ms = int(time.time() * 1000)
        expires_at = now_ms + expires_in * 1000
        poll_interval_ms = max(500, (interval * 1000) if interval > 0 else 2000)

        flow_id = uuid.uuid4().hex
        with _FLOW_LOCK:
            _cleanup_flows(now_ms)
            _FLOWS[flow_id] = {
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
            }

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
    base_url = normalize_qwen_resource_url(resource_url) or "https://portal.qwen.ai/v1"
    models = [
        {"id": "coder-model", "isEnabled": True, "config": {"id": "coder-model"}},
        {"id": "vision-model", "isEnabled": True, "config": {"id": "vision-model"}},
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
            if pid not in ("qwen", "qwen-portal"):
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


def handle_get_provider_auth_status(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        flow_id = str(q.get("flowId") or "").strip()
        if not flow_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "flowId is required"})
            return

        now_ms = int(time.time() * 1000)
        with _FLOW_LOCK:
            _cleanup_flows(now_ms)
            flow = _FLOWS.get(flow_id)
        if not flow:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "flow not found"})
            return
        if now_ms >= int(flow.get("expiresAt") or 0):
            with _FLOW_LOCK:
                _FLOWS.pop(flow_id, None)
            json_response(handler, HTTPStatus.OK, {"ok": True, "state": "error", "error": "Qwen OAuth timed out"})
            return

        device_code = str(flow.get("deviceCode") or "").strip()
        verifier = str(flow.get("verifier") or "").strip()
        if not device_code or not verifier:
            json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "invalid flow state"})
            return

        result = poll_device_token(device_code, verifier)
        status = str(result.get("status") or "").strip().lower()
        if status == "pending":
            slow_down = bool(result.get("slowDown") is True)
            with _FLOW_LOCK:
                f = _FLOWS.get(flow_id) or {}
                f["lastPollAt"] = now_ms
                if slow_down:
                    cur = int(f.get("pollIntervalMs") or 2000)
                    f["pollIntervalMs"] = min(int(cur * 1.5), 10_000)
                _FLOWS[flow_id] = f
            json_response(handler, HTTPStatus.OK, {"ok": True, "state": "pending"})
            return

        if status == "error":
            msg = str(result.get("message") or "Qwen OAuth failed").strip()
            with _FLOW_LOCK:
                _FLOWS.pop(flow_id, None)
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
        profile_id = str(flow.get("profileId") or "").strip() or "default"
        provider_record_id = str(flow.get("providerRecordId") or "").strip()
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
            _FLOWS.pop(flow_id, None)

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
        profile_id = str(body.get("profileId") or "").strip() or "default"
        delete_credential("qwen", profile_id)
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_provider_auth_profiles(handler: Any) -> None:
    try:
        profiles = list_profiles("qwen")
        json_response(handler, HTTPStatus.OK, {"ok": True, "profiles": profiles})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
