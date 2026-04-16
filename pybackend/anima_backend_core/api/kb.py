from __future__ import annotations

import threading
import time
import uuid
from http import HTTPStatus
from typing import Any

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.knowledge_base import (
    delete_kb_documents,
    get_kb_stats,
    import_markdown_files,
    list_kb_documents,
    query_kb_chunks,
)
from anima_backend_shared.settings import load_settings

kb_import_tasks: dict[str, dict[str, Any]] = {}
kb_import_lock = threading.Lock()


def _resolve_workspace_dir(handler: Any, body: Any = None) -> str:
    if isinstance(body, dict):
        wd = str(body.get("workspaceDir") or "").strip()
        if wd:
            return wd
    q = getattr(handler, "query", None) or {}
    wd = str(q.get("workspaceDir") or "").strip()
    if wd:
        return wd
    raw = load_settings()
    s = raw.get("settings") if isinstance(raw, dict) else {}
    if not isinstance(s, dict):
        s = {}
    return str(s.get("workspaceDir") or "").strip()


def handle_get_kb_documents(handler: Any) -> None:
    try:
        workspace_dir = _resolve_workspace_dir(handler)
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        q = getattr(handler, "query", None) or {}
        limit = int(q.get("limit") or 500)
        items = list_kb_documents(workspace_dir=workspace_dir, limit=limit)
        stats = get_kb_stats(workspace_dir=workspace_dir)
        json_response(handler, HTTPStatus.OK, {"ok": True, "items": items, "stats": stats})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_kb_import(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        workspace_dir = _resolve_workspace_dir(handler, body)
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        raw_paths = body.get("paths")
        paths = [str(x).strip() for x in raw_paths if str(x).strip()] if isinstance(raw_paths, list) else []
        if not paths:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "paths is required"})
            return
        chunk_size = int(body.get("chunkSize") or 1200)
        chunk_overlap = int(body.get("chunkOverlap") or 200)
        max_chunks_per_doc = int(body.get("maxChunksPerDoc") or 2000)
        task_id = f"kbimp_{uuid.uuid4().hex[:12]}"
        now_ms = int(time.time() * 1000)
        with kb_import_lock:
            kb_import_tasks[task_id] = {
                "taskId": task_id,
                "status": "running",
                "workspaceDir": workspace_dir,
                "createdAt": now_ms,
                "startedAt": now_ms,
                "endedAt": 0,
                "percent": 0,
                "stage": "queued",
                "totalFiles": len(paths),
                "processedFiles": 0,
                "totalChunks": 0,
                "processedChunks": 0,
                "currentFile": "",
                "result": None,
                "error": "",
            }

        def _run() -> None:
            def _on_progress(info: dict[str, Any]) -> None:
                with kb_import_lock:
                    task = kb_import_tasks.get(task_id)
                    if task is None:
                        return
                    task["stage"] = str(info.get("stage") or task.get("stage") or "running")
                    task["percent"] = int(info.get("percent") or task.get("percent") or 0)
                    task["totalFiles"] = int(info.get("totalFiles") or task.get("totalFiles") or 0)
                    task["processedFiles"] = int(info.get("processedFiles") or task.get("processedFiles") or 0)
                    task["totalChunks"] = int(info.get("totalChunks") or task.get("totalChunks") or 0)
                    task["processedChunks"] = int(info.get("processedChunks") or task.get("processedChunks") or 0)
                    task["currentFile"] = str(info.get("currentFile") or task.get("currentFile") or "")
                    task["currentFileProcessedChunks"] = int(
                        info.get("currentFileProcessedChunks") or task.get("currentFileProcessedChunks") or 0
                    )
                    task["currentFileTotalChunks"] = int(info.get("currentFileTotalChunks") or task.get("currentFileTotalChunks") or 0)

            try:
                result = import_markdown_files(
                    workspace_dir=workspace_dir,
                    paths=paths,
                    chunk_size=chunk_size,
                    chunk_overlap=chunk_overlap,
                    max_chunks_per_doc=max_chunks_per_doc,
                    progress_cb=_on_progress,
                )
                stats = get_kb_stats(workspace_dir=workspace_dir)
                with kb_import_lock:
                    task = kb_import_tasks.get(task_id)
                    if task is None:
                        return
                    task["status"] = "done"
                    task["endedAt"] = int(time.time() * 1000)
                    task["percent"] = 100
                    task["stage"] = "done"
                    task["result"] = result
                    task["stats"] = stats
            except Exception as e:
                with kb_import_lock:
                    task = kb_import_tasks.get(task_id)
                    if task is None:
                        return
                    task["status"] = "error"
                    task["endedAt"] = int(time.time() * 1000)
                    task["error"] = str(e)
                    task["stage"] = "error"

        threading.Thread(target=_run, daemon=True).start()
        json_response(handler, HTTPStatus.OK, {"ok": True, "taskId": task_id})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_kb_import_status(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        task_id = str(q.get("taskId") or "").strip()
        if not task_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
            return
        with kb_import_lock:
            task = kb_import_tasks.get(task_id)
            snapshot = dict(task) if isinstance(task, dict) else None
        if snapshot is None:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
            return
        json_response(handler, HTTPStatus.OK, {"ok": True, "task": snapshot})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_delete_kb_documents(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            body = {}
        workspace_dir = _resolve_workspace_dir(handler, body)
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        raw_ids = body.get("ids")
        ids = [str(x).strip() for x in raw_ids if str(x).strip()] if isinstance(raw_ids, list) else []
        raw_paths = body.get("paths")
        paths = [str(x).strip() for x in raw_paths if str(x).strip()] if isinstance(raw_paths, list) else []
        out = delete_kb_documents(workspace_dir=workspace_dir, ids=ids, paths=paths)
        stats = get_kb_stats(workspace_dir=workspace_dir)
        json_response(handler, HTTPStatus.OK, {"ok": True, "result": out, "stats": stats})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_kb_query(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        workspace_dir = _resolve_workspace_dir(handler, body)
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return
        query = str(body.get("query") or "").strip()
        if not query:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "query is required"})
            return
        items = query_kb_chunks(
            workspace_dir=workspace_dir,
            query=query,
            top_k=int(body.get("topK") or 6),
            similarity_threshold=float(body.get("threshold") if body.get("threshold") is not None else 0.35),
            hybrid_enabled=bool(True if body.get("hybridEnabled") is None else body.get("hybridEnabled")),
            keyword_top_k=int(body.get("keywordTopK") or 30),
            max_content_chars=int(body.get("maxContentChars") or 700),
        )
        json_response(handler, HTTPStatus.OK, {"ok": True, "items": items})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
