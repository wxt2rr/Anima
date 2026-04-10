from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from .settings import config_root, load_settings, save_settings


qwen_tts_download_tasks: Dict[str, Dict[str, Any]] = {}
qwen_tts_download_lock = threading.Lock()

qwen_tts_service_lock = threading.Lock()
qwen_tts_service_proc: Optional[subprocess.Popen[Any]] = None
qwen_tts_service_meta: Dict[str, Any] = {}


def qwen_tts_models_dir() -> Path:
    d = config_root() / "qwen_tts_models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def qwen_tts_model_catalog() -> List[Dict[str, Any]]:
    return [
        {"id": "qwen3-tts-flash", "name": "Qwen3 TTS Flash", "sizeHint": "small"},
        {"id": "qwen3-tts-plus", "name": "Qwen3 TTS Plus", "sizeHint": "medium"},
        {"id": "qwen3-tts-max", "name": "Qwen3 TTS Max", "sizeHint": "large"},
    ]


def _normalize_installed(items: Any) -> List[Dict[str, Any]]:
    if not isinstance(items, list):
        return []
    out: List[Dict[str, Any]] = []
    seen = set()
    for it in items:
        if not isinstance(it, dict):
            continue
        mid = str(it.get("id") or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append({"id": mid, "name": str(it.get("name") or mid), "path": str(it.get("path") or "")})
    return out


def qwen_tts_installed_models() -> List[Dict[str, Any]]:
    raw = load_settings()
    settings_obj = raw.get("settings") if isinstance(raw, dict) else {}
    tts = settings_obj.get("tts") if isinstance(settings_obj, dict) else {}
    installed = _normalize_installed(tts.get("qwenLocalModelsInstalled") if isinstance(tts, dict) else [])
    return installed


def _upsert_installed_model(model_id: str) -> None:
    model_id = str(model_id or "").strip()
    if not model_id:
        return
    model_dir = str((qwen_tts_models_dir() / model_id).resolve())
    name = next((m.get("name") for m in qwen_tts_model_catalog() if str(m.get("id") or "") == model_id), model_id)
    current = qwen_tts_installed_models()
    next_items = [x for x in current if str(x.get("id") or "").strip() != model_id]
    next_items.append({"id": model_id, "name": str(name or model_id), "path": model_dir})
    save_settings({"tts": {"qwenLocalModelsInstalled": next_items}})


def _parse_endpoint(endpoint: str) -> Dict[str, str]:
    ep = str(endpoint or "").strip() or "http://127.0.0.1:8000/v1/audio/speech"
    p = urllib.parse.urlparse(ep)
    scheme = p.scheme or "http"
    host = p.hostname or "127.0.0.1"
    port = str(p.port or 8000)
    path = p.path or "/v1/audio/speech"
    base = f"{scheme}://{host}:{port}"
    return {"endpoint": f"{base}{path}", "baseUrl": base, "host": host, "port": port}


def _is_tcp_open(host: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _probe_service(base_url: str, endpoint: str, timeout: float = 1.0) -> bool:
    probes = [
        ("GET", f"{base_url}/health", None),
        ("GET", f"{base_url}/v1/models", None),
        ("POST", endpoint, {"model": "qwen3-tts-flash", "input": "hi", "voice": "Cherry", "response_format": "wav"}),
    ]
    for method, url, payload in probes:
        try:
            req = urllib.request.Request(url, method=method)
            raw = b""
            if payload is not None:
                req.add_header("Content-Type", "application/json")
                raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            with urllib.request.urlopen(req, data=raw if raw else None, timeout=timeout) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                if status < 500:
                    return True
        except Exception:
            continue
    return False


def _render_cmd_args(args: List[str], *, model_id: str, endpoint: str, base_url: str, host: str, port: str, model_dir: str) -> List[str]:
    out: List[str] = []
    for a in args:
        s = str(a or "")
        s = s.replace("{model_id}", model_id)
        s = s.replace("{endpoint}", endpoint)
        s = s.replace("{base_url}", base_url)
        s = s.replace("{host}", host)
        s = s.replace("{port}", port)
        s = s.replace("{model_dir}", model_dir)
        out.append(s)
    return out


def _resolve_qwen_tts_command(preferred: str) -> str:
    pref = str(preferred or "").strip()
    candidates: List[str] = []
    if pref:
        candidates.append(pref)
    for c in ("qwen-tts", "qwen3-tts", "qwen_tts"):
        if c not in candidates:
            candidates.append(c)
    for c in candidates:
        if shutil.which(c):
            return c
    names = ", ".join(candidates)
    raise RuntimeError(f"未找到可用的 Qwen-TTS 命令（尝试: {names}）。请先安装 qwen-tts，或在设置中配置 qwenLocalCommand。")


def ensure_qwen_tts_local_service(*, model_id: str, endpoint: str = "") -> Dict[str, Any]:
    raw = load_settings()
    settings_obj = raw.get("settings") if isinstance(raw, dict) else {}
    tts = settings_obj.get("tts") if isinstance(settings_obj, dict) else {}
    parsed = _parse_endpoint(str(endpoint or (tts.get("qwenLocalEndpoint") if isinstance(tts, dict) else "") or ""))
    host = parsed["host"]
    port = parsed["port"]
    base_url = parsed["baseUrl"]
    resolved_endpoint = parsed["endpoint"]
    model_dir = str((qwen_tts_models_dir() / str(model_id or "").strip()).resolve())

    if _probe_service(base_url, resolved_endpoint):
        return {"ok": True, "running": True, "endpoint": resolved_endpoint, "baseUrl": base_url}

    with qwen_tts_service_lock:
        global qwen_tts_service_proc
        running_proc = qwen_tts_service_proc if qwen_tts_service_proc and qwen_tts_service_proc.poll() is None else None
        if running_proc is not None:
            qwen_tts_service_proc = running_proc
        else:
            qwen_tts_service_proc = None

        if qwen_tts_service_proc is None:
            preferred = str((tts.get("qwenLocalCommand") if isinstance(tts, dict) else "") or "qwen-tts").strip()
            command = _resolve_qwen_tts_command(preferred)
            args_raw = tts.get("qwenLocalArgs") if isinstance(tts, dict) else []
            args = args_raw if isinstance(args_raw, list) else []
            if not args:
                args = ["serve", "--model", "{model_id}", "--host", "{host}", "--port", "{port}"]
            rendered_args = _render_cmd_args(
                [str(x) for x in args],
                model_id=str(model_id or "").strip() or "qwen3-tts-flash",
                endpoint=resolved_endpoint,
                base_url=base_url,
                host=host,
                port=port,
                model_dir=model_dir,
            )
            env = os.environ.copy()
            env["ANIMA_QWEN_TTS_MODEL_ID"] = str(model_id or "").strip()
            env["ANIMA_QWEN_TTS_MODEL_DIR"] = model_dir
            env["ANIMA_QWEN_TTS_ENDPOINT"] = resolved_endpoint
            env["ANIMA_QWEN_TTS_BASE_URL"] = base_url
            env["ANIMA_QWEN_TTS_HOST"] = host
            env["ANIMA_QWEN_TTS_PORT"] = port
            try:
                qwen_tts_service_proc = subprocess.Popen(
                    [command, *rendered_args],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env=env,
                )
            except FileNotFoundError as e:
                raise RuntimeError(f"无法启动本地 Qwen-TTS：命令不存在 `{command}`。请先安装 qwen-tts。") from e
            qwen_tts_service_meta.clear()
            qwen_tts_service_meta.update(
                {
                    "modelId": str(model_id or "").strip(),
                    "endpoint": resolved_endpoint,
                    "baseUrl": base_url,
                    "host": host,
                    "port": int(port),
                    "command": command,
                    "args": rendered_args,
                    "startedAt": int(time.time() * 1000),
                    "pid": int(qwen_tts_service_proc.pid or 0),
                }
            )

    start = time.time()
    while time.time() - start < 15:
        if _probe_service(base_url, resolved_endpoint):
            return {"ok": True, "running": True, "endpoint": resolved_endpoint, "baseUrl": base_url}
        if not _is_tcp_open(host, int(port), timeout=0.25):
            time.sleep(0.25)
            continue
        time.sleep(0.25)

    raise RuntimeError("qwen_tts local service did not become ready in time")


def get_qwen_tts_service_status() -> Dict[str, Any]:
    with qwen_tts_service_lock:
        proc = qwen_tts_service_proc
        running = bool(proc is not None and proc.poll() is None)
        meta = dict(qwen_tts_service_meta)
        if proc is not None:
            meta["pid"] = int(proc.pid or 0)
    return {"ok": True, "running": running, "service": meta}


def _start_qwen_tts_download_task(model_id: str) -> str:
    task_id = f"qwen_tts_dl_{uuid.uuid4().hex}"
    now = int(time.time() * 1000)
    with qwen_tts_download_lock:
        qwen_tts_download_tasks[task_id] = {
            "taskId": task_id,
            "modelId": model_id,
            "status": "running",
            "startedAt": now,
            "endedAt": None,
            "cancelRequested": False,
            "progress": 0,
            "error": None,
        }

    def _run() -> None:
        try:
            raw = load_settings()
            settings_obj = raw.get("settings") if isinstance(raw, dict) else {}
            tts = settings_obj.get("tts") if isinstance(settings_obj, dict) else {}
            preferred = str((tts.get("qwenLocalInstallCommand") if isinstance(tts, dict) else "") or "qwen-tts").strip()
            cmd = _resolve_qwen_tts_command(preferred)
            args_raw = tts.get("qwenLocalInstallArgs") if isinstance(tts, dict) else []
            args = args_raw if isinstance(args_raw, list) else []
            if not args:
                args = ["download", "{model_id}"]
            rendered = _render_cmd_args(
                [str(x) for x in args],
                model_id=model_id,
                endpoint="",
                base_url="",
                host="",
                port="",
                model_dir=str((qwen_tts_models_dir() / model_id).resolve()),
            )
            with qwen_tts_download_lock:
                t = qwen_tts_download_tasks.get(task_id)
                if t is not None:
                    t["progress"] = 5
            try:
                proc = subprocess.run([cmd, *rendered], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            except FileNotFoundError as e:
                raise RuntimeError(f"无法下载模型：命令不存在 `{cmd}`。请先安装 qwen-tts。") from e
            if proc.returncode != 0:
                err = str(proc.stderr or proc.stdout or "").strip()
                raise RuntimeError(err[:800] or f"install command failed: {proc.returncode}")
            with qwen_tts_download_lock:
                t = qwen_tts_download_tasks.get(task_id)
                if t is not None:
                    t["progress"] = 100
            _upsert_installed_model(model_id)
            with qwen_tts_download_lock:
                t = qwen_tts_download_tasks.get(task_id)
                if t is not None:
                    t["status"] = "done"
                    t["endedAt"] = int(time.time() * 1000)
        except Exception as e:
            with qwen_tts_download_lock:
                t = qwen_tts_download_tasks.get(task_id)
                if t is not None:
                    t["status"] = "error"
                    t["endedAt"] = int(time.time() * 1000)
                    t["error"] = str(e)

    threading.Thread(target=_run, daemon=True).start()
    return task_id


def start_qwen_tts_download(model_id: str) -> str:
    mid = str(model_id or "").strip()
    if not mid:
        raise RuntimeError("modelId is required")
    valid_ids = {str(m.get("id") or "") for m in qwen_tts_model_catalog()}
    if mid not in valid_ids:
        raise RuntimeError("Unknown model id")
    return _start_qwen_tts_download_task(mid)
