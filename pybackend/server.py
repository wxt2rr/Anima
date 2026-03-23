import argparse
import traceback
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Tuple

from anima_backend_core.api import dispatch as lg_dispatch
from anima_backend_shared.constants import DEFAULT_HOST, DEFAULT_PORT
from anima_backend_shared.database import close_db_connection, close_runs_db_connection, init_db, init_runs_db
from anima_backend_shared.http import json_response


class Handler(BaseHTTPRequestHandler):
    server_version = "anima-backend/0.1"
    protocol_version = "HTTP/1.1"

    def handle_one_request(self) -> None:
        try:
            return super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            return
        finally:
            close_db_connection()
            close_runs_db_connection()

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def _route(self) -> Tuple[str, str, Dict[str, str]]:
        parsed = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        self.query = q
        return self.command.upper(), parsed.path, q

    def _dispatch(self) -> None:
        method, path, _q = self._route()
        if lg_dispatch(self, method, path):
            return
        if method == "GET" and path == "/health":
            json_response(self, HTTPStatus.OK, {"ok": True, "version": "0.1.0", "backendImpl": "core"})
            return
        json_response(self, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

    def do_DELETE(self) -> None:
        self._dispatch()

    def do_GET(self) -> None:
        self._dispatch()

    def do_PATCH(self) -> None:
        self._dispatch()

    def do_POST(self) -> None:
        self._dispatch()


def run(host: str, port: int) -> None:
    init_db()
    init_runs_db()
    try:
        from anima_backend_core.cron import reconcile_cron_from_settings
        from anima_backend_core.telegram_integration import reconcile_telegram_from_settings
        from anima_backend_shared.settings import migrate_settings

        settings_obj = migrate_settings()
        reconcile_telegram_from_settings(settings_obj)
        reconcile_cron_from_settings(settings_obj)
    except Exception as e:
        print(f"[startup] reconcile failed: {e}")
        traceback.print_exc()
    print(f"Server running at http://{host}:{port}")
    server = ThreadingHTTPServer((host, port), Handler)
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    run(args.host, args.port)


if __name__ == "__main__":
    main()
