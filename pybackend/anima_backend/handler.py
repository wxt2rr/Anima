import json
import uuid
import urllib.parse
import urllib.request
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple
import tempfile
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

from .chat import ClientDisconnected, apply_attachments_inline, chat_with_tools, chat_with_tools_stream
from .database import (
    add_message,
    clear_all_data,
    create_chat,
    db_path,
    close_db_connection,
    delete_chat,
    export_snapshot,
    get_app_settings_info,
    get_chat,
    get_chats,
    import_chats,
    import_snapshot,
    is_db_empty,
    update_chat,
    update_message,
)
from .http import json_response, read_body_json
from .providers import create_chat_provider, fetch_provider_models, get_provider_spec
from .settings import config_root, get_skills_content, list_skills, load_settings, open_folder, skills_dir, \
    save_settings
from .tools import builtin_tools, mcp_tools

# Global pipeline cache
voice_pipeline_cache: Dict[str, Any] = {}
voice_pipeline_lock = threading.Lock()
voice_pipeline_events: Dict[str, threading.Event] = {}

voice_download_tasks: Dict[str, Dict[str, Any]] = {}
voice_download_lock = threading.Lock()

hf_model_info_cache: Dict[str, Dict[str, Any]] = {}
hf_model_info_lock = threading.Lock()
hf_model_info_inflight: set[str] = set()


class VoiceDownloadCancelled(Exception):
    pass


def voice_models_dir() -> Path:
    d = config_root() / "voice_models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_repo_dir_name(repo_id: str) -> str:
    return repo_id.replace("/", "__").replace(":", "_")


def _http_json(url: str, timeout: int = 20) -> Any:
    from urllib.error import HTTPError, URLError

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "anima-backend/0.1",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
        return json.loads(raw.decode("utf-8"))
    except HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        raise RuntimeError(f"HTTP {getattr(e, 'code', '')} {getattr(e, 'reason', '')}: {body[:400]}".strip()) from e
    except URLError as e:
        raise RuntimeError(f"URL error: {e}") from e


def _hf_endpoints() -> List[str]:
    env_endpoint = str(os.environ.get("HF_ENDPOINT") or "").strip()
    candidates = [env_endpoint] if env_endpoint else []
    candidates += ["https://huggingface.co", "https://hf-mirror.com"]
    uniq: List[str] = []
    seen = set()
    for x in candidates:
        u = str(x or "").strip().rstrip("/")
        if not u or u in seen:
            continue
        seen.add(u)
        uniq.append(u)
    return uniq


def _get_hf_model_info_with_base(repo_id: str, timeout: int = 20) -> Tuple[Dict[str, Any], str]:
    key = str(repo_id or "").strip()
    if not key:
        return {}, ""
    now = int(time.time())
    with hf_model_info_lock:
        cached = hf_model_info_cache.get(key)
        if cached and (now - int(cached.get("_ts", 0))) < 3600:
            return dict(cached.get("data") or {}), str(cached.get("base") or "")

    last_err = ""
    for base in _hf_endpoints():
        try:
            url = f"{base}/api/models/{urllib.parse.quote(key, safe='/')}"
            data = _http_json(url, timeout=timeout)
            data_dict = data if isinstance(data, dict) else {}
            with hf_model_info_lock:
                hf_model_info_cache[key] = {"_ts": now, "data": data_dict, "base": base}
            return data_dict, base
        except Exception as e:
            last_err = str(e)
            continue
    return {"_error": last_err} if last_err else {}, ""


def _get_hf_model_info_cached(repo_id: str) -> Dict[str, Any]:
    key = str(repo_id or "").strip()
    if not key:
        return {}
    now = int(time.time())
    with hf_model_info_lock:
        cached = hf_model_info_cache.get(key)
        if cached and (now - int(cached.get("_ts", 0))) < 3600:
            return dict(cached.get("data") or {})
    return {}


def _warm_hf_model_info(repo_id: str) -> None:
    key = str(repo_id or "").strip()
    if not key:
        return
    with hf_model_info_lock:
        if key in hf_model_info_inflight:
            return
        now = int(time.time())
        cached = hf_model_info_cache.get(key)
        if cached and (now - int(cached.get("_ts", 0))) < 3600:
            return
        hf_model_info_inflight.add(key)

    def _run() -> None:
        try:
            _get_hf_model_info_with_base(key, timeout=8)
        finally:
            with hf_model_info_lock:
                hf_model_info_inflight.discard(key)

    threading.Thread(target=_run, daemon=True).start()


def _get_hf_model_info(repo_id: str) -> Dict[str, Any]:
    info, _base = _get_hf_model_info_with_base(repo_id)
    return info


def _sum_model_size_bytes(info: Dict[str, Any]) -> Optional[int]:
    sibs = info.get("siblings")
    if not isinstance(sibs, list):
        return None
    total = 0
    found = False
    for s in sibs:
        if not isinstance(s, dict):
            continue
        size = s.get("size")
        if isinstance(size, int):
            total += size
            found = True
    return total if found else None


def voice_model_catalog() -> List[Dict[str, Any]]:
    base = [
        {"id": "openai/whisper-large-v3-turbo", "name": "Whisper Large V3 Turbo"},
        {"id": "openai/whisper-medium", "name": "Whisper Medium"},
        {"id": "openai/whisper-small", "name": "Whisper Small"},
        {"id": "openai/whisper-base", "name": "Whisper Base"},
        {"id": "openai/whisper-tiny", "name": "Whisper Tiny"},
    ]
    res: List[Dict[str, Any]] = []
    for m in base:
        repo_id = str(m.get("id") or "").strip()
        info = _get_hf_model_info_cached(repo_id)
        if not isinstance(info.get("siblings"), list):
            _warm_hf_model_info(repo_id)
        size_bytes = _sum_model_size_bytes(info)
        res.append({**m, "sizeBytes": size_bytes})
    return res


def _normalize_whisper_model_id(raw: Any) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.startswith("local:"):
        return s
    if "/" in s:
        return s
    legacy_map = {
        "large-v3-turbo": "openai/whisper-large-v3-turbo",
        "large_v3_turbo": "openai/whisper-large-v3-turbo",
        "base": "openai/whisper-base",
        "small": "openai/whisper-small",
        "medium": "openai/whisper-medium",
        "tiny": "openai/whisper-tiny",
    }
    return legacy_map.get(s, s)


def _is_remote_model_installed(model_id: str) -> bool:
    if not model_id or model_id.startswith("local:") or "/" not in model_id:
        return False
    try:
        from transformers.utils.hub import cached_file

        cached_file(model_id, "config.json", local_files_only=True)

        weight_candidates = [
            "model.safetensors",
            "pytorch_model.bin",
            "model.safetensors.index.json",
            "pytorch_model.bin.index.json",
            "flax_model.msgpack",
            "tf_model.h5",
        ]
        for fname in weight_candidates:
            try:
                cached_file(model_id, fname, local_files_only=True)
                return True
            except Exception:
                continue
        return False
    except Exception:
        return False


def _get_remote_model_cache_dir(model_id: str) -> str:
    if not model_id or model_id.startswith("local:") or "/" not in model_id:
        return ""
    try:
        from transformers.utils.hub import cached_file

        cfg_path = cached_file(model_id, "config.json", local_files_only=True)
        cfg_path_str = str(cfg_path or "").strip()
        if not cfg_path_str:
            return ""

        weight_candidates = [
            "model.safetensors",
            "pytorch_model.bin",
            "model.safetensors.index.json",
            "pytorch_model.bin.index.json",
            "flax_model.msgpack",
            "tf_model.h5",
        ]
        for fname in weight_candidates:
            try:
                cached_file(model_id, fname, local_files_only=True)
                return str(Path(cfg_path_str).parent)
            except Exception:
                continue
        return ""
    except Exception:
        return ""


def _is_local_model_dir_installed(model_dir: Path) -> bool:
    try:
        if not model_dir.exists() or not model_dir.is_dir():
            return False
        cfg = model_dir / "config.json"
        if not cfg.exists():
            return False
        weight_candidates = [
            model_dir / "model.safetensors",
            model_dir / "pytorch_model.bin",
            model_dir / "model.safetensors.index.json",
            model_dir / "pytorch_model.bin.index.json",
            model_dir / "flax_model.msgpack",
            model_dir / "tf_model.h5",
        ]
        for p in weight_candidates:
            if p.exists():
                return True
        return False
    except Exception:
        return False


def _get_installed_voice_models() -> List[Dict[str, Any]]:
    raw = load_settings()
    settings_obj = raw.get("settings") if isinstance(raw, dict) else None
    voice_obj = settings_obj.get("voice") if isinstance(settings_obj, dict) else None
    local_models = []
    remote_models = []
    if isinstance(voice_obj, dict):
        local_models = voice_obj.get("localModels")
        remote_models = voice_obj.get("remoteModels")
    local_models = local_models if isinstance(local_models, list) else []
    remote_models = remote_models if isinstance(remote_models, list) else []

    installed: List[Dict[str, Any]] = []
    for item in remote_models:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        name = str(item.get("name") or mid).strip() or mid
        path = str(item.get("path") or "").strip()
        if not mid or not path:
            continue
        model_dir = Path(path)
        if _is_local_model_dir_installed(model_dir):
            installed.append({"id": mid, "name": name, "source": "remote", "path": str(model_dir)})

    for m in voice_model_catalog():
        mid = str(m.get("id") or "").strip()
        if any(x.get("id") == mid for x in installed):
            continue
        cache_dir = _get_remote_model_cache_dir(mid)
        if cache_dir:
            installed.append({"id": mid, "name": m.get("name") or mid, "source": "remote", "path": cache_dir})

    for item in local_models:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip()
        if not path or not os.path.exists(path):
            continue
        mid = str(item.get("id") or f"local:{path}").strip()
        name = str(item.get("name") or os.path.basename(path) or mid).strip()
        installed.append({"id": mid, "name": name, "source": "local", "path": path})

    uniq: Dict[str, Dict[str, Any]] = {}
    for m in installed:
        mid = str(m.get("id") or "").strip()
        if not mid:
            continue
        prev = uniq.get(mid)
        if prev is None:
            uniq[mid] = m
            continue
        prev_path = str(prev.get("path") or "").strip()
        next_path = str(m.get("path") or "").strip()
        if prev_path and not next_path:
            continue
        if (not prev_path) and next_path:
            uniq[mid] = m
            continue
    return list(uniq.values())


def _download_remote_model(model_id: str, task_id: str) -> str:
    repo_id = str(model_id or "").strip()
    info, base = _get_hf_model_info_with_base(repo_id)
    sibs = info.get("siblings") if isinstance(info, dict) else None
    if not isinstance(sibs, list) or not sibs:
        hint = str(info.get("_error") or "").strip() if isinstance(info, dict) else ""
        msg = "Failed to fetch model file list"
        if hint:
            msg = f"{msg}: {hint}"
        raise RuntimeError(msg)

    model_dir = voice_models_dir() / _safe_repo_dir_name(repo_id)
    model_dir.mkdir(parents=True, exist_ok=True)

    files: List[Tuple[str, int]] = []
    total_bytes = 0
    for s in sibs:
        if not isinstance(s, dict):
            continue
        fname = str(s.get("rfilename") or "").strip()
        if not fname:
            continue
        if fname in [".gitattributes"]:
            continue
        size = s.get("size")
        size_int = int(size) if isinstance(size, int) else 0
        files.append((fname, size_int))
        total_bytes += size_int

    with voice_download_lock:
        t = voice_download_tasks.get(task_id)
        if t is not None:
            t["destDir"] = str(model_dir)
            t["totalBytes"] = total_bytes
            t["downloadedBytes"] = 0
            t["totalFiles"] = len(files)
            t["downloadedFiles"] = 0
            t["currentFile"] = ""
            t["cancelRequested"] = False

    def _cancelled() -> bool:
        with voice_download_lock:
            return bool(voice_download_tasks.get(task_id, {}).get("cancelRequested"))

    downloaded_bytes = 0
    downloaded_files = 0

    for fname, expected_size in files:
        if _cancelled():
            raise VoiceDownloadCancelled()

        dest = model_dir / fname
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and expected_size > 0:
            try:
                if dest.stat().st_size == expected_size:
                    downloaded_files += 1
                    downloaded_bytes += expected_size
                    with voice_download_lock:
                        t = voice_download_tasks.get(task_id)
                        if t is not None:
                            t["downloadedFiles"] = downloaded_files
                            t["downloadedBytes"] = downloaded_bytes
                    continue
            except Exception:
                pass

        with voice_download_lock:
            t = voice_download_tasks.get(task_id)
            if t is not None:
                t["currentFile"] = fname

        dl_base = str(base or "").strip().rstrip("/") or "https://huggingface.co"
        url = f"{dl_base}/{repo_id}/resolve/main/{urllib.parse.quote(fname)}"
        tmp_path = dest.with_suffix(dest.suffix + ".part")
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass

        req = urllib.request.Request(url, headers={"User-Agent": "anima-backend/0.1"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            with open(tmp_path, "wb") as f:
                while True:
                    if _cancelled():
                        raise VoiceDownloadCancelled()
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded_bytes += len(chunk)
                    with voice_download_lock:
                        t = voice_download_tasks.get(task_id)
                        if t is not None:
                            t["downloadedBytes"] = downloaded_bytes

        os.replace(str(tmp_path), str(dest))
        downloaded_files += 1
        with voice_download_lock:
            t = voice_download_tasks.get(task_id)
            if t is not None:
                t["downloadedFiles"] = downloaded_files

    return str(model_dir)

    AutoProcessor.from_pretrained(model_id)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(model_id)
    del model


def _start_download_task(model_id: str) -> str:
    task_id = uuid.uuid4().hex
    now = int(time.time() * 1000)
    with voice_download_lock:
        voice_download_tasks[task_id] = {
            "taskId": task_id,
            "modelId": model_id,
            "status": "running",
            "startedAt": now,
            "endedAt": None,
            "error": "",
        }

    def _run() -> None:
        try:
            model_dir = _download_remote_model(model_id, task_id)
            raw = load_settings()
            settings_obj = raw.get("settings") if isinstance(raw, dict) else {}
            voice_obj = settings_obj.get("voice") if isinstance(settings_obj, dict) else {}
            remote_models = voice_obj.get("remoteModels") if isinstance(voice_obj, dict) else None
            remote_models = remote_models if isinstance(remote_models, list) else []
            catalog = {str(x.get("id")): x for x in voice_model_catalog() if isinstance(x, dict)}
            name = str((catalog.get(model_id) or {}).get("name") or model_id)
            next_remote = [x for x in remote_models if
                           isinstance(x, dict) and str(x.get("id") or "").strip() != model_id]
            next_remote.append({"id": model_id, "name": name, "path": model_dir, "updatedAt": int(time.time() * 1000)})
            save_settings({"settings": {"voice": {"remoteModels": next_remote}}})

            with voice_download_lock:
                voice_download_tasks[task_id]["status"] = "done"
                voice_download_tasks[task_id]["endedAt"] = int(time.time() * 1000)
        except VoiceDownloadCancelled:
            with voice_download_lock:
                voice_download_tasks[task_id]["status"] = "canceled"
                voice_download_tasks[task_id]["endedAt"] = int(time.time() * 1000)
        except Exception as e:
            with voice_download_lock:
                voice_download_tasks[task_id]["status"] = "error"
                voice_download_tasks[task_id]["endedAt"] = int(time.time() * 1000)
                voice_download_tasks[task_id]["error"] = str(e)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return task_id


def get_voice_pipeline(model_id: str):
    key = str(model_id or "").strip()
    if not key:
        raise ValueError("voice model is not configured")

    is_builder = False
    with voice_pipeline_lock:
        cached = voice_pipeline_cache.get(key)
        if cached is not None:
            return cached
        event = voice_pipeline_events.get(key)
        if event is None:
            event = threading.Event()
            voice_pipeline_events[key] = event
            is_builder = True

    if not is_builder:
        event.wait(timeout=300)
        with voice_pipeline_lock:
            cached = voice_pipeline_cache.get(key)
            if cached is not None:
                return cached
        raise RuntimeError("Failed to initialize voice pipeline")

    try:
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
        import torch

        device = torch.device("mps") if torch.backends.mps.is_available() else torch.device("cpu")
        torch_dtype = torch.float16 if device.type == "mps" else torch.float32

        print(f"Loading Whisper model {key} on {device.type}...")
        processor = AutoProcessor.from_pretrained(key)
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            key,
            torch_dtype=torch_dtype,
            low_cpu_mem_usage=False,
        )
        model.to(device)
        pipe = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=getattr(processor, "tokenizer", None),
            feature_extractor=getattr(processor, "feature_extractor", None),
            device=device,
        )

        with voice_pipeline_lock:
            voice_pipeline_cache[key] = pipe
        return pipe
    finally:
        with voice_pipeline_lock:
            ev = voice_pipeline_events.pop(key, None)
        if ev is not None:
            ev.set()


def _convert_audio_to_wav_if_needed(src_path: str) -> Tuple[str, bool]:
    p = str(src_path or "").strip()
    if not p:
        raise ValueError("empty audio path")
    ext = Path(p).suffix.lower()
    if ext in [".wav", ".flac", ".mp3", ".ogg", ".m4a"]:
        return p, False

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to decode this audio format")

    dst = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", p, "-ac", "1", "-ar", "16000", "-f", "wav", dst]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        err_full = (proc.stderr or b"").decode("utf-8", errors="ignore")
        err = err_full[-1600:] if len(err_full) > 1600 else err_full
        raise RuntimeError(f"ffmpeg failed to decode audio: {err}".strip())
    return dst, True


def _extract_audio_from_http_request(headers: Any, body: bytes) -> Tuple[bytes, str]:
    content_type = str(getattr(headers, "get", lambda _k, _d=None: _d)("Content-Type", "") or "").strip()
    ct_lower = content_type.lower()

    ext_by_ct = {
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/wave": ".wav",
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/flac": ".flac",
    }

    if ct_lower.startswith("multipart/form-data"):
        boundary = ""
        for part in content_type.split(";"):
            s = part.strip()
            if s.lower().startswith("boundary="):
                boundary = s.split("=", 1)[1].strip().strip('"')
                break
        if not boundary:
            raise RuntimeError("multipart/form-data missing boundary")
        marker = ("--" + boundary).encode("utf-8")
        chunks = body.split(marker)
        for ch in chunks:
            if not ch:
                continue
            if ch.startswith(b"--"):
                continue
            if ch.startswith(b"\r\n"):
                ch = ch[2:]
            header_end = ch.find(b"\r\n\r\n")
            if header_end <= 0:
                continue
            raw_headers = ch[:header_end].decode("utf-8", errors="ignore")
            payload = ch[header_end + 4 :]
            if payload.endswith(b"\r\n"):
                payload = payload[:-2]
            rh_lower = raw_headers.lower()
            is_file_part = ("filename=" in rh_lower) or ("\ncontent-type:" in rh_lower) or ("\r\ncontent-type:" in rh_lower)
            is_audio_part = "content-type: audio/" in rh_lower
            if not (is_file_part or is_audio_part):
                continue
            ext = ".webm"
            for line in raw_headers.splitlines():
                if ":" not in line:
                    continue
                k, v = line.split(":", 1)
                if k.strip().lower() == "content-type":
                    ct = v.strip().split(";", 1)[0].strip().lower()
                    ext = ext_by_ct.get(ct, ext)
                    break
            if payload:
                return payload, ext
        raise RuntimeError("multipart/form-data contains no audio part")

    base_ct = ct_lower.split(";", 1)[0].strip()
    ext = ext_by_ct.get(base_ct, ".webm")
    return body, ext


class Handler(BaseHTTPRequestHandler):
    server_version = "anima-backend/0.1"
    protocol_version = "HTTP/1.1"

    def handle_one_request(self) -> None:
        try:
            return super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            return
        finally:
            close_db_connection()

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def _route(self) -> Tuple[str, str, Dict[str, str]]:
        parsed = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        return self.command.upper(), parsed.path, q

    def do_DELETE(self) -> None:
        method, path, q = self._route()
        if path.startswith("/api/chats/"):
            parts = path.split("/")
            if len(parts) == 4 and parts[1] == "api" and parts[2] == "chats":
                chat_id = parts[3]
                try:
                    delete_chat(chat_id)
                    json_response(self, HTTPStatus.OK, {"ok": True})
                except Exception as e:
                    json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
                return
        json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def do_GET(self) -> None:
        method, path, q = self._route()
        if path == "/health":
            json_response(self, HTTPStatus.OK, {"ok": True, "version": "0.1.0"})
            return
        if path == "/voice/models/base_dir":
            json_response(self, HTTPStatus.OK, {"ok": True, "dir": str(voice_models_dir())})
            return
        if path == "/voice/models/catalog":
            json_response(self, HTTPStatus.OK, {"ok": True, "models": voice_model_catalog()})
            return
        if path == "/voice/models/installed":
            try:
                json_response(self, HTTPStatus.OK, {"ok": True, "models": _get_installed_voice_models()})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return
        if path == "/voice/models/download/status":
            task_id = str(q.get("taskId") or "").strip()
            if not task_id:
                json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
                return
            with voice_download_lock:
                task = voice_download_tasks.get(task_id)
            if not task:
                json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
                return
            json_response(self, HTTPStatus.OK, {"ok": True, "task": task})
            return
        if path == "/api/chats":
            try:
                json_response(self, HTTPStatus.OK, get_chats())
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return
        if path.startswith("/api/chats/"):
            parts = path.split("/")
            if len(parts) == 4 and parts[1] == "api" and parts[2] == "chats":
                chat_id = parts[3]
                try:
                    chat = get_chat(chat_id)
                    if chat:
                        json_response(self, HTTPStatus.OK, chat)
                    else:
                        json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Chat not found"})
                except Exception as e:
                    json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
                return
        if path == "/api/db/status":
            try:
                json_response(self, HTTPStatus.OK, {"empty": is_db_empty()})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return
        if path == "/api/db/path":
            try:
                json_response(self, HTTPStatus.OK, {"path": str(db_path())})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return
        if path == "/api/db/export":
            try:
                json_response(self, HTTPStatus.OK, export_snapshot())
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/settings":
            try:
                json_response(self, HTTPStatus.OK, load_settings())
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return
        if path == "/skills/list":
            try:
                dir_path, skills = list_skills()
                json_response(self, HTTPStatus.OK, {"ok": True, "dir": dir_path, "skills": skills})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return
        if path == "/tools/list":
            try:
                settings_obj = load_settings()
                composer: Dict[str, Any] = {}
                tools = builtin_tools()
                mcp, _ = mcp_tools(settings_obj, composer)
                json_response(self, HTTPStatus.OK, {"ok": True, "tools": tools, "mcpTools": mcp})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return
        json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def do_PATCH(self) -> None:
        method, path, q = self._route()
        if path.startswith("/api/chats/"):
            parts = path.split("/")
            # PATCH /api/chats/{id}
            if len(parts) == 4 and parts[1] == "api" and parts[2] == "chats":
                chat_id = parts[3]
                try:
                    body = read_body_json(self)
                    if isinstance(body, dict):
                        update_chat(chat_id, body)
                        json_response(self, HTTPStatus.OK, {"ok": True})
                    else:
                        json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid body"})
                except Exception as e:
                    json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
                return

            # PATCH /api/chats/{chat_id}/messages/{msg_id}
            if len(parts) == 6 and parts[1] == "api" and parts[2] == "chats" and parts[4] == "messages":
                chat_id = parts[3]
                msg_id = parts[5]
                try:
                    body = read_body_json(self)
                    if isinstance(body, dict):
                        update_message(chat_id, msg_id, body)
                        json_response(self, HTTPStatus.OK, {"ok": True})
                    else:
                        json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid body"})
                except Exception as e:
                    json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
                return

        if path != "/settings":
            json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
            return
        try:
            body = read_body_json(self)
            if not isinstance(body, dict):
                json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                return
            merged = save_settings(body)
            json_response(self, HTTPStatus.OK, merged)
        except Exception as e:
            json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})

    def do_POST(self) -> None:
        method, path, q = self._route()
        if path == "/api/chats":
            try:
                body = read_body_json(self)
                title = "New Chat"
                if isinstance(body, dict):
                    title = body.get("title", "New Chat")
                json_response(self, HTTPStatus.OK, create_chat(title))
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/voice/models/download":
            try:
                body = read_body_json(self)
                if not isinstance(body, dict):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                    return
                model_id = _normalize_whisper_model_id(body.get("id") or body.get("modelId"))
                if not model_id or model_id.startswith("local:"):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid model id"})
                    return
                if model_id not in [m["id"] for m in voice_model_catalog()]:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Unknown model id"})
                    return
                task_id = _start_download_task(model_id)
                json_response(self, HTTPStatus.OK, {"ok": True, "taskId": task_id})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/voice/models/download/cancel":
            try:
                body = read_body_json(self)
                if not isinstance(body, dict):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                    return
                task_id = str(body.get("taskId") or "").strip()
                if not task_id:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "taskId is required"})
                    return
                with voice_download_lock:
                    task = voice_download_tasks.get(task_id)
                    if task is None:
                        json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "task not found"})
                        return
                    task["cancelRequested"] = True
                json_response(self, HTTPStatus.OK, {"ok": True})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/voice/transcribe":
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length == 0:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "No content"})
                    return
                raw_body = self.rfile.read(content_length)
                audio_bytes, audio_ext = _extract_audio_from_http_request(self.headers, raw_body)

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
                        json_response(self, HTTPStatus.BAD_REQUEST,
                                      {"ok": False, "error": "Voice model is not configured"})
                        return

                    if model_id.startswith("local:"):
                        local_path = model_id[len("local:"):].strip()
                        if not local_path or not os.path.exists(local_path):
                            json_response(self, HTTPStatus.BAD_REQUEST,
                                          {"ok": False, "error": "Local voice model path not found"})
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
                                json_response(self, HTTPStatus.BAD_REQUEST,
                                              {"ok": False, "error": "Voice model is not installed"})
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
                    json_response(self, HTTPStatus.OK, {"ok": True, "text": text})
                finally:
                    if wav_path and wav_delete and os.path.exists(wav_path):
                        try:
                            os.unlink(wav_path)
                        except Exception:
                            pass
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
            except Exception as e:
                print(f"Transcription error: {e}")
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/api/chats/sync":
            try:
                body = read_body_json(self)
                if isinstance(body, list):
                    import_chats(body)
                    json_response(self, HTTPStatus.OK, {"ok": True})
                else:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected list of chats"})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/api/db/import":
            try:
                body = read_body_json(self)
                if not isinstance(body, dict):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                    return
                import_snapshot(body)
                json_response(self, HTTPStatus.OK, {"ok": True})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/api/db/clear":
            try:
                clear_all_data()
                json_response(self, HTTPStatus.OK, {"ok": True})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path.startswith("/api/chats/") and path.endswith("/messages"):
            parts = path.split("/")
            if len(parts) == 5 and parts[1] == "api" and parts[2] == "chats" and parts[4] == "messages":
                chat_id = parts[3]
                try:
                    body = read_body_json(self)
                    if isinstance(body, dict):
                        msg = add_message(chat_id, body)
                        json_response(self, HTTPStatus.OK, msg)
                    else:
                        json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid body"})
                except Exception as e:
                    json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
                return

        if path == "/skills/content":
            try:
                body = read_body_json(self)
                ids: Optional[List[str]] = None
                if isinstance(body, dict):
                    raw_ids = body.get("ids")
                    if isinstance(raw_ids, list):
                        ids = [str(x) for x in raw_ids if str(x).strip()]
                skills = get_skills_content(ids)
                json_response(self, HTTPStatus.OK, {"ok": True, "skills": skills})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/skills/openDir":
            try:
                open_folder(skills_dir())
                json_response(self, HTTPStatus.OK, {"ok": True})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/chat/prepare":
            try:
                body = read_body_json(self)
                if not isinstance(body, dict):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                    return
                messages = body.get("messages")
                if not isinstance(messages, list):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "messages must be a list"})
                    return
                composer = body.get("composer")
                if not isinstance(composer, dict):
                    composer = {}
                prepared = apply_attachments_inline(messages, composer)
                json_response(self, HTTPStatus.OK, {"ok": True, "messages": prepared})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/api/providers/fetch_models":
            try:
                body = read_body_json(self)
                if not isinstance(body, dict):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                    return
                base_url = body.get("baseUrl")
                api_key = body.get("apiKey")
                if not base_url:
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "baseUrl is required"})
                    return
                models = fetch_provider_models(base_url, api_key or "")
                json_response(self, HTTPStatus.OK, {"ok": True, "models": models})
            except Exception as e:
                json_response(self, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
            return

        if path == "/chat":
            stream = q.get("stream") == "1"
            try:
                body = read_body_json(self)
                if not isinstance(body, dict):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
                    return
                messages = body.get("messages")
                if not isinstance(messages, list):
                    json_response(self, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "messages must be a list"})
                    return
                composer = body.get("composer")
                if not isinstance(composer, dict):
                    composer = {}

                turn_id = str(body.get("turnId") or "").strip()

                settings_obj = load_settings()
                db_path_str = str(db_path())
                app_settings_updated_at = None
                try:
                    _, app_settings_updated_at = get_app_settings_info()
                except Exception:
                    app_settings_updated_at = None
                provider_override_id = str(composer.get("providerOverrideId") or "").strip()
                spec = get_provider_spec(settings_obj, provider_override_id or None)
                if not spec:
                    if provider_override_id:
                        # Debug info for "Provider not configured"
                        providers_list = settings_obj.get("providers", [])
                        found_provider = next((p for p in providers_list if str(p.get("id")) == provider_override_id),
                                              None)

                        # Safe dump of provider info (masking API keys)
                        provider_dump = None
                        if found_provider:
                            provider_dump = found_provider.copy()
                            if "config" in provider_dump and isinstance(provider_dump["config"], dict):
                                cfg = provider_dump["config"].copy()
                                if "apiKey" in cfg:
                                    k = str(cfg["apiKey"])
                                    if len(k) > 8:
                                        cfg["apiKey"] = k[:4] + "..." + k[-4:]
                                    else:
                                        cfg["apiKey"] = "***"
                                provider_dump["config"] = cfg

                        debug_info = {
                            "providerOverrideId": provider_override_id,
                            "foundInSettings": bool(found_provider),
                            "providerDump": provider_dump,
                            "allProviderIds": [str(p.get("id")) for p in providers_list],
                            "dbPath": db_path_str,
                            "appSettingsUpdatedAt": app_settings_updated_at,
                        }

                        json_response(
                            self,
                            HTTPStatus.BAD_REQUEST,
                            {
                                "ok": False,
                                "error": f"Provider not configured: {provider_override_id}",
                                "debug": debug_info,
                                "settings": settings_obj,
                                "dbPath": db_path_str,
                                "appSettingsUpdatedAt": app_settings_updated_at,
                            },
                        )
                    else:
                        json_response(
                            self,
                            HTTPStatus.BAD_REQUEST,
                            {
                                "ok": False,
                                "error": "No active provider configured",
                                "settings": settings_obj,
                                "dbPath": db_path_str,
                                "appSettingsUpdatedAt": app_settings_updated_at,
                            },
                        )
                    return
                provider = create_chat_provider(spec)

                temperature = float(
                    body.get("temperature") or (settings_obj.get("settings") or {}).get("temperature") or 0.7)
                max_tokens = int(body.get("maxTokens") or (settings_obj.get("settings") or {}).get("maxTokens") or 0)

                composer_max_tokens = int(composer.get("maxOutputTokens") or 0)
                if composer_max_tokens > 0:
                    max_tokens = composer_max_tokens

                extra_body = composer.get("jsonConfig")
                if isinstance(extra_body, str):
                    try:
                        extra_body = json.loads(extra_body)
                    except Exception:
                        extra_body = {}
                if not isinstance(extra_body, dict):
                    extra_body = None

                prepared = apply_attachments_inline(messages, composer)
                if not stream:
                    content, usage, traces, reasoning = chat_with_tools(
                        provider,
                        settings_obj=settings_obj,
                        messages=prepared,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        composer=composer,
                        extra_body=extra_body,
                    )
                    rate_limit = getattr(provider, "last_rate_limit", None)
                    payload = {"ok": True, "content": content, "usage": usage, "traces": traces, "reasoning": reasoning}
                    if isinstance(rate_limit, dict) and rate_limit:
                        payload["rateLimit"] = rate_limit
                    json_response(self, HTTPStatus.OK, payload)
                    return

                self.send_response(HTTPStatus.OK)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("X-Accel-Buffering", "no")
                self.send_header("Connection", "keep-alive")
                self.end_headers()

                def emit(obj: Any) -> None:
                    try:
                        if isinstance(obj, dict) and turn_id:
                            obj["turnId"] = turn_id
                        data = json.dumps(obj, ensure_ascii=False)
                        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except Exception as e:
                        raise ClientDisconnected() from e

                try:
                    content, usage, traces, reasoning = chat_with_tools_stream(
                        provider,
                        settings_obj=settings_obj,
                        messages=prepared,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        composer=composer,
                        emit=emit,
                        extra_body=extra_body,
                    )
                except ClientDisconnected:
                    return
                except Exception as e:
                    try:
                        emit(
                            {
                                "type": "error",
                                "error": str(e),
                                "settings": settings_obj,
                                "dbPath": db_path_str,
                                "appSettingsUpdatedAt": app_settings_updated_at,
                            }
                        )
                    except Exception:
                        return
                    return

                rate_limit = getattr(provider, "last_rate_limit", None)
                done_payload = {"type": "done", "usage": usage, "reasoning": reasoning}
                if turn_id:
                    done_payload["turnId"] = turn_id
                if isinstance(rate_limit, dict) and rate_limit:
                    done_payload["rateLimit"] = rate_limit
                try:
                    done = json.dumps(done_payload, ensure_ascii=False)
                    self.wfile.write(f"data: {done}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except Exception:
                    return
            except Exception as e:
                try:
                    s_obj = settings_obj
                except UnboundLocalError:
                    try:
                        s_obj = load_settings()
                    except Exception:
                        s_obj = {}

                db_path_str = str(db_path())
                app_settings_updated_at = None
                try:
                    _, app_settings_updated_at = get_app_settings_info()
                except Exception:
                    app_settings_updated_at = None

                if stream:
                    try:
                        data = json.dumps(
                            {
                                "type": "error",
                                "error": str(e),
                                "settings": s_obj,
                                "dbPath": db_path_str,
                                "appSettingsUpdatedAt": app_settings_updated_at,
                            },
                            ensure_ascii=False,
                        )
                        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except Exception:
                        return
                    return
                json_response(
                    self,
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {
                        "ok": False,
                        "error": str(e),
                        "settings": s_obj,
                        "dbPath": db_path_str,
                        "appSettingsUpdatedAt": app_settings_updated_at,
                    },
                )
            return

        json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})
