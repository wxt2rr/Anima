from __future__ import annotations

from http import HTTPStatus
from typing import Any

from anima_backend_shared.database import (
    add_message,
    create_chat,
    delete_chat,
    get_chat,
    get_chats,
    update_chat,
    update_message,
    import_chats,
)
from anima_backend_shared.http import json_response, read_body_json


def handle_get_chats(handler: Any) -> None:
    try:
        json_response(handler, HTTPStatus.OK, get_chats())
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_chat(handler: Any, chat_id: str) -> None:
    try:
        chat = get_chat(chat_id)
        if chat:
            json_response(handler, HTTPStatus.OK, chat)
        else:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Chat not found"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_chats(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        title = "New Chat"
        if isinstance(body, dict):
            title = body.get("title", "New Chat")
        json_response(handler, HTTPStatus.OK, create_chat(title))
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_patch_chat(handler: Any, chat_id: str) -> None:
    try:
        body = read_body_json(handler)
        if isinstance(body, dict):
            update_chat(chat_id, body)
            json_response(handler, HTTPStatus.OK, {"ok": True})
        else:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid body"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_patch_chat_message(handler: Any, chat_id: str, msg_id: str) -> None:
    try:
        body = read_body_json(handler)
        if isinstance(body, dict):
            update_message(chat_id, msg_id, body)
            json_response(handler, HTTPStatus.OK, {"ok": True})
        else:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid body"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_chat_message(handler: Any, chat_id: str) -> None:
    try:
        body = read_body_json(handler)
        if isinstance(body, dict):
            msg = add_message(chat_id, body)
            json_response(handler, HTTPStatus.OK, msg)
        else:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid body"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_chats_sync(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if isinstance(body, list):
            import_chats(body)
            json_response(handler, HTTPStatus.OK, {"ok": True})
        else:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Expected list of chats"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_delete_chat(handler: Any, chat_id: str) -> None:
    try:
        delete_chat(chat_id)
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})
