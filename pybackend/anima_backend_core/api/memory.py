from __future__ import annotations

from http import HTTPStatus
from typing import Any

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.memory_scope_policy import decide_memory_scope
from anima_backend_shared.memory_embedding import (
    embedding_download_lock,
    embedding_download_tasks,
    embedding_model_catalog,
    embedding_models_dir,
    start_embedding_download_task,
    _get_installed_embedding_models,
)
from anima_backend_shared.memory_store import get_memory_metrics_summary
from anima_backend_shared.memory_store import add_memory_item_scoped, delete_memory_item, list_memory_items, update_memory_item
from anima_backend_shared.memory_store import global_memory_workspace_dir
from anima_backend_shared.settings import load_settings


def _resolve_workspace_dir(handler: Any) -> str:
    q = getattr(handler, "query", None) or {}
    wd = str(q.get("workspaceDir") or "").strip()
    if wd:
        return wd
    raw = load_settings()
    s = raw.get("settings") if isinstance(raw, dict) else {}
    if not isinstance(s, dict):
        s = {}
    return str(s.get("workspaceDir") or "").strip()


def handle_get_memory_embedding_models_base_dir(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "dir": str(embedding_models_dir())})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_memory_embedding_models_catalog(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": embedding_model_catalog()})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_memory_embedding_models_installed(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": _get_installed_embedding_models()})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_memory_embedding_models_download_status(handler: Any) -> None:
    q = getattr(handler, "query", None) or {}
    task_id = str(q.get("taskId") or "").strip()
    if not task_id:
        json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
        return
    with embedding_download_lock:
        task = embedding_download_tasks.get(task_id)
    if not task:
        json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
        return
    json_response(handler, HTTPStatus.OK, {"ok": True, "task": task})


def handle_post_memory_embedding_models_download(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        model_id = str(body.get("id") or body.get("modelId") or "").strip()
        if not model_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "id is required"})
            return
        if model_id.startswith("local:"):
            model_id = model_id[len("local:") :].strip()
        all_ids = [str(x.get("id") or "").strip() for x in embedding_model_catalog() if isinstance(x, dict)]
        if model_id not in all_ids:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Unknown model id"})
            return
        task_id = start_embedding_download_task(model_id)
        json_response(handler, HTTPStatus.OK, {"ok": True, "taskId": task_id})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_memory_embedding_models_download_cancel(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        task_id = str(body.get("taskId") or "").strip()
        if not task_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
            return
        with embedding_download_lock:
            task = embedding_download_tasks.get(task_id)
            if task is None:
                json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
                return
            task["cancelRequested"] = True
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_memory_metrics(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        days = int(q.get("days") or 7)
        workspace_dir = _resolve_workspace_dir(handler)
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        out = get_memory_metrics_summary(workspace_dir=workspace_dir, days=days)
        json_response(handler, HTTPStatus.OK, {"ok": True, "metrics": out})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_memory_items(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        workspace_dir = _resolve_workspace_dir(handler)
        limit = int(q.get("limit") or 200)
        include_inactive = str(q.get("includeInactive") or "1").strip() not in ("0", "false", "False")
        query = str(q.get("query") or "").strip()
        include_global = str(q.get("includeGlobal") or "0").strip() in ("1", "true", "True")
        items = []
        if workspace_dir:
            ws_items = list_memory_items(
                workspace_dir=workspace_dir,
                limit=limit,
                include_inactive=include_inactive,
                query=query,
            )
            for it in ws_items:
                if isinstance(it, dict):
                    it["scope"] = "workspace"
            items.extend(ws_items)
        if include_global:
            g_items = list_memory_items(
                workspace_dir=global_memory_workspace_dir(),
                limit=limit,
                include_inactive=include_inactive,
                query=query,
            )
            for it in g_items:
                if isinstance(it, dict):
                    it["scope"] = "global"
            items.extend(g_items)
        if not workspace_dir and not include_global:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        items.sort(key=lambda x: int((x or {}).get("createdAt") or 0), reverse=True)
        json_response(handler, HTTPStatus.OK, {"ok": True, "items": items})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_memory_items(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        requested_scope = str(body.get("scope") or "auto").strip().lower()
        if requested_scope not in ("workspace", "global", "auto"):
            requested_scope = "auto"
        raw = load_settings()
        st = raw.get("settings") if isinstance(raw, dict) else {}
        if not isinstance(st, dict):
            st = {}
        workspace_dir = str(body.get("workspaceDir") or "").strip() or _resolve_workspace_dir(handler)
        content = str(body.get("content") or "").strip()
        if not content:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "content is required"})
            return
        tags = [str(x) for x in (body.get("tags") or []) if str(x).strip()] if isinstance(body.get("tags"), list) else []
        memory_type = str(body.get("type") or "semantic")
        scope, scope_reason = decide_memory_scope(
            requested_scope=requested_scope,
            content=content,
            memory_type=memory_type,
            tags=tags,
            workspace_dir=workspace_dir,
            settings_obj=st,
        )
        if scope == "global":
            if not bool(st.get("memoryGlobalEnabled", False)):
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "global memory is disabled"})
                return
            if not bool(st.get("memoryGlobalWriteEnabled", True)):
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "global memory write is disabled"})
                return
        if scope == "workspace" and not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        item = add_memory_item_scoped(
            workspace_dir=workspace_dir,
            scope=scope,
            content=content,
            memory_type=memory_type,
            importance=float(body.get("importance") if body.get("importance") is not None else 0.7),
            confidence=float(body.get("confidence") if body.get("confidence") is not None else 0.8),
            source=str(body.get("source") or "settings"),
            run_id=str(body.get("runId") or ""),
            user_id=str(body.get("userId") or ""),
            evidence=[str(x) for x in (body.get("evidence") or []) if str(x).strip()] if isinstance(body.get("evidence"), list) else [],
            tags=tags,
            ttl_days=int(body.get("ttlDays") or 0),
        )
        json_response(handler, HTTPStatus.OK, {"ok": True, "item": item, "scopeDecision": {"scope": scope, "reason": scope_reason}})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_patch_memory_items(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        scope = str(body.get("scope") or "workspace").strip().lower()
        if scope not in ("workspace", "global"):
            scope = "workspace"
        workspace_dir = str(body.get("workspaceDir") or "").strip() or _resolve_workspace_dir(handler)
        if scope == "global":
            workspace_dir = global_memory_workspace_dir()
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        mid = str(body.get("id") or "").strip()
        if not mid:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "id is required"})
            return
        patch = body.get("patch")
        if not isinstance(patch, dict):
            patch = {}
        item = update_memory_item(workspace_dir=workspace_dir, memory_id=mid, patch=patch)
        if item is None:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "memory not found"})
            return
        json_response(handler, HTTPStatus.OK, {"ok": True, "item": item})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_delete_memory_items(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            body = {}
        scope = str(body.get("scope") or "workspace").strip().lower()
        if scope not in ("workspace", "global"):
            scope = "workspace"
        workspace_dir = str(body.get("workspaceDir") or "").strip() or _resolve_workspace_dir(handler)
        if scope == "global":
            workspace_dir = global_memory_workspace_dir()
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        mid = str(body.get("id") or "").strip()
        if not mid:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "id is required"})
            return
        ok = delete_memory_item(workspace_dir=workspace_dir, memory_id=mid)
        if not ok:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "memory not found"})
            return
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
