import argparse
from http.server import ThreadingHTTPServer

from .constants import DEFAULT_HOST, DEFAULT_PORT
from .database import init_db
from .handler import Handler


def run(host: str, port: int) -> None:
    init_db()
    print(f"Server running at http://{host}:{port}")
    server = ThreadingHTTPServer((host, port), Handler)
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    run(args.host, args.port)

