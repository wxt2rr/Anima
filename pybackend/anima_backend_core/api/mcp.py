from __future__ import annotations

from http import HTTPStatus
from typing import Any, Dict

from anima_backend_shared.http import json_response, read_body_json

from ..mcp import get_mcp_runtime_manager
from ..mcp.errors import McpConfigError, McpValidationError


def _scope_and_workspace(handler: Any, body: Dict[str, Any] | None = None) -> tuple[str, str]:
    q = getattr(handler, "query", None) or {}
    b = body if isinstance(body, dict) else {}
    scope = str(b.get("scope") or q.get("scope") or "user").strip().lower() or "user"
    workspace_dir = str(b.get("workspaceDir") or q.get("workspaceDir") or "").strip()
    return scope, workspace_dir


def handle_get_mcp_config(handler: Any) -> None:
    try:
        scope, workspace_dir = _scope_and_workspace(handler)
        mgr = get_mcp_runtime_manager()
        out = mgr.get_config(scope=scope, workspace_dir=workspace_dir)
        json_response(handler, HTTPStatus.OK, {"ok": True, **out})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_put_mcp_config(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return

        scope, workspace_dir = _scope_and_workspace(handler, body)
        text = body.get("text")
        config = body.get("config")

        mgr = get_mcp_runtime_manager()
        saved = mgr.save_config(
            scope=scope,
            workspace_dir=workspace_dir,
            text=str(text) if isinstance(text, str) else None,
            config=config if isinstance(config, dict) else None,
        )
        json_response(handler, HTTPStatus.OK, {"ok": True, "scope": scope, **saved})
    except McpValidationError as e:
        json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "validation_failed", "errors": e.errors})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_mcp_validate(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            body = {}
        text = body.get("text")
        config = body.get("config")

        mgr = get_mcp_runtime_manager()
        out = mgr.validate(
            text=str(text) if isinstance(text, str) else None,
            config=config if isinstance(config, dict) else None,
        )
        status = HTTPStatus.OK if bool(out.get("ok")) else HTTPStatus.BAD_REQUEST
        json_response(handler, status, out)
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_mcp_server_test(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return

        scope, workspace_dir = _scope_and_workspace(handler, body)
        server_id = str(body.get("serverId") or "").strip()
        input_values = body.get("inputValues")
        if not isinstance(input_values, dict):
            input_values = {}

        mgr = get_mcp_runtime_manager()
        out = mgr.test_server(
            scope=scope,
            workspace_dir=workspace_dir,
            server_id=server_id,
            input_values={str(k): str(v) for k, v in input_values.items()},
        )
        json_response(handler, HTTPStatus.OK, {"ok": True, "scope": scope, "workspaceDir": workspace_dir, "result": out})
    except McpConfigError as e:
        json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(e)})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_mcp_server_catalog(handler: Any, server_id: str) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        scope = str(q.get("scope") or "user").strip().lower() or "user"
        workspace_dir = str(q.get("workspaceDir") or "").strip()

        mgr = get_mcp_runtime_manager()
        out = mgr.get_catalog(scope=scope, workspace_dir=workspace_dir, server_id=server_id, input_values={})
        json_response(handler, HTTPStatus.OK, {"ok": True, "scope": scope, "workspaceDir": workspace_dir, "catalog": out})
    except McpConfigError as e:
        json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(e)})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_mcp_server_close(handler: Any, server_id: str) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            body = {}
        scope, workspace_dir = _scope_and_workspace(handler, body)
        mgr = get_mcp_runtime_manager()
        closed = mgr.close_server(scope=scope, workspace_dir=workspace_dir, server_id=server_id)
        json_response(handler, HTTPStatus.OK, {"ok": True, "closed": bool(closed)})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
