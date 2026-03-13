import json
import os
import re
import subprocess
import sys
import base64
import mimetypes
import time
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


def _resolve_permission_mode(args: Dict[str, Any]) -> str:
    mode = str(args.get("_animaPermissionMode") or "workspace_whitelist").strip()
    return "full_access" if mode == "full_access" else "workspace_whitelist"


def _is_path_allowed(target: str, workspace_dir: str, args: Dict[str, Any]) -> bool:
    if _resolve_permission_mode(args) == "full_access":
        return True
    roots: List[str] = [ANIMA_COMMAND_WHITELIST_ROOT]
    wdir = str(workspace_dir or "").strip()
    if wdir:
        roots.insert(0, norm_abs(wdir))
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
                "name": "edit_file",
                "description": "Edit an existing workspace text file using literal search/replace edits. Preferred for modifying files. Returns a diff.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "edits": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "search": {"type": "string"},
                                    "replace": {"type": "string"},
                                    "expectedCount": {"type": "integer"},
                                },
                                "required": ["search", "replace"],
                            },
                        },
                    },
                    "required": ["path", "edits"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write full content to a workspace file (overwrites existing). Use edit_file for targeted modifications. Returns a diff.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                    "required": ["path", "content"],
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
        {
            "type": "function",
            "function": {
                "name": "update_app_state",
                "description": "Update application configuration and UI state based on user needs, emotion, or workflow context. Handles both persistent settings (Config) and transient UI state (UI).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "config": {
                            "type": "object",
                            "description": "Persistent configuration changes (e.g. theme, language). Only whitelisted fields allowed.",
                            "properties": {
                                "theme": {"type": "string", "enum": ["light", "dark", "system"]},
                                "themeColor": {
                                    "type": "string",
                                    "enum": ["zinc", "red", "rose", "orange", "green", "blue", "yellow", "violet"],
                                    "description": "Color theme. Use orange/rose for sadness, green for anxiety, blue/zinc for focus.",
                                },
                                "language": {"type": "string"},
                                "density": {
                                    "type": "string",
                                    "enum": ["comfortable", "compact"],
                                    "description": "Layout density. Use comfortable for relaxation, compact for focus.",
                                },
                                "sidebarCollapsed": {"type": "boolean"},
                            },
                        },
                        "ui": {
                            "type": "object",
                            "description": "Transient UI state changes (e.g. open sidebar).",
                            "properties": {
                                "rightSidebarOpen": {
                                    "type": "boolean",
                                    "description": "Open/close right sidebar. Open for previewing generated content.",
                                },
                                "activeRightPanel": {
                                    "type": "string",
                                    "enum": ["files", "git", "terminal", "preview"],
                                    "description": "Active panel in right sidebar. Use 'preview' for content, 'files' for exploring.",
                                },
                            },
                        },
                    },
                },
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


def execute_builtin_tool(name: str, args: Dict[str, Any], workspace_dir: str) -> str:
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

        base_cwd = norm_abs(workspace_dir) if workspace_dir else norm_abs(str(Path.home()))
        raw_cwd = str(args.get("cwd") or "").strip()
        target = norm_abs(str(Path(base_cwd) / raw_cwd)) if raw_cwd and not os.path.isabs(raw_cwd) else norm_abs(raw_cwd or base_cwd)
        if permission_mode == "full_access":
            run_cwd = target
        else:
            allowed_roots = [ANIMA_COMMAND_WHITELIST_ROOT, base_cwd]
            if not any(is_within(root, target) for root in allowed_roots):
                raise RuntimeError("cwd outside allowed directory")
            run_cwd = target

        timeout_ms = int(args.get("timeoutMs") or 20000)
        timeout_ms = max(1000, min(timeout_ms, 120000))

        p = subprocess.run(
            ["/bin/bash", "-c", cmd],
            cwd=run_cwd,
            capture_output=True,
            text=True,
            env=safe_env(),
            timeout=timeout_ms / 1000.0,
        )
        stdout = p.stdout or ""
        stderr = p.stderr or ""

        max_chars = 20000
        out_trunc = len(stdout) > max_chars
        err_trunc = len(stderr) > max_chars
        if out_trunc:
            stdout = stdout[:max_chars]
        if err_trunc:
            stderr = stderr[:max_chars]

        return json.dumps(
            {
                "ok": True,
                "exitCode": int(p.returncode),
                "stdout": stdout,
                "stderr": stderr,
                "truncated": {"stdout": out_trunc, "stderr": err_trunc},
                "cwd": run_cwd,
            },
            ensure_ascii=False,
        )

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

    if name == "edit_file":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        path = str(args.get("path") or "").strip()
        edits = args.get("edits")
        if not isinstance(edits, list) or not edits:
            raise RuntimeError("edits is required")
        target = norm_abs(str(Path(workspace_dir) / path))
        if not _is_path_allowed(target, workspace_dir, args):
            raise RuntimeError("Path outside workspace")

        old_content, meta = read_text_file(target, max_bytes=MAX_FILE_BYTES_TOOL)
        if meta.get("truncated"):
            raise RuntimeError("File too large to edit with edit_file")

        new_content = old_content
        applied: List[Dict[str, Any]] = []
        for i, e in enumerate(edits):
            if not isinstance(e, dict):
                raise RuntimeError(f"edits[{i}] must be an object")
            search = str(e.get("search") or "")
            replace = str(e.get("replace") or "")
            if not search:
                raise RuntimeError(f"edits[{i}].search is required")
            expected = e.get("expectedCount")
            try:
                expected_n = int(expected) if expected is not None else 1
            except Exception:
                expected_n = 1
            if expected_n < 1:
                raise RuntimeError(f"edits[{i}].expectedCount must be >= 1")
            found = new_content.count(search)
            if found != expected_n:
                raise RuntimeError(f"edits[{i}] search occurrences {found} != expected {expected_n}")
            new_content = new_content.replace(search, replace)
            applied.append({"index": i, "replacements": found})

        if new_content != old_content:
            with open(target, "w", encoding="utf-8") as f:
                f.write(new_content)

        return json.dumps(
            {
                "ok": True,
                "changed": new_content != old_content,
                "applied": applied,
                "diffs": [{"path": path, "oldContent": old_content, "newContent": new_content}],
            },
            ensure_ascii=False,
        )

    if name == "write_file":
        if not workspace_dir:
            raise RuntimeError("No workspace directory selected")
        path = str(args.get("path") or "").strip()
        content = str(args.get("content") or "")
        target = norm_abs(str(Path(workspace_dir) / path))
        if not _is_path_allowed(target, workspace_dir, args):
            raise RuntimeError("Path outside workspace")

        old_content = ""
        try:
            if Path(target).exists() and Path(target).is_file():
                old_content, _ = read_text_file(target, max_bytes=MAX_FILE_BYTES_TOOL)
        except Exception:
            pass

        Path(target).parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(content)

        return json.dumps({"ok": True, "diffs": [{"path": path, "oldContent": old_content, "newContent": content}]}, ensure_ascii=False)

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

        from anima_backend_lg import cron as cron_mod

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

    if name == "update_app_state":
        config = args.get("config")
        ui = args.get("ui")
        return json.dumps({"ok": True, "config": config, "ui": ui}, ensure_ascii=False)

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
