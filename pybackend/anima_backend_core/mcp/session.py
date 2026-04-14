from __future__ import annotations

from typing import Any, Dict, List, Optional

from .constants import MCP_PROTOCOL_VERSION
from .errors import McpConfigError
from .resolver import VariableResolver
from .transport_stdio import StdioMcpTransport
from .transport_streamable_http import StreamableHttpMcpTransport


class McpSession:
    def __init__(
        self,
        *,
        server_id: str,
        server_config: Dict[str, Any],
        resolver: VariableResolver,
    ) -> None:
        self.server_id = str(server_id or "").strip()
        self.server_config = dict(server_config or {})
        self._resolver = resolver
        self._transport: Optional[StdioMcpTransport | StreamableHttpMcpTransport] = None
        self._initialized = False
        self._capabilities: Dict[str, Any] = {}
        self._server_info: Dict[str, Any] = {}
        self._protocol_version = MCP_PROTOCOL_VERSION

    def _build_transport(self) -> StdioMcpTransport | StreamableHttpMcpTransport:
        stype = str(self.server_config.get("type") or "").strip().lower()
        timeout_ms = int(self.server_config.get("requestTimeoutMs") or 20000)
        startup_timeout_ms = int(self.server_config.get("startupTimeoutMs") or 15000)

        if stype == "stdio":
            command = self._resolver.resolve_string(str(self.server_config.get("command") or ""))
            args = [self._resolver.resolve_string(str(x)) for x in (self.server_config.get("args") or [])]
            env = self._resolver.resolve_string_map(self.server_config.get("env") if isinstance(self.server_config.get("env"), dict) else {})
            if not command:
                raise McpConfigError(f"Missing command for MCP server: {self.server_id}")
            return StdioMcpTransport(command=command, args=args, env=env, startup_timeout_ms=startup_timeout_ms)

        if stype in ("http", "sse"):
            url = self._resolver.resolve_string(str(self.server_config.get("url") or ""))
            headers = self._resolver.resolve_string_map(self.server_config.get("headers") if isinstance(self.server_config.get("headers"), dict) else {})
            if not url:
                raise McpConfigError(f"Missing url for MCP server: {self.server_id}")
            return StreamableHttpMcpTransport(url=url, headers=headers, request_timeout_ms=timeout_ms)

        raise McpConfigError(f"Unsupported MCP server type: {stype}")

    @property
    def capabilities(self) -> Dict[str, Any]:
        return dict(self._capabilities)

    @property
    def server_info(self) -> Dict[str, Any]:
        return dict(self._server_info)

    def _ensure_transport(self) -> StdioMcpTransport | StreamableHttpMcpTransport:
        if self._transport is None:
            self._transport = self._build_transport()
        return self._transport

    def initialize(self) -> Dict[str, Any]:
        if self._initialized:
            return {"capabilities": self.capabilities, "serverInfo": self.server_info, "protocolVersion": self._protocol_version}

        transport = self._ensure_transport()
        init_result = transport.request(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {
                    "roots": {"listChanged": True},
                    "sampling": {},
                },
                "clientInfo": {
                    "name": "Anima",
                    "version": "0.1.0",
                },
            },
            timeout_ms=int(self.server_config.get("requestTimeoutMs") or 20000),
        )
        self._capabilities = init_result.get("capabilities") if isinstance(init_result.get("capabilities"), dict) else {}
        self._server_info = init_result.get("serverInfo") if isinstance(init_result.get("serverInfo"), dict) else {}
        protocol = str(init_result.get("protocolVersion") or "").strip()
        if protocol:
            self._protocol_version = protocol
            if isinstance(transport, StreamableHttpMcpTransport):
                transport.set_protocol_version(protocol)

        transport.notify("notifications/initialized", {})
        self._initialized = True
        return {
            "capabilities": self.capabilities,
            "serverInfo": self.server_info,
            "protocolVersion": self._protocol_version,
        }

    def _request(self, method: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
        self.initialize()
        transport = self._ensure_transport()
        return transport.request(method, params or {}, timeout_ms=int(self.server_config.get("requestTimeoutMs") or 20000))

    def list_tools(self) -> List[Dict[str, Any]]:
        result = self._request("tools/list", {})
        tools = result.get("tools") if isinstance(result.get("tools"), list) else []
        return [x for x in tools if isinstance(x, dict)]

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        return self._request("tools/call", {"name": str(name or "").strip(), "arguments": arguments or {}})

    def list_resources(self) -> List[Dict[str, Any]]:
        result = self._request("resources/list", {})
        items = result.get("resources") if isinstance(result.get("resources"), list) else []
        return [x for x in items if isinstance(x, dict)]

    def list_resource_templates(self) -> List[Dict[str, Any]]:
        result = self._request("resources/templates/list", {})
        items = result.get("resourceTemplates") if isinstance(result.get("resourceTemplates"), list) else []
        return [x for x in items if isinstance(x, dict)]

    def read_resource(self, uri: str) -> Dict[str, Any]:
        return self._request("resources/read", {"uri": str(uri or "").strip()})

    def list_prompts(self) -> List[Dict[str, Any]]:
        result = self._request("prompts/list", {})
        items = result.get("prompts") if isinstance(result.get("prompts"), list) else []
        return [x for x in items if isinstance(x, dict)]

    def get_prompt(self, name: str, arguments: Dict[str, Any] | None = None) -> Dict[str, Any]:
        return self._request("prompts/get", {"name": str(name or "").strip(), "arguments": arguments or {}})

    def catalog(self) -> Dict[str, Any]:
        self.initialize()
        tools = self.list_tools()
        resources = self.list_resources()
        resource_templates = self.list_resource_templates()
        prompts = self.list_prompts()
        return {
            "serverId": self.server_id,
            "protocolVersion": self._protocol_version,
            "serverInfo": self.server_info,
            "capabilities": self.capabilities,
            "tools": tools,
            "resources": resources,
            "resourceTemplates": resource_templates,
            "prompts": prompts,
        }

    def close(self) -> None:
        if self._transport is not None:
            self._transport.close()
        self._transport = None
        self._initialized = False
