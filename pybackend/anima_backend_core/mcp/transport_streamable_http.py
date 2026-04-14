from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .constants import MCP_PROTOCOL_VERSION
from .errors import McpProtocolError, McpTransportError


class StreamableHttpMcpTransport:
    def __init__(
        self,
        *,
        url: str,
        headers: Dict[str, str],
        request_timeout_ms: int,
    ) -> None:
        self._url = str(url or "").strip()
        self._headers = dict(headers or {})
        self._request_timeout_ms = max(1000, int(request_timeout_ms or 20000))
        self._next_id = 1
        self._session_id: Optional[str] = None
        self._protocol_version = MCP_PROTOCOL_VERSION
        self._notifications: List[Dict[str, Any]] = []

    def set_protocol_version(self, version: str) -> None:
        v = str(version or "").strip()
        if v:
            self._protocol_version = v

    def _next_request_id(self) -> int:
        rid = self._next_id
        self._next_id += 1
        return rid

    def _make_headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": self._protocol_version,
        }
        if self._session_id:
            headers["MCP-Session-Id"] = self._session_id
        for k, v in self._headers.items():
            headers[str(k)] = str(v)
        return headers

    def _parse_sse_messages(self, raw: str) -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        data_lines: List[str] = []
        for line in raw.splitlines():
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
                continue
            if line.strip() == "":
                if data_lines:
                    payload = "\n".join(data_lines).strip()
                    data_lines = []
                    if not payload:
                        continue
                    try:
                        obj = json.loads(payload)
                    except Exception:
                        continue
                    if isinstance(obj, dict):
                        events.append(obj)
                continue
        if data_lines:
            payload = "\n".join(data_lines).strip()
            if payload:
                try:
                    obj = json.loads(payload)
                except Exception:
                    obj = None
                if isinstance(obj, dict):
                    events.append(obj)
        return events

    def _do_post(self, payload: Dict[str, Any], timeout_ms: int) -> Dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            self._url,
            data=body,
            headers=self._make_headers(),
            method="POST",
        )
        timeout_s = max(1.0, float(timeout_ms or 0) / 1000.0)
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                self._session_id = str(resp.headers.get("MCP-Session-Id") or self._session_id or "") or None
                ct = str(resp.headers.get("Content-Type") or "").lower()
                raw = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            text = ""
            try:
                text = e.read().decode("utf-8", errors="replace")
            except Exception:
                text = str(e)
            raise McpTransportError(f"MCP HTTP error: status={e.code} body={text}") from e
        except urllib.error.URLError as e:
            raise McpTransportError(f"MCP HTTP connection failed: {e}") from e
        except Exception as e:
            raise McpTransportError(f"MCP HTTP request failed: {e}") from e

        if "text/event-stream" in ct:
            events = self._parse_sse_messages(raw)
            if events:
                return {"_sse": events}
            raise McpProtocolError("MCP SSE response contains no events")

        try:
            obj = json.loads(raw)
        except Exception as e:
            raise McpProtocolError(f"Invalid MCP HTTP JSON response: {e}") from e
        if not isinstance(obj, dict):
            raise McpProtocolError("Invalid MCP HTTP JSON response")
        return obj

    def request(self, method: str, params: Dict[str, Any] | None = None, *, timeout_ms: int) -> Dict[str, Any]:
        req_id = self._next_request_id()
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params or {},
        }
        obj = self._do_post(payload, timeout_ms or self._request_timeout_ms)

        if "_sse" in obj:
            events = obj.get("_sse") if isinstance(obj.get("_sse"), list) else []
            for evt in events:
                if not isinstance(evt, dict):
                    continue
                evt_id = evt.get("id")
                if evt_id == req_id:
                    err = evt.get("error")
                    if isinstance(err, dict):
                        raise McpProtocolError(f"MCP error: code={err.get('code')} message={err.get('message')}")
                    result = evt.get("result")
                    return result if isinstance(result, dict) else {}
                self._notifications.append(evt)
            raise McpProtocolError("MCP SSE response missing matched request id")

        err = obj.get("error")
        if isinstance(err, dict):
            raise McpProtocolError(f"MCP error: code={err.get('code')} message={err.get('message')}")

        if obj.get("id") != req_id:
            self._notifications.append(obj)
            raise McpProtocolError("MCP HTTP response request id mismatch")
        result = obj.get("result")
        return result if isinstance(result, dict) else {}

    def notify(self, method: str, params: Dict[str, Any] | None = None) -> None:
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {},
        }
        self._do_post(payload, self._request_timeout_ms)

    def pop_notifications(self) -> List[Dict[str, Any]]:
        out = list(self._notifications)
        self._notifications = []
        return out

    def close(self) -> None:
        self._notifications = []
