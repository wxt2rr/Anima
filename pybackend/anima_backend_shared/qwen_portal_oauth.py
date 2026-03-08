import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple


QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai"
QWEN_OAUTH_DEVICE_CODE_ENDPOINT = f"{QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code"
QWEN_OAUTH_TOKEN_ENDPOINT = f"{QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token"
QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"
QWEN_OAUTH_SCOPE = "openid profile email model.completion"
QWEN_OAUTH_GRANT_TYPE_DEVICE_CODE = "urn:ietf:params:oauth:grant-type:device_code"
QWEN_OAUTH_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) anima/0.1.16 Chrome/124.0.6367.243 Electron/30.5.1 Safari/537.36"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def generate_pkce_verifier_challenge() -> Tuple[str, str]:
    verifier = _b64url(os.urandom(32))
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    challenge = _b64url(digest)
    return verifier, challenge


def _http_post_form(url: str, params: Dict[str, str], headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    body = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", QWEN_OAUTH_USER_AGENT)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = int(getattr(resp, "status", None) or resp.getcode() or 200)
            content_type = str(getattr(resp, "headers", {}).get("Content-Type") or "")
            raw = resp.read().decode("utf-8", errors="ignore")
            if not raw.strip():
                return {"_http_status": status, "_content_type": content_type}
            try:
                payload = json.loads(raw)
            except Exception:
                return {"_http_status": status, "_content_type": content_type, "_raw": raw[:2000]}
            if isinstance(payload, dict):
                payload["_http_status"] = status
                payload["_content_type"] = content_type
            return payload if isinstance(payload, dict) else {"_http_status": status, "_content_type": content_type, "_payload": payload}
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode("utf-8", errors="ignore")
        except Exception:
            raw = ""
        try:
            payload = json.loads(raw) if raw else {}
        except Exception:
            payload = {"error": raw or str(e)}
        payload["_http_status"] = int(e.code)
        return payload


def request_device_code(challenge: str) -> Dict[str, Any]:
    payload = _http_post_form(
        QWEN_OAUTH_DEVICE_CODE_ENDPOINT,
        {
            "client_id": QWEN_OAUTH_CLIENT_ID,
            "scope": QWEN_OAUTH_SCOPE,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
        headers={"x-request-id": _b64url(os.urandom(16))},
    )
    if not isinstance(payload, dict):
        raise RuntimeError("Qwen device authorization returned invalid payload")
    if payload.get("_http_status") and int(payload.get("_http_status")) >= 400:
        raise RuntimeError(f"Qwen device authorization failed: {payload}")
    if not payload.get("device_code") or not payload.get("user_code") or not payload.get("verification_uri"):
        raise RuntimeError("Qwen device authorization returned incomplete payload")
    return payload


def poll_device_token(device_code: str, verifier: str) -> Dict[str, Any]:
    payload = _http_post_form(
        QWEN_OAUTH_TOKEN_ENDPOINT,
        {
            "grant_type": QWEN_OAUTH_GRANT_TYPE_DEVICE_CODE,
            "client_id": QWEN_OAUTH_CLIENT_ID,
            "device_code": device_code,
            "code_verifier": verifier,
        },
    )
    if not isinstance(payload, dict):
        return {"status": "error", "message": "invalid token payload"}

    if payload.get("_http_status") and int(payload.get("_http_status")) >= 400:
        err = str(payload.get("error") or "").strip()
        desc = str(payload.get("error_description") or "").strip()
        if err == "authorization_pending":
            return {"status": "pending"}
        if err == "slow_down":
            return {"status": "pending", "slowDown": True}
        return {"status": "error", "message": desc or err or "token request failed"}

    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    expires_in = payload.get("expires_in")
    if not isinstance(access, str) or not access.strip():
        return {"status": "error", "message": "missing access_token"}
    if not isinstance(refresh, str) or not refresh.strip():
        return {"status": "error", "message": "missing refresh_token"}
    if not isinstance(expires_in, (int, float)) or expires_in <= 0:
        return {"status": "error", "message": "missing expires_in"}
    resource_url = payload.get("resource_url")
    return {
        "status": "success",
        "token": {
            "accessToken": access.strip(),
            "refreshToken": refresh.strip(),
            "expiresAt": int(time.time() * 1000 + int(expires_in) * 1000),
            "resourceUrl": str(resource_url).strip() if isinstance(resource_url, str) and resource_url.strip() else None,
        },
    }


def refresh_access_token(refresh_token: str) -> Dict[str, Any]:
    rt = str(refresh_token or "").strip()
    if not rt:
        raise RuntimeError("refresh_token missing")
    payload = _http_post_form(
        QWEN_OAUTH_TOKEN_ENDPOINT,
        {"grant_type": "refresh_token", "refresh_token": rt, "client_id": QWEN_OAUTH_CLIENT_ID},
    )
    if payload.get("_http_status") and int(payload.get("_http_status")) >= 400:
        raise RuntimeError(str(payload.get("error_description") or payload.get("error") or "refresh failed"))
    access = payload.get("access_token")
    new_refresh = payload.get("refresh_token")
    expires_in = payload.get("expires_in")
    if not isinstance(access, str) or not access.strip():
        raise RuntimeError("refresh response missing access_token")
    if not isinstance(expires_in, (int, float)) or expires_in <= 0:
        raise RuntimeError("refresh response missing expires_in")
    refresh_out = rt
    if isinstance(new_refresh, str) and new_refresh.strip():
        refresh_out = new_refresh.strip()
    return {"accessToken": access.strip(), "refreshToken": refresh_out, "expiresAt": int(time.time() * 1000 + int(expires_in) * 1000)}


def normalize_qwen_resource_url(resource_url: Optional[str]) -> Optional[str]:
    raw = str(resource_url or "").strip()
    if not raw:
        return None
    with_protocol = raw if raw.startswith("http") else f"https://{raw}"
    base = with_protocol.rstrip("/")
    if base.endswith("/v1"):
        return base
    return f"{base}/v1"
