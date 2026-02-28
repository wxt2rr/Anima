from __future__ import annotations

from http import HTTPStatus
from typing import Any

from anima_backend_shared.database import is_db_empty, db_path, export_snapshot, import_snapshot, clear_all_data
from anima_backend_shared.http import json_response, read_body_json


def handle_get_db_status(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"empty": is_db_empty()})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_db_path(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, {"path": str(db_path())})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_db_export(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, export_snapshot())
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_db_import(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        import_snapshot(body)
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_db_clear(handler: Any) -> None:
    try:
        clear_all_data()
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
