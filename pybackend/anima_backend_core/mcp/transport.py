from __future__ import annotations

from typing import Any, Dict, Protocol


class McpTransport(Protocol):
    def request(self, method: str, params: Dict[str, Any] | None = None, *, timeout_ms: int) -> Dict[str, Any]:
        ...

    def notify(self, method: str, params: Dict[str, Any] | None = None) -> None:
        ...

    def close(self) -> None:
        ...
