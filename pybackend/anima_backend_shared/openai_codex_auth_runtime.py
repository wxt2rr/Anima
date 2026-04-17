import threading
import time
from typing import Any, Dict, Optional, Tuple

from .openai_codex_oauth import extract_chatgpt_account_id, refresh_access_token
from .provider_credentials import get_oauth_credential, upsert_oauth_credential


OPENAI_CODEX_CANONICAL_ID = "openai_codex"
REFRESH_MARGIN_MS = 10 * 60 * 1000
_REFRESH_LOCK = threading.Lock()


def get_openai_codex_profile_id_from_provider_obj(provider_obj: Dict[str, Any]) -> Optional[str]:
    auth = provider_obj.get("auth")
    if not isinstance(auth, dict):
        return None
    mode = str(auth.get("mode") or "").strip().lower()
    if mode != "oauth_openai_codex":
        return None
    profile_id = str(auth.get("profileId") or "").strip() or "default"
    return profile_id


def resolve_openai_codex_access_token(provider_id: str, profile_id: str) -> Tuple[str, str]:
    pid = OPENAI_CODEX_CANONICAL_ID
    pf = str(profile_id or "").strip() or "default"
    cred = get_oauth_credential(pid, pf)
    if not cred:
        raise RuntimeError("OpenAI Codex not logged in")
    access = str(cred.get("accessToken") or "").strip()
    refresh = str(cred.get("refreshToken") or "").strip()
    account_id = str(cred.get("resourceUrl") or "").strip() or extract_chatgpt_account_id(access)
    try:
        expires_at = int(cred.get("expiresAt") or 0)
    except Exception:
        expires_at = 0
    if not access or not refresh or expires_at <= 0:
        raise RuntimeError("OpenAI Codex credential invalid")
    if access.count(".") < 2:
        raise RuntimeError("OpenAI Codex credential invalid. Please sign in again.")
    now = int(time.time() * 1000)
    if now + REFRESH_MARGIN_MS < expires_at:
        if not account_id:
            raise RuntimeError("OpenAI Codex account id missing")
        return access, account_id

    with _REFRESH_LOCK:
        latest = get_oauth_credential(pid, pf) or {}
        latest_access = str(latest.get("accessToken") or "").strip()
        latest_refresh = str(latest.get("refreshToken") or "").strip()
        latest_account_id = str(latest.get("resourceUrl") or "").strip() or extract_chatgpt_account_id(latest_access)
        try:
            latest_expires_at = int(latest.get("expiresAt") or 0)
        except Exception:
            latest_expires_at = 0

        now = int(time.time() * 1000)
        if latest_access and latest_refresh and latest_expires_at > 0 and now + REFRESH_MARGIN_MS < latest_expires_at:
            if not latest_account_id:
                raise RuntimeError("OpenAI Codex account id missing")
            if latest_access.count(".") < 2:
                raise RuntimeError("OpenAI Codex credential invalid. Please sign in again.")
            return latest_access, latest_account_id

        try:
            refreshed = refresh_access_token(latest_refresh or refresh)
        except Exception as e:
            msg = str(e or "").strip()
            if not msg:
                msg = "refresh failed"
            raise RuntimeError(f"OpenAI Codex login expired. Please sign in again. ({msg})")
        refreshed_access = str(refreshed.get("accessToken") or "").strip()
        refreshed_account_id = extract_chatgpt_account_id(refreshed_access) or latest_account_id or account_id
        upsert_oauth_credential(
            {
                "providerId": pid,
                "profileId": pf,
                "accessToken": refreshed["accessToken"],
                "refreshToken": refreshed["refreshToken"],
                "expiresAt": refreshed["expiresAt"],
                "resourceUrl": refreshed_account_id or None,
                "email": latest.get("email") or cred.get("email"),
            }
        )
        if not refreshed_account_id:
            raise RuntimeError("OpenAI Codex account id missing")
        return refreshed_access, refreshed_account_id
