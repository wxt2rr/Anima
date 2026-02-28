from __future__ import annotations

import os
import time
import mimetypes
from pathlib import Path
from http import HTTPStatus
from typing import Any, Dict, List, Optional, Tuple

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import get_skills_content, list_skills, load_settings, open_folder, skills_dir
from anima_backend_shared.tools import builtin_tools, mcp_tools


def handle_get_settings(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, load_settings())
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
            from anima_backend_lg.telegram_integration import reconcile_telegram_from_settings

            if isinstance(merged, dict):
                reconcile_telegram_from_settings(merged)
        except Exception:
            pass
        try:
            from anima_backend_lg.cron import reconcile_cron_from_settings

            if isinstance(merged, dict):
                reconcile_cron_from_settings(merged)
        except Exception:
            pass
        try:
            from anima_backend_lg.runtime.graph import reconcile_openclaw_from_settings

            if isinstance(merged, dict):
                reconcile_openclaw_from_settings(merged)
        except Exception:
            pass
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


def handle_post_providers_fetch_models(handler: Any) -> None:
    from anima_backend_shared.providers import fetch_provider_models

    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        base_url = body.get("baseUrl")
        api_key = body.get("apiKey")
        if not base_url:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "baseUrl is required"})
            return
        models = fetch_provider_models(base_url, api_key or "")
        json_response(handler, HTTPStatus.OK, {"ok": True, "models": models})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
