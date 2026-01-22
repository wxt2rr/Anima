import json
import os
import re
import subprocess
import sys
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
                "name": "mac_reminders_create",
                "description": "Create a reminder in the macOS Reminders app.",
                "parameters": {
                    "type": "object",
                    "properties": {"title": {"type": "string"}, "notes": {"type": "string"}, "listName": {"type": "string"}, "dueAt": {"type": "string"}},
                    "required": ["title"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mac_reminders_list",
                "description": "List reminders in the macOS Reminders app.",
                "parameters": {
                    "type": "object",
                    "properties": {"listName": {"type": "string"}, "status": {"type": "string", "enum": ["open", "completed", "all"]}, "limit": {"type": "integer"}},
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mac_reminders_complete",
                "description": "Mark a reminder as completed in the macOS Reminders app.",
                "parameters": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "listName": {"type": "string"}}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mac_notes_create",
                "description": "Create a note in the macOS Notes app.",
                "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}, "folderName": {"type": "string"}}, "required": ["title", "body"]},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "mac_notes_append",
                "description": "Append text to a note in the macOS Notes app (matched by title).",
                "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "appendText": {"type": "string"}, "folderName": {"type": "string"}}, "required": ["title", "appendText"]},
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
                    "required": ["path", "content"]
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
                                    "description": "Color theme. Use orange/rose for sadness, green for anxiety, blue/zinc for focus."
                                },
                                "language": {"type": "string"},
                                "density": {
                                    "type": "string",
                                    "enum": ["comfortable", "compact"],
                                    "description": "Layout density. Use comfortable for relaxation, compact for focus."
                                },
                                "sidebarCollapsed": {"type": "boolean"}
                            }
                        },
                        "ui": {
                            "type": "object",
                            "description": "Transient UI state changes (e.g. open sidebar).",
                            "properties": {
                                "rightSidebarOpen": {
                                    "type": "boolean",
                                    "description": "Open/close right sidebar. Open for previewing generated content."
                                },
                                "activeRightPanel": {
                                    "type": "string",
                                    "enum": ["files", "git", "terminal", "preview"],
                                    "description": "Active panel in right sidebar. Use 'preview' for content, 'files' for exploring."
                                }
                            }
                        }
                    }
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "TodoWrite",
                "description": "Manage your (the assistant's) internal plan and progress. Use this to track your own execution steps. Do NOT use this to manage the user's personal todo list.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string", "description": "Unique identifier for the todo item"},
                                    "content": {"type": "string", "description": "Description of the todo item"},
                                    "status": {"type": "string", "enum": ["pending", "in_progress", "completed"], "description": "Current status"},
                                    "priority": {"type": "string", "enum": ["high", "medium", "low"], "description": "Priority level"}
                                },
                                "required": ["id", "content", "status", "priority"]
                            },
                            "description": "Array of todo items"
                        },
                        "merge": {
                            "type": "boolean",
                            "description": "Whether to merge with existing todos based on id. If false, replaces the list."
                        }
                    },
                    "required": ["todos", "merge"]
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

    if name == "bash":
        cmd = str(args.get("command") or "").strip()
        if not cmd:
            raise RuntimeError("command is required")
        if len(cmd) > 8000:
            raise RuntimeError("command too long")

        blocked = [
            r"(^|\s)sudo(\s|$)",
            r"(^|\s)rm(\s|$)",
            r"(^|\s)shutdown(\s|$)",
            r"(^|\s)reboot(\s|$)",
            r"(^|\s)halt(\s|$)",
            r"(^|\s)poweroff(\s|$)",
            r"(^|\s)killall(\s|$)",
            r"(^|\s)pkill(\s|$)",
            r"(^|\s)kill(\s|$)",
            r"(^|\s)launchctl(\s|$)",
            r"(^|\s)systemsetup(\s|$)",
            r"(^|\s)networksetup(\s|$)",
            r"(^|\s)curl(\s|$)",
            r"(^|\s)wget(\s|$)",
            r"(^|\s)ssh(\s|$)",
            r"(^|\s)scp(\s|$)",
            r"(^|\s)sftp(\s|$)",
            r"(>|>>|<|<<)",
        ]
        lowered = cmd.lower()
        for pat in blocked:
            if re.search(pat, lowered):
                raise RuntimeError("Blocked command for safety")

        base_cwd = workspace_dir or str(Path.home())
        raw_cwd = str(args.get("cwd") or "").strip()
        if raw_cwd:
            target = norm_abs(str(Path(base_cwd) / raw_cwd)) if not os.path.isabs(raw_cwd) else norm_abs(raw_cwd)
            if not is_within(base_cwd, target):
                raise RuntimeError("cwd outside allowed directory")
            run_cwd = target
        else:
            run_cwd = base_cwd

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
        if not is_within(workspace_dir, target):
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
        if not is_within(workspace_dir, target):
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
        if not is_within(workspace_dir, target):
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
        if not is_within(workspace_dir, target):
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
            
        return json.dumps({
            "ok": True,
            "diffs": [{
                "path": path,
                "oldContent": old_content,
                "newContent": content
            }]
        }, ensure_ascii=False)

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

    if name == "update_app_state":
        config = args.get("config")
        ui = args.get("ui")
        return json.dumps({
            "ok": True,
            "config": config,
            "ui": ui
        }, ensure_ascii=False)

    if name == "TodoWrite":
        todos = args.get("todos")
        if not isinstance(todos, list):
             raise RuntimeError("todos must be a list")
        merge = bool(args.get("merge"))
        return json.dumps({
            "ok": True,
            "todos": todos,
            "merge": merge
        }, ensure_ascii=False)

    if name.startswith("mac_"):
        if sys.platform != "darwin":
            raise RuntimeError("macOS tools are only supported on macOS")

        def run_osascript(script: str, argv: List[str]) -> str:
            p = subprocess.run(["osascript", "-e", script, *argv], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
            if p.returncode != 0:
                msg = (p.stderr or "").strip() or "osascript failed"
                raise RuntimeError(msg)
            return (p.stdout or "").strip()

        if name == "mac_reminders_create":
            title = str(args.get("title") or "").strip()
            if not title:
                raise RuntimeError("title is required")
            notes = str(args.get("notes") or "")
            list_name = str(args.get("listName") or "").strip()
            due_at = str(args.get("dueAt") or "").strip()
            delta_seconds = ""
            if due_at:
                s = due_at.replace("Z", "+00:00")
                try:
                    due_dt = datetime.fromisoformat(s)
                    now_local = datetime.now().astimezone()
                    if due_dt.tzinfo is None:
                        due_dt = due_dt.replace(tzinfo=now_local.tzinfo)
                    due_local = due_dt.astimezone(now_local.tzinfo)
                    delta_seconds = str(int((due_local - now_local).total_seconds()))
                except Exception:
                    raise RuntimeError("Invalid dueAt; expected ISO-8601 string")

            script = r'''
on run argv
  set t to item 1 of argv
  set n to item 2 of argv
  set listName to item 3 of argv
  set deltaStr to item 4 of argv
  if listName is "" then set listName to "Reminders"
  tell application "Reminders"
    if not (exists list listName) then
      make new list with properties {name:listName}
    end if
    set theList to list listName
    set r to make new reminder at end of reminders of theList with properties {name:t}
    if n is not "" then set body of r to n
    if deltaStr is not "" then
      set due date of r to (current date) + (deltaStr as integer)
    end if
    set rid to id of r
    return rid & "\t" & name of r
  end tell
end run
'''
            out = run_osascript(script, [title, notes, list_name, delta_seconds])
            rid, rtitle = (out.split("\t", 1) + [""])[:2]
            return json.dumps({"ok": True, "id": rid, "title": rtitle or title}, ensure_ascii=False)

        if name == "mac_reminders_list":
            list_name = str(args.get("listName") or "").strip()
            status = str(args.get("status") or "open").strip()
            if status not in ("open", "completed", "all"):
                status = "open"
            limit = int(args.get("limit") or 50)
            limit = max(1, min(200, limit))

            script = r'''
on run argv
  set listName to item 1 of argv
  set status to item 2 of argv
  set limitStr to item 3 of argv
  if listName is "" then set listName to "Reminders"
  set lim to (limitStr as integer)
  set resultList to {}
  tell application "Reminders"
    if not (exists list listName) then return ""
    set theList to list listName
    if status is "open" then
      set reminderItems to (reminders of theList whose completed is false)
    else if status is "completed" then
      set reminderItems to (reminders of theList whose completed is true)
    else
      set reminderItems to reminders of theList
    end if
    set c to 0
    repeat with r in reminderItems
      set c to c + 1
      if c > lim then exit repeat
      set rid to id of r
      set nm to name of r
      set comp to completed of r
      set dd to ""
      try
        set d to due date of r
        if d is not missing value then set dd to (d as string)
      end try
      set end of resultList to (rid & "\t" & nm & "\t" & (comp as string) & "\t" & dd)
    end repeat
  end tell
  set AppleScript's text item delimiters to "\n"
  return resultList as text
end run
'''
            raw = run_osascript(script, [list_name, status, str(limit)])
            items: List[Dict[str, Any]] = []
            if raw:
                for ln in raw.splitlines():
                    parts = ln.split("\t")
                    if len(parts) < 2:
                        continue
                    rid = parts[0]
                    nm = parts[1]
                    comp = parts[2] if len(parts) > 2 else "false"
                    dd = parts[3] if len(parts) > 3 else ""
                    items.append({"id": rid, "title": nm, "completed": comp.lower() == "true", "dueAtText": dd})
            return json.dumps({"ok": True, "items": items}, ensure_ascii=False)

        if name == "mac_reminders_complete":
            rid = str(args.get("id") or "").strip()
            title = str(args.get("title") or "").strip()
            list_name = str(args.get("listName") or "").strip()
            if not rid and not title:
                raise RuntimeError("id or title is required")

            script = r'''
on run argv
  set rid to item 1 of argv
  set ttl to item 2 of argv
  set listName to item 3 of argv
  if listName is "" then set listName to "Reminders"
  tell application "Reminders"
    if not (exists list listName) then return "NOT_FOUND"
    set theList to list listName
    set target to missing value
    if rid is not "" then
      try
        set target to first reminder of theList whose id is rid
      end try
    end if
    if target is missing value and ttl is not "" then
      try
        set target to first reminder of theList whose name is ttl
      end try
    end if
    if target is missing value then return "NOT_FOUND"
    set completed of target to true
    return "OK"
  end tell
end run
'''
            out = run_osascript(script, [rid, title, list_name])
            ok = out.strip() == "OK"
            if not ok:
                return json.dumps({"ok": False, "error": "Reminder not found"}, ensure_ascii=False)
            return json.dumps({"ok": True}, ensure_ascii=False)

        if name == "mac_notes_create":
            title = str(args.get("title") or "").strip()
            body = str(args.get("body") or "")
            folder_name = str(args.get("folderName") or "").strip()
            if not title:
                raise RuntimeError("title is required")
            if not body:
                raise RuntimeError("body is required")

            script = r'''
on run argv
  set ttl to item 1 of argv
  set bdy to item 2 of argv
  set folderName to item 3 of argv
  tell application "Notes"
    set acc to first account
    set theFolder to missing value
    if folderName is not "" then
      try
        set theFolder to first folder of acc whose name is folderName
      end try
      if theFolder is missing value then
        set theFolder to make new folder at acc with properties {name:folderName}
      end if
    else
      set theFolder to first folder of acc
    end if
    set n to make new note at theFolder with properties {name:ttl, body:bdy}
    set nid to ""
    try
      set nid to id of n
    end try
    return nid & "\t" & name of n
  end tell
end run
'''
            out = run_osascript(script, [title, body, folder_name])
            nid, nt = (out.split("\t", 1) + [""])[:2]
            return json.dumps({"ok": True, "id": nid, "title": nt or title}, ensure_ascii=False)

        if name == "mac_notes_append":
            title = str(args.get("title") or "").strip()
            append_text = str(args.get("appendText") or "")
            folder_name = str(args.get("folderName") or "").strip()
            if not title:
                raise RuntimeError("title is required")
            if not append_text:
                raise RuntimeError("appendText is required")

            script = r'''
on run argv
  set ttl to item 1 of argv
  set addText to item 2 of argv
  set folderName to item 3 of argv
  tell application "Notes"
    set acc to first account
    set target to missing value
    if folderName is not "" then
      try
        set f to first folder of acc whose name is folderName
        set target to first note of f whose name is ttl
      end try
    else
      repeat with f in folders of acc
        try
          set target to first note of f whose name is ttl
          exit repeat
        end try
      end repeat
    end if
    if target is missing value then return "NOT_FOUND"
    set oldBody to body of target
    set body of target to (oldBody & "<br/>" & addText)
    return "OK"
  end tell
end run
'''
            out = run_osascript(script, [title, append_text, folder_name])
            if out.strip() != "OK":
                return json.dumps({"ok": False, "error": "Note not found"}, ensure_ascii=False)
            return json.dumps({"ok": True}, ensure_ascii=False)

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
