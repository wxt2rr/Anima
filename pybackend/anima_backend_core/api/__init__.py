from __future__ import annotations

import re
from http import HTTPStatus
from typing import Any, Callable, Dict, Match, Pattern, Tuple

from anima_backend_shared.http import json_response, read_body_json

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
from .composer import handle_post_composer_tab_complete
from .db import handle_get_db_export, handle_get_db_path, handle_get_db_status, handle_post_db_clear, handle_post_db_import
from .debug import handle_get_debug_config
from .qwen_auth import (
    handle_get_provider_auth_profiles,
    handle_get_provider_auth_status,
    handle_post_provider_auth_logout,
    handle_post_provider_auth_start,
    handle_post_provider_auth_sync,
)
from .qwen_tts import (
    handle_get_tts_qwen_local_catalog,
    handle_get_tts_qwen_local_download_status,
    handle_get_tts_qwen_local_installed,
    handle_get_tts_qwen_local_service_status,
    handle_post_tts_qwen_local_download,
    handle_post_tts_qwen_local_service_start,
)
from .memory import (
    handle_delete_memory_items,
    handle_get_memory_embedding_models_base_dir,
    handle_get_memory_embedding_models_catalog,
    handle_get_memory_embedding_models_download_status,
    handle_get_memory_embedding_models_installed,
    handle_get_memory_items,
    handle_get_memory_metrics,
    handle_patch_memory_items,
    handle_post_memory_items,
    handle_post_memory_query,
    handle_post_memory_embedding_models_download,
    handle_post_memory_embedding_models_download_cancel,
)
from .kb import (
    handle_delete_kb_documents,
    handle_get_kb_documents,
    handle_get_kb_import_status,
    handle_post_kb_import,
    handle_post_kb_query,
)
from .mcp import (
    handle_get_mcp_config,
    handle_get_mcp_server_catalog,
    handle_post_mcp_server_close,
    handle_post_mcp_server_test,
    handle_post_mcp_validate,
    handle_put_mcp_config,
)
from .runs import handle_get_run, handle_post_run_resume, handle_post_runs_non_stream
from .runs_stream import handle_post_runs_stream
from .settings_tools import (
    handle_get_commands_list,
    handle_get_artifact_file,
    handle_get_attachment_file,
    handle_get_settings,
    handle_get_skills_list,
    handle_get_tools_list,
    handle_patch_settings,
    handle_post_artifacts_cleanup,
    handle_post_providers_fetch_models,
    handle_post_tts_preview,
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


ExactHandler = Callable[[Any], None]
DynamicHandler = Callable[[Any, Match[str]], None]


def _handle_post_runs(handler: Any) -> None:
    q = getattr(handler, "query", None) or {}
    stream = q.get("stream") == "1"
    body = read_body_json(handler)
    if not isinstance(body, dict):
        json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
        return
    if stream:
        handle_post_runs_stream(handler, body)
        return
    status, payload = handle_post_runs_non_stream(body)
    json_response(handler, status, payload)


def _handle_get_chat_dynamic(handler: Any, match: Match[str]) -> None:
    handle_get_chat(handler, match.group("chat_id"))


def _handle_get_chat_summary_dynamic(handler: Any, match: Match[str]) -> None:
    handle_get_chat_summary(handler, match.group("chat_id"))


def _handle_post_chat_message_dynamic(handler: Any, match: Match[str]) -> None:
    handle_post_chat_message(handler, match.group("chat_id"))


def _handle_post_chat_compact_dynamic(handler: Any, match: Match[str]) -> None:
    handle_post_chat_compact(handler, match.group("chat_id"))


def _handle_patch_chat_dynamic(handler: Any, match: Match[str]) -> None:
    handle_patch_chat(handler, match.group("chat_id"))


def _handle_patch_chat_message_dynamic(handler: Any, match: Match[str]) -> None:
    handle_patch_chat_message(handler, match.group("chat_id"), match.group("message_id"))


def _handle_delete_chat_dynamic(handler: Any, match: Match[str]) -> None:
    handle_delete_chat(handler, match.group("chat_id"))


def _handle_get_run_dynamic(handler: Any, match: Match[str]) -> None:
    handle_get_run(handler, match.group("run_id"))


def _handle_post_run_resume_dynamic(handler: Any, match: Match[str]) -> None:
    handle_post_run_resume(handler, match.group("run_id"))


def _handle_get_mcp_server_catalog_dynamic(handler: Any, match: Match[str]) -> None:
    handle_get_mcp_server_catalog(handler, match.group("server_id"))


def _handle_post_mcp_server_close_dynamic(handler: Any, match: Match[str]) -> None:
    handle_post_mcp_server_close(handler, match.group("server_id"))


EXACT_ROUTES: Dict[Tuple[str, str], ExactHandler] = {
    ("GET", "/api/chats"): handle_get_chats,
    ("POST", "/api/chats"): handle_post_chats,
    ("POST", "/api/chats/sync"): handle_post_chats_sync,
    ("GET", "/settings"): handle_get_settings,
    ("PATCH", "/settings"): handle_patch_settings,
    ("GET", "/commands/list"): handle_get_commands_list,
    ("GET", "/skills/list"): handle_get_skills_list,
    ("POST", "/skills/content"): handle_post_skills_content,
    ("POST", "/skills/openDir"): handle_post_skills_open_dir,
    ("GET", "/tools/list"): handle_get_tools_list,
    ("GET", "/api/cron/jobs"): handle_get_cron_jobs,
    ("POST", "/api/cron/jobs"): handle_post_cron_jobs,
    ("GET", "/api/db/status"): handle_get_db_status,
    ("GET", "/api/db/path"): handle_get_db_path,
    ("GET", "/api/db/export"): handle_get_db_export,
    ("POST", "/api/db/import"): handle_post_db_import,
    ("POST", "/api/db/clear"): handle_post_db_clear,
    ("GET", "/api/debug/config"): handle_get_debug_config,
    ("GET", "/api/artifacts/file"): handle_get_artifact_file,
    ("GET", "/api/attachments/file"): handle_get_attachment_file,
    ("POST", "/api/artifacts/cleanup"): handle_post_artifacts_cleanup,
    ("POST", "/api/runs"): _handle_post_runs,
    ("POST", "/api/composer/tab_complete"): handle_post_composer_tab_complete,
    ("POST", "/api/providers/fetch_models"): handle_post_providers_fetch_models,
    ("POST", "/api/tts/preview"): handle_post_tts_preview,
    ("GET", "/api/tts/qwen/local/catalog"): handle_get_tts_qwen_local_catalog,
    ("GET", "/api/tts/qwen/local/installed"): handle_get_tts_qwen_local_installed,
    ("POST", "/api/tts/qwen/local/download"): handle_post_tts_qwen_local_download,
    ("GET", "/api/tts/qwen/local/download/status"): handle_get_tts_qwen_local_download_status,
    ("GET", "/api/tts/qwen/local/service/status"): handle_get_tts_qwen_local_service_status,
    ("POST", "/api/tts/qwen/local/service/start"): handle_post_tts_qwen_local_service_start,
    ("POST", "/api/providers/auth/start"): handle_post_provider_auth_start,
    ("GET", "/api/providers/auth/status"): handle_get_provider_auth_status,
    ("POST", "/api/providers/auth/logout"): handle_post_provider_auth_logout,
    ("POST", "/api/providers/auth/sync"): handle_post_provider_auth_sync,
    ("GET", "/api/providers/auth/profiles"): handle_get_provider_auth_profiles,
    ("GET", "/voice/models/base_dir"): handle_get_voice_models_base_dir,
    ("GET", "/voice/models/catalog"): handle_get_voice_models_catalog,
    ("GET", "/voice/models/installed"): handle_get_voice_models_installed,
    ("GET", "/voice/models/download/status"): handle_get_voice_models_download_status,
    ("POST", "/voice/models/download"): handle_post_voice_models_download,
    ("POST", "/voice/models/download/cancel"): handle_post_voice_models_download_cancel,
    ("POST", "/voice/transcribe"): handle_post_voice_transcribe,
    ("POST", "/voice/stream/start"): handle_post_voice_stream_start,
    ("POST", "/voice/stream/chunk"): handle_post_voice_stream_chunk,
    ("POST", "/voice/stream/stop"): handle_post_voice_stream_stop,
    ("GET", "/voice/stream/events"): handle_get_voice_stream_events,
    ("GET", "/memory/metrics"): handle_get_memory_metrics,
    ("GET", "/memory/items"): handle_get_memory_items,
    ("POST", "/memory/items"): handle_post_memory_items,
    ("POST", "/memory/query"): handle_post_memory_query,
    ("PATCH", "/memory/items"): handle_patch_memory_items,
    ("DELETE", "/memory/items"): handle_delete_memory_items,
    ("GET", "/memory/embedding/models/base_dir"): handle_get_memory_embedding_models_base_dir,
    ("GET", "/memory/embedding/models/catalog"): handle_get_memory_embedding_models_catalog,
    ("GET", "/memory/embedding/models/installed"): handle_get_memory_embedding_models_installed,
    ("GET", "/memory/embedding/models/download/status"): handle_get_memory_embedding_models_download_status,
    ("POST", "/memory/embedding/models/download"): handle_post_memory_embedding_models_download,
    ("POST", "/memory/embedding/models/download/cancel"): handle_post_memory_embedding_models_download_cancel,
    ("GET", "/kb/documents"): handle_get_kb_documents,
    ("POST", "/kb/import"): handle_post_kb_import,
    ("GET", "/kb/import/status"): handle_get_kb_import_status,
    ("DELETE", "/kb/documents"): handle_delete_kb_documents,
    ("POST", "/kb/query"): handle_post_kb_query,
    ("GET", "/api/mcp/config"): handle_get_mcp_config,
    ("PUT", "/api/mcp/config"): handle_put_mcp_config,
    ("POST", "/api/mcp/validate"): handle_post_mcp_validate,
    ("POST", "/api/mcp/servers/test"): handle_post_mcp_server_test,
}


DYNAMIC_ROUTES: Tuple[Tuple[str, Pattern[str], DynamicHandler], ...] = (
    ("GET", re.compile(r"^/api/chats/(?P<chat_id>[^/]+)$"), _handle_get_chat_dynamic),
    ("GET", re.compile(r"^/api/chats/(?P<chat_id>[^/]+)/summary$"), _handle_get_chat_summary_dynamic),
    ("POST", re.compile(r"^/api/chats/(?P<chat_id>[^/]+)/messages$"), _handle_post_chat_message_dynamic),
    ("POST", re.compile(r"^/api/chats/(?P<chat_id>[^/]+)/compact$"), _handle_post_chat_compact_dynamic),
    ("PATCH", re.compile(r"^/api/chats/(?P<chat_id>[^/]+)$"), _handle_patch_chat_dynamic),
    ("PATCH", re.compile(r"^/api/chats/(?P<chat_id>[^/]+)/messages/(?P<message_id>[^/]+)$"), _handle_patch_chat_message_dynamic),
    ("DELETE", re.compile(r"^/api/chats/(?P<chat_id>[^/]+)$"), _handle_delete_chat_dynamic),
    ("GET", re.compile(r"^/api/runs/(?P<run_id>[^/]+)$"), _handle_get_run_dynamic),
    ("POST", re.compile(r"^/api/runs/(?P<run_id>[^/]+)/resume$"), _handle_post_run_resume_dynamic),
    ("GET", re.compile(r"^/api/mcp/servers/(?P<server_id>[^/]+)/catalog$"), _handle_get_mcp_server_catalog_dynamic),
    ("POST", re.compile(r"^/api/mcp/servers/(?P<server_id>[^/]+)/close$"), _handle_post_mcp_server_close_dynamic),
)


def dispatch(handler: Any, method: str, path: str) -> bool:
    m = (method or "").upper().strip()
    exact = EXACT_ROUTES.get((m, path))
    if exact is not None:
        exact(handler)
        return True

    for rm, pattern, fn in DYNAMIC_ROUTES:
        if m != rm:
            continue
        match = pattern.match(path)
        if match is None:
            continue
        fn(handler, match)
        return True

    return False


__all__ = [
    "dispatch",
]
