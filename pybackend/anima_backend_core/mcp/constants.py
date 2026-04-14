from __future__ import annotations

MCP_CONFIG_VERSION = "1"
MCP_PROTOCOL_VERSION = "2025-11-05"
DEFAULT_REQUEST_TIMEOUT_MS = 20000
DEFAULT_STARTUP_TIMEOUT_MS = 15000
MAX_REQUEST_TIMEOUT_MS = 300000
MIN_REQUEST_TIMEOUT_MS = 1000

SUPPORTED_SERVER_TYPES = {"stdio", "http", "sse"}
SENSITIVE_KEYWORDS = ("token", "secret", "password", "apikey", "api_key", "authorization")
