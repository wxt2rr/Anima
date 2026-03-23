from __future__ import annotations

import os
from http import HTTPStatus
from typing import Any, Dict, List

from anima_backend_shared.database import config_root, db_path, runs_db_path
from anima_backend_shared.http import json_response
from anima_backend_shared.provider_credentials import get_oauth_credential, list_profiles


def _cred_summary(provider_id: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in list_profiles(provider_id):
        pf = str(p.get("profileId") or "").strip() or "default"
        cred = get_oauth_credential(provider_id, pf) or {}
        access = str(cred.get("accessToken") or "")
        refresh = str(cred.get("refreshToken") or "")
        out.append(
            {
                "profileId": pf,
                "state": str(p.get("state") or ""),
                "expiresAt": p.get("expiresAt"),
                "updatedAt": p.get("updatedAt"),
                "accessTokenLen": len(access),
                "refreshTokenLen": len(refresh),
                "accessTokenLooksJwt": access.count(".") >= 2,
                "resourceUrl": str(cred.get("resourceUrl") or "") or None,
            }
        )
    return out


def handle_get_debug_config(handler: Any) -> None:
    try:
        root = config_root()
        payload = {
            "ok": True,
            "env": {"ANIMA_CONFIG_ROOT": str(os.environ.get("ANIMA_CONFIG_ROOT") or ""), "ANIMA_SKILLS_DIR": str(os.environ.get("ANIMA_SKILLS_DIR") or "")},
            "paths": {"configRoot": str(root), "dbPath": str(db_path()), "runsDbPath": str(runs_db_path())},
            "credentials": {"openai_codex": _cred_summary("openai_codex"), "qwen": _cred_summary("qwen")},
        }
        json_response(handler, HTTPStatus.OK, payload)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
