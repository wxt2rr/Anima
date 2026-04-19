import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def now_ms() -> int:
    return int(time.time() * 1000)


def truncate_text(s: str, max_chars: int) -> Tuple[str, bool]:
    if len(s) <= max_chars:
        return s, False
    return s[: max(0, max_chars)], True


def redact_value(v: Any) -> Any:
    if isinstance(v, dict):
        out: Dict[str, Any] = {}
        for k, vv in v.items():
            ks = str(k).lower()
            if any(x in ks for x in ["api_key", "apikey", "authorization", "token", "secret", "password"]):
                out[k] = "***"
            else:
                out[k] = redact_value(vv)
        return out
    if isinstance(v, list):
        return [redact_value(x) for x in v[:200]]
    if isinstance(v, str):
        if len(v) > 2000:
            return v[:2000]
        return v
    return v


def preview_json(v: Any, max_chars: int) -> Dict[str, Any]:
    redacted = redact_value(v)
    txt = json.dumps(redacted, ensure_ascii=False)
    preview, truncated = truncate_text(txt, max_chars=max_chars)
    return {"text": preview, "truncated": truncated}


def preview_tool_result(raw: str, max_chars: int) -> Dict[str, Any]:
    if not isinstance(raw, str):
        return {"text": "", "truncated": False}
    s = raw.strip()
    if not s:
        return {"text": "", "truncated": False}
    try:
        v = json.loads(s)
        redacted = redact_value(v)
        txt = json.dumps(redacted, ensure_ascii=False)
        if len(txt) <= max_chars:
            return {"text": txt, "truncated": False}

        def _dump(obj: Any) -> str:
            return json.dumps(obj, ensure_ascii=False)

        def _fit_results_list(parent: Dict[str, Any], key: str) -> Dict[str, Any]:
            lst = parent.get(key)
            if not isinstance(lst, list):
                return {"_preview": {"truncated": True}}
            total = len(lst)
            base = {k: v for k, v in parent.items() if k != key}

            def _clean_item(it: Any, snippet_limit: int) -> Any:
                if not isinstance(it, dict):
                    return it
                out: Dict[str, Any] = {}
                if isinstance(it.get("title"), str):
                    out["title"] = it.get("title")
                if isinstance(it.get("url"), str):
                    out["url"] = it.get("url")
                if isinstance(it.get("snippet"), str):
                    sn = it.get("snippet") or ""
                    out["snippet"] = sn[: max(0, snippet_limit)]
                for k in ["source", "published", "date"]:
                    if isinstance(it.get(k), (str, int, float, bool)):
                        out[k] = it.get(k)
                return out or it

            n = total
            snippet_limit = 220
            while True:
                items = [_clean_item(x, snippet_limit=snippet_limit) for x in lst[:n]]
                candidate = {**base, key: items, "_preview": {"total": total, "truncated": True}}
                if len(_dump(candidate)) <= max_chars:
                    return candidate
                if n > 1:
                    n = max(1, n // 2)
                    continue
                if snippet_limit > 60:
                    snippet_limit = max(60, snippet_limit // 2)
                    continue
                return candidate

        if isinstance(redacted, dict):
            if isinstance(redacted.get("results"), list):
                fitted = _fit_results_list(redacted, "results")
                return {"text": _dump(fitted), "truncated": True, "fullText": txt}
            if isinstance(redacted.get("items"), list):
                fitted = _fit_results_list(redacted, "items")
                return {"text": _dump(fitted), "truncated": True, "fullText": txt}
            candidate = {"_preview": {"truncated": True}}
            return {"text": _dump(candidate), "truncated": True, "fullText": txt}

        if isinstance(redacted, list):
            total = len(redacted)
            n = total
            while n > 1 and len(_dump({"items": redacted[:n], "_preview": {"total": total, "truncated": True}})) > max_chars:
                n = max(1, n // 2)
            candidate = {"items": redacted[:n], "_preview": {"total": total, "truncated": True}}
            return {"text": _dump(candidate), "truncated": True, "fullText": txt}

        candidate = {"value": redacted, "_preview": {"truncated": True}}
        return {"text": _dump(candidate), "truncated": True, "fullText": txt}
    except Exception:
        preview, truncated = truncate_text(s, max_chars=max_chars)
        return {"text": preview, "truncated": truncated}


def as_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        parts: List[str] = []
        for it in value:
            if isinstance(it, str):
                if it.strip():
                    parts.append(it)
                continue
            if isinstance(it, dict):
                t = it.get("text")
                if isinstance(t, str) and t.strip():
                    parts.append(t)
                    continue
                c = it.get("content")
                if isinstance(c, str) and c.strip():
                    parts.append(c)
                    continue
        return "\n".join([p for p in parts if p.strip()]).strip()
    if isinstance(value, dict):
        for k in ["text", "content", "thinking", "reasoning", "value"]:
            v = value.get(k)
            if isinstance(v, str) and v.strip():
                return v
        return ""
    return ""


def extract_reasoning_text(msg: Any) -> str:
    if not isinstance(msg, dict):
        return ""
    for k in ["reasoning_content", "thoughts", "thinking", "reasoning"]:
        v = msg.get(k)
        text = as_text(v)
        if text.strip():
            return text.strip()
    content_text = as_text(msg.get("content"))
    if content_text.strip():
        parts: List[str] = []
        for pattern in (r"<think>(.*?)</think>", r"<reasoning>(.*?)</reasoning>"):
            for raw in re.findall(pattern, content_text, flags=re.IGNORECASE | re.DOTALL):
                txt = str(raw or "").strip()
                if txt:
                    parts.append(txt)
        if parts:
            return "\n\n".join(parts).strip()
    return ""


def maybe_truncate_text(text: str, max_chars: int) -> Tuple[str, bool]:
    if not isinstance(text, str):
        return "", False
    if max_chars <= 0:
        return text, False
    if len(text) <= max_chars:
        return text, False
    return text[:max_chars], True


def is_probably_binary(buf: bytes) -> bool:
    if not buf:
        return False
    if b"\x00" in buf:
        return True
    sample = buf[:4096]
    nontext = 0
    for b in sample:
        if b < 9:
            nontext += 1
        elif 14 <= b <= 31:
            nontext += 1
    return (nontext / max(1, len(sample))) > 0.12


def read_text_file(path: str, max_bytes: int) -> Tuple[str, Dict[str, Any]]:
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise RuntimeError("File not found")
    size = int(p.stat().st_size)
    read_bytes = min(max(1, int(max_bytes)), max(1, size))
    with p.open("rb") as fh:
        raw = fh.read(read_bytes)
    if is_probably_binary(raw):
        raise RuntimeError("Binary file not supported")
    text = raw.decode("utf-8", errors="ignore")
    truncated = read_bytes < size
    meta = {"path": str(p), "size": size, "truncated": truncated, "readBytes": read_bytes}
    return text, meta


def norm_abs(path: str) -> str:
    return str(Path(path).expanduser().resolve())


def is_within(base: str, target: str) -> bool:
    try:
        b = Path(base).resolve()
        t = Path(target).resolve()
        t.relative_to(b)
        return True
    except Exception:
        return False


_wechat_env_cache: Optional[Dict[str, str]] = None


def _load_wechat_env_from_shell() -> Dict[str, str]:
    keys = ("WECHAT_APPID", "WECHAT_APPSECRET")
    lines: List[str] = []
    for k in keys:
        lines.append(f'printf "{k}=%s\\n" "${k}"')
    script = "; ".join(lines)
    try:
        p = subprocess.run(
            ["/bin/zsh", "-i", "-c", script],
            capture_output=True,
            text=True,
            timeout=2.5,
            env={**os.environ},
        )
    except Exception:
        return {}
    if p.returncode != 0:
        return {}
    out: Dict[str, str] = {}
    for line in (p.stdout or "").splitlines():
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = str(k).strip()
        v = str(v).strip()
        if k in keys and v:
            out[k] = v
    return out


def safe_env() -> Dict[str, str]:
    global _wechat_env_cache
    env = {
        "HOME": str(Path.home()),
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "LANG": os.environ.get("LANG") or "en_US.UTF-8",
    }
    # 后端进程通常不会读取交互式 shell 配置；这里兜底读取一次 zsh -i 环境并缓存。
    if _wechat_env_cache is None:
        _wechat_env_cache = _load_wechat_env_from_shell()
    for key in ("WECHAT_APPID", "WECHAT_APPSECRET"):
        val = os.environ.get(key)
        if (val is None or not str(val).strip()) and _wechat_env_cache:
            val = _wechat_env_cache.get(key)
        if val is not None and str(val).strip():
            env[key] = val
    if str(os.environ.get("ANIMA_DEV_MODE") or "").strip() == "1":
        entries = []
        repo_root = str(os.environ.get("ANIMA_DEV_REPO_ROOT") or "").strip()
        if repo_root and os.path.isfile(os.path.join(repo_root, "anima")):
            entries.append(repo_root)
        home = str(env.get("HOME") or "").strip()
        anima_user_bin = os.path.join(home, ".anima", "bin") if home else ""
        if anima_user_bin and os.path.isdir(anima_user_bin):
            entries.append(anima_user_bin)
        if entries:
            parts = [p for p in str(env.get("PATH") or "").split(":") if str(p).strip()]
            env["PATH"] = ":".join(list(dict.fromkeys(entries + parts)))
    return env
