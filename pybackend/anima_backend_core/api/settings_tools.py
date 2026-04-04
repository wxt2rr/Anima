from __future__ import annotations

import os
import time
import mimetypes
import json
import urllib.request
import urllib.error
import subprocess
import tempfile
import shutil
import shlex
import base64
from pathlib import Path
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Tuple

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import get_skills_content, list_skills, load_settings, open_folder, skills_dir
from anima_backend_shared.tools import builtin_tools, mcp_tools

DEFAULT_MODEL_CONTEXT_WINDOW = 128000


def _normalize_fetched_models(raw_models: Any) -> List[Dict[str, Any]]:
    items = raw_models if isinstance(raw_models, list) else []
    out: List[Dict[str, Any]] = []
    for m in items:
        if isinstance(m, str):
            mid = str(m).strip()
            if not mid:
                continue
            out.append({"id": mid, "isEnabled": True, "config": {"id": mid, "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}})
            continue
        if not isinstance(m, dict):
            continue
        mid = str(m.get("id") or "").strip()
        if not mid:
            continue
        mc = m.get("config") if isinstance(m.get("config"), dict) else {}
        try:
            cw = int(mc.get("contextWindow") or 0)
        except Exception:
            cw = 0
        next_mc = dict(mc)
        next_mc["id"] = mid
        if cw <= 0:
            next_mc["contextWindow"] = DEFAULT_MODEL_CONTEXT_WINDOW
        out.append({"id": mid, "isEnabled": bool(m.get("isEnabled", True)), "config": next_mc})
    return out


def handle_get_settings(handler: Any) -> None:
    try:
        out = load_settings()
        if isinstance(out, dict):
            try:
                from anima_backend_shared.voice import _get_installed_voice_models

                out = {**out, "voiceModelsInstalled": _get_installed_voice_models()}
            except Exception:
                out = {**out, "voiceModelsInstalled": []}
            try:
                from anima_backend_shared.memory_embedding import _get_installed_embedding_models

                out = {**out, "embeddingModelsInstalled": _get_installed_embedding_models()}
            except Exception:
                out = {**out, "embeddingModelsInstalled": []}
        json_response(handler, HTTPStatus.OK, out)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_patch_settings(handler: Any) -> None:
    from anima_backend_shared.settings import save_settings

    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        merged = save_settings(body)
        try:
            from anima_backend_core.telegram_integration import reconcile_telegram_from_settings

            if isinstance(merged, dict):
                reconcile_telegram_from_settings(merged)
        except Exception:
            pass
        try:
            from anima_backend_core.cron import reconcile_cron_from_settings

            if isinstance(merged, dict):
                reconcile_cron_from_settings(merged)
        except Exception:
            pass
        try:
            from anima_backend_core.runtime.graph import reconcile_openclaw_from_settings

            if isinstance(merged, dict):
                reconcile_openclaw_from_settings(merged)
        except Exception:
            pass
        if isinstance(merged, dict):
            try:
                from anima_backend_shared.voice import _get_installed_voice_models

                merged = {**merged, "voiceModelsInstalled": _get_installed_voice_models()}
            except Exception:
                merged = {**merged, "voiceModelsInstalled": []}
            try:
                from anima_backend_shared.memory_embedding import _get_installed_embedding_models

                merged = {**merged, "embeddingModelsInstalled": _get_installed_embedding_models()}
            except Exception:
                merged = {**merged, "embeddingModelsInstalled": []}
        json_response(handler, HTTPStatus.OK, merged)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_skills_list(handler: Any) -> None:
    try:
        dir_path, skills = list_skills()
        json_response(handler, HTTPStatus.OK, {"ok": True, "dir": dir_path, "skills": skills})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_skills_content(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        ids: Optional[List[str]] = None
        if isinstance(body, dict):
            raw_ids = body.get("ids")
            if isinstance(raw_ids, list):
                ids = [str(x) for x in raw_ids if str(x).strip()]
        skills = get_skills_content(ids)
        json_response(handler, HTTPStatus.OK, {"ok": True, "skills": skills})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_skills_open_dir(handler: Any) -> None:
    try:
        open_folder(skills_dir())
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_tools_list(handler: Any) -> None:
    try:
        settings_obj = load_settings()
        composer: Dict[str, Any] = {}
        tools = builtin_tools()
        mcp, _ = mcp_tools(settings_obj, composer)
        json_response(handler, HTTPStatus.OK, {"ok": True, "tools": tools, "mcpTools": mcp})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_artifacts_cleanup(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            body = {}

        settings_obj = load_settings()
        s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
        if not isinstance(s, dict):
            s = {}

        workspace_dir = str(body.get("workspaceDir") or "").strip() or str(s.get("workspaceDir") or "").strip()
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return

        try:
            from anima_backend_shared.util import norm_abs

            workspace_dir = norm_abs(workspace_dir)
        except Exception:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid workspaceDir"})
            return

        artifacts_dir = Path(workspace_dir) / ".anima" / "artifacts"
        if not artifacts_dir.exists() or not artifacts_dir.is_dir():
            json_response(handler, HTTPStatus.OK, {"ok": True, "deletedCount": 0, "freedBytes": 0, "remainingBytes": 0})
            return

        max_age_days = body.get("maxAgeDays")
        try:
            max_age_days = int(max_age_days) if max_age_days is not None else 14
        except Exception:
            max_age_days = 14
        max_age_days = max(0, min(int(max_age_days), 3650))

        max_total_bytes = body.get("maxTotalBytes")
        try:
            max_total_bytes = int(max_total_bytes) if max_total_bytes is not None else (1024 * 1024 * 1024)
        except Exception:
            max_total_bytes = 1024 * 1024 * 1024
        max_total_bytes = max(0, min(int(max_total_bytes), 10 * 1024 * 1024 * 1024))

        now = int(time.time())
        cutoff = now - (max_age_days * 86400)

        entries: List[Dict[str, Any]] = []
        for p in artifacts_dir.iterdir():
            try:
                if not p.is_file():
                    continue
                st = p.stat()
                entries.append({"path": p, "mtime": int(st.st_mtime), "size": int(st.st_size)})
            except Exception:
                continue

        try:
            from anima_backend_shared.util import is_within
        except Exception:
            is_within = None  # type: ignore[assignment]

        deleted = 0
        freed = 0
        kept: List[Dict[str, Any]] = []

        for e in sorted(entries, key=lambda x: int(x.get("mtime") or 0)):
            p = e["path"]
            mtime = int(e.get("mtime") or 0)
            size = int(e.get("size") or 0)
            ap = str(p.resolve())
            if is_within is not None and not is_within(str(artifacts_dir.resolve()), ap):
                continue
            if max_age_days > 0 and mtime > 0 and mtime < cutoff:
                try:
                    os.remove(ap)
                    deleted += 1
                    freed += max(0, size)
                except Exception:
                    kept.append(e)
                continue
            kept.append(e)

        total = 0
        for e in kept:
            try:
                total += int(e.get("size") or 0)
            except Exception:
                continue

        if max_total_bytes >= 0 and total > max_total_bytes:
            for e in sorted(kept, key=lambda x: int(x.get("mtime") or 0)):
                if total <= max_total_bytes:
                    break
                p = e["path"]
                size = int(e.get("size") or 0)
                ap = str(p.resolve())
                if is_within is not None and not is_within(str(artifacts_dir.resolve()), ap):
                    continue
                try:
                    os.remove(ap)
                    deleted += 1
                    freed += max(0, size)
                    total = max(0, total - max(0, size))
                except Exception:
                    continue

        json_response(handler, HTTPStatus.OK, {"ok": True, "deletedCount": deleted, "freedBytes": freed, "remainingBytes": total})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_artifact_file(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        raw_path = str(q.get("path") or "").strip()
        if not raw_path:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "path is required"})
            return

        settings_obj = load_settings()
        s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
        if not isinstance(s, dict):
            s = {}

        workspace_dir = str(q.get("workspaceDir") or "").strip() or str(s.get("workspaceDir") or "").strip()
        if not workspace_dir:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required"})
            return

        from anima_backend_shared.util import is_within, norm_abs

        try:
            workspace_dir = norm_abs(workspace_dir)
        except Exception:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid workspaceDir"})
            return

        try:
            ap = norm_abs(raw_path)
        except Exception:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid path"})
            return

        if not is_within(workspace_dir, ap):
            json_response(handler, HTTPStatus.FORBIDDEN, {"ok": False, "error": "Path outside workspace"})
            return
        if not os.path.isfile(ap):
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "File not found"})
            return

        total = 0
        try:
            total = int(os.path.getsize(ap))
        except Exception:
            total = 0

        mime = mimetypes.guess_type(ap)[0] or "application/octet-stream"
        range_header = ""
        try:
            range_header = str(getattr(handler, "headers", None).get("Range") or "")
        except Exception:
            range_header = ""

        start = 0
        end = max(0, total - 1)
        partial = False
        if range_header.startswith("bytes=") and total > 0:
            spec = range_header[len("bytes=") :].strip()
            first = spec.split(",")[0].strip()
            if "-" in first:
                a, b = first.split("-", 1)
                a = a.strip()
                b = b.strip()
                if a == "" and b:
                    try:
                        suffix = int(b)
                        start = max(0, total - max(0, suffix))
                        end = total - 1
                        partial = True
                    except Exception:
                        partial = False
                else:
                    try:
                        start = int(a) if a else 0
                        end = int(b) if b else (total - 1)
                        partial = True
                    except Exception:
                        partial = False

        if total <= 0:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Empty file"})
            return

        start = max(0, min(int(start), total - 1))
        end = max(start, min(int(end), total - 1))
        length = end - start + 1

        if partial:
            handler.send_response(HTTPStatus.PARTIAL_CONTENT)
        else:
            handler.send_response(HTTPStatus.OK)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Type", mime)
        if partial:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{total}")
        handler.send_header("Content-Length", str(length if partial else total))
        handler.end_headers()

        with open(ap, "rb") as f:
            if partial and start:
                f.seek(start)
            remaining = length if partial else total
            while remaining > 0:
                chunk = f.read(min(1024 * 64, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_attachment_file(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        raw_path = str(q.get("path") or "").strip()
        if not raw_path:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "path is required"})
            return

        from anima_backend_shared.util import is_within, norm_abs

        workspace_dir = str(q.get("workspaceDir") or "").strip()
        if workspace_dir:
            try:
                workspace_dir = norm_abs(workspace_dir)
            except Exception:
                workspace_dir = ""

        ap = ""
        if os.path.isabs(raw_path):
            try:
                ap = norm_abs(raw_path)
            except Exception:
                ap = ""
        else:
            if not workspace_dir:
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "workspaceDir is required for relative paths"})
                return
            try:
                ap = norm_abs(str(Path(workspace_dir) / raw_path))
            except Exception:
                ap = ""
            if not ap or not is_within(workspace_dir, ap):
                json_response(handler, HTTPStatus.FORBIDDEN, {"ok": False, "error": "Path outside workspace"})
                return

        if not ap:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid path"})
            return
        if not os.path.isfile(ap):
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "File not found"})
            return

        total = 0
        try:
            total = int(os.path.getsize(ap))
        except Exception:
            total = 0
        if total <= 0:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Empty file"})
            return

        mime = mimetypes.guess_type(ap)[0] or "application/octet-stream"
        if not str(mime).startswith("image/"):
            json_response(handler, HTTPStatus.FORBIDDEN, {"ok": False, "error": "Only image/* is allowed"})
            return

        range_header = ""
        try:
            range_header = str(getattr(handler, "headers", None).get("Range") or "")
        except Exception:
            range_header = ""

        start = 0
        end = max(0, total - 1)
        partial = False
        if range_header.startswith("bytes=") and total > 0:
            spec = range_header[len("bytes=") :].strip()
            first = spec.split(",")[0].strip()
            if "-" in first:
                a, b = first.split("-", 1)
                a = a.strip()
                b = b.strip()
                if a == "" and b:
                    try:
                        suffix = int(b)
                        start = max(0, total - max(0, suffix))
                        end = total - 1
                        partial = True
                    except Exception:
                        partial = False
                else:
                    try:
                        start = int(a) if a else 0
                        end = int(b) if b else (total - 1)
                        partial = True
                    except Exception:
                        partial = False

        start = max(0, min(int(start), total - 1))
        end = max(start, min(int(end), total - 1))
        length = end - start + 1

        if partial:
            handler.send_response(HTTPStatus.PARTIAL_CONTENT)
        else:
            handler.send_response(HTTPStatus.OK)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Content-Type", mime)
        if partial:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{total}")
        handler.send_header("Content-Length", str(length if partial else total))
        handler.end_headers()

        with open(ap, "rb") as f:
            if partial and start:
                f.seek(start)
            remaining = length if partial else total
            while remaining > 0:
                chunk = f.read(min(1024 * 64, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_providers_fetch_models(handler: Any) -> None:
    from anima_backend_shared.providers import fetch_provider_models

    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        provider_id = str(body.get("providerId") or "").strip().lower()
        base_url = str(body.get("baseUrl") or "").strip()
        if not base_url and provider_id == "ollama_local":
            base_url = "http://127.0.0.1:11434/v1"
        if not base_url and provider_id == "lmstudio_local":
            base_url = "http://127.0.0.1:1234/v1"
        if not base_url:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "baseUrl is required"})
            return
        use_qwen_oauth = bool(body.get("useQwenOAuth") is True)
        profile_id = str(body.get("profileId") or "").strip() or "default"
        if (provider_id and provider_id.startswith("qwen")) or use_qwen_oauth:
            from anima_backend_shared.qwen_auth_runtime import resolve_qwen_access_token

            token = resolve_qwen_access_token(provider_id, profile_id)
            models = fetch_provider_models(base_url, token)
        else:
            api_key = body.get("apiKey")
            try:
                models = fetch_provider_models(base_url, api_key or "")
            except Exception:
                if provider_id == "ollama_local":
                    models = _fetch_ollama_models_by_tags(base_url)
                else:
                    raise
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": _normalize_fetched_models(models)})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def _fetch_ollama_models_by_tags(base_url: str) -> List[Dict[str, Any]]:
    base = str(base_url or "").strip().rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    url = f"{base}/api/tags"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read()
    data = json.loads(raw.decode("utf-8")) if raw else {}
    models = data.get("models") if isinstance(data, dict) else None
    if not isinstance(models, list):
        return []
    out: List[Dict[str, Any]] = []
    for m in models:
        if not isinstance(m, dict):
            continue
        mid = str(m.get("model") or m.get("name") or "").strip()
        if not mid:
            continue
        out.append({"id": mid, "isEnabled": True, "config": {"id": mid, "contextWindow": DEFAULT_MODEL_CONTEXT_WINDOW}})
    return out


def handle_post_tts_preview(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        text = str(body.get("text") or "").strip()
        if not text:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "text is required"})
            return
        provider = str(body.get("provider") or "macos_say").strip().lower()
        model = str(body.get("model") or "").strip()
        endpoint = str(body.get("endpoint") or "").strip()
        api_key = str(body.get("apiKey") or "").strip()
        qwen_model = str(body.get("qwenModel") or "").strip()
        qwen_language_type = str(body.get("qwenLanguageType") or "").strip()
        local_models = body.get("localModels")
        speed_raw = body.get("speed")
        try:
            speed = float(speed_raw) if speed_raw is not None else 1.0
        except Exception:
            speed = 1.0
        speed = max(0.5, min(2.0, speed))
        if provider == "macos_say":
            rate = max(80, min(500, int(175 * speed)))
            cmd = ["say", "-r", str(rate)]
            if model:
                cmd += ["-v", model]
            cmd.append(text[:500])
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif provider == "piper":
            _tts_preview_piper(text=text[:500], model=model, local_models=local_models, speed=speed)
        elif provider in ("custom_http", "kokoro_onnx"):
            if not endpoint:
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "endpoint is required for custom_http/kokoro_onnx"})
                return
            _tts_preview_via_http(
                endpoint=endpoint,
                api_key=api_key,
                payload={"text": text[:500], "model": model, "speed": speed, "provider": provider},
            )
        elif provider == "qwen_tts":
            is_local = _is_local_endpoint(endpoint)
            if (not api_key) and (not is_local):
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "apiKey is required for qwen_tts"})
                return
            _tts_preview_qwen(
                text=text[:500],
                voice=model,
                qwen_model=qwen_model or "qwen3-tts-flash",
                language_type=qwen_language_type or "Auto",
                endpoint=endpoint,
                api_key=api_key,
            )
        else:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"Unsupported TTS provider: {provider}"})
            return
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except FileNotFoundError:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "`say` command not found on this system"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def _resolve_tts_local_model_path(model: str, local_models: Any) -> str:
    m = str(model or "").strip()
    if m and os.path.isfile(m):
        return m
    if not isinstance(local_models, list):
        return m
    target = m.lower()
    for item in local_models:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip()
        if not path:
            continue
        iid = str(item.get("id") or "").strip().lower()
        name = str(item.get("name") or "").strip().lower()
        if not target or target == iid or target == name:
            if os.path.isfile(path):
                return path
    return m


def _tts_preview_piper(*, text: str, model: str, local_models: Any, speed: float) -> None:
    if not shutil.which("piper"):
        raise RuntimeError("`piper` command not found. Please install Piper first.")
    if not shutil.which("afplay"):
        raise RuntimeError("`afplay` command not found on this system.")
    model_path = _resolve_tts_local_model_path(model, local_models)
    if not model_path:
        raise RuntimeError("piper model is required")
    if not os.path.isfile(model_path):
        raise RuntimeError(f"piper model file not found: {model_path}")
    length_scale = max(0.5, min(2.0, 1.0 / max(0.5, min(2.0, float(speed)))))
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name
    try:
        proc = subprocess.run(
            ["piper", "--model", model_path, "--output_file", wav_path, "--length_scale", f"{length_scale:.3f}"],
            input=text,
            text=True,
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            err = str(proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(f"piper failed: {err[:400]}")
        cmd = f"afplay {shlex.quote(wav_path)} >/dev/null 2>&1; rm -f {shlex.quote(wav_path)} >/dev/null 2>&1"
        subprocess.Popen(["/bin/sh", "-c", cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        try:
            os.remove(wav_path)
        except Exception:
            pass
        raise


def _tts_preview_via_http(*, endpoint: str, api_key: str, payload: Dict[str, Any]) -> None:
    req = urllib.request.Request(endpoint, method="POST")
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    with urllib.request.urlopen(req, data=raw, timeout=15) as resp:
        status = int(getattr(resp, "status", 200) or 200)
    if status >= 400:
        raise RuntimeError(f"Upstream HTTP {status}")


def _extract_qwen_audio_bytes(obj: Any) -> bytes:
    if isinstance(obj, str):
        s = obj.strip()
        if not s:
            return b""
        try:
            return base64.b64decode(s, validate=False)
        except Exception:
            return b""
    if isinstance(obj, dict):
        keys = ["data", "audio", "audio_data", "base64", "wav", "pcm"]
        for k in keys:
            if k in obj:
                b = _extract_qwen_audio_bytes(obj.get(k))
                if b:
                    return b
        for v in obj.values():
            b = _extract_qwen_audio_bytes(v)
            if b:
                return b
    if isinstance(obj, list):
        for item in obj:
            b = _extract_qwen_audio_bytes(item)
            if b:
                return b
    return b""


def _is_local_endpoint(endpoint: str) -> bool:
    ep = str(endpoint or "").strip().lower()
    if not ep:
        return False
    return ep.startswith("http://127.0.0.1") or ep.startswith("http://localhost") or ep.startswith("http://0.0.0.0")


def _tts_preview_qwen(*, text: str, voice: str, qwen_model: str, language_type: str, endpoint: str, api_key: str) -> None:
    if not shutil.which("afplay"):
        raise RuntimeError("`afplay` command not found on this system.")
    ep = str(endpoint or "").strip() or "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    payload = {
        "model": str(qwen_model or "qwen3-tts-flash"),
        "input": {
            "text": str(text or ""),
            "voice": str(voice or "Cherry"),
            "language_type": str(language_type or "Auto"),
        },
    }
    req = urllib.request.Request(ep, method="POST")
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/json")
    if str(api_key or "").strip():
        req.add_header("Authorization", f"Bearer {api_key}")
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    with urllib.request.urlopen(req, data=raw, timeout=20) as resp:
        body = resp.read()
        status = int(getattr(resp, "status", 200) or 200)
        content_type = str(getattr(resp, "headers", {}).get("Content-Type") or "").lower()
    if status >= 400:
        raise RuntimeError(f"Upstream HTTP {status}")
    if content_type.startswith("audio/") and body:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(body)
            wav_path = tmp.name
        cmd = f"afplay {shlex.quote(wav_path)} >/dev/null 2>&1; rm -f {shlex.quote(wav_path)} >/dev/null 2>&1"
        subprocess.Popen(["/bin/sh", "-c", cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    data = json.loads(body.decode("utf-8")) if body else {}
    audio_bytes = _extract_qwen_audio_bytes(data)
    if not audio_bytes:
        raise RuntimeError("qwen_tts returned no audio data")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        wav_path = tmp.name
    cmd = f"afplay {shlex.quote(wav_path)} >/dev/null 2>&1; rm -f {shlex.quote(wav_path)} >/dev/null 2>&1"
    subprocess.Popen(["/bin/sh", "-c", cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
