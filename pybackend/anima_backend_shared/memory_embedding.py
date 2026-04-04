from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .settings import config_root, load_settings, save_settings


embedding_download_tasks: Dict[str, Dict[str, Any]] = {}
embedding_download_lock = threading.Lock()

embedding_model_cache: Dict[str, Any] = {}
embedding_model_lock = threading.Lock()

hf_model_info_cache: Dict[str, Dict[str, Any]] = {}
hf_model_info_lock = threading.Lock()
hf_model_info_inflight: set[str] = set()


class EmbeddingDownloadCancelled(Exception):
    pass


def embedding_models_dir() -> Path:
    d = config_root() / "embedding_models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_repo_dir_name(repo_id: str) -> str:
    return repo_id.replace("/", "__").replace(":", "_")


def _http_json(url: str, timeout: int = 20) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "anima-backend/0.1", "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


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


def embedding_model_catalog() -> List[Dict[str, Any]]:
    base = [
        {
            "id": "sentence-transformers/all-MiniLM-L6-v2",
            "name": "all-MiniLM-L6-v2",
            "desc": {"zh": "轻量英文通用嵌入", "en": "Lightweight general-purpose English embedding"},
        },
        {
            "id": "BAAI/bge-small-en-v1.5",
            "name": "bge-small-en-v1.5",
            "desc": {"zh": "英文检索常用小模型", "en": "Popular small model for English retrieval"},
        },
        {
            "id": "intfloat/multilingual-e5-small",
            "name": "multilingual-e5-small",
            "desc": {"zh": "多语言小模型", "en": "Small multilingual embedding model"},
        },
    ]
    out: List[Dict[str, Any]] = []
    for m in base:
        repo_id = str(m.get("id") or "").strip()
        info = _get_hf_model_info_cached(repo_id)
        if not isinstance(info.get("siblings"), list):
            _warm_hf_model_info(repo_id)
        out.append({**m, "sizeBytes": _sum_model_size_bytes(info)})
    return out


def _is_local_embedding_model_installed(model_dir: Path) -> bool:
    try:
        if not model_dir.exists() or not model_dir.is_dir():
            return False
        if not (model_dir / "config.json").exists():
            return False
        for fn in [
            "model.safetensors",
            "pytorch_model.bin",
            "model.safetensors.index.json",
            "pytorch_model.bin.index.json",
        ]:
            if (model_dir / fn).exists():
                return True
        return False
    except Exception:
        return False


def _get_installed_embedding_models() -> List[Dict[str, Any]]:
    raw = load_settings()
    settings_obj = raw.get("settings") if isinstance(raw, dict) else {}
    if not isinstance(settings_obj, dict):
        settings_obj = {}
    local_models = settings_obj.get("memoryEmbeddingLocalModels")
    local_models = local_models if isinstance(local_models, list) else []
    installed: List[Dict[str, Any]] = []
    for m in local_models:
        if not isinstance(m, dict):
            continue
        mid = str(m.get("id") or "").strip()
        name = str(m.get("name") or mid).strip()
        path = str(m.get("path") or "").strip()
        if not mid or not path:
            continue
        p = Path(path)
        if _is_local_embedding_model_installed(p):
            installed.append({"id": mid, "name": name, "source": "local", "path": str(p)})
    return installed


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

    model_dir = embedding_models_dir() / _safe_repo_dir_name(repo_id)
    model_dir.mkdir(parents=True, exist_ok=True)

    files: List[Tuple[str, int]] = []
    total_bytes = 0
    for s in sibs:
        if not isinstance(s, dict):
            continue
        fname = str(s.get("rfilename") or "").strip()
        if not fname or fname in [".gitattributes"]:
            continue
        size_int = int(s.get("size")) if isinstance(s.get("size"), int) else 0
        files.append((fname, size_int))
        total_bytes += size_int

    with embedding_download_lock:
        t = embedding_download_tasks.get(task_id)
        if t is not None:
            t["destDir"] = str(model_dir)
            t["totalBytes"] = total_bytes
            t["downloadedBytes"] = 0
            t["totalFiles"] = len(files)
            t["downloadedFiles"] = 0
            t["currentFile"] = ""
            t["cancelRequested"] = False

    def _cancelled() -> bool:
        with embedding_download_lock:
            return bool(embedding_download_tasks.get(task_id, {}).get("cancelRequested"))

    downloaded_bytes = 0
    downloaded_files = 0
    dl_base = str(base or "").strip().rstrip("/") or "https://huggingface.co"

    for fname, expected_size in files:
        if _cancelled():
            raise EmbeddingDownloadCancelled()
        dest = model_dir / fname
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and expected_size > 0:
            try:
                if dest.stat().st_size == expected_size:
                    downloaded_files += 1
                    downloaded_bytes += expected_size
                    with embedding_download_lock:
                        t = embedding_download_tasks.get(task_id)
                        if t is not None:
                            t["downloadedFiles"] = downloaded_files
                            t["downloadedBytes"] = downloaded_bytes
                    continue
            except Exception:
                pass
        with embedding_download_lock:
            t = embedding_download_tasks.get(task_id)
            if t is not None:
                t["currentFile"] = fname
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
                        raise EmbeddingDownloadCancelled()
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded_bytes += len(chunk)
                    with embedding_download_lock:
                        t = embedding_download_tasks.get(task_id)
                        if t is not None:
                            t["downloadedBytes"] = downloaded_bytes
        os.replace(str(tmp_path), str(dest))
        downloaded_files += 1
        with embedding_download_lock:
            t = embedding_download_tasks.get(task_id)
            if t is not None:
                t["downloadedFiles"] = downloaded_files
    return str(model_dir)


def start_embedding_download_task(model_id: str) -> str:
    task_id = uuid.uuid4().hex
    now = int(time.time() * 1000)
    with embedding_download_lock:
        embedding_download_tasks[task_id] = {
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
            if not isinstance(settings_obj, dict):
                settings_obj = {}
            local_models = settings_obj.get("memoryEmbeddingLocalModels")
            local_models = local_models if isinstance(local_models, list) else []
            catalog = {str(x.get("id") or ""): x for x in embedding_model_catalog() if isinstance(x, dict)}
            name = str((catalog.get(model_id) or {}).get("name") or model_id).strip() or model_id
            local_id = f"local:{model_id}"
            next_local = [x for x in local_models if isinstance(x, dict) and str(x.get("id") or "").strip() != local_id]
            next_local.append({"id": local_id, "name": name, "path": model_dir, "updatedAt": int(time.time() * 1000)})
            save_settings({"settings": {"memoryEmbeddingLocalModels": next_local}})
            with embedding_download_lock:
                embedding_download_tasks[task_id]["status"] = "done"
                embedding_download_tasks[task_id]["endedAt"] = int(time.time() * 1000)
        except EmbeddingDownloadCancelled:
            with embedding_download_lock:
                embedding_download_tasks[task_id]["status"] = "canceled"
                embedding_download_tasks[task_id]["endedAt"] = int(time.time() * 1000)
        except Exception as e:
            with embedding_download_lock:
                embedding_download_tasks[task_id]["status"] = "error"
                embedding_download_tasks[task_id]["endedAt"] = int(time.time() * 1000)
                embedding_download_tasks[task_id]["error"] = str(e)

    threading.Thread(target=_run, daemon=True).start()
    return task_id


def _hash_embedding(text: str, dim: int = 256) -> List[float]:
    s = str(text or "").lower().strip()
    toks = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]", s)
    out = [0.0] * max(16, int(dim or 256))
    if not toks:
        return out
    for tok in toks:
        h = int(uuid.uuid5(uuid.NAMESPACE_DNS, tok).int & 0xFFFFFFFF)
        out[h % len(out)] += 1.0
    norm = sum(x * x for x in out) ** 0.5
    if norm <= 1e-12:
        return out
    return [x / norm for x in out]


def _embed_with_local_model(local_path: str, text: str) -> List[float]:
    p = str(local_path or "").strip()
    if not p:
        return []
    try:
        import torch
        from transformers import AutoModel, AutoTokenizer

        key = f"local:{p}"
        with embedding_model_lock:
            cached = embedding_model_cache.get(key)
            if isinstance(cached, tuple) and len(cached) == 2:
                tokenizer, model = cached
            else:
                tokenizer = AutoTokenizer.from_pretrained(p)
                model = AutoModel.from_pretrained(p)
                model.eval()
                embedding_model_cache[key] = (tokenizer, model)
        inputs = tokenizer([text], padding=True, truncation=True, return_tensors="pt", max_length=512)
        with torch.no_grad():
            out = model(**inputs)
            hidden = out.last_hidden_state
            mask = inputs["attention_mask"].unsqueeze(-1).float()
            summed = (hidden * mask).sum(dim=1)
            denom = mask.sum(dim=1).clamp(min=1e-6)
            emb = (summed / denom)[0]
            emb = torch.nn.functional.normalize(emb, p=2, dim=0)
            return [float(x) for x in emb.cpu().tolist()]
    except Exception:
        return []


def _embed_with_provider(settings_obj: Dict[str, Any], model_id: str, text: str) -> List[float]:
    providers = settings_obj.get("providers")
    if not isinstance(providers, list):
        return []
    for p in providers:
        if not isinstance(p, dict):
            continue
        if not bool(p.get("isEnabled")):
            continue
        cfg = p.get("config")
        if not isinstance(cfg, dict):
            continue
        models = cfg.get("models")
        model_ids: List[str] = []
        if isinstance(models, list):
            for m in models:
                if isinstance(m, str):
                    model_ids.append(m)
                elif isinstance(m, dict):
                    mid = str(m.get("id") or "").strip()
                    if mid:
                        model_ids.append(mid)
        if model_ids and model_id not in model_ids:
            continue
        base = str(cfg.get("baseUrl") or "").strip().rstrip("/")
        api_key = str(cfg.get("apiKey") or "").strip()
        if not base or not api_key:
            continue
        url = f"{base}/embeddings"
        payload = json.dumps({"model": model_id, "input": text}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                raw = resp.read()
            obj = json.loads(raw.decode("utf-8"))
            data = obj.get("data") if isinstance(obj, dict) else None
            item = data[0] if isinstance(data, list) and data else None
            emb = item.get("embedding") if isinstance(item, dict) else None
            if isinstance(emb, list) and emb:
                return [float(x) for x in emb if isinstance(x, (int, float))]
        except Exception:
            continue
    return []


def embed_text(text: str, settings_obj: Dict[str, Any], default_dim: int = 256) -> List[float]:
    s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
    if not isinstance(s, dict):
        s = {}
    model_id = str(s.get("memoryEmbeddingModelId") or "").strip()
    if model_id.startswith("local:"):
        local_models = s.get("memoryEmbeddingLocalModels")
        local_models = local_models if isinstance(local_models, list) else []
        path = ""
        for m in local_models:
            if not isinstance(m, dict):
                continue
            if str(m.get("id") or "").strip() == model_id:
                path = str(m.get("path") or "").strip()
                break
        if path:
            emb = _embed_with_local_model(path, text)
            if emb:
                return emb
    elif model_id:
        emb = _embed_with_provider(settings_obj, model_id, text)
        if emb:
            return emb
    return _hash_embedding(text, dim=default_dim)
