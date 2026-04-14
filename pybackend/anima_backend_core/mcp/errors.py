from __future__ import annotations


class McpError(RuntimeError):
    pass


class McpConfigError(McpError):
    pass


class McpTransportError(McpError):
    pass


class McpProtocolError(McpError):
    pass


class McpValidationError(McpError):
    def __init__(self, errors: list[dict]):
        super().__init__("Invalid MCP configuration")
        self.errors = errors
