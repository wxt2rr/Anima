import time
from typing import Any, Dict, Optional

from .provider_credentials import get_oauth_credential, upsert_oauth_credential
from .qwen_portal_oauth import refresh_access_token


QWEN_CANONICAL_ID = "qwen"
REFRESH_MARGIN_MS = 10 * 60 * 1000


def resolve_qwen_access_token(provider_id: str, profile_id: str) -> str:
    pid = QWEN_CANONICAL_ID
    pf = str(profile_id or "").strip() or "default"
    cred = get_oauth_credential(pid, pf)
    if not cred:
        raise RuntimeError("Qwen not logged in")
    access = str(cred.get("accessToken") or "").strip()
    refresh = str(cred.get("refreshToken") or "").strip()
    try:
        expires_at = int(cred.get("expiresAt") or 0)
    except Exception:
        expires_at = 0
    if not access or not refresh or expires_at <= 0:
        raise RuntimeError("Qwen credential invalid")
    now = int(time.time() * 1000)
    if now + REFRESH_MARGIN_MS < expires_at:
        return access

    refreshed = refresh_access_token(refresh)
    upsert_oauth_credential(
        {
            "providerId": pid,
            "profileId": pf,
            "accessToken": refreshed["accessToken"],
            "refreshToken": refreshed["refreshToken"],
            "expiresAt": refreshed["expiresAt"],
            "resourceUrl": cred.get("resourceUrl"),
        }
    )
    return str(refreshed["accessToken"] or "").strip()


def get_qwen_profile_id_from_provider_obj(provider_obj: Dict[str, Any]) -> Optional[str]:
    auth = provider_obj.get("auth")
    if not isinstance(auth, dict):
        return None
    mode = str(auth.get("mode") or "").strip().lower()
    if mode != "oauth_device_code":
        return None
    profile_id = str(auth.get("profileId") or "").strip() or "default"
    return profile_id
