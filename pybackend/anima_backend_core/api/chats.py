from __future__ import annotations

from http import HTTPStatus
from typing import Any

from anima_backend_shared.database import (
    add_message,
    create_chat,
    delete_chat,
    get_chat,
    get_chats,
    merge_chat_meta,
    update_chat,
    update_message,
    import_chats,
)
from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import load_settings

from ..llm.adapter import call_chat_completion, create_provider


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
            updates = dict(body)
            meta = updates.pop("meta", None) if "meta" in updates else None
            replace_meta = bool(updates.pop("replaceMeta", False))
            if meta is not None:
                if isinstance(meta, dict) and not replace_meta:
                    merge_chat_meta(chat_id, meta)
                else:
                    update_chat(chat_id, {"meta": meta})
            if updates:
                update_chat(chat_id, updates)
            json_response(handler, HTTPStatus.OK, {"ok": True})
        else:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid body"})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_chat_summary(handler: Any, chat_id: str) -> None:
    try:
        chat = get_chat(chat_id)
        if not isinstance(chat, dict):
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Chat not found"})
            return
        meta = chat.get("meta") if isinstance(chat.get("meta"), dict) else {}
        compression = meta.get("compression") if isinstance(meta.get("compression"), dict) else {}
        json_response(handler, HTTPStatus.OK, {"ok": True, "compression": compression})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_chat_compact(handler: Any, chat_id: str) -> None:
    try:
        body = read_body_json(handler)
        body = body if isinstance(body, dict) else {}
        focus = str(body.get("focus") or "").strip()
        composer = body.get("composer")
        composer = composer if isinstance(composer, dict) else {}

        settings_obj = load_settings()
        provider = create_provider(settings_obj, composer)

        s = settings_obj.get("settings") if isinstance(settings_obj, dict) else {}
        s = s if isinstance(s, dict) else {}
        keep_recent = body.get("keepRecentMessages")
        try:
            keep_recent = int(keep_recent) if keep_recent is not None else int(s.get("keepRecentMessages") or 6)
        except Exception:
            keep_recent = 6
        keep_recent = max(2, min(int(keep_recent), 20))

        chat = get_chat(chat_id)
        if not isinstance(chat, dict):
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Chat not found"})
            return

        meta = chat.get("meta") if isinstance(chat.get("meta"), dict) else {}
        comp = meta.get("compression") if isinstance(meta.get("compression"), dict) else {}
        prev_summary = str(comp.get("summary") or "").strip()

        history = chat.get("messages") if isinstance(chat.get("messages"), list) else []
        usable = [m for m in history if isinstance(m, dict) and str(m.get("role") or "") not in ("system", "tool")]
        if len(usable) <= keep_recent:
            json_response(handler, HTTPStatus.OK, {"ok": True, "compression": comp, "skipped": True})
            return

        to_summarize = usable[:-keep_recent]
        last_id = str((to_summarize[-1] or {}).get("id") or "").strip()

        def _fmt(m: Any) -> str:
            if not isinstance(m, dict):
                return ""
            role = str(m.get("role") or "").strip() or "unknown"
            content = m.get("content")
            if isinstance(content, str):
                txt = content
            else:
                try:
                    import json

                    txt = json.dumps(content, ensure_ascii=False)
                except Exception:
                    txt = str(content)
            txt = txt.replace("\r\n", "\n").replace("\r", "\n").strip()
            if len(txt) > 4000:
                txt = txt[:4000] + "…"
            return f"{role}: {txt}"

        transcript = "\n".join([x for x in (_fmt(m) for m in to_summarize) if x]).strip()
        if not transcript:
            json_response(handler, HTTPStatus.OK, {"ok": True, "compression": comp, "skipped": True})
            return

        focus_line = f"额外要求：{focus}" if focus else ""
        sys_text = (
            "请将以下对话历史压缩成摘要，供后续对话继续使用。要求：只保留关键事实/决定/未完成事项/用户偏好；不要编造；尽量结构化；长度 400-800 字。"
            + (f"\n{focus_line}" if focus_line else "")
        )
        user_text = (f"已有摘要：\n{prev_summary}\n\n" if prev_summary else "") + "对话片段：\n" + transcript
        summary_messages = [{"role": "system", "content": sys_text}, {"role": "user", "content": user_text}]

        max_tokens = 800
        try:
            max_tokens = int((s.get("maxTokens") or 0) or 800)
        except Exception:
            max_tokens = 800
        max_tokens = min(1200, max(256, int(max_tokens)))

        mo = str(s.get("memoryToolModelId") or "").strip() or (str(composer.get("modelOverride") or "").strip() or None)
        res = call_chat_completion(provider, summary_messages, temperature=0.2, max_tokens=max_tokens, tools=None, tool_choice=None, model_override=mo)
        summary_text = ""
        if isinstance(res, dict):
            if isinstance(res.get("output_text"), str):
                summary_text = str(res.get("output_text") or "").strip()
            elif isinstance(res.get("output"), list):
                parts = []
                for it in res.get("output") or []:
                    if not isinstance(it, dict):
                        continue
                    if str(it.get("type") or "").strip() != "message":
                        continue
                    content = it.get("content")
                    if isinstance(content, str):
                        if content.strip():
                            parts.append(content.strip())
                        continue
                    if isinstance(content, list):
                        for blk in content:
                            if not isinstance(blk, dict):
                                continue
                            t = str(blk.get("type") or "").strip()
                            if t not in ("output_text", "text"):
                                continue
                            txt = blk.get("text")
                            if isinstance(txt, str) and txt.strip():
                                parts.append(txt)
                summary_text = "\n".join(parts).strip()
            else:
                choice = ((res.get("choices") or [{}])[0]) if isinstance(res.get("choices"), list) else {}
                msg = (choice.get("message") or {}) if isinstance(choice, dict) else {}
                summary_text = str(msg.get("content") or "").strip()
        if not summary_text:
            json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Failed to generate summary"})
            return

        next_comp = {
            "enabled": True,
            "summary": summary_text,
            "summaryUpdatedAt": int(__import__("time").time() * 1000),
            "summarizedUntilMessageId": last_id,
            "keepRecentMessages": keep_recent,
            "lastCompactReason": "manual",
        }
        merged = merge_chat_meta(chat_id, {"compression": next_comp})
        out_comp = merged.get("compression") if isinstance(merged.get("compression"), dict) else next_comp
        json_response(handler, HTTPStatus.OK, {"ok": True, "compression": out_comp})
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
