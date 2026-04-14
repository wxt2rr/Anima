from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .config import (
    DEFAULT_MCP_CONFIG,
    choose_config_path,
    load_config_from_file,
    normalize_and_validate_config,
    parse_config_text,
    save_config_to_file,
)
from .errors import McpConfigError, McpValidationError
from .resolver import VariableResolver
from .session import McpSession


class McpRuntimeManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._sessions: Dict[Tuple[Path, str], McpSession] = {}

    def _load_config(self, *, scope: str = "user", workspace_dir: str = "") -> Tuple[Path, Dict[str, Any]]:
        path = choose_config_path(scope, workspace_dir)
        cfg = load_config_from_file(path)
        return path, cfg

    def get_config(self, *, scope: str = "user", workspace_dir: str = "") -> Dict[str, Any]:
        path, cfg = self._load_config(scope=scope, workspace_dir=workspace_dir)
        return {"path": str(path), "config": cfg, "scope": scope}

    def validate(self, *, text: Optional[str] = None, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        obj: Any = config
        parse_errors = []
        if text is not None:
            obj, parse_errors = parse_config_text(text)
            if parse_errors:
                return {"ok": False, "errors": parse_errors, "normalized": dict(DEFAULT_MCP_CONFIG)}
        normalized, errors = normalize_and_validate_config(obj if obj is not None else {})
        return {"ok": len(errors) == 0, "errors": errors, "normalized": normalized}

    def save_config(
        self,
        *,
        scope: str,
        workspace_dir: str,
        text: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        validated = self.validate(text=text, config=config)
        if not bool(validated.get("ok")):
            raise McpValidationError(validated.get("errors") if isinstance(validated.get("errors"), list) else [])

        path = choose_config_path(scope, workspace_dir)
        normalized = validated.get("normalized") if isinstance(validated.get("normalized"), dict) else dict(DEFAULT_MCP_CONFIG)
        save_config_to_file(path, normalized)

        with self._lock:
            dead_keys = [k for k in self._sessions if k[0] == path]
            for key in dead_keys:
                session = self._sessions.pop(key, None)
                if session is not None:
                    session.close()

        return {"path": str(path), "config": normalized}

    def _resolve_server(
        self,
        *,
        scope: str,
        workspace_dir: str,
        server_id: str,
        input_values: Optional[Dict[str, str]] = None,
    ) -> Tuple[Path, Dict[str, Any], Dict[str, Any], VariableResolver]:
        path, cfg = self._load_config(scope=scope, workspace_dir=workspace_dir)
        servers = cfg.get("mcpServers") if isinstance(cfg.get("mcpServers"), dict) else {}
        sid = str(server_id or "").strip()
        if not sid:
            raise McpConfigError("serverId is required")
        server_cfg = servers.get(sid)
        if not isinstance(server_cfg, dict):
            raise McpConfigError(f"MCP server not found: {sid}")
        resolver = VariableResolver(inputs=input_values or {})
        return path, cfg, server_cfg, resolver

    def _get_or_create_session(
        self,
        *,
        path: Path,
        server_id: str,
        server_cfg: Dict[str, Any],
        resolver: VariableResolver,
    ) -> McpSession:
        key = (path, server_id)
        with self._lock:
            old = self._sessions.get(key)
            if old is not None:
                return old
            session = McpSession(server_id=server_id, server_config=server_cfg, resolver=resolver)
            self._sessions[key] = session
            return session

    def test_server(
        self,
        *,
        scope: str,
        workspace_dir: str,
        server_id: str,
        input_values: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        path, _cfg, server_cfg, resolver = self._resolve_server(
            scope=scope,
            workspace_dir=workspace_dir,
            server_id=server_id,
            input_values=input_values,
        )
        if not bool(server_cfg.get("trust")):
            raise McpConfigError(f"MCP server `{server_id}` is not trusted")

        session = self._get_or_create_session(path=path, server_id=server_id, server_cfg=server_cfg, resolver=resolver)
        init = session.initialize()
        tools = session.list_tools()
        resources = session.list_resources()
        templates = session.list_resource_templates()
        prompts = session.list_prompts()
        return {
            "serverId": server_id,
            "initialize": init,
            "counts": {
                "tools": len(tools),
                "resources": len(resources),
                "resourceTemplates": len(templates),
                "prompts": len(prompts),
            },
        }

    def list_tool_contracts(
        self,
        *,
        scope: str,
        workspace_dir: str,
        input_values: Optional[Dict[str, str]] = None,
        enabled_server_ids: Optional[list[str]] = None,
    ) -> tuple[list[dict], dict[str, dict[str, Any]]]:
        path, cfg = self._load_config(scope=scope, workspace_dir=workspace_dir)
        servers = cfg.get("mcpServers") if isinstance(cfg.get("mcpServers"), dict) else {}
        enabled_filter = set([str(x).strip() for x in (enabled_server_ids or []) if str(x).strip()])
        tools: list[dict] = []
        index: dict[str, dict[str, Any]] = {}
        for sid, server_cfg in servers.items():
            server_id = str(sid or "").strip()
            if not server_id or not isinstance(server_cfg, dict):
                continue
            if enabled_filter and server_id not in enabled_filter:
                continue
            if not bool(server_cfg.get("enabled")):
                continue
            if not bool(server_cfg.get("trust")):
                continue
            try:
                resolver = VariableResolver(inputs=input_values or {})
                session = self._get_or_create_session(path=path, server_id=server_id, server_cfg=server_cfg, resolver=resolver)
                server_tools = session.list_tools()
            except Exception:
                continue
            for item in server_tools:
                if not isinstance(item, dict):
                    continue
                tool_name = str(item.get("name") or "").strip()
                if not tool_name:
                    continue
                contract_name = f"mcp__{server_id}__{tool_name}"
                params = item.get("inputSchema")
                if not isinstance(params, dict):
                    params = item.get("parameters")
                if not isinstance(params, dict):
                    params = {"type": "object", "properties": {}}
                desc = str(item.get("description") or f"MCP tool {tool_name}").strip()
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": contract_name,
                            "description": desc,
                            "parameters": params,
                        },
                    }
                )
                index[contract_name] = {
                    "serverId": server_id,
                    "toolName": tool_name,
                    "scope": scope,
                    "workspaceDir": workspace_dir,
                }
        return tools, index

    def call_tool(
        self,
        *,
        scope: str,
        workspace_dir: str,
        server_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        input_values: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        path, _cfg, server_cfg, resolver = self._resolve_server(
            scope=scope,
            workspace_dir=workspace_dir,
            server_id=server_id,
            input_values=input_values,
        )
        if not bool(server_cfg.get("trust")):
            raise McpConfigError(f"MCP server `{server_id}` is not trusted")
        if not bool(server_cfg.get("enabled")):
            raise McpConfigError(f"MCP server `{server_id}` is not enabled")
        session = self._get_or_create_session(path=path, server_id=server_id, server_cfg=server_cfg, resolver=resolver)
        return session.call_tool(tool_name, arguments or {})

    def call_tool_by_contract(
        self,
        *,
        contract_name: str,
        arguments: Dict[str, Any],
        index: Dict[str, Dict[str, Any]],
        input_values: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        meta = index.get(str(contract_name or "").strip())
        if not isinstance(meta, dict):
            raise McpConfigError("MCP tool not found")
        server_id = str(meta.get("serverId") or "").strip()
        tool_name = str(meta.get("toolName") or "").strip()
        scope = str(meta.get("scope") or "user").strip() or "user"
        workspace_dir = str(meta.get("workspaceDir") or "").strip()
        if not server_id or not tool_name:
            raise McpConfigError("MCP tool not found")
        return self.call_tool(
            scope=scope,
            workspace_dir=workspace_dir,
            server_id=server_id,
            tool_name=tool_name,
            arguments=arguments or {},
            input_values=input_values,
        )

    def get_catalog(
        self,
        *,
        scope: str,
        workspace_dir: str,
        server_id: str,
        input_values: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        path, _cfg, server_cfg, resolver = self._resolve_server(
            scope=scope,
            workspace_dir=workspace_dir,
            server_id=server_id,
            input_values=input_values,
        )
        if not bool(server_cfg.get("trust")):
            raise McpConfigError(f"MCP server `{server_id}` is not trusted")

        session = self._get_or_create_session(path=path, server_id=server_id, server_cfg=server_cfg, resolver=resolver)
        return session.catalog()

    def close_server(self, *, scope: str, workspace_dir: str, server_id: str) -> bool:
        path = choose_config_path(scope, workspace_dir)
        key = (path, str(server_id or "").strip())
        with self._lock:
            session = self._sessions.pop(key, None)
        if session is None:
            return False
        session.close()
        return True


_MANAGER = McpRuntimeManager()


def get_mcp_runtime_manager() -> McpRuntimeManager:
    return _MANAGER
