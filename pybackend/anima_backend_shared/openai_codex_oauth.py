import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple


OPENAI_OAUTH_AUTH_URL = "https://auth.openai.com/oauth/authorize"
OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
OPENAI_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback"
OPENAI_OAUTH_SCOPE = "openid profile email offline_access"
OPENAI_OAUTH_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) anima/0.1.0 Chrome/124.0.6367.243 Electron/30.5.1 Safari/537.36"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def generate_pkce_verifier_challenge() -> Tuple[str, str]:
    verifier = _b64url(os.urandom(32))
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    challenge = _b64url(digest)
    return verifier, challenge


def build_authorize_url(challenge: str, state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": OPENAI_OAUTH_CLIENT_ID,
        "redirect_uri": OPENAI_OAUTH_REDIRECT_URI,
        "scope": OPENAI_OAUTH_SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "codex_cli_simplified_flow": "true",
        "originator": "codex_cli_rs",
    }
    return f"{OPENAI_OAUTH_AUTH_URL}?{urllib.parse.urlencode(params)}"


def _http_post_form(url: str, params: Dict[str, str], headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    body = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", OPENAI_OAUTH_USER_AGENT)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = int(getattr(resp, "status", None) or resp.getcode() or 200)
            content_type = str(getattr(resp, "headers", {}).get("Content-Type") or "")
            raw = resp.read().decode("utf-8", errors="ignore")
            if not raw.strip():
                return {"_http_status": status, "_content_type": content_type}
            try:
                payload = json.loads(raw)
            except Exception:
                return {"_http_status": status, "_content_type": content_type, "_raw": raw[:4000]}
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
        if isinstance(payload, dict):
            payload["_http_status"] = int(e.code)
        return payload if isinstance(payload, dict) else {"_http_status": int(e.code), "_payload": payload}


def _oauth_error_message(payload: Any) -> str:
    if not isinstance(payload, dict):
        return "oauth request failed"
    desc = payload.get("error_description")
    if isinstance(desc, str) and desc.strip():
        return desc.strip()
    err = payload.get("error")
    if isinstance(err, str) and err.strip():
        return err.strip()
    if isinstance(err, dict):
        msg = err.get("message")
        if isinstance(msg, str) and msg.strip():
            return msg.strip()
        code = err.get("code")
        if isinstance(code, str) and code.strip():
            return code.strip()
    msg = payload.get("message")
    if isinstance(msg, str) and msg.strip():
        return msg.strip()
    code = payload.get("code")
    if isinstance(code, str) and code.strip():
        return code.strip()
    try:
        s = json.dumps(payload, ensure_ascii=False)
    except Exception:
        s = str(payload)
    s = str(s or "").strip()
    if not s:
        return "oauth request failed"
    return s[:4000]


def exchange_authorization_code(code: str, verifier: str) -> Dict[str, Any]:

    c = str(code or "").strip()
    v = str(verifier or "").strip()
    if not c or not v:
        raise RuntimeError("missing code/verifier")
    payload = _http_post_form(
        OPENAI_OAUTH_TOKEN_URL,
        {
            "grant_type": "authorization_code",
            "client_id": OPENAI_OAUTH_CLIENT_ID,
            "code": c,
            "redirect_uri": OPENAI_OAUTH_REDIRECT_URI,
            "code_verifier": v,
        },
        headers={"OpenAI-Beta": "responses=experimental"},
    )
    if payload.get("_http_status") and int(payload.get("_http_status")) >= 400:
        raise RuntimeError(_oauth_error_message(payload))
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    expires_in = payload.get("expires_in")
    if not isinstance(access, str) or not access.strip():
        raise RuntimeError("token exchange missing access_token")
    if not isinstance(refresh, str) or not refresh.strip():
        raise RuntimeError("token exchange missing refresh_token")
    if not isinstance(expires_in, (int, float)) or float(expires_in) <= 0:
        raise RuntimeError("token exchange missing expires_in")
    return {
        "accessToken": access.strip(),
        "refreshToken": refresh.strip(),
        "expiresAt": int(time.time() * 1000 + int(expires_in) * 1000),
    }


def refresh_access_token(refresh_token: str) -> Dict[str, Any]:
    rt = str(refresh_token or "").strip()
    if not rt:
        raise RuntimeError("refresh_token missing")
    payload = _http_post_form(
        OPENAI_OAUTH_TOKEN_URL,
        {"grant_type": "refresh_token", "refresh_token": rt, "client_id": OPENAI_OAUTH_CLIENT_ID},
        headers={"OpenAI-Beta": "responses=experimental"},
    )
    if payload.get("_http_status") and int(payload.get("_http_status")) >= 400:
        raise RuntimeError(_oauth_error_message(payload))
    access = payload.get("access_token")
    new_refresh = payload.get("refresh_token")
    expires_in = payload.get("expires_in")
    if not isinstance(access, str) or not access.strip():
        raise RuntimeError("refresh response missing access_token")
    if not isinstance(expires_in, (int, float)) or float(expires_in) <= 0:
        raise RuntimeError("refresh response missing expires_in")
    out_refresh = rt
    if isinstance(new_refresh, str) and new_refresh.strip():
        out_refresh = new_refresh.strip()
    return {"accessToken": access.strip(), "refreshToken": out_refresh, "expiresAt": int(time.time() * 1000 + int(expires_in) * 1000)}


def extract_chatgpt_account_id(access_token: str) -> str:
    tok = str(access_token or "").strip()
    if not tok or tok.count(".") < 2:
        return ""
    try:
        payload_b64 = tok.split(".")[1]
        pad = "=" * ((4 - (len(payload_b64) % 4)) % 4)
        payload_json = base64.urlsafe_b64decode((payload_b64 + pad).encode("utf-8")).decode("utf-8", errors="ignore")
        obj = json.loads(payload_json)
        if not isinstance(obj, dict):
            return ""
        direct = obj.get("https://api.openai.com/auth.chatgpt_account_id")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()
        nested = obj.get("https://api.openai.com/auth")
        if isinstance(nested, dict):
            v = nested.get("chatgpt_account_id")
            if isinstance(v, str) and v.strip():
                return v.strip()
        sub = obj.get("sub")
        if isinstance(sub, str) and sub.strip():
            return sub.strip()
        return ""
    except Exception:
        return ""
