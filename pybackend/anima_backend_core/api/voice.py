from __future__ import annotations

import os
import tempfile
from http import HTTPStatus
from pathlib import Path
from typing import Any, Optional

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import load_settings
from anima_backend_shared.voice import (
    _convert_audio_to_wav_if_needed,
    _extract_audio_from_http_request,
    _get_installed_voice_models,
    _is_local_model_dir_installed,
    _is_remote_model_installed,
    _normalize_whisper_model_id,
    _start_download_task,
    get_voice_pipeline,
    voice_download_lock,
    voice_download_tasks,
    voice_model_catalog,
    voice_models_dir,
)


def handle_get_voice_models_base_dir(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "dir": str(voice_models_dir())})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_voice_models_catalog(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": voice_model_catalog()})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_voice_models_installed(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": _get_installed_voice_models()})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_voice_models_download_status(handler: Any) -> None:
    q = getattr(handler, "query", None) or {}
    task_id = str(q.get("taskId") or "").strip()
    if not task_id:
        json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
        return
    with voice_download_lock:
        task = voice_download_tasks.get(task_id)
    if not task:
        json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
        return
    json_response(handler, HTTPStatus.OK, {"ok": True, "task": task})


def handle_post_voice_models_download(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        model_id = _normalize_whisper_model_id(body.get("id") or body.get("modelId"))
        if not model_id or model_id.startswith("local:"):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid model id"})
            return
        if model_id not in [m["id"] for m in voice_model_catalog()]:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Unknown model id"})
            return
        task_id = _start_download_task(model_id)
        json_response(handler, HTTPStatus.OK, {"ok": True, "taskId": task_id})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_voice_models_download_cancel(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        task_id = str(body.get("taskId") or "").strip()
        if not task_id:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
            return
        with voice_download_lock:
            task = voice_download_tasks.get(task_id)
            if task is None:
                json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
                return
            task["cancelRequested"] = True
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_voice_transcribe(handler: Any) -> None:
    try:
        content_length = int(handler.headers.get("Content-Length", 0))
        if content_length == 0:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "No content"})
            return
        raw_body = handler.rfile.read(content_length)
        audio_bytes, audio_ext = _extract_audio_from_http_request(handler.headers, raw_body)

        with tempfile.NamedTemporaryFile(suffix=audio_ext or ".webm", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        wav_path: Optional[str] = None
        wav_delete = False

        try:
            raw = load_settings()
            settings_obj = raw.get("settings") if isinstance(raw, dict) else None
            voice_obj = settings_obj.get("voice") if isinstance(settings_obj, dict) else None
            voice_model_raw = voice_obj.get("model") if isinstance(voice_obj, dict) else ""
            voice_lang = voice_obj.get("language") if isinstance(voice_obj, dict) else "auto"
            model_id = _normalize_whisper_model_id(voice_model_raw)
            if not model_id:
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Voice model is not configured"})
                return

            if model_id.startswith("local:"):
                local_path = model_id[len("local:") :].strip()
                if not local_path or not os.path.exists(local_path):
                    json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Local voice model path not found"})
                    return
                model_key = local_path
            else:
                remote_models = voice_obj.get("remoteModels") if isinstance(voice_obj, dict) else None
                remote_models = remote_models if isinstance(remote_models, list) else []
                mapped_dir: Optional[str] = None
                for rm in remote_models:
                    if not isinstance(rm, dict):
                        continue
                    if str(rm.get("id") or "").strip() != model_id:
                        continue
                    p = str(rm.get("path") or "").strip()
                    if p and _is_local_model_dir_installed(Path(p)):
                        mapped_dir = p
                        break

                if mapped_dir:
                    model_key = mapped_dir
                else:
                    if not _is_remote_model_installed(model_id):
                        json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Voice model is not installed"})
                        return
                    model_key = model_id

            pipe = get_voice_pipeline(model_key)
            generate_kwargs = None
            lang = str(voice_lang or "").strip()
            if lang and lang != "auto":
                lang_map = {"en": "english", "zh": "chinese", "ja": "japanese"}
                generate_kwargs = {"language": lang_map.get(lang, lang)}

            wav_path, wav_delete = _convert_audio_to_wav_if_needed(tmp_path)
            result = pipe(wav_path, generate_kwargs=generate_kwargs) if generate_kwargs else pipe(wav_path)
            text = result.get("text", "")
            json_response(handler, HTTPStatus.OK, {"ok": True, "text": text})
        finally:
            if wav_path and wav_delete and os.path.exists(wav_path):
                try:
                    os.unlink(wav_path)
                except Exception:
                    pass
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
