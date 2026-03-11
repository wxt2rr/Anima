from __future__ import annotations

from typing import Any

from .chats import (
    handle_delete_chat,
    handle_get_chat,
    handle_get_chat_summary,
    handle_get_chats,
    handle_patch_chat,
    handle_patch_chat_message,
    handle_post_chat_message,
    handle_post_chat_compact,
    handle_post_chats,
    handle_post_chats_sync,
)
from .db import handle_get_db_export, handle_get_db_path, handle_get_db_status, handle_post_db_clear, handle_post_db_import
from .debug import handle_get_debug_config
from .runs import (
    handle_get_run,
    handle_post_chat,
    handle_post_chat_prepare,
    handle_post_run_resume,
    handle_post_runs_non_stream,
)
from .runs_stream import handle_post_runs_stream
from .qwen_auth import (
    handle_get_provider_auth_profiles,
    handle_get_provider_auth_status,
    handle_post_provider_auth_logout,
    handle_post_provider_auth_start,
)
from .settings_tools import (
    handle_get_attachment_file,
    handle_get_artifact_file,
    handle_get_settings,
    handle_get_skills_list,
    handle_get_tools_list,
    handle_patch_settings,
    handle_post_artifacts_cleanup,
    handle_post_providers_fetch_models,
    handle_post_skills_content,
    handle_post_skills_open_dir,
)
from .voice import (
    handle_get_voice_models_base_dir,
    handle_get_voice_models_catalog,
    handle_get_voice_models_download_status,
    handle_get_voice_models_installed,
    handle_post_voice_models_download,
    handle_post_voice_models_download_cancel,
    handle_post_voice_transcribe,
)
from .voice_stream import (
    handle_get_voice_stream_events,
    handle_post_voice_stream_chunk,
    handle_post_voice_stream_start,
    handle_post_voice_stream_stop,
)
from ..cron import handle_get_cron_jobs, handle_post_cron_jobs


def dispatch(handler: Any, method: str, path: str) -> bool:
    m = (method or "").upper().strip()

    if m == "GET" and path == "/api/chats":
        handle_get_chats(handler)
        return True
    if m == "GET" and path.startswith("/api/chats/"):
        parts = path.split("/")
        if len(parts) == 4 and parts[1] == "api" and parts[2] == "chats":
            handle_get_chat(handler, parts[3])
            return True
        if len(parts) == 5 and parts[1] == "api" and parts[2] == "chats" and parts[4] == "summary":
            handle_get_chat_summary(handler, parts[3])
            return True

    if m == "POST" and path == "/api/chats":
        handle_post_chats(handler)
        return True
    if m == "POST" and path.endswith("/messages") and path.startswith("/api/chats/"):
        parts = path.split("/")
        if len(parts) == 5 and parts[1] == "api" and parts[2] == "chats" and parts[4] == "messages":
            handle_post_chat_message(handler, parts[3])
            return True
    if m == "POST" and path.endswith("/compact") and path.startswith("/api/chats/"):
        parts = path.split("/")
        if len(parts) == 5 and parts[1] == "api" and parts[2] == "chats" and parts[4] == "compact":
            handle_post_chat_compact(handler, parts[3])
            return True
    if m == "POST" and path == "/api/chats/sync":
        handle_post_chats_sync(handler)
        return True

    if m == "PATCH" and path.startswith("/api/chats/"):
        parts = path.split("/")
        if len(parts) == 4 and parts[1] == "api" and parts[2] == "chats":
            handle_patch_chat(handler, parts[3])
            return True
        if len(parts) == 6 and parts[1] == "api" and parts[2] == "chats" and parts[4] == "messages":
            handle_patch_chat_message(handler, parts[3], parts[5])
            return True

    if m == "DELETE" and path.startswith("/api/chats/"):
        parts = path.split("/")
        if len(parts) == 4 and parts[1] == "api" and parts[2] == "chats":
            handle_delete_chat(handler, parts[3])
            return True

    if m == "GET" and path == "/settings":
        handle_get_settings(handler)
        return True
    if m == "PATCH" and path == "/settings":
        handle_patch_settings(handler)
        return True
    if m == "GET" and path == "/skills/list":
        handle_get_skills_list(handler)
        return True
    if m == "POST" and path == "/skills/content":
        handle_post_skills_content(handler)
        return True
    if m == "POST" and path == "/skills/openDir":
        handle_post_skills_open_dir(handler)
        return True
    if m == "GET" and path == "/tools/list":
        handle_get_tools_list(handler)
        return True

    if m == "GET" and path == "/api/cron/jobs":
        handle_get_cron_jobs(handler)
        return True
    if m == "POST" and path == "/api/cron/jobs":
        handle_post_cron_jobs(handler)
        return True

    if m == "GET" and path == "/api/db/status":
        handle_get_db_status(handler)
        return True
    if m == "GET" and path == "/api/db/path":
        handle_get_db_path(handler)
        return True
    if m == "GET" and path == "/api/db/export":
        handle_get_db_export(handler)
        return True
    if m == "POST" and path == "/api/db/import":
        handle_post_db_import(handler)
        return True
    if m == "POST" and path == "/api/db/clear":
        handle_post_db_clear(handler)
        return True

    if m == "GET" and path == "/api/debug/config":
        handle_get_debug_config(handler)
        return True

    if m == "GET" and path == "/api/artifacts/file":
        handle_get_artifact_file(handler)
        return True
    if m == "GET" and path == "/api/attachments/file":
        handle_get_attachment_file(handler)
        return True

    if m == "POST" and path == "/api/artifacts/cleanup":
        handle_post_artifacts_cleanup(handler)
        return True

    if m == "POST" and path == "/api/runs":
        q = getattr(handler, "query", None) or {}
        stream = q.get("stream") == "1"
        if stream:
            from anima_backend_shared.http import read_body_json

            body = read_body_json(handler)
            if not isinstance(body, dict):
                from http import HTTPStatus

                from anima_backend_shared.http import json_response

                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                return True
            handle_post_runs_stream(handler, body)
            return True
        from anima_backend_shared.http import read_body_json

        body = read_body_json(handler)
        if not isinstance(body, dict):
            from http import HTTPStatus

            from anima_backend_shared.http import json_response

            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return True
        status, payload = handle_post_runs_non_stream(body)
        from anima_backend_shared.http import json_response

        json_response(handler, status, payload)
        return True

    if m == "GET" and path.startswith("/api/runs/"):
        parts = path.split("/")
        if len(parts) == 4 and parts[1] == "api" and parts[2] == "runs":
            handle_get_run(handler, parts[3])
            return True

    if m == "POST" and path.startswith("/api/runs/") and path.endswith("/resume"):
        parts = path.split("/")
        if len(parts) == 5 and parts[1] == "api" and parts[2] == "runs" and parts[4] == "resume":
            handle_post_run_resume(handler, parts[3])
            return True

    if m == "POST" and path == "/api/providers/fetch_models":
        handle_post_providers_fetch_models(handler)
        return True

    if m == "POST" and path == "/api/providers/auth/start":
        handle_post_provider_auth_start(handler)
        return True
    if m == "GET" and path == "/api/providers/auth/status":
        handle_get_provider_auth_status(handler)
        return True
    if m == "POST" and path == "/api/providers/auth/logout":
        handle_post_provider_auth_logout(handler)
        return True
    if m == "GET" and path == "/api/providers/auth/profiles":
        handle_get_provider_auth_profiles(handler)
        return True

    if m == "POST" and path == "/chat/prepare":
        handle_post_chat_prepare(handler)
        return True
    if m == "POST" and path == "/chat":
        handle_post_chat(handler)
        return True

    if m == "GET" and path == "/voice/models/base_dir":
        handle_get_voice_models_base_dir(handler)
        return True
    if m == "GET" and path == "/voice/models/catalog":
        handle_get_voice_models_catalog(handler)
        return True
    if m == "GET" and path == "/voice/models/installed":
        handle_get_voice_models_installed(handler)
        return True
    if m == "GET" and path == "/voice/models/download/status":
        handle_get_voice_models_download_status(handler)
        return True
    if m == "POST" and path == "/voice/models/download":
        handle_post_voice_models_download(handler)
        return True
    if m == "POST" and path == "/voice/models/download/cancel":
        handle_post_voice_models_download_cancel(handler)
        return True
    if m == "POST" and path == "/voice/transcribe":
        handle_post_voice_transcribe(handler)
        return True
    if m == "POST" and path == "/voice/stream/start":
        handle_post_voice_stream_start(handler)
        return True
    if m == "POST" and path == "/voice/stream/chunk":
        handle_post_voice_stream_chunk(handler)
        return True
    if m == "POST" and path == "/voice/stream/stop":
        handle_post_voice_stream_stop(handler)
        return True
    if m == "GET" and path == "/voice/stream/events":
        handle_get_voice_stream_events(handler)
        return True

    return False


__all__ = [
    "dispatch",
]
