import json
import os
import re
import shlex
import subprocess
import sys
import base64
import mimetypes
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import html
import ipaddress
import socket
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import urllib.error
import urllib.parse
import urllib.request

from .constants import MAX_FILE_BYTES_TOOL
from .os_sandbox_runner import run_bash_with_os_sandbox
from .util import is_within, norm_abs, read_text_file, safe_env

ANIMA_COMMAND_WHITELIST_ROOT = norm_abs("/Users/wangxt/.config/anima")

DEFAULT_DANGEROUS_COMMANDS = [
    "sudo",
    "rm",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "killall",
    "pkill",
    "kill",
    "launchctl",
    "systemsetup",
    "networksetup",
    "curl",
    "wget",
    "ssh",
    "scp",
    "sftp",
]

PARALLEL_MAX_WORKERS = 4
PARALLEL_ALLOWED_TOOLS = {
    "bash",
    "read_file",
    "list_dir",
    "glob_files",
    "rg_search",
    "apply_patch",
    "load_skill",
    "WebSearch",
    "WebFetch",
}


def _resolve_permission_mode(args: Dict[str, Any]) -> str:
    mode = str(args.get("_animaPermissionMode") or "workspace_whitelist").strip()
    return "full_access" if mode == "full_access" else "workspace_whitelist"


def _resolve_workspace_roots(args: Dict[str, Any], workspace_dir: str) -> List[str]:
    roots: List[str] = []
    seen = set()
    wdir = str(workspace_dir or "").strip()
    if wdir:
        try:
            wd = norm_abs(wdir)
            roots.append(wd)
            seen.add(wd)
        except Exception:
            pass
    raw = args.get("_animaWorkspaceRoots")
    if isinstance(raw, list):
        for item in raw:
            s = str(item or "").strip()
            if not s:
                continue
            try:
                ap = norm_abs(s)
            except Exception:
                continue
            if ap in seen:
                continue
            seen.add(ap)
            roots.append(ap)
    return roots


def _is_path_allowed(target: str, workspace_dir: str, args: Dict[str, Any]) -> bool:
    if _resolve_permission_mode(args) == "full_access":
        return True
    roots: List[str] = [ANIMA_COMMAND_WHITELIST_ROOT, *_resolve_workspace_roots(args, workspace_dir)]
    return any(is_within(root, target) for root in roots)


def _safe_command_list(raw: Any, fallback: List[str]) -> List[str]:
    if not isinstance(raw, list):
        return list(fallback)
    out: List[str] = []
    for item in raw:
        s = str(item or "").strip().lower()
        if not s:
            continue
        out.append(s)
    return out if out else list(fallback)


def _safe_optional_command_list(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for item in raw:
        s = str(item or "").strip().lower()
        if not s:
            continue
        out.append(s)
    return out


def _log_coder_event(stage: str, payload: Dict[str, Any]) -> None:
    try:
        ts = datetime.now(timezone.utc).isoformat()
        print(f"[coder][{ts}][{stage}] {json.dumps(payload, ensure_ascii=False)}", flush=True)
    except Exception:
        return


def _log_coder_stream_line(stage: str, text: str, log_base: Dict[str, Any]) -> None:
    line = str(text or "").rstrip("\n")
    if not line.strip():
        return
    preview = _clip_text(line, 1200)
    _log_coder_event(
        stage,
        {
            **log_base,
            "text": preview,
            "truncated": len(line) > len(preview),
        },
    )


def _read_coder_pipe_stream(pipe: Any, stage: str, bucket: List[str], log_base: Dict[str, Any]) -> None:
    if pipe is None:
        return
    try:
        while True:
            line = pipe.readline()
            if line == "":
                break
            text = str(line)
            bucket.append(text)
            _log_coder_stream_line(stage, text, log_base)
    except Exception as e:
        _log_coder_event(
            "stream_error",
            {
                **log_base,
                "stream": stage,
                "error": str(e),
            },
        )
    finally:
        try:
            pipe.close()
        except Exception:
            pass


def _matches_command_entry(command_text: str, entry: str) -> bool:
    cmd = str(command_text or "").strip().lower()
    e = str(entry or "").strip().lower()
    if not cmd or not e:
        return False
    # 复合命令（如 "pwd && ls -la"）需要逐段匹配，避免只检查首段导致漏判。
    parts = re.split(r"(?:&&|\|\||\||;|\n)+", cmd)
    for part in parts:
        s = str(part or "").strip()
        if not s:
            continue
        if s == e:
            return True
        if s.startswith(e + " "):
            return True
        first = s.split(None, 1)[0] if s.split() else ""
        if first == e:
            return True
    return False


def _matches_any_command(command_text: str, entries: List[str]) -> Optional[str]:
    for entry in entries:
        if _matches_command_entry(command_text, entry):
            return entry
    return None


def _resolve_command_safety_settings() -> Tuple[List[str], List[str]]:
    try:
        from anima_backend_shared.settings import load_settings

        settings_obj = load_settings()
        settings = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
        if not isinstance(settings, dict):
            settings = {}
        raw_blacklist = settings.get("commandBlacklist")
        if raw_blacklist is None:
            raw_blacklist = settings.get("commandBlacklistPatterns")
        raw_whitelist = settings.get("commandWhitelist")
        if raw_whitelist is None:
            raw_whitelist = settings.get("commandWhitelistPatterns")
        blacklist = _safe_command_list(raw_blacklist, DEFAULT_DANGEROUS_COMMANDS)
        whitelist = _safe_optional_command_list(raw_whitelist)
        return blacklist, whitelist
    except Exception:
        return list(DEFAULT_DANGEROUS_COMMANDS), []


def _auth_header_value(api_key: str) -> str:
    s = str(api_key or "").strip()
    if not s:
        return ""
    lower = s.lower()
    if lower.startswith("bearer ") or lower.startswith("basic ") or lower.startswith("token "):
        return s
    return f"Bearer {s}"


def _http_post_json(*, url: str, payload: Dict[str, Any], headers: Dict[str, str], proxy_url: str, timeout_s: int) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    handlers: List[urllib.request.BaseHandler] = []
    p = str(proxy_url or "").strip()
    if p:
        handlers.append(urllib.request.ProxyHandler({"http": p, "https": p}))
    opener = urllib.request.build_opener(*handlers)
    try:
        with opener.open(req, timeout=max(1, int(timeout_s or 60))) as resp:
            raw = resp.read()
        obj = json.loads(raw.decode("utf-8"))
        return obj if isinstance(obj, dict) else {"ok": False, "error": "Invalid response"}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        raise RuntimeError(f"Upstream HTTP {e.code}: {body[:4000]}")
    except Exception as e:
        raise RuntimeError(str(e))


def _download_public_url_bytes(*, url: str, timeout_s: int, max_bytes: int) -> Tuple[bytes, str]:
    safe_url = _safe_public_http_url(url)
    req = urllib.request.Request(safe_url, headers={"Accept": "*/*"}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=max(1, int(timeout_s or 60))) as resp:
            ct = str(resp.headers.get("Content-Type") or "").strip()
            raw = resp.read(int(max_bytes) + 1)
        if len(raw) > int(max_bytes):
            raise RuntimeError("Downloaded file too large")
        return raw, ct
    except Exception as e:
        raise RuntimeError(str(e))


def _safe_public_http_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        raise RuntimeError("url is required")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise RuntimeError("Only http/https URLs are allowed")
    host = parsed.hostname
    if not host:
        raise RuntimeError("Invalid URL")
    if host in ("localhost",):
        raise RuntimeError("Blocked host")
    try:
        addrs = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except Exception:
        addrs = []
    for a in addrs:
        ip = a[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip)
        except Exception:
            continue
        if (
            ip_obj.is_loopback
            or ip_obj.is_private
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            raise RuntimeError("Blocked non-public address")
    return url


def _html_to_text(source: str) -> str:
    s = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", source)
    s = re.sub(r"(?is)<br\s*/?>", "\n", s)
    s = re.sub(r"(?is)</p\s*>", "\n\n", s)
    s = re.sub(r"(?is)<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n[ \t]+", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _fetch_url_text(url: str, timeout_ms: int, max_bytes: int) -> Dict[str, Any]:
    safe_url = _safe_public_http_url(url)
    timeout_ms = max(1000, min(int(timeout_ms or 15000), 60000))
    max_bytes = max(1024, min(int(max_bytes or (2 * 1024 * 1024)), 8 * 1024 * 1024))
    req = urllib.request.Request(
        safe_url,
        headers={
            "User-Agent": "Anima/0.1 (+https://example.invalid)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_ms / 1000.0) as resp:
            content_type = str(resp.headers.get("Content-Type") or "")
            final_url = str(getattr(resp, "url", safe_url) or safe_url)
            raw = resp.read(max_bytes + 1)
            truncated = len(raw) > max_bytes
            if truncated:
                raw = raw[:max_bytes]
            charset = "utf-8"
            m = re.search(r"charset=([A-Za-z0-9_\-]+)", content_type, flags=re.I)
            if m:
                charset = m.group(1)
            try:
                text = raw.decode(charset, errors="ignore")
            except Exception:
                text = raw.decode("utf-8", errors="ignore")
            is_html = "text/html" in content_type.lower() or "<html" in text.lower()
            out_text = _html_to_text(text) if is_html else text.strip()
            return {
                "ok": True,
                "url": safe_url,
                "finalUrl": final_url,
                "status": int(getattr(resp, "status", 200) or 200),
                "contentType": content_type,
                "body": text,
                "text": out_text,
                "truncated": truncated,
            }
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read(8192).decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        raise RuntimeError(f"HTTP {e.code}: {body[:4000]}")
    except Exception as e:
        raise RuntimeError(str(e))


def _ddg_extract_results(html_text: str, limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in re.finditer(r'(?is)<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html_text):
        href = html.unescape(m.group(1))
        title = _html_to_text(m.group(2))
        url = href
        try:
            parsed = urllib.parse.urlparse(href)
            qs = urllib.parse.parse_qs(parsed.query or "")
            if "uddg" in qs and qs["uddg"]:
                url = qs["uddg"][0]
        except Exception:
            url = href
        out.append({"title": title, "url": url})
        if len(out) >= limit:
            break
    snippets: List[str] = []
    for sm in re.finditer(r'(?is)<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</(?:a|div)>', html_text):
        snippets.append(_html_to_text(sm.group(1)))
    for i in range(min(len(out), len(snippets))):
        if snippets[i]:
            out[i]["snippet"] = snippets[i]
    return out[:limit]


def _parse_freeform_patch(raw_patch: str) -> List[Dict[str, Any]]:
    text = str(raw_patch or "")
    lines = [str(x).rstrip("\r") for x in text.splitlines()]
    if not lines:
        raise RuntimeError("PARSE_ERROR: empty patch")

    def _normalize_marker(line: str) -> str:
        s = str(line or "").strip()
        if re.fullmatch(r"\*{3}\s*Begin Patch(?:\s*\*{3})?", s):
            return "*** Begin Patch"
        if re.fullmatch(r"\*{3}\s*End Patch(?:\s*\*{3})?", s):
            return "*** End Patch"
        return line

    def _normalize_hunk_header(line: str) -> str:
        s = str(line or "").strip()
        for prefix in ("Add File:", "Delete File:", "Update File:", "Move to:"):
            if s.startswith(prefix):
                return f"*** {s}"
        return line

    lines = [_normalize_hunk_header(_normalize_marker(x)) for x in lines]

    if lines[0].strip() != "*** Begin Patch":
        raise RuntimeError("PARSE_ERROR: missing *** Begin Patch (exact line)")
    if lines[-1].strip() != "*** End Patch":
        raise RuntimeError("PARSE_ERROR: missing *** End Patch (exact line)")

    def _is_hunk_start(line: str) -> bool:
        return line.startswith("*** Add File: ") or line.startswith("*** Delete File: ") or line.startswith("*** Update File: ")

    i = 1
    end = len(lines) - 1
    ops: List[Dict[str, Any]] = []
    while i < end:
        line = lines[i]
        if not line.strip():
            i += 1
            continue

        if line.startswith("*** Add File: "):
            path = line[len("*** Add File: ") :].strip()
            if not path:
                raise RuntimeError("PARSE_ERROR: Add File path is required")
            i += 1
            payload: List[str] = []
            while i < end and not _is_hunk_start(lines[i]):
                cur = lines[i]
                if not cur.startswith("+"):
                    raise RuntimeError("PARSE_ERROR: Add File only accepts '+' lines (prefix each content line with '+')")
                payload.append(cur[1:])
                i += 1
            if not payload:
                raise RuntimeError("PARSE_ERROR: Add File requires at least one '+' line")
            ops.append({"type": "add", "path": path, "content": "\n".join(payload)})
            continue

        if line.startswith("*** Delete File: "):
            path = line[len("*** Delete File: ") :].strip()
            if not path:
                raise RuntimeError("PARSE_ERROR: Delete File path is required")
            ops.append({"type": "delete", "path": path})
            i += 1
            continue

        if line.startswith("*** Update File: "):
            path = line[len("*** Update File: ") :].strip()
            if not path:
                raise RuntimeError("PARSE_ERROR: Update File path is required")
            i += 1

            move_to = None
            if i < end and lines[i].startswith("*** Move to: "):
                move_to = lines[i][len("*** Move to: ") :].strip()
                if not move_to:
                    raise RuntimeError("PARSE_ERROR: Move to path is required")
                i += 1

            change_lines: List[str] = []
            while i < end and not _is_hunk_start(lines[i]):
                cur = lines[i]
                if not (cur.startswith("@@") or cur.startswith(" ") or cur.startswith("+") or cur.startswith("-")):
                    raise RuntimeError("PARSE_ERROR: Update File only accepts '@@'/' '/'+'/'-' lines")
                change_lines.append(cur)
                i += 1

            if not change_lines and not move_to:
                raise RuntimeError("PARSE_ERROR: Update File requires changes or Move to")

            src_lines: List[str] = []
            dst_lines: List[str] = []
            saw_change = False
            for cur in change_lines:
                if cur.startswith("@@"):
                    continue
                if cur.startswith(" "):
                    part = cur[1:]
                    src_lines.append(part)
                    dst_lines.append(part)
                    continue
                if cur.startswith("-"):
                    saw_change = True
                    src_lines.append(cur[1:])
                    continue
                if cur.startswith("+"):
                    saw_change = True
                    dst_lines.append(cur[1:])
                    continue

            ops.append(
                {
                    "type": "update",
                    "path": path,
                    "moveTo": move_to,
                    "sourceText": "\n".join(src_lines),
                    "targetText": "\n".join(dst_lines),
                    "hasContentChange": bool(saw_change),
                }
            )
            continue

        raise RuntimeError("PARSE_ERROR: unknown hunk header")

    if not ops:
        raise RuntimeError("PARSE_ERROR: no hunks")
    return ops


def _execute_freeform_patch(raw_patch: str, workspace_dir: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if not workspace_dir:
        raise RuntimeError("No workspace directory selected")
    ops = _parse_freeform_patch(raw_patch)

    state: Dict[str, Optional[str]] = {}
    initial: Dict[str, Optional[str]] = {}
    touched_order: List[str] = []

    def _to_abs_path(rel_path: str) -> str:
        target = norm_abs(str(Path(workspace_dir) / rel_path))
        if not _is_path_allowed(target, workspace_dir, args):
            raise RuntimeError("PATH_ERROR: path outside workspace")
        return target

    def _load(path_abs: str) -> Optional[str]:
        if path_abs in state:
            return state[path_abs]
        p = Path(path_abs)
        if p.exists():
            if not p.is_file():
                raise RuntimeError("PATH_ERROR: target is not a file")
            content, meta = read_text_file(path_abs, max_bytes=MAX_FILE_BYTES_TOOL)
            if meta.get("truncated"):
                raise RuntimeError("IO_ERROR: file too large")
            initial[path_abs] = content
            state[path_abs] = content
            touched_order.append(path_abs)
            return content
        initial[path_abs] = None
        state[path_abs] = None
        touched_order.append(path_abs)
        return None

    def _set(path_abs: str, value: Optional[str]) -> None:
        if path_abs not in state:
            _load(path_abs)
        state[path_abs] = value

    for op in ops:
        tp = str(op.get("type") or "")
        rel_path = str(op.get("path") or "").strip()
        if not rel_path:
            raise RuntimeError("PARSE_ERROR: path is required")
        abs_path = _to_abs_path(rel_path)

        if tp == "add":
            cur = _load(abs_path)
            if cur is not None:
                raise RuntimeError("CONFLICT: add target already exists")
            _set(abs_path, str(op.get("content") or ""))
            continue

        if tp == "delete":
            cur = _load(abs_path)
            if cur is None:
                raise RuntimeError("CONFLICT: delete target does not exist")
            _set(abs_path, None)
            continue

        if tp == "update":
            cur = _load(abs_path)
            if cur is None:
                raise RuntimeError("CONFLICT: update target does not exist")

            next_content = cur
            if bool(op.get("hasContentChange")):
                source_text = str(op.get("sourceText") or "")
                target_text = str(op.get("targetText") or "")
                if not source_text:
                    raise RuntimeError("CONFLICT: update source block is empty")
                found = cur.count(source_text)
                if found != 1:
                    raise RuntimeError(f"CONFLICT: source block occurrences {found} != 1")
                next_content = cur.replace(source_text, target_text, 1)
            _set(abs_path, next_content)

            move_to = str(op.get("moveTo") or "").strip()
            if move_to:
                abs_move_to = _to_abs_path(move_to)
                if abs_move_to != abs_path:
                    target_cur = _load(abs_move_to)
                    if target_cur is not None:
                        raise RuntimeError("CONFLICT: move target already exists")
                    _set(abs_move_to, next_content)
                    _set(abs_path, None)
            continue

        raise RuntimeError("PARSE_ERROR: unsupported op type")

    changed_files: List[str] = []
    diffs: List[Dict[str, Any]] = []
    actions: List[Tuple[str, Optional[str], Optional[str]]] = []
    for path_abs in touched_order:
        before = initial.get(path_abs)
        after = state.get(path_abs)
        if before == after:
            continue
        changed_files.append(str(Path(path_abs).resolve().relative_to(Path(workspace_dir).resolve())))
        diffs.append(
            {
                "path": str(Path(path_abs).resolve().relative_to(Path(workspace_dir).resolve())),
                "oldContent": before if before is not None else "",
                "newContent": after if after is not None else "",
            }
        )
        actions.append((path_abs, before, after))

    if not actions:
        return {"ok": True, "changed": False, "applied_hunks": len(ops), "changed_files": [], "diffs": []}

    applied: List[Tuple[str, Optional[str], Optional[str]]] = []
    try:
        for path_abs, _before, after in actions:
            p = Path(path_abs)
            if after is None:
                if p.exists():
                    p.unlink()
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                with open(path_abs, "w", encoding="utf-8") as f:
                    f.write(after)
            applied.append((path_abs, _before, after))
    except Exception as e:
        for path_abs, before, _after in reversed(applied):
            p = Path(path_abs)
            try:
                if before is None:
                    if p.exists():
                        p.unlink()
                else:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    with open(path_abs, "w", encoding="utf-8") as f:
                        f.write(before)
            except Exception:
                pass
        raise RuntimeError(f"IO_ERROR: {e}")

    return {
        "ok": True,
        "changed": True,
        "applied_hunks": len(ops),
        "changed_files": changed_files,
        "diffs": diffs,
    }


def _normalize_coder_profile(raw: Any) -> Dict[str, Any]:
    c = dict(raw) if isinstance(raw, dict) else {}
    backend_kind = str(c.get("backendKind") or "").strip().lower()
    if backend_kind == "claude":
        backend_kind = "claude"
    elif backend_kind == "custom":
        backend_kind = "custom"
    else:
        backend_kind = "codex"
    default_command = "claude" if backend_kind == "claude" else "codex"
    default_args = ["-p", "{prompt}"] if backend_kind == "claude" else ["exec", "{prompt}"]
    args = c.get("args")
    if not isinstance(args, list) or not args:
        args = list(default_args)
    args = [str(x) for x in args]
    timeout_ms = int(c.get("timeoutMs") or 1200000)
    if timeout_ms <= 0:
        timeout_ms = 1200000
    max_output_chars = int(c.get("maxOutputChars") or 120000)
    if max_output_chars <= 0:
        max_output_chars = 120000
    rp = c.get("resultPolicy") if isinstance(c.get("resultPolicy"), dict) else {}
    message_mode = str(rp.get("messageMode") or "").strip().lower()
    if message_mode not in ("all", "last", "summary"):
        message_mode = "summary"
    artifact_mode = str(rp.get("artifactMode") or "").strip().lower()
    if artifact_mode not in ("none", "final", "all"):
        artifact_mode = "final"
    return {
        "id": str(c.get("id") or "").strip(),
        "enabled": bool(c.get("enabled")),
        "name": str(c.get("name") or "Coder").strip() or "Coder",
        "backendKind": backend_kind,
        "backendLabel": str(c.get("backendLabel") or "").strip(),
        "command": str(c.get("command") or default_command).strip() or default_command,
        "args": args,
        "cwd": str(c.get("cwd") or "").strip(),
        "env": c.get("env") if isinstance(c.get("env"), dict) else {},
        "timeoutMs": timeout_ms,
        "maxOutputChars": max_output_chars,
        "resultPolicy": {
            "messageMode": message_mode,
            "artifactMode": artifact_mode,
            "includeDecisionRequests": bool(rp.get("includeDecisionRequests", True)),
        },
    }


def _normalize_proxy_url(proxy_url: Any) -> str:
    s = str(proxy_url or "").strip()
    if not s:
        return ""
    lower = s.lower()
    if "://" in lower:
        return s
    if s.startswith("/"):
        return s
    if ":" in s:
        return "http://" + s
    return s


def _resolve_coder_profile(args: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    from .settings import load_settings

    settings_obj = load_settings()
    settings = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
    if not isinstance(settings, dict):
        settings = {}

    raw_profiles = settings.get("coderProfiles")
    profiles: List[Dict[str, Any]] = []
    if isinstance(raw_profiles, list):
        for item in raw_profiles:
            p = _normalize_coder_profile(item)
            if p.get("id"):
                profiles.append(p)
    raw_single = settings.get("coder")
    if isinstance(raw_single, dict):
        fallback = _normalize_coder_profile(raw_single)
        if fallback.get("id"):
            if all(str(x.get("id") or "") != str(fallback.get("id") or "") for x in profiles):
                profiles.append(fallback)
        elif not profiles:
            fallback["id"] = "coder-default"
            profiles.append(fallback)
    if not profiles:
        profiles = [_normalize_coder_profile({"id": "coder-default"})]

    profile_id = str(args.get("profileId") or "").strip()
    provider = str(args.get("provider") or "").strip().lower()
    active_id = str(settings.get("activeCoderProfileId") or "").strip()

    if profile_id:
        for p in profiles:
            if str(p.get("id") or "") == profile_id:
                return p, settings
        raise RuntimeError("Coder profile not found")

    if provider and provider != "auto":
        for p in profiles:
            if str(p.get("backendKind") or "") == provider:
                return p, settings
        raise RuntimeError(f"Coder provider '{provider}' not found")

    for p in profiles:
        if str(p.get("id") or "") == active_id:
            return p, settings
    return profiles[0], settings


def _clip_text(text: str, max_chars: int) -> str:
    s = str(text or "")
    if max_chars <= 0:
        return ""
    if len(s) <= max_chars:
        return s
    return s[: max(0, max_chars)] + "\n...[truncated]"


def _normalize_artifact_item(item: Any, workspace_dir: str) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    raw_path = str(item.get("path") or "").strip()
    if not raw_path:
        return None
    if not os.path.isabs(raw_path):
        raw_path = str(Path(workspace_dir) / raw_path)
    try:
        path_abs = norm_abs(raw_path)
    except Exception:
        return None
    if workspace_dir:
        try:
            if not is_within(norm_abs(workspace_dir), path_abs):
                return None
        except Exception:
            return None
    mime = str(item.get("mime") or mimetypes.guess_type(path_abs)[0] or "").strip()
    kind = str(item.get("kind") or "").strip().lower()
    if kind not in ("image", "video", "file"):
        if mime.startswith("image/"):
            kind = "image"
        elif mime.startswith("video/"):
            kind = "video"
        else:
            kind = "file"
    out = {"kind": kind, "path": path_abs}
    if mime:
        out["mime"] = mime
    title = str(item.get("title") or "").strip()
    if title:
        out["title"] = title
    caption = str(item.get("caption") or "").strip()
    if caption:
        out["caption"] = caption
    return out


def _collect_coder_events(stdout_text: str, stderr_text: str, workspace_dir: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    messages: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []
    decision_requests: List[Dict[str, Any]] = []

    for line in str(stdout_text or "").splitlines():
        s = line.strip()
        if not s:
            continue
        obj: Any = None
        try:
            obj = json.loads(s)
        except Exception:
            obj = None
        if isinstance(obj, dict):
            content = str(obj.get("content") or obj.get("message") or "").strip()
            if content:
                role = str(obj.get("role") or "assistant").strip() or "assistant"
                messages.append({"role": role, "content": content})
            raw_artifacts = obj.get("artifacts")
            if isinstance(raw_artifacts, list):
                for item in raw_artifacts:
                    normalized = _normalize_artifact_item(item, workspace_dir)
                    if normalized:
                        artifacts.append(normalized)
            if isinstance(obj.get("artifact"), dict):
                normalized = _normalize_artifact_item(obj.get("artifact"), workspace_dir)
                if normalized:
                    artifacts.append(normalized)
            if isinstance(obj.get("approval"), dict):
                decision_requests.append({"type": "approval", **obj.get("approval")})
            if bool(obj.get("needsDecision")):
                decision_requests.append(
                    {
                        "type": "decision",
                        "message": str(obj.get("decisionMessage") or content or "").strip(),
                    }
                )
            continue
        messages.append({"role": "assistant", "content": s})

    if not messages and str(stdout_text or "").strip():
        messages.append({"role": "assistant", "content": str(stdout_text or "").strip()})
    if str(stderr_text or "").strip():
        messages.append({"role": "system", "content": str(stderr_text or "").strip()})
    return messages, artifacts, decision_requests


def _build_coder_result(
    *,
    profile: Dict[str, Any],
    prompt: str,
    command: str,
    command_args: List[str],
    cwd: str,
    exit_code: int,
    stdout_text: str,
    stderr_text: str,
    timeout_ms: int,
    max_output_chars: int,
    message_mode: str,
    artifact_mode: str,
    include_decision_requests: bool,
    workspace_dir: str,
    elapsed_ms: int,
) -> Dict[str, Any]:
    messages, artifacts, decision_requests = _collect_coder_events(stdout_text, stderr_text, workspace_dir)
    clipped_stdout = _clip_text(stdout_text, max_output_chars)
    clipped_stderr = _clip_text(stderr_text, max_output_chars)
    if message_mode == "all":
        selected_messages = messages
    elif message_mode == "last":
        selected_messages = messages[-1:] if messages else []
    else:
        last = messages[-1]["content"] if messages else clipped_stdout or clipped_stderr
        selected_messages = [{"role": "assistant", "content": _clip_text(last, min(max_output_chars, 1200))}] if last else []
    if artifact_mode == "none":
        selected_artifacts: List[Dict[str, Any]] = []
    elif artifact_mode == "final":
        selected_artifacts = artifacts[-1:] if artifacts else []
    else:
        selected_artifacts = artifacts
    final_message = ""
    for msg in reversed(messages):
        content = str(msg.get("content") or "").strip()
        if content:
            final_message = content
            break
    if not final_message:
        final_message = _clip_text(clipped_stdout or clipped_stderr, min(max_output_chars, 2000))
    summary = _clip_text(final_message, min(max_output_chars, 1200))
    return {
        "ok": exit_code == 0,
        "provider": str(profile.get("backendKind") or "codex"),
        "profileId": str(profile.get("id") or ""),
        "profileName": str(profile.get("name") or ""),
        "exitCode": exit_code,
        "elapsedMs": elapsed_ms,
        "command": command,
        "args": command_args,
        "cwd": cwd,
        "timeoutMs": timeout_ms,
        "prompt": _clip_text(prompt, 2000),
        "summary": summary,
        "finalMessage": final_message,
        "messages": selected_messages,
        "artifacts": selected_artifacts,
        "needsDecision": bool(decision_requests) and include_decision_requests,
        "decisionRequests": decision_requests if include_decision_requests else [],
        "raw": {"stdout": clipped_stdout, "stderr": clipped_stderr},
    }


def _build_coder_tool_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    ok = bool(result.get("ok"))
    exit_code_raw = result.get("exitCode")
    try:
        exit_code = int(exit_code_raw if exit_code_raw is not None else 0)
    except Exception:
        exit_code = 0

    raw = result.get("raw") if isinstance(result.get("raw"), dict) else {}
    stdout_text = str(raw.get("stdout") or "")
    stderr_text = str(raw.get("stderr") or "")

    out: Dict[str, Any] = {
        "ok": ok,
        "exitCode": exit_code,
        "stdout": stdout_text,
    }
    if (not ok) and stderr_text.strip():
        out["stderr"] = stderr_text

    artifacts = result.get("artifacts")
    if isinstance(artifacts, list) and artifacts:
        out["artifacts"] = artifacts

    decision_requests = result.get("decisionRequests")
    if isinstance(decision_requests, list) and decision_requests:
        out["needsDecision"] = True
        out["decisionRequests"] = decision_requests
    elif bool(result.get("needsDecision")):
        out["needsDecision"] = True
    return out


def builtin_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "glob_files",
                "description": "Find files in the workspace using a glob pattern.",
                "parameters": {"type": "object", "properties": {"pattern": {"type": "string"}}, "required": ["pattern"]},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "load_skill",
                "description": "Load full instructions for a skill by id (progressive disclosure).",
                "parameters": {
                    "type": "object",
                    "properties": {"id": {"type": "string", "description": "Skill id (folder name)"}},
                    "required": ["id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "multi_tool_use_parallel",
                "description": "Run multiple tool calls concurrently and return aggregated results in original order.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tool_uses": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "recipient_name": {"type": "string"},
                                    "parameters": {"type": "object"},
                                },
                                "required": ["recipient_name", "parameters"],
                            },
                        },
                        "max_parallel": {"type": "integer"},
                    },
                    "required": ["tool_uses"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Run a safe bash command on this Mac and return stdout/stderr.",
                "parameters": {
                    "type": "object",
                    "properties": {"command": {"type": "string"}, "cwd": {"type": "string"}, "timeoutMs": {"type": "integer"}},
                    "required": ["command"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "screenshot",
                "description": "Capture a screenshot and save it under the workspace. Returns an image artifact.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string", "enum": ["screen"], "description": "Screenshot mode"},
                        "path": {"type": "string", "description": "Optional output path relative to workspace"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "generate_image",
                "description": "Generate an image using the configured image provider and save it under the workspace. Returns an image artifact.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": "Image prompt"},
                        "model": {"type": "string", "description": "Optional image model id"},
                        "size": {"type": "string", "description": "Optional image size, e.g. 1024x1024"},
                        "path": {"type": "string", "description": "Optional output path relative to workspace"},
                    },
                    "required": ["prompt"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "generate_video",
                "description": "Generate a short video using the configured video provider and save it under the workspace. Returns a video artifact.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string", "description": "Video prompt"},
                        "model": {"type": "string", "description": "Optional video model id"},
                        "path": {"type": "string", "description": "Optional output path relative to workspace"},
                    },
                    "required": ["prompt"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a text file from the workspace.",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "maxBytes": {"type": "integer"}}, "required": ["path"]},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_add",
                "description": "Write a structured memory item into workspace/global memory store with policy guardrails.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "content": {"type": "string"},
                        "scope": {"type": "string", "enum": ["workspace", "global"]},
                        "type": {"type": "string", "enum": ["working", "episodic", "semantic", "perceptual"]},
                        "importance": {"type": "number"},
                        "confidence": {"type": "number"},
                        "source": {"type": "string"},
                        "runId": {"type": "string"},
                        "userId": {"type": "string"},
                        "evidence": {"type": "array", "items": {"type": "string"}},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "ttlDays": {"type": "integer"},
                    },
                    "required": ["content"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_query",
                "description": "Query structured memory items from workspace/global memory store.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "includeGlobal": {"type": "boolean"},
                        "globalTopK": {"type": "integer"},
                        "topK": {"type": "integer"},
                        "threshold": {"type": "number"},
                        "types": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_forget",
                "description": "Soft-delete memory items by ids/types/time for memory hygiene.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ids": {"type": "array", "items": {"type": "string"}},
                        "types": {"type": "array", "items": {"type": "string"}},
                        "createdBeforeMs": {"type": "integer"},
                        "maxForget": {"type": "integer"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_consolidate",
                "description": "Promote high-value working/episodic memory into semantic memory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "minImportance": {"type": "number"},
                        "minConfidence": {"type": "number"},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_link",
                "description": "Create a graph relation edge between two memory items.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "fromId": {"type": "string"},
                        "toId": {"type": "string"},
                        "relation": {"type": "string"},
                        "weight": {"type": "number"},
                        "source": {"type": "string"},
                    },
                    "required": ["fromId", "toId", "relation"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_graph_query",
                "description": "Query one-hop/two-hop related memory nodes and edges from graph store.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "anchorIds": {"type": "array", "items": {"type": "string"}},
                        "hops": {"type": "integer"},
                        "maxNodes": {"type": "integer"},
                    },
                    "required": ["anchorIds"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "memory_metrics",
                "description": "Get memory system metrics summary.",
                "parameters": {
                    "type": "object",
                    "properties": {"days": {"type": "integer"}},
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "rg_search",
                "description": "Search text in workspace files (ripgrep when available).",
                "parameters": {
                    "type": "object",
                    "properties": {"pattern": {"type": "string"}, "glob": {"type": "string"}, "maxMatches": {"type": "integer"}},
                    "required": ["pattern"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "List entries under a workspace directory.",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "maxEntries": {"type": "integer"}}, "required": ["path"]},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "apply_patch",
                "description": "Apply FREEFORM patch text to workspace files. Required format: '*** Begin Patch' ... hunk headers '*** Add File|Delete File|Update File' (optional '*** Move to' under Update), and final '*** End Patch'. Add File content lines must start with '+'.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "patch": {
                            "type": "string",
                            "description": "Examples:\\nAdd File:\\n*** Begin Patch\\n*** Add File: a.txt\\n+hello\\n*** End Patch\\n\\nDelete File:\\n*** Begin Patch\\n*** Delete File: a.txt\\n*** End Patch\\n\\nUpdate File:\\n*** Begin Patch\\n*** Update File: a.txt\\n@@\\n-old line\\n+new line\\n*** End Patch",
                        }
                    },
                    "required": ["patch"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "coder",
                "description": "Run local coder CLI (Codex/Claude) synchronously and return normalized messages/artifacts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string"},
                        "provider": {"type": "string", "enum": ["auto", "codex", "claude", "custom"]},
                        "profileId": {"type": "string"},
                        "workspaceDir": {"type": "string"},
                    },
                    "required": ["prompt"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "WebSearch",
                "description": "Search the web and return a short list of results.",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}, "num": {"type": "integer"}, "lr": {"type": "string"}},
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "WebFetch",
                "description": "Fetch a web page and return extracted text content.",
                "parameters": {
                    "type": "object",
                    "properties": {"url": {"type": "string"}, "timeoutMs": {"type": "integer"}, "maxBytes": {"type": "integer"}},
                    "required": ["url"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "cron_list",
                "description": "List cron jobs managed by the local backend.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "cron_upsert",
                "description": "Create or update a cron job in the local backend.",
                "parameters": {
                    "type": "object",
                    "properties": {"job": {"type": "object"}},
                    "required": ["job"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "cron_delete",
                "description": "Delete a cron job by id in the local backend.",
                "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "cron_run",
                "description": "Trigger a cron job to run immediately by id.",
                "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
            },
        },
    ]


def http_json(url: str, method: str = "GET", payload: Optional[Dict[str, Any]] = None, timeout: int = 10) -> Any:
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def mcp_tools(settings_obj: Dict[str, Any], composer: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    servers = ((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("mcpServers") or []
    if not isinstance(servers, list):
        servers = []
    enabled_ids = composer.get("enabledMcpServerIds")
    if enabled_ids is None:
        enabled_ids = ((settings_obj.get("settings") or {}) if isinstance(settings_obj, dict) else {}).get("mcpEnabledServerIds") or []
    enabled = set([str(x) for x in enabled_ids]) if isinstance(enabled_ids, list) else set()
    if not enabled:
        return [], {}
    tools: List[Dict[str, Any]] = []
    call_index: Dict[str, Dict[str, Any]] = {}
    for s in servers:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or "").strip()
        if not sid or sid not in enabled:
            continue
        base = str(s.get("url") or "").strip().rstrip("/")
        if not base:
            continue
        try:
            res = http_json(base + "/tools", method="GET", payload=None, timeout=5)
        except Exception:
            continue
        items = (res or {}).get("tools") if isinstance(res, dict) else None
        if not isinstance(items, list):
            continue
        for t in items:
            if not isinstance(t, dict):
                continue
            tid = str(t.get("id") or t.get("name") or "").strip()
            if not tid:
                continue
            name = f"mcp__{sid}__{tid}"
            params = t.get("parameters")
            if not isinstance(params, dict):
                params = {"type": "object", "properties": {}}
            tools.append({"type": "function", "function": {"name": name, "description": str(t.get("description") or f"MCP tool {tid}").strip(), "parameters": params}})
            call_index[name] = {"serverUrl": base, "toolId": tid}
    return tools, call_index


def _parallel_resolve_tool_name(raw_name: str) -> str:
    name = str(raw_name or "").strip()
    if not name:
        return ""
    if name.startswith("functions."):
        mapped = name.split(".", 1)[1].strip()
        if mapped == "exec_command":
            return "bash"
        return mapped
    if name in ("multi_tool_use_parallel", "multi_tool_use.parallel"):
        return name
    return name


def _parallel_resolve_tool_args(*, recipient_name: str, params: Dict[str, Any], parent_args: Dict[str, Any]) -> Dict[str, Any]:
    args = dict(params or {})
    # 继承父调用里的执行安全上下文，确保并行子调用遵循同一审批与权限约束。
    for k, v in (parent_args or {}).items():
        if str(k).startswith("_anima") and k not in args:
            args[k] = v
    if recipient_name == "functions.exec_command":
        out: Dict[str, Any] = {}
        out["command"] = str(args.get("cmd") or args.get("command") or "").strip()
        if not out["command"]:
            raise RuntimeError("tool_uses[].parameters.cmd is required for functions.exec_command")
        cwd = str(args.get("workdir") or args.get("cwd") or "").strip()
        if cwd:
            out["cwd"] = cwd
        timeout_ms = args.get("yield_time_ms")
        if timeout_ms is None:
            timeout_ms = args.get("timeoutMs")
        if timeout_ms is not None:
            try:
                out["timeoutMs"] = int(timeout_ms)
            except Exception:
                pass
        for k, v in args.items():
            if str(k).startswith("_anima"):
                out[k] = v
        return out
    return args


def execute_builtin_tool(name: str, args: Dict[str, Any], workspace_dir: str) -> str:
    if name in ("multi_tool_use_parallel", "multi_tool_use.parallel"):
        raw_uses = args.get("tool_uses")
        if not isinstance(raw_uses, list) or not raw_uses:
            raise RuntimeError("tool_uses must be a non-empty array")
        try:
            max_parallel = int(args.get("max_parallel") or PARALLEL_MAX_WORKERS)
        except Exception:
            max_parallel = PARALLEL_MAX_WORKERS
        max_workers = max(1, min(max_parallel, PARALLEL_MAX_WORKERS, len(raw_uses)))
        results: List[Optional[Dict[str, Any]]] = [None] * len(raw_uses)
        started_at = int(time.time() * 1000)

        def _run_one(i: int, item: Any) -> Dict[str, Any]:
            call_started = int(time.time() * 1000)
            if not isinstance(item, dict):
                raise RuntimeError("each tool_uses item must be an object")
            recipient_name = str(item.get("recipient_name") or item.get("name") or "").strip()
            if not recipient_name:
                raise RuntimeError("tool_uses[].recipient_name is required")
            params = item.get("parameters")
            if not isinstance(params, dict):
                raise RuntimeError("tool_uses[].parameters must be an object")
            tool_name = _parallel_resolve_tool_name(recipient_name)
            if not tool_name:
                raise RuntimeError("unable to resolve tool name")
            if tool_name in ("multi_tool_use_parallel", "multi_tool_use.parallel"):
                raise RuntimeError("nested multi_tool_use.parallel is not allowed")
            if tool_name not in PARALLEL_ALLOWED_TOOLS:
                raise RuntimeError(f"tool not allowed in parallel: {tool_name}")
            call_args = _parallel_resolve_tool_args(recipient_name=recipient_name, params=params, parent_args=args)
            raw = execute_builtin_tool(tool_name, call_args, workspace_dir)
            try:
                parsed_result: Any = json.loads(raw)
            except Exception:
                parsed_result = raw
            call_ended = int(time.time() * 1000)
            return {
                "index": i,
                "recipientName": recipient_name,
                "toolName": tool_name,
                "ok": True,
                "durationMs": max(0, call_ended - call_started),
                "result": parsed_result,
            }

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            fut_to_idx = {pool.submit(_run_one, i, item): i for i, item in enumerate(raw_uses)}
            for fut in as_completed(fut_to_idx):
                i = fut_to_idx[fut]
                try:
                    results[i] = fut.result()
                except Exception as e:
                    call_ended = int(time.time() * 1000)
                    item = raw_uses[i] if i < len(raw_uses) else {}
                    recipient_name = str((item or {}).get("recipient_name") or (item or {}).get("name") or "").strip()
                    tool_name = _parallel_resolve_tool_name(recipient_name)
                    results[i] = {
                        "index": i,
                        "recipientName": recipient_name,
                        "toolName": tool_name,
                        "ok": False,
                        "durationMs": 0,
                        "error": str(e),
                        "endedAt": call_ended,
                    }

        settled = [r for r in results if isinstance(r, dict)]
        ended_at = int(time.time() * 1000)
        ok = len(settled) == len(raw_uses) and all(bool((r or {}).get("ok")) for r in settled)
        return json.dumps(
            {
                "ok": ok,
                "tool": "multi_tool_use_parallel",
                "maxWorkers": max_workers,
                "startedAt": started_at,
                "endedAt": ended_at,
                "durationMs": max(0, ended_at - started_at),
                "results": settled,
            },
            ensure_ascii=False,
        )

    if name == "memory_metrics":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        from .memory_store import get_memory_metrics_summary

        out = get_memory_metrics_summary(
            workspace_dir=workspace_dir,
            days=int(args.get("days") or 7),
        )
        return json.dumps({"ok": True, "result": out}, ensure_ascii=False)

    if name == "memory_graph_query":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        from .memory_store import query_memory_graph

        anchor_ids = [str(x).strip() for x in (args.get("anchorIds") or []) if str(x).strip()] if isinstance(args.get("anchorIds"), list) else []
        out = query_memory_graph(
            workspace_dir=workspace_dir,
            anchor_ids=anchor_ids,
            hops=int(args.get("hops") or 1),
            max_nodes=int(args.get("maxNodes") or 20),
        )
        return json.dumps({"ok": True, "result": out}, ensure_ascii=False)

    if name == "memory_link":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        from .memory_store import link_memory_items

        out = link_memory_items(
            workspace_dir=workspace_dir,
            from_id=str(args.get("fromId") or "").strip(),
            to_id=str(args.get("toId") or "").strip(),
            relation=str(args.get("relation") or "").strip(),
            weight=float(args.get("weight") or 1.0),
            source=str(args.get("source") or "agent").strip(),
        )
        return json.dumps({"ok": True, "edge": out}, ensure_ascii=False)

    if name == "memory_forget":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        from .memory_store import forget_memory_items

        ids = [str(x).strip() for x in (args.get("ids") or []) if str(x).strip()] if isinstance(args.get("ids"), list) else []
        types = [str(x).strip().lower() for x in (args.get("types") or []) if str(x).strip()] if isinstance(args.get("types"), list) else []
        out = forget_memory_items(
            workspace_dir=workspace_dir,
            ids=ids,
            memory_types=types,
            created_before_ms=int(args.get("createdBeforeMs") or 0),
            max_forget=int(args.get("maxForget") or 200),
        )
        return json.dumps({"ok": True, "result": out}, ensure_ascii=False)

    if name == "memory_consolidate":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        from .memory_store import consolidate_memory_items
        from .settings import load_settings

        settings_obj = load_settings()
        s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
        if not isinstance(s, dict):
            s = {}
        raw_min_importance = args.get("minImportance")
        raw_min_confidence = args.get("minConfidence")
        try:
            min_importance = float(s.get("memoryConsolidateMinImportance") if raw_min_importance is None else raw_min_importance)
        except Exception:
            min_importance = 0.75
        try:
            min_confidence = float(s.get("memoryConsolidateMinConfidence") if raw_min_confidence is None else raw_min_confidence)
        except Exception:
            min_confidence = 0.75
        out = consolidate_memory_items(
            workspace_dir=workspace_dir,
            min_importance=min_importance,
            min_confidence=min_confidence,
        )
        return json.dumps({"ok": True, "result": out}, ensure_ascii=False)

    if name == "memory_query":
        from .memory_store import query_memory_items_scoped
        from .settings import load_settings

        q = str(args.get("query") or "").strip()
        if not q:
            raise RuntimeError("query is required")
        settings_obj = load_settings()
        s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
        if not isinstance(s, dict):
            s = {}
        raw_top_k = args.get("topK")
        raw_threshold = args.get("threshold")
        try:
            top_k = int(s.get("memoryMaxRetrieveCount") if raw_top_k is None else raw_top_k)
        except Exception:
            top_k = 8
        try:
            threshold = float(s.get("memorySimilarityThreshold") if raw_threshold is None else raw_threshold)
        except Exception:
            threshold = 0.6
        global_enabled_default = bool(s.get("memoryGlobalEnabled", False))
        include_global = bool(global_enabled_default if args.get("includeGlobal") is None else args.get("includeGlobal"))
        global_top_k_raw = args.get("globalTopK")
        try:
            global_top_k = int(s.get("memoryGlobalRetrieveCount") if global_top_k_raw is None else global_top_k_raw)
        except Exception:
            global_top_k = 3
        raw_types = args.get("types")
        mem_types = [str(x).strip().lower() for x in raw_types] if isinstance(raw_types, list) else []
        if not workspace_dir and not include_global:
            raise RuntimeError("No workspace directory selected")
        rows = query_memory_items_scoped(
            workspace_dir=workspace_dir,
            query=q,
            top_k=top_k,
            similarity_threshold=threshold,
            memory_types=mem_types,
            include_global=include_global,
            global_top_k=global_top_k,
        )
        scope_stats = {"workspace": 0, "global": 0}
        for row in rows:
            if not isinstance(row, dict):
                continue
            sc = str(row.get("scope") or "workspace").strip().lower()
            if sc == "global":
                scope_stats["global"] += 1
            else:
                scope_stats["workspace"] += 1
        return json.dumps(
            {"ok": True, "query": q, "includeGlobal": include_global, "scopeStats": scope_stats, "items": rows},
            ensure_ascii=False,
        )

    if name == "memory_add":
        from .memory_store import add_memory_item_scoped
        from .memory_scope_policy import decide_memory_scope
        from .settings import load_settings

        content = str(args.get("content") or "").strip()
        if not content:
            raise RuntimeError("content is required")
        settings_obj = load_settings()
        s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
        if not isinstance(s, dict):
            s = {}
        raw_scope = args.get("scope")
        global_enabled = bool(s.get("memoryGlobalEnabled", False))
        global_write_enabled = bool(s.get("memoryGlobalWriteEnabled", True))
        memory_type = str(args.get("type") or "semantic").strip().lower()
        tags = [str(x).strip() for x in (args.get("tags") or []) if str(x).strip()] if isinstance(args.get("tags"), list) else []
        scope, scope_reason = decide_memory_scope(
            requested_scope=raw_scope,
            content=content,
            memory_type=memory_type,
            tags=tags,
            workspace_dir=workspace_dir,
            settings_obj=s,
        )
        if scope == "global" and (not global_enabled or not global_write_enabled):
            return json.dumps(
                {
                    "ok": False,
                    "blocked": True,
                    "reason": "global_memory_disabled",
                    "message": "memory_add blocked: global memory write is disabled",
                    "scopeDecision": {"scope": scope, "reason": scope_reason},
                },
                ensure_ascii=False,
            )
        if scope == "workspace" and not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        require_evidence = bool(s.get("memoryWriteRequireEvidence", True))
        min_importance = float(s.get("memoryWriteMinImportance") or 0.5)
        min_confidence = float(s.get("memoryWriteMinConfidence") or 0.6)
        raw_importance = args.get("importance")
        raw_confidence = args.get("confidence")
        importance = float(0.5 if raw_importance is None else raw_importance)
        confidence = float(0.7 if raw_confidence is None else raw_confidence)
        evidence = [str(x).strip() for x in (args.get("evidence") or []) if str(x).strip()] if isinstance(args.get("evidence"), list) else []
        if require_evidence and memory_type in ("episodic", "semantic", "perceptual") and not evidence:
            return json.dumps(
                {
                    "ok": False,
                    "blocked": True,
                    "reason": "evidence_required",
                    "message": "memory_add blocked: evidence is required for non-working memory",
                },
                ensure_ascii=False,
            )
        if importance < min_importance:
            return json.dumps(
                {
                    "ok": False,
                    "blocked": True,
                    "reason": "importance_too_low",
                    "message": f"memory_add blocked: importance<{min_importance}",
                },
                ensure_ascii=False,
            )
        if confidence < min_confidence:
            return json.dumps(
                {
                    "ok": False,
                    "blocked": True,
                    "reason": "confidence_too_low",
                    "message": f"memory_add blocked: confidence<{min_confidence}",
                },
                ensure_ascii=False,
            )
        item = add_memory_item_scoped(
            workspace_dir=workspace_dir,
            scope=scope,
            content=content,
            memory_type=memory_type,
            importance=importance,
            confidence=confidence,
            source=str(args.get("source") or "agent"),
            run_id=str(args.get("runId") or ""),
            user_id=str(args.get("userId") or ""),
            evidence=evidence,
            tags=tags,
            ttl_days=int(args.get("ttlDays") or 0),
        )
        return json.dumps({"ok": True, "item": item, "scopeDecision": {"scope": scope, "reason": scope_reason}}, ensure_ascii=False)

    if name == "load_skill":
        skill_id = str(args.get("id") or "").strip()
        if not skill_id:
            raise RuntimeError("id is required")
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", skill_id):
            raise RuntimeError("Invalid skill id format")
        from .settings import get_skills_content

        items = get_skills_content([skill_id])
        if not items:
            raise RuntimeError("Skill not found")
        s = items[0]
        return json.dumps(
            {
                "ok": True,
                "skill": {
                    "id": s.get("id"),
                    "name": s.get("name"),
                    "description": s.get("description"),
                    "dir": s.get("dir"),
                    "file": s.get("file"),
                    "content": s.get("content"),
                    "meta": s.get("meta"),
                    "updatedAt": s.get("updatedAt"),
                },
            },
            ensure_ascii=False,
        )

    if name == "coder":
        prompt = str(args.get("prompt") or "").strip()
        if not prompt:
            raise RuntimeError("prompt is required")
        profile, settings = _resolve_coder_profile(args)
        command = str(profile.get("command") or "").strip()
        if not command:
            raise RuntimeError("coder command is required")
        raw_command_args = profile.get("args") if isinstance(profile.get("args"), list) else []
        command_args = [str(x).replace("{prompt}", prompt) for x in raw_command_args]
        if not any("{prompt}" in str(x) for x in raw_command_args):
            command_args.append(prompt)
        invoked_command = " ".join([shlex.quote(command), *[shlex.quote(str(x)) for x in command_args]])
        call_workspace_dir = str(args.get("workspaceDir") or workspace_dir or "").strip()
        cwd_raw = str(args.get("cwd") or profile.get("cwd") or call_workspace_dir or workspace_dir or "").strip()
        cwd = norm_abs(cwd_raw) if cwd_raw else norm_abs(call_workspace_dir) if call_workspace_dir else ""
        if cwd and call_workspace_dir:
            ws = norm_abs(call_workspace_dir)
            if not _is_path_allowed(cwd, ws, args):
                raise RuntimeError("Coder cwd outside workspace")
        timeout_ms = int(profile.get("timeoutMs") or 1200000)
        if timeout_ms <= 0:
            timeout_ms = 1200000
        max_output_chars = int(profile.get("maxOutputChars") or 120000)
        if max_output_chars <= 0:
            max_output_chars = 120000
        env = safe_env()
        profile_env = profile.get("env") if isinstance(profile.get("env"), dict) else {}
        for k, v in profile_env.items():
            env[str(k)] = str(v)
        extra_env = args.get("env") if isinstance(args.get("env"), dict) else {}
        for k, v in extra_env.items():
            env[str(k)] = str(v)
        proxy_keys = (
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
        )
        proxy_env_keys = [k for k in proxy_keys if str(env.get(k) or "").strip()]
        proxy_source = "env" if proxy_env_keys else "none"
        if not proxy_env_keys:
            px = _normalize_proxy_url((settings.get("proxyUrl") if isinstance(settings, dict) else ""))
            if px:
                for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
                    env[k] = px
                proxy_env_keys = [k for k in proxy_keys if str(env.get(k) or "").strip()]
                proxy_source = "settings.proxyUrl" if proxy_env_keys else "none"
        rp = profile.get("resultPolicy") if isinstance(profile.get("resultPolicy"), dict) else {}
        message_mode = str(rp.get("messageMode") or "summary").strip().lower()
        if message_mode not in ("all", "last", "summary"):
            message_mode = "summary"
        artifact_mode = str(rp.get("artifactMode") or "final").strip().lower()
        if artifact_mode not in ("none", "final", "all"):
            artifact_mode = "final"
        include_decision_requests = bool(rp.get("includeDecisionRequests", True))
        log_base = {
            "provider": str(profile.get("backendKind") or ""),
            "profileId": str(profile.get("id") or ""),
            "profileName": str(profile.get("name") or ""),
            "command": command,
            "commandArgs": command_args,
            "invokedCommand": invoked_command,
            "cwd": cwd,
            "timeoutMs": timeout_ms,
            "maxOutputChars": max_output_chars,
            "messageMode": message_mode,
            "artifactMode": artifact_mode,
            "includeDecisionRequests": include_decision_requests,
            "proxyEnvConfigured": bool(proxy_env_keys),
            "proxyEnvKeys": proxy_env_keys,
            "proxySource": proxy_source,
            "stdinMode": "devnull",
            "workspaceDir": call_workspace_dir or workspace_dir or cwd,
            "promptChars": len(prompt),
        }
        _log_coder_event("start", log_base)
        started_at = int(time.time() * 1000)
        proc: Optional[subprocess.Popen] = None
        stdout_parts: List[str] = []
        stderr_parts: List[str] = []
        stdout_thread: Optional[threading.Thread] = None
        stderr_thread: Optional[threading.Thread] = None
        try:
            proc = subprocess.Popen(
                [command, *command_args],
                cwd=cwd or None,
                env=env,
                stdin=subprocess.DEVNULL,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
            )
            stdout_thread = threading.Thread(
                target=_read_coder_pipe_stream,
                args=(proc.stdout, "stdout", stdout_parts, log_base),
                daemon=True,
            )
            stderr_thread = threading.Thread(
                target=_read_coder_pipe_stream,
                args=(proc.stderr, "stderr", stderr_parts, log_base),
                daemon=True,
            )
            stdout_thread.start()
            stderr_thread.start()
            proc.wait(timeout=max(1, int(timeout_ms / 1000)))
        except subprocess.TimeoutExpired as e:
            if proc is not None:
                try:
                    proc.kill()
                except Exception:
                    pass
                try:
                    proc.wait(timeout=2)
                except Exception:
                    pass
            if stdout_thread is not None:
                stdout_thread.join(timeout=1)
            if stderr_thread is not None:
                stderr_thread.join(timeout=1)
            stdout_text = "".join(stdout_parts)
            stderr_text = "".join(stderr_parts)
            ended_at = int(time.time() * 1000)
            _log_coder_event(
                "timeout",
                {
                    **log_base,
                    "elapsedMs": max(0, ended_at - started_at),
                    "error": str(e),
                    "stdoutChars": len(stdout_text),
                    "stderrChars": len(stderr_text),
                    "stdoutPreview": _clip_text(stdout_text, 1500),
                    "stderrPreview": _clip_text(stderr_text, 1500),
                },
            )
            raise
        except Exception as e:
            if proc is not None:
                try:
                    proc.kill()
                except Exception:
                    pass
            if stdout_thread is not None:
                stdout_thread.join(timeout=1)
            if stderr_thread is not None:
                stderr_thread.join(timeout=1)
            stdout_text = "".join(stdout_parts)
            stderr_text = "".join(stderr_parts)
            ended_at = int(time.time() * 1000)
            _log_coder_event(
                "error",
                {
                    **log_base,
                    "elapsedMs": max(0, ended_at - started_at),
                    "error": str(e),
                    "stdoutChars": len(stdout_text),
                    "stderrChars": len(stderr_text),
                    "stdoutPreview": _clip_text(stdout_text, 1500),
                    "stderrPreview": _clip_text(stderr_text, 1500),
                },
            )
            raise
        if stdout_thread is not None:
            stdout_thread.join(timeout=1)
        if stderr_thread is not None:
            stderr_thread.join(timeout=1)
        stdout_text = "".join(stdout_parts)
        stderr_text = "".join(stderr_parts)
        ended_at = int(time.time() * 1000)
        _log_coder_event(
            "finish",
            {
                **log_base,
                "elapsedMs": max(0, ended_at - started_at),
                "exitCode": int(proc.returncode or 0) if proc is not None else -1,
                "stdoutChars": len(stdout_text),
                "stderrChars": len(stderr_text),
                "stdoutPreview": _clip_text(stdout_text, 1500),
                "stderrPreview": _clip_text(stderr_text, 1500),
            },
        )
        full_res = _build_coder_result(
            profile=profile,
            prompt=prompt,
            command=command,
            command_args=command_args,
            cwd=cwd,
            exit_code=int(proc.returncode or 0) if proc is not None else 1,
            stdout_text=stdout_text,
            stderr_text=stderr_text,
            timeout_ms=timeout_ms,
            max_output_chars=max_output_chars,
            message_mode=message_mode,
            artifact_mode=artifact_mode,
            include_decision_requests=include_decision_requests,
            workspace_dir=call_workspace_dir or workspace_dir or cwd,
            elapsed_ms=max(0, ended_at - started_at),
        )
        res = _build_coder_tool_payload(full_res)
        _log_coder_event(
            "result",
            {
                **log_base,
                "ok": bool(full_res.get("ok")),
                "exitCode": int(full_res.get("exitCode") or 0),
                "summary": _clip_text(str(full_res.get("summary") or ""), 1200),
                "finalMessage": _clip_text(str(full_res.get("finalMessage") or ""), 1200),
                "needsDecision": bool(full_res.get("needsDecision")),
            },
        )
        return json.dumps(res, ensure_ascii=False)

    if name == "WebSearch":
        query = str(args.get("query") or "").strip()
        if not query:
            raise RuntimeError("query is required")
        num = int(args.get("num") or 5)
        num = max(1, min(num, 10))
        lr = str(args.get("lr") or "").strip()
        kl = ""
        if lr:
            if lr == "lang_en":
                kl = "us-en"
            elif lr == "lang_zh":
                kl = "cn-zh"
            else:
                kl = "wt-wt"

        params = {"q": query}
        if kl:
            params["kl"] = kl
        url = "https://duckduckgo.com/html/?" + urllib.parse.urlencode(params)
        res = _fetch_url_text(url, timeout_ms=20000, max_bytes=2 * 1024 * 1024)
        results = _ddg_extract_results(str(res.get("body") or ""), limit=num)
        return json.dumps({"query": query, "results": results}, ensure_ascii=False)

    if name == "WebFetch":
        url = str(args.get("url") or "").strip()
        timeout_ms = int(args.get("timeoutMs") or 15000)
        max_bytes = int(args.get("maxBytes") or (2 * 1024 * 1024))
        res = _fetch_url_text(url, timeout_ms=timeout_ms, max_bytes=max_bytes)
        res.pop("body", None)
        text = str(res.get("text") or "")
        if len(text) > 200000:
            text = text[:200000]
            res["truncated"] = True
        res["text"] = text
        return json.dumps(res, ensure_ascii=False)

    if name == "glob_files":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        pattern = str(args.get("pattern") or "").strip()
        if not pattern:
            return json.dumps({"paths": []}, ensure_ascii=False)
        paths = [str(p) for p in Path(workspace_dir).glob(pattern) if p.is_file()]
        rel = [str(Path(p).resolve().relative_to(Path(workspace_dir).resolve())) for p in paths[:200]]
        return json.dumps({"paths": rel}, ensure_ascii=False)

    if name == "screenshot":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        mode = str(args.get("mode") or "screen").strip() or "screen"
        if mode != "screen":
            raise RuntimeError("Unsupported screenshot mode")

        rel_path = str(args.get("path") or "").strip()
        if rel_path:
            target = norm_abs(str(Path(workspace_dir) / rel_path))
            if not _is_path_allowed(target, workspace_dir, args):
                raise RuntimeError("Path outside workspace")
            if not str(target).lower().endswith(".png"):
                target = target + ".png"
        else:
            out_dir = Path(workspace_dir) / ".anima" / "artifacts"
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            target = norm_abs(str(out_dir / f"screenshot_{ts}.png"))

        p = subprocess.run(
            ["screencapture", "-x", "-t", "png", target],
            cwd=workspace_dir,
            capture_output=True,
            text=True,
            env=safe_env(),
            timeout=20,
        )
        if int(p.returncode) != 0:
            raise RuntimeError((p.stderr or p.stdout or "screencapture failed").strip()[:4000])
        if not os.path.isfile(target):
            raise RuntimeError("Screenshot file not created")

        rel = str(Path(target).resolve().relative_to(Path(workspace_dir).resolve()))
        return json.dumps(
            {
                "ok": True,
                "artifacts": [{"kind": "image", "path": rel, "mime": "image/png", "title": str(Path(rel).name)}],
            },
            ensure_ascii=False,
        )

    if name == "generate_image":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        prompt = str(args.get("prompt") or "").strip()
        if not prompt:
            raise RuntimeError("prompt is required")

        from .providers import get_active_provider_spec, get_provider_spec, normalize_base_url
        from .settings import load_settings

        settings_obj = load_settings()
        image_provider_id = ""
        try:
            s = settings_obj.get("settings")
            if isinstance(s, dict):
                media = s.get("media")
                if isinstance(media, dict):
                    if media.get("imageEnabled") is False:
                        raise RuntimeError("Image generation disabled")
                    image_provider_id = str(media.get("imageProviderId") or "").strip()
        except Exception as e:
            if isinstance(e, RuntimeError):
                raise
        if image_provider_id:
            spec = get_provider_spec(settings_obj, image_provider_id)
            if spec is None:
                raise RuntimeError("No image provider configured. Please configure an image provider in Settings.")
        else:
            spec = get_active_provider_spec(settings_obj)
            if spec is None:
                raise RuntimeError("No active provider configured")

        default_model = ""
        default_size = ""
        try:
            s = settings_obj.get("settings")
            if isinstance(s, dict):
                media = s.get("media")
                if isinstance(media, dict):
                    default_model = str(media.get("defaultImageModel") or "").strip()
                    default_size = str(media.get("defaultImageSize") or "").strip()
        except Exception:
            pass

        actual_model = str(args.get("model") or "").strip() or default_model or str(spec.model or "").strip()
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        url = normalize_base_url(spec.base_url) + "/images/generations"
        payload: Dict[str, Any] = {"model": actual_model, "prompt": prompt, "response_format": "b64_json"}
        size = str(args.get("size") or "").strip() or default_size
        if size:
            payload["size"] = size

        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if str(spec.api_key or "").strip():
            headers["Authorization"] = _auth_header_value(spec.api_key)

        res = _http_post_json(url=url, payload=payload, headers=headers, proxy_url=spec.proxy_url, timeout_s=180)
        data = res.get("data")
        item = data[0] if isinstance(data, list) and data else None
        if not isinstance(item, dict):
            raise RuntimeError("Image generation returned no data")

        raw_bytes: bytes = b""
        mime = "image/png"
        if isinstance(item.get("b64_json"), str) and item.get("b64_json").strip():
            try:
                raw_bytes = base64.b64decode(item.get("b64_json"), validate=False)
            except Exception:
                raise RuntimeError("Failed to decode image bytes")
        elif isinstance(item.get("url"), str) and item.get("url").strip():
            raw_bytes, ct = _download_public_url_bytes(url=str(item.get("url")), timeout_s=180, max_bytes=25 * 1024 * 1024)
            if ct:
                mime = ct
        else:
            raise RuntimeError("Image generation returned no bytes")

        if len(raw_bytes) > (25 * 1024 * 1024):
            raise RuntimeError("Image too large")

        rel_path = str(args.get("path") or "").strip()
        if rel_path:
            target = norm_abs(str(Path(workspace_dir) / rel_path))
            if not _is_path_allowed(target, workspace_dir, args):
                raise RuntimeError("Path outside workspace")
            if not str(target).lower().endswith(".png"):
                target = target + ".png"
        else:
            out_dir = Path(workspace_dir) / ".anima" / "artifacts"
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            target = norm_abs(str(out_dir / f"image_{ts}.png"))

        with open(target, "wb") as f:
            f.write(raw_bytes)
        if not os.path.isfile(target):
            raise RuntimeError("Image file not created")

        rel = str(Path(target).resolve().relative_to(Path(workspace_dir).resolve()))
        return json.dumps(
            {"ok": True, "artifacts": [{"kind": "image", "path": rel, "mime": mime, "title": str(Path(rel).name)}]},
            ensure_ascii=False,
        )

    if name == "generate_video":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        prompt = str(args.get("prompt") or "").strip()
        if not prompt:
            raise RuntimeError("prompt is required")

        from .providers import get_active_provider_spec, get_provider_spec, normalize_base_url
        from .settings import load_settings

        settings_obj = load_settings()
        video_provider_id = ""
        try:
            s = settings_obj.get("settings")
            if isinstance(s, dict):
                media = s.get("media")
                if isinstance(media, dict):
                    if media.get("videoEnabled") is False:
                        raise RuntimeError("Video generation disabled")
                    video_provider_id = str(media.get("videoProviderId") or "").strip()
        except Exception as e:
            if isinstance(e, RuntimeError):
                raise
        if video_provider_id:
            spec = get_provider_spec(settings_obj, video_provider_id)
            if spec is None:
                raise RuntimeError("No video provider configured. Please configure a video provider in Settings.")
        else:
            spec = get_active_provider_spec(settings_obj)
            if spec is None:
                raise RuntimeError("No active provider configured")

        default_model = ""
        try:
            s = settings_obj.get("settings")
            if isinstance(s, dict):
                media = s.get("media")
                if isinstance(media, dict):
                    default_model = str(media.get("defaultVideoModel") or "").strip()
        except Exception:
            pass

        actual_model = str(args.get("model") or "").strip() or default_model or str(spec.model or "").strip()
        if not actual_model:
            raise RuntimeError("No model selected. Please configure a model in Settings.")

        base = normalize_base_url(spec.base_url)
        candidates = [base + "/videos/generations", base + "/video/generations"]
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if str(spec.api_key or "").strip():
            headers["Authorization"] = _auth_header_value(spec.api_key)

        last_err: Optional[Exception] = None
        res: Optional[Dict[str, Any]] = None
        for u in candidates:
            try:
                payload: Dict[str, Any] = {"model": actual_model, "prompt": prompt, "response_format": "b64_json"}
                res = _http_post_json(url=u, payload=payload, headers=headers, proxy_url=spec.proxy_url, timeout_s=300)
                last_err = None
                break
            except Exception as e:
                last_err = e
                continue
        if res is None:
            raise RuntimeError(str(last_err) if last_err else "Video generation failed")

        data = res.get("data")
        item = data[0] if isinstance(data, list) and data else None
        if not isinstance(item, dict):
            raise RuntimeError("Video generation returned no data")

        raw_bytes: bytes = b""
        mime = "video/mp4"
        if isinstance(item.get("b64_json"), str) and item.get("b64_json").strip():
            try:
                raw_bytes = base64.b64decode(item.get("b64_json"), validate=False)
            except Exception:
                raise RuntimeError("Failed to decode video bytes")
        elif isinstance(item.get("url"), str) and item.get("url").strip():
            raw_bytes, ct = _download_public_url_bytes(url=str(item.get("url")), timeout_s=300, max_bytes=200 * 1024 * 1024)
            if ct:
                mime = ct
        else:
            raise RuntimeError("Video generation returned no bytes")

        if len(raw_bytes) > (200 * 1024 * 1024):
            raise RuntimeError("Video too large")

        rel_path = str(args.get("path") or "").strip()
        if rel_path:
            target = norm_abs(str(Path(workspace_dir) / rel_path))
            if not _is_path_allowed(target, workspace_dir, args):
                raise RuntimeError("Path outside workspace")
            if not re.search(r"\.(mp4|webm|mov)$", str(target).lower()):
                target = target + ".mp4"
        else:
            out_dir = Path(workspace_dir) / ".anima" / "artifacts"
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            target = norm_abs(str(out_dir / f"video_{ts}.mp4"))

        with open(target, "wb") as f:
            f.write(raw_bytes)
        if not os.path.isfile(target):
            raise RuntimeError("Video file not created")

        rel = str(Path(target).resolve().relative_to(Path(workspace_dir).resolve()))
        if not mime:
            mime = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        return json.dumps(
            {"ok": True, "artifacts": [{"kind": "video", "path": rel, "mime": mime, "title": str(Path(rel).name)}]},
            ensure_ascii=False,
        )

    if name == "bash":
        cmd = str(args.get("command") or "").strip()
        if not cmd:
            raise RuntimeError("command is required")
        if len(cmd) > 8000:
            raise RuntimeError("command too long")

        permission_mode = _resolve_permission_mode(args)
        lowered = cmd.lower()
        if permission_mode != "full_access":
            blocked, allowed = _resolve_command_safety_settings()
            bypass = set()
            raw_bypass = args.get("_animaDangerousCommandApprovals")
            if isinstance(raw_bypass, list):
                for item in raw_bypass:
                    s = str(item or "").strip().lower()
                    if s:
                        bypass.add(s)
            allow_for_thread = bool(args.get("_animaDangerousCommandAllowForThread"))
            if not allow_for_thread and lowered not in bypass:
                hit_block = _matches_any_command(lowered, blocked)
                hit_allow = _matches_any_command(lowered, allowed)
                hit_redirect = bool(re.search(r"(>|>>|<|<<)", lowered))
                if (hit_block and not hit_allow) or (hit_redirect and not hit_allow):
                    payload = {
                        "code": "dangerous_command_requires_approval",
                        "command": cmd,
                        "matchedPattern": hit_block or "redirect",
                    }
                    raise RuntimeError("ANIMA_DANGEROUS_COMMAND_APPROVAL:" + json.dumps(payload, ensure_ascii=False))

        workspace_roots = _resolve_workspace_roots(args, workspace_dir)
        base_cwd = workspace_roots[0] if workspace_roots else (norm_abs(workspace_dir) if workspace_dir else norm_abs(str(Path.home())))
        raw_cwd = str(args.get("cwd") or "").strip()
        target = norm_abs(str(Path(base_cwd) / raw_cwd)) if raw_cwd and not os.path.isabs(raw_cwd) else norm_abs(raw_cwd or base_cwd)
        if permission_mode == "full_access":
            run_cwd = target
        else:
            allowed_roots = [ANIMA_COMMAND_WHITELIST_ROOT, *workspace_roots, base_cwd]
            if not any(is_within(root, target) for root in allowed_roots):
                raise RuntimeError("cwd outside allowed directory")
            run_cwd = target

        timeout_ms = int(args.get("timeoutMs") or 20000)
        out = run_bash_with_os_sandbox(
            command=cmd,
            cwd=run_cwd,
            timeout_ms=timeout_ms,
            permission_mode=permission_mode,
            workspace_dir=base_cwd,
            allowed_roots=[ANIMA_COMMAND_WHITELIST_ROOT, *workspace_roots],
            env=safe_env(),
            max_chars=20000,
        )
        return json.dumps(out, ensure_ascii=False)

    if name == "list_dir":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        path = str(args.get("path") or "").strip()
        max_entries = int(args.get("maxEntries") or 200)
        target = norm_abs(str(Path(workspace_dir) / path))
        if not _is_path_allowed(target, workspace_dir, args):
            raise RuntimeError("Path outside workspace")
        p = Path(target)
        if not p.exists() or not p.is_dir():
            raise RuntimeError("Directory not found")
        entries = []
        for i, e in enumerate(sorted(p.iterdir(), key=lambda x: x.name)):
            if i >= max(1, max_entries):
                break
            entries.append({"name": e.name, "type": "dir" if e.is_dir() else "file"})
        return json.dumps({"entries": entries}, ensure_ascii=False)

    if name == "read_file":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        path = str(args.get("path") or "").strip()
        max_bytes = int(args.get("maxBytes") or MAX_FILE_BYTES_TOOL)
        target = norm_abs(str(Path(workspace_dir) / path))
        if not _is_path_allowed(target, workspace_dir, args):
            raise RuntimeError("Path outside workspace")
        text, meta = read_text_file(target, max_bytes=max_bytes)
        return json.dumps({"meta": meta, "text": text}, ensure_ascii=False)

    if name == "apply_patch":
        patch_text = str(args.get("patch") or "")
        if not patch_text.strip():
            raise RuntimeError("patch is required")
        out = _execute_freeform_patch(patch_text, workspace_dir, args)
        return json.dumps(out, ensure_ascii=False)

    if name == "rg_search":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        pattern = str(args.get("pattern") or "").strip()
        if not pattern:
            return json.dumps({"matches": []}, ensure_ascii=False)
        glob = str(args.get("glob") or "").strip()
        max_matches = int(args.get("maxMatches") or 200)
        max_matches = max(1, min(2000, max_matches))
        cmd = ["rg", "--no-heading", "--line-number", "--color", "never", pattern, workspace_dir]
        if glob:
            cmd.extend(["--glob", glob])
        try:
            out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=12)
            if out.returncode not in (0, 1):
                raise RuntimeError(out.stderr.strip() or "rg failed")
            lines = [ln for ln in (out.stdout or "").splitlines() if ln.strip()]
            matches = []
            for ln in lines[:max_matches]:
                parts = ln.split(":", 2)
                if len(parts) != 3:
                    continue
                fp, lno, txt = parts
                try:
                    rel = str(Path(fp).resolve().relative_to(Path(workspace_dir).resolve()))
                except Exception:
                    rel = fp
                matches.append({"path": rel, "line": int(lno) if lno.isdigit() else lno, "text": txt})
            return json.dumps({"matches": matches}, ensure_ascii=False)
        except FileNotFoundError:
            matches = []
            root = Path(workspace_dir)
            rx = re.compile(pattern)
            for p in root.rglob("*"):
                if not p.is_file():
                    continue
                relp = str(p.relative_to(root))
                if glob and not Path(relp).match(glob):
                    continue
                try:
                    txt, _ = read_text_file(str(p), max_bytes=128 * 1024)
                except Exception:
                    continue
                for i, line in enumerate(txt.splitlines(), start=1):
                    if rx.search(line):
                        matches.append({"path": relp, "line": i, "text": line[:400]})
                        if len(matches) >= max_matches:
                            return json.dumps({"matches": matches}, ensure_ascii=False)
            return json.dumps({"matches": matches}, ensure_ascii=False)

    if name in ("cron_list", "cron_upsert", "cron_delete", "cron_run"):
        from .settings import load_settings

        settings_obj = load_settings()
        s = settings_obj.get("settings")
        if not isinstance(s, dict):
            s = {}
        cron = s.get("cron")
        if not isinstance(cron, dict):
            cron = {}
        if not bool(cron.get("allowAgentManage")):
            raise RuntimeError("cron tools disabled")

        from anima_backend_core import cron as cron_mod

        if name == "cron_list":
            store = cron_mod.cron_list_store()
            return json.dumps({"ok": True, "store": store}, ensure_ascii=False)

        if name == "cron_upsert":
            job = args.get("job")
            if not isinstance(job, dict):
                raise RuntimeError("job must be an object")
            saved = cron_mod.cron_upsert_job(job)
            return json.dumps({"ok": True, "job": saved}, ensure_ascii=False)

        if name == "cron_delete":
            jid = str(args.get("id") or "").strip()
            if not jid:
                raise RuntimeError("id is required")
            deleted = bool(cron_mod.cron_delete_job(jid))
            return json.dumps({"ok": True, "deleted": deleted}, ensure_ascii=False)

        jid = str(args.get("id") or "").strip()
        if not jid:
            raise RuntimeError("id is required")
        ran = bool(cron_mod.cron_run_job(jid))
        return json.dumps({"ok": True, "ran": ran}, ensure_ascii=False)

    raise RuntimeError("Unknown tool")


def execute_mcp_tool(tool_name: str, args: Dict[str, Any], index: Dict[str, Dict[str, Any]]) -> str:
    meta = index.get(tool_name)
    if not meta:
        raise RuntimeError("MCP tool not found")
    base = str(meta.get("serverUrl") or "").rstrip("/")
    tool_id = str(meta.get("toolId") or "").strip()
    if not base or not tool_id:
        raise RuntimeError("MCP tool not found")
    res = http_json(base + "/call", method="POST", payload={"toolId": tool_id, "args": args}, timeout=20)
    return json.dumps(res, ensure_ascii=False)
