import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .settings import config_root, load_settings, save_settings


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
        {
            "id": "openai/whisper-large-v3-turbo",
            "name": "Whisper Large V3 Turbo",
            "desc": {
                "zh": "大模型加速版：速度很快，准确率接近 large-v3；更适合实时/快速转写。",
                "en": "Turbo variant: much faster with near large-v3 quality; great for fast transcription.",
            },
            "badges": {"zh": ["很快", "多语言", "高质量"], "en": ["Very fast", "Multilingual", "High quality"]},
            "capabilities": {"multilingual": True, "supportedLanguages": "100+", "uiLanguageOptions": ["auto", "en", "zh", "ja"]},
        },
        {
            "id": "openai/whisper-medium",
            "name": "Whisper Medium",
            "desc": {
                "zh": "准确率与速度平衡，日常使用推荐；资源占用中等。",
                "en": "Balanced accuracy and speed; good default for most users.",
            },
            "badges": {"zh": ["推荐", "多语言", "均衡"], "en": ["Recommended", "Multilingual", "Balanced"]},
            "capabilities": {"multilingual": True, "supportedLanguages": "100+", "uiLanguageOptions": ["auto", "en", "zh", "ja"]},
        },
        {
            "id": "openai/whisper-small",
            "name": "Whisper Small",
            "desc": {
                "zh": "速度更快、占用更低；准确率略低，适合轻量设备。",
                "en": "Faster and lighter; slightly lower accuracy.",
            },
            "badges": {"zh": ["更省", "多语言", "更快"], "en": ["Lighter", "Multilingual", "Faster"]},
            "capabilities": {"multilingual": True, "supportedLanguages": "100+", "uiLanguageOptions": ["auto", "en", "zh", "ja"]},
        },
        {
            "id": "openai/whisper-base",
            "name": "Whisper Base",
            "desc": {
                "zh": "更轻量，适合基础听写；长句与口音下准确率有限。",
                "en": "Lightweight for basic dictation; less robust on accents/long speech.",
            },
            "badges": {"zh": ["轻量", "多语言", "入门"], "en": ["Lightweight", "Multilingual", "Starter"]},
            "capabilities": {"multilingual": True, "supportedLanguages": "100+", "uiLanguageOptions": ["auto", "en", "zh", "ja"]},
        },
        {
            "id": "openai/whisper-tiny",
            "name": "Whisper Tiny",
            "desc": {
                "zh": "最快最小，适合试用/应急；准确率最低。",
                "en": "Smallest and fastest; lowest accuracy—good for quick trials.",
            },
            "badges": {"zh": ["最快", "多语言", "试用"], "en": ["Fastest", "Multilingual", "Trial"]},
            "capabilities": {"multilingual": True, "supportedLanguages": "100+", "uiLanguageOptions": ["auto", "en", "zh", "ja"]},
        },
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
            next_remote = [x for x in remote_models if isinstance(x, dict) and str(x.get("id") or "").strip() != model_id]
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


def get_voice_pipeline(model_id: str, device_hint: Optional[str] = None):
    key = str(model_id or "").strip()
    if not key:
        raise ValueError("voice model is not configured")

    device_key = str(device_hint or os.environ.get("ANIMA_VOICE_DEVICE") or "cpu").strip().lower()
    cache_key = key if not device_key else f"{key}::device={device_key}"

    is_builder = False
    with voice_pipeline_lock:
        cached = voice_pipeline_cache.get(cache_key)
        if cached is not None:
            return cached
        event = voice_pipeline_events.get(cache_key)
        if event is None:
            event = threading.Event()
            voice_pipeline_events[cache_key] = event
            is_builder = True

    if not is_builder:
        event.wait(timeout=300)
        with voice_pipeline_lock:
            cached = voice_pipeline_cache.get(cache_key)
            if cached is not None:
                return cached
        raise RuntimeError("Failed to initialize voice pipeline")

    try:
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
        import torch

        if device_key == "cpu":
            device = torch.device("cpu")
        else:
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
        try:
            gc = getattr(model, "generation_config", None)
            if gc is not None and getattr(gc, "forced_decoder_ids", None) is not None:
                gc.forced_decoder_ids = None
        except Exception:
            pass
        pipe = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=getattr(processor, "tokenizer", None),
            feature_extractor=getattr(processor, "feature_extractor", None),
            device=device,
        )

        with voice_pipeline_lock:
            voice_pipeline_cache[cache_key] = pipe
        return pipe
    finally:
        with voice_pipeline_lock:
            ev = voice_pipeline_events.pop(cache_key, None)
        if ev is not None:
            ev.set()


def _convert_audio_to_wav_if_needed(src_path: str) -> Tuple[str, bool]:
    p = str(src_path or "").strip()
    if not p:
        raise ValueError("empty audio path")
    ext = Path(p).suffix.lower()
    if ext in [".wav", ".flac", ".mp3", ".m4a"]:
        return p, False

    ffmpeg = None
    for k in ("ANIMA_FFMPEG", "FFMPEG_BINARY", "IMAGEIO_FFMPEG_EXE"):
        v = str(os.environ.get(k) or "").strip()
        if v and os.path.exists(v):
            ffmpeg = v
            break
    if not ffmpeg:
        ffmpeg = shutil.which("ffmpeg")
    if ext == ".ogg" and not ffmpeg:
        return p, False
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
