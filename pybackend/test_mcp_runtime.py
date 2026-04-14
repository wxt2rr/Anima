import json
import os
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch


class _WFile:
    def __init__(self) -> None:
        self.buf = b""

    def write(self, b: bytes) -> None:
        self.buf += b

    def flush(self) -> None:
        return


class _Handler:
    def __init__(self, body_obj=None, *, query=None):
        body_bytes = b""
        if body_obj is not None:
            body_bytes = json.dumps(body_obj).encode("utf-8")
        self._body = body_bytes
        self.headers = {"Content-Length": str(len(body_bytes))}
        self.wfile = _WFile()
        self.query = query or {}
        self._code = 0

    def send_response(self, code) -> None:
        self._code = int(code)

    def send_header(self, _k, _v) -> None:
        return

    def end_headers(self) -> None:
        return

    def _read(self) -> bytes:
        return self._body


class McpRuntimeTests(unittest.TestCase):
    def _dispatch(self, method: str, path: str, body_obj=None, *, query=None):
        from anima_backend_core.api import dispatch

        h = _Handler(body_obj=body_obj, query=query)
        h.rfile = type("rf", (), {"read": lambda _self, n=-1: h._read()})()
        ok = dispatch(h, method, path)
        self.assertTrue(ok)
        raw = h.wfile.buf.decode("utf-8")
        out = json.loads(raw) if raw.strip() else {}
        return h._code, out

    def test_validate_config_rejects_plain_secret(self) -> None:
        from anima_backend_core.mcp.config import normalize_and_validate_config

        _normalized, errors = normalize_and_validate_config(
            {
                "version": "1",
                "mcpServers": {
                    "a": {
                        "type": "http",
                        "url": "https://example.com/mcp",
                        "headers": {"Authorization": "Bearer abc"},
                        "tools": ["*"],
                        "trust": True,
                    }
                },
            }
        )
        self.assertTrue(any(str(e.get("code") or "") == "insecure_secret_literal" for e in errors))

    def test_mcp_api_save_get_validate(self) -> None:
        td = tempfile.TemporaryDirectory()
        with td:
            with patch.dict(os.environ, {"HOME": td.name}, clear=False):
                put_code, put_out = self._dispatch(
                    "PUT",
                    "/api/mcp/config",
                    {
                        "scope": "user",
                        "config": {
                            "version": "1",
                            "inputs": [],
                            "mcpServers": {
                                "demo": {
                                    "type": "http",
                                    "url": "https://example.com/mcp",
                                    "tools": ["*"],
                                    "headers": {"Authorization": "Bearer ${env:DEMO_TOKEN}"},
                                    "trust": True,
                                    "enabled": True,
                                }
                            },
                        },
                    },
                )
                self.assertEqual(put_code, 200)
                self.assertTrue(bool(put_out.get("ok")))

                get_code, get_out = self._dispatch("GET", "/api/mcp/config", None, query={"scope": "user"})
                self.assertEqual(get_code, 200)
                self.assertTrue(bool(get_out.get("ok")))
                servers = ((get_out.get("config") or {}).get("mcpServers") or {})
                self.assertTrue("demo" in servers)

                bad_code, bad_out = self._dispatch(
                    "POST",
                    "/api/mcp/validate",
                    {
                        "config": {
                            "version": "1",
                            "mcpServers": {
                                "x": {
                                    "type": "stdio",
                                    "command": "python",
                                    "args": ["-m", "x"],
                                    "tools": [],
                                    "trust": True,
                                }
                            },
                        }
                    },
                )
                self.assertEqual(bad_code, 400)
                self.assertFalse(bool(bad_out.get("ok")))

    def test_stdio_server_test_endpoint(self) -> None:
        td = tempfile.TemporaryDirectory()
        with td:
            script_path = Path(td.name) / "mcp_mock.py"
            script_path.write_text(
                textwrap.dedent(
                    """
                    import json
                    import sys

                    for line in sys.stdin:
                        s = line.strip()
                        if not s:
                            continue
                        req = json.loads(s)
                        method = req.get("method")
                        rid = req.get("id")
                        if method == "notifications/initialized":
                            continue
                        if method == "initialize":
                            res = {
                                "jsonrpc": "2.0",
                                "id": rid,
                                "result": {
                                    "protocolVersion": "2025-11-05",
                                    "serverInfo": {"name": "mock", "version": "1.0"},
                                    "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
                                },
                            }
                        elif method == "tools/list":
                            res = {"jsonrpc": "2.0", "id": rid, "result": {"tools": [{"name": "echo", "description": "d", "inputSchema": {"type": "object"}}]}}
                        elif method == "resources/list":
                            res = {"jsonrpc": "2.0", "id": rid, "result": {"resources": []}}
                        elif method == "resources/templates/list":
                            res = {"jsonrpc": "2.0", "id": rid, "result": {"resourceTemplates": []}}
                        elif method == "prompts/list":
                            res = {"jsonrpc": "2.0", "id": rid, "result": {"prompts": []}}
                        else:
                            res = {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "not found"}}
                        sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\\n")
                        sys.stdout.flush()
                    """
                ).strip()
                + "\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {"HOME": td.name}, clear=False):
                put_code, _put_out = self._dispatch(
                    "PUT",
                    "/api/mcp/config",
                    {
                        "scope": "user",
                        "config": {
                            "version": "1",
                            "mcpServers": {
                                "local": {
                                    "type": "stdio",
                                    "command": sys.executable,
                                    "args": [str(script_path)],
                                    "env": {},
                                    "tools": ["*"],
                                    "trust": True,
                                    "enabled": True,
                                }
                            },
                        },
                    },
                )
                self.assertEqual(put_code, 200)

                test_code, test_out = self._dispatch(
                    "POST",
                    "/api/mcp/servers/test",
                    {
                        "scope": "user",
                        "serverId": "local",
                    },
                )
                self.assertEqual(test_code, 200)
                self.assertTrue(bool(test_out.get("ok")))
                counts = (((test_out.get("result") or {}).get("counts") or {}))
                self.assertEqual(int(counts.get("tools") or 0), 1)

                catalog_code, catalog_out = self._dispatch(
                    "GET",
                    "/api/mcp/servers/local/catalog",
                    None,
                    query={"scope": "user"},
                )
                self.assertEqual(catalog_code, 200)
                self.assertTrue(bool(catalog_out.get("ok")))
                tools = (((catalog_out.get("catalog") or {}).get("tools") or []))
                self.assertEqual(len(tools), 1)
                self.assertEqual(str((tools[0] or {}).get("name") or ""), "echo")

                close_code, close_out = self._dispatch(
                    "POST",
                    "/api/mcp/servers/local/close",
                    {"scope": "user"},
                )
                self.assertEqual(close_code, 200)
                self.assertTrue(bool(close_out.get("ok")))


if __name__ == "__main__":
    unittest.main()
