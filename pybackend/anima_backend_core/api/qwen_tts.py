from __future__ import annotations

from http import HTTPStatus
from typing import Any

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.qwen_tts_local import (
    ensure_qwen_tts_local_service,
    get_qwen_tts_service_status,
    qwen_tts_download_lock,
    qwen_tts_download_tasks,
    qwen_tts_installed_models,
    qwen_tts_model_catalog,
    start_qwen_tts_download,
)


def handle_get_tts_qwen_local_catalog(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": qwen_tts_model_catalog()})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_tts_qwen_local_installed(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": qwen_tts_installed_models()})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_tts_qwen_local_download(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        model_id = str(body.get("modelId") or body.get("id") or "").strip()
        task_id = start_qwen_tts_download(model_id)
        json_response(handler, HTTPStatus.OK, {"ok": True, "taskId": task_id})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_tts_qwen_local_download_status(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        task_id = str(q.get("taskId") or "").strip()
        if not task_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
            return
        with qwen_tts_download_lock:
            task = qwen_tts_download_tasks.get(task_id)
        if not task:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
            return
        json_response(handler, HTTPStatus.OK, {"ok": True, "task": task})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_tts_qwen_local_service_status(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, get_qwen_tts_service_status())
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_tts_qwen_local_service_start(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        model_id = str(body.get("modelId") or "").strip()
        endpoint = str(body.get("endpoint") or "").strip()
        if not model_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "modelId is required"})
            return
        out = ensure_qwen_tts_local_service(model_id=model_id, endpoint=endpoint)
        json_response(handler, HTTPStatus.OK, out)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
