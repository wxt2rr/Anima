import json
import time
from typing import Any, Dict, List, Optional

from .database import get_db_connection


def upsert_oauth_credential(params: Dict[str, Any]) -> None:
    provider_id = str(params.get("providerId") or "").strip()
    profile_id = str(params.get("profileId") or "").strip() or "default"
    if not provider_id:
        raise ValueError("providerId is required")

    cred = {
        "accessToken": str(params.get("accessToken") or ""),
        "refreshToken": str(params.get("refreshToken") or ""),
        "expiresAt": int(params.get("expiresAt") or 0),
        "resourceUrl": str(params.get("resourceUrl") or "").strip() or None,
    }
    if not cred["accessToken"] or not cred["refreshToken"] or cred["expiresAt"] <= 0:
        raise ValueError("invalid oauth credential payload")

    payload = json.dumps(cred, ensure_ascii=False)
    now = int(time.time() * 1000)
    conn = get_db_connection()
    conn.execute(
        """
        INSERT INTO provider_credentials (provider_id, profile_id, type, data, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, profile_id) DO UPDATE SET
          type = excluded.type,
          data = excluded.data,
          updated_at = excluded.updated_at
        """,
        (provider_id, profile_id, "oauth", payload, now),
    )
    conn.commit()


def get_oauth_credential(provider_id: str, profile_id: str) -> Optional[Dict[str, Any]]:
    pid = str(provider_id or "").strip()
    pf = str(profile_id or "").strip() or "default"
    if not pid:
        return None
    conn = get_db_connection()
    row = conn.execute(
        "SELECT type, data, updated_at FROM provider_credentials WHERE provider_id = ? AND profile_id = ?",
        (pid, pf),
    ).fetchone()
    if not row:
        return None
    if str(row["type"] or "") != "oauth":
        return None
    try:
        data = json.loads(row["data"])
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    data["updatedAt"] = int(row["updated_at"] or 0)
    return data


def delete_credential(provider_id: str, profile_id: str) -> None:
    pid = str(provider_id or "").strip()
    pf = str(profile_id or "").strip() or "default"
    if not pid:
        return
    conn = get_db_connection()
    conn.execute(
        "DELETE FROM provider_credentials WHERE provider_id = ? AND profile_id = ?",
        (pid, pf),
    )
    conn.commit()


def list_profiles(provider_id: str) -> List[Dict[str, Any]]:
    pid = str(provider_id or "").strip()
    if not pid:
        return []
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT profile_id, type, data, updated_at FROM provider_credentials WHERE provider_id = ? ORDER BY updated_at DESC",
        (pid,),
    ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows or []:
        profile_id = str(r["profile_id"] or "").strip()
        if not profile_id:
            continue
        if str(r["type"] or "") != "oauth":
            continue
        try:
            data = json.loads(r["data"])
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        expires_at = data.get("expiresAt")
        try:
            expires_at_int = int(expires_at) if expires_at is not None else 0
        except Exception:
            expires_at_int = 0
        state = "not_logged_in"
        if expires_at_int > 0:
            state = "expired" if int(time.time() * 1000) >= expires_at_int else "valid"
        out.append(
            {
                "providerId": pid,
                "profileId": profile_id,
                "type": "oauth",
                "expiresAt": expires_at_int or None,
                "updatedAt": int(r["updated_at"] or 0),
                "state": state,
            }
        )
    return out

