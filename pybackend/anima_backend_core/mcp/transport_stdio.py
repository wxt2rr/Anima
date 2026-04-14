from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional

from .errors import McpProtocolError, McpTransportError


class StdioMcpTransport:
    def __init__(
        self,
        *,
        command: str,
        args: List[str],
        env: Dict[str, str],
        startup_timeout_ms: int,
    ) -> None:
        self._command = str(command or "").strip()
        self._args = [str(x) for x in (args or [])]
        self._env = dict(env or {})
        self._startup_timeout_ms = max(1000, int(startup_timeout_ms or 15000))

        self._proc: Optional[subprocess.Popen[str]] = None
        self._pending: Dict[int, queue.Queue[Dict[str, Any]]] = {}
        self._pending_lock = threading.Lock()
        self._stdout_thread: Optional[threading.Thread] = None
        self._stderr_thread: Optional[threading.Thread] = None
        self._notifications: Deque[Dict[str, Any]] = deque(maxlen=200)
        self._stderr_lines: Deque[str] = deque(maxlen=300)
        self._next_id = 1
        self._id_lock = threading.Lock()
        self._write_lock = threading.Lock()

    def _next_request_id(self) -> int:
        with self._id_lock:
            rid = self._next_id
            self._next_id += 1
            return rid

    def _ensure_started(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            return
        if not self._command:
            raise McpTransportError("Missing stdio MCP command")

        cmd = [self._command, *self._args]
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=self._env if self._env else None,
            )
        except Exception as e:
            raise McpTransportError(f"Failed to start MCP stdio server: {e}") from e

        self._stdout_thread = threading.Thread(target=self._read_stdout_loop, daemon=True)
        self._stderr_thread = threading.Thread(target=self._read_stderr_loop, daemon=True)
        self._stdout_thread.start()
        self._stderr_thread.start()

        time.sleep(min(0.08, self._startup_timeout_ms / 1000.0))
        if self._proc.poll() is not None:
            stderr = "\n".join(self._stderr_lines) if self._stderr_lines else ""
            raise McpTransportError(f"MCP stdio server exited immediately: {stderr}")

    def _read_stdout_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        for raw_line in proc.stdout:
            line = str(raw_line or "").strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            msg_id = msg.get("id")
            if isinstance(msg_id, int):
                with self._pending_lock:
                    q = self._pending.get(msg_id)
                if q is not None:
                    q.put(msg)
                    continue
            self._notifications.append(msg)

    def _read_stderr_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        for raw_line in proc.stderr:
            line = str(raw_line or "").rstrip("\n")
            if line:
                self._stderr_lines.append(line)

    def _send_message(self, message: Dict[str, Any]) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise McpTransportError("MCP stdio server is not running")
        payload = json.dumps(message, ensure_ascii=False)
        with self._write_lock:
            proc.stdin.write(payload + "\n")
            proc.stdin.flush()

    def request(self, method: str, params: Dict[str, Any] | None = None, *, timeout_ms: int) -> Dict[str, Any]:
        self._ensure_started()
        proc = self._proc
        if proc is None:
            raise McpTransportError("MCP stdio server is not running")
        if proc.poll() is not None:
            raise McpTransportError("MCP stdio server is not running")

        req_id = self._next_request_id()
        response_queue: queue.Queue[Dict[str, Any]] = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[req_id] = response_queue

        try:
            self._send_message({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}})
            timeout = max(1.0, float(timeout_ms or 0) / 1000.0)
            try:
                msg = response_queue.get(timeout=timeout)
            except queue.Empty:
                raise McpTransportError(f"MCP stdio request timeout: method={method}")
        finally:
            with self._pending_lock:
                self._pending.pop(req_id, None)

        if not isinstance(msg, dict):
            raise McpProtocolError("Invalid MCP response")
        err = msg.get("error")
        if isinstance(err, dict):
            code = err.get("code")
            emsg = err.get("message")
            raise McpProtocolError(f"MCP error: code={code} message={emsg}")
        result = msg.get("result")
        return result if isinstance(result, dict) else {}

    def notify(self, method: str, params: Dict[str, Any] | None = None) -> None:
        self._ensure_started()
        self._send_message({"jsonrpc": "2.0", "method": method, "params": params or {}})

    def pop_notifications(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        while self._notifications:
            out.append(self._notifications.popleft())
        return out

    def stderr_tail(self) -> List[str]:
        return list(self._stderr_lines)

    def close(self) -> None:
        proc = self._proc
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            if proc.stdout:
                proc.stdout.close()
        except Exception:
            pass
        try:
            if proc.stderr:
                proc.stderr.close()
        except Exception:
            pass
        try:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=1.5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        self._proc = None
