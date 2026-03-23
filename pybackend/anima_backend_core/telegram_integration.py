from __future__ import annotations

import json
import mimetypes
import os
import re
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


def _tg_debug_enabled() -> bool:
    v = str(os.environ.get("ANIMA_TG_DEBUG") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _tg_debug(msg: str) -> None:
    if not _tg_debug_enabled():
        return
    try:
        ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    except Exception:
        ts = str(int(time.time()))
    print(f"[telegram][{ts}] {msg}")


def _tg_voice_debug_enabled() -> bool:
    v = str(os.environ.get("ANIMA_VOICE_DEBUG") or "").strip().lower()
    return v in ("1", "true", "yes", "on") or _tg_debug_enabled()


def _is_bad_transcript(text: str) -> bool:
    s = str(text or "").strip()
    if not s:
        return True
    if re.search(r"[\u4e00-\u9fffA-Za-z0-9]", s):
        return False
    return True


def _extract_telegram_config(settings_obj: Dict[str, Any]) -> Dict[str, Any]:
    s = settings_obj.get("settings")
    if not isinstance(s, dict):
        return {}
    im = s.get("im")
    if not isinstance(im, dict):
        return {}
    if str(im.get("provider") or "").strip() not in ("", "telegram"):
        return {}
    tg = im.get("telegram")
    if not isinstance(tg, dict):
        return {}
    return tg


def _tg_api_call(token: str, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"https://api.telegram.org/bot{token}/{method}?{qs}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read().decode("utf-8", errors="replace")
    obj = json.loads(data)
    return obj if isinstance(obj, dict) else {"ok": False, "error": "Invalid response"}


def _tg_api_post_form(token: str, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    body = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None}).encode("utf-8")
    url = f"https://api.telegram.org/bot{token}/{method}"
    headers = {"Content-Type": "application/x-www-form-urlencoded; charset=utf-8", "Accept": "application/json"}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read().decode("utf-8", errors="replace")
    obj = json.loads(data)
    return obj if isinstance(obj, dict) else {"ok": False, "error": "Invalid response"}


def _tg_api_post_multipart(token: str, method: str, fields: Dict[str, Any], files: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    boundary = uuid.uuid4().hex
    body_parts: List[bytes] = []

    def _add_field(name: str, value: str) -> None:
        body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
        body_parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body_parts.append(value.encode("utf-8"))
        body_parts.append(b"\r\n")

    def _add_file(name: str, filename: str, content_type: str, content: bytes) -> None:
        body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
        body_parts.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8")
        )
        body_parts.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        body_parts.append(content)
        body_parts.append(b"\r\n")

    for k, v in (fields or {}).items():
        if v is None:
            continue
        _add_field(str(k), str(v))

    for name, spec in (files or {}).items():
        if not isinstance(spec, dict):
            continue
        filename = str(spec.get("filename") or "file")
        content = spec.get("content")
        if not isinstance(content, (bytes, bytearray)):
            continue
        ct = str(spec.get("contentType") or "application/octet-stream").strip() or "application/octet-stream"
        _add_file(str(name), filename, ct, bytes(content))

    body_parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(body_parts)

    url = f"https://api.telegram.org/bot{token}/{method}"
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read().decode("utf-8", errors="replace")
    obj = json.loads(data)
    return obj if isinstance(obj, dict) else {"ok": False, "error": "Invalid response"}


def _tg_send_message(token: str, chat_id: str, text: str, reply_to_message_id: Optional[int] = None) -> None:
    msg = str(text or "")
    if not msg.strip():
        msg = "(empty)"

    max_len = 3900
    parts: List[str] = []
    if len(msg) <= max_len:
        parts = [msg]
    else:
        buf = ""
        for line in msg.splitlines(True):
            if len(line) > max_len:
                if buf:
                    parts.append(buf)
                    buf = ""
                for i in range(0, len(line), max_len):
                    parts.append(line[i : i + max_len])
                continue
            if len(buf) + len(line) > max_len:
                if buf:
                    parts.append(buf)
                buf = line
            else:
                buf += line
        if buf:
            parts.append(buf)

    replied = False
    for p in parts:
        payload: Dict[str, Any] = {"chat_id": chat_id, "text": p}
        if (not replied) and isinstance(reply_to_message_id, int) and reply_to_message_id > 0:
            payload["reply_to_message_id"] = int(reply_to_message_id)
            payload["allow_sending_without_reply"] = True
            replied = True
        resp = _tg_api_post_form(token, "sendMessage", payload)
        if not (isinstance(resp, dict) and resp.get("ok") is True):
            err = ""
            if isinstance(resp, dict):
                err = str(resp.get("description") or resp.get("error") or "").strip()
            raise RuntimeError(err or "Telegram sendMessage failed")


def _tg_send_photo(token: str, chat_id: str, image_path: str, caption: str, reply_to_message_id: Optional[int] = None) -> None:
    with open(image_path, "rb") as f:
        content = f.read()
    ct = mimetypes.guess_type(image_path)[0] or "application/octet-stream"
    cap = str(caption or "").strip()
    if len(cap) > 900:
        cap = cap[:900]
    fields: Dict[str, Any] = {"chat_id": chat_id, "caption": cap} if cap else {"chat_id": chat_id}
    if isinstance(reply_to_message_id, int) and reply_to_message_id > 0:
        fields["reply_to_message_id"] = int(reply_to_message_id)
        fields["allow_sending_without_reply"] = True
    resp = _tg_api_post_multipart(
        token,
        "sendPhoto",
        fields,
        {"photo": {"filename": os.path.basename(image_path), "contentType": ct, "content": content}},
    )
    if not (isinstance(resp, dict) and resp.get("ok") is True):
        err = ""
        if isinstance(resp, dict):
            err = str(resp.get("description") or resp.get("error") or "").strip()
        raise RuntimeError(err or "Telegram sendPhoto failed")


def _tg_send_document(token: str, chat_id: str, file_path: str, caption: str, reply_to_message_id: Optional[int] = None) -> None:
    with open(file_path, "rb") as f:
        content = f.read()
    ct = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    cap = str(caption or "").strip()
    if len(cap) > 900:
        cap = cap[:900]
    fields: Dict[str, Any] = {"chat_id": chat_id, "caption": cap} if cap else {"chat_id": chat_id}
    if isinstance(reply_to_message_id, int) and reply_to_message_id > 0:
        fields["reply_to_message_id"] = int(reply_to_message_id)
        fields["allow_sending_without_reply"] = True
    resp = _tg_api_post_multipart(
        token,
        "sendDocument",
        fields,
        {"document": {"filename": os.path.basename(file_path), "contentType": ct, "content": content}},
    )
    if not (isinstance(resp, dict) and resp.get("ok") is True):
        err = ""
        if isinstance(resp, dict):
            err = str(resp.get("description") or resp.get("error") or "").strip()
        raise RuntimeError(err or "Telegram sendDocument failed")


def _tg_send_video(token: str, chat_id: str, video_path: str, caption: str, reply_to_message_id: Optional[int] = None) -> None:
    with open(video_path, "rb") as f:
        content = f.read()
    ct = mimetypes.guess_type(video_path)[0] or "application/octet-stream"
    cap = str(caption or "").strip()
    if len(cap) > 900:
        cap = cap[:900]
    fields: Dict[str, Any] = {"chat_id": chat_id, "caption": cap} if cap else {"chat_id": chat_id}
    if isinstance(reply_to_message_id, int) and reply_to_message_id > 0:
        fields["reply_to_message_id"] = int(reply_to_message_id)
        fields["allow_sending_without_reply"] = True
    resp = _tg_api_post_multipart(
        token,
        "sendVideo",
        fields,
        {"video": {"filename": os.path.basename(video_path), "contentType": ct, "content": content}},
    )
    if not (isinstance(resp, dict) and resp.get("ok") is True):
        err = ""
        if isinstance(resp, dict):
            err = str(resp.get("description") or resp.get("error") or "").strip()
        raise RuntimeError(err or "Telegram sendVideo failed")


def _is_image_file_name(name: str) -> bool:
    n = str(name or "").lower().strip()
    return n.endswith((".png", ".jpg", ".jpeg", ".webp"))


def _default_send_base_dir(workspace_dir: str) -> str:
    w = str(workspace_dir or "").strip()
    if w:
        return w
    return str(Path.home())


def _extract_image_candidates_from_text(text: str) -> List[str]:
    s = str(text or "")
    if not s.strip():
        return []
    candidates: List[str] = []

    try:
        for m in re.finditer(r"['\"`]([^'\"`\r\n]+?\.(?:png|jpg|jpeg|webp))['\"`]", s, flags=re.IGNORECASE):
            v = str(m.group(1) or "").strip()
            if v:
                candidates.append(v)
    except Exception:
        pass

    try:
        for m in re.finditer(r"(?:file://)?(/[^ \r\n\"'`]+?\.(?:png|jpg|jpeg|webp))", s, flags=re.IGNORECASE):
            v = str(m.group(1) or "").strip()
            if v:
                candidates.append(v)
    except Exception:
        pass

    compact = s.replace("file://", "")
    for token in compact.replace("\r", "\n").split():
        v = token.strip().strip("`'\"()[]{}<>.,;")
        if not v:
            continue
        if _is_image_file_name(v):
            candidates.append(v)

    seen: Set[str] = set()
    out: List[str] = []
    for c in candidates:
        if c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out


def _extract_image_from_traces(traces: Any, base_dir: str) -> Optional[str]:
    if not isinstance(traces, list) or not traces:
        return None
    bdir = str(base_dir or "").strip()
    if not bdir:
        return None
    try:
        from anima_backend_shared.util import is_within, norm_abs
    except Exception:
        return None
    try:
        bdir = norm_abs(bdir)
    except Exception:
        return None
    if not bdir:
        return None

    for tr in traces:
        if not isinstance(tr, dict):
            continue
        for key in ["resultPreview", "argsPreview"]:
            pv = tr.get(key)
            if not isinstance(pv, dict):
                continue
            txt = pv.get("text")
            if not isinstance(txt, str) or not txt.strip():
                continue

            scan_texts: List[str] = [txt]
            if key == "argsPreview":
                try:
                    args = json.loads(txt)
                    if isinstance(args, dict):
                        cmd = args.get("command")
                        if isinstance(cmd, str) and cmd.strip():
                            scan_texts.append(cmd)
                except Exception:
                    pass

            for scan in scan_texts:
                for c in _extract_image_candidates_from_text(scan):
                    p = c.replace("file://", "")
                    if not os.path.isabs(p):
                        p = os.path.join(bdir, p)
                    try:
                        apath = norm_abs(p)
                    except Exception:
                        continue
                    if not is_within(bdir, apath):
                        continue
                    if os.path.isfile(apath):
                        return apath
    return None


def _extract_image_from_artifacts(artifacts: Any, base_dir: str) -> Optional[str]:
    if not isinstance(artifacts, list) or not artifacts:
        return None
    bdir = str(base_dir or "").strip()
    if not bdir:
        return None
    try:
        from anima_backend_shared.util import is_within, norm_abs
    except Exception:
        return None
    try:
        bdir = norm_abs(bdir)
    except Exception:
        return None
    if not bdir:
        return None

    for a in artifacts:
        if not isinstance(a, dict):
            continue
        if str(a.get("kind") or "").strip() != "image":
            continue
        p = str(a.get("path") or "").strip()
        if not p:
            continue
        if not os.path.isabs(p):
            p = os.path.join(bdir, p)
        try:
            ap = norm_abs(p)
        except Exception:
            continue
        if not is_within(bdir, ap):
            continue
        if os.path.isfile(ap):
            return ap
    return None


def _extract_file_from_artifacts(artifacts: Any, base_dir: str) -> Optional[str]:
    if not isinstance(artifacts, list) or not artifacts:
        return None
    bdir = str(base_dir or "").strip()
    if not bdir:
        return None
    try:
        from anima_backend_shared.util import is_within, norm_abs
    except Exception:
        return None
    try:
        bdir = norm_abs(bdir)
    except Exception:
        return None
    if not bdir:
        return None

    for a in artifacts:
        if not isinstance(a, dict):
            continue
        if str(a.get("kind") or "").strip() != "file":
            continue
        p = str(a.get("path") or "").strip()
        if not p:
            continue
        if not os.path.isabs(p):
            p = os.path.join(bdir, p)
        try:
            ap = norm_abs(p)
        except Exception:
            continue
        if not is_within(bdir, ap):
            continue
        if os.path.isfile(ap):
            return ap
    return None


def _extract_video_from_artifacts(artifacts: Any, base_dir: str) -> Optional[str]:
    if not isinstance(artifacts, list) or not artifacts:
        return None
    bdir = str(base_dir or "").strip()
    if not bdir:
        return None
    try:
        from anima_backend_shared.util import is_within, norm_abs
    except Exception:
        return None
    try:
        bdir = norm_abs(bdir)
    except Exception:
        return None
    if not bdir:
        return None

    for a in artifacts:
        if not isinstance(a, dict):
            continue
        kind = str(a.get("kind") or "").strip()
        mime = str(a.get("mime") or "").lower().strip()
        if kind != "video" and not mime.startswith("video/"):
            continue
        p = str(a.get("path") or "").strip()
        if not p:
            continue
        if not os.path.isabs(p):
            p = os.path.join(bdir, p)
        try:
            ap = norm_abs(p)
        except Exception:
            continue
        if not is_within(bdir, ap):
            continue
        if os.path.isfile(ap):
            return ap
    return None


def _telegram_file_url(token: str, file_path: str) -> str:
    p = str(file_path or "").lstrip("/")
    return f"https://api.telegram.org/file/bot{token}/{p}"


def _download_telegram_file(token: str, file_id: str) -> Optional[Dict[str, Any]]:
    obj = _tg_api_call(token, "getFile", {"file_id": file_id})
    if not (isinstance(obj, dict) and obj.get("ok") is True):
        return None
    result = obj.get("result")
    if not isinstance(result, dict):
        return None
    fp = str(result.get("file_path") or "").strip()
    if not fp:
        return None
    url = _telegram_file_url(token, fp)
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=60) as resp:
        content = resp.read()
    if not isinstance(content, (bytes, bytearray)) or not content:
        return None
    return {"file_path": fp, "content": bytes(content)}


def _extract_audio_file_spec_from_message(msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    voice = msg.get("voice")
    if isinstance(voice, dict):
        file_id = str(voice.get("file_id") or "").strip()
        uniq = str(voice.get("file_unique_id") or "").strip()
        size = voice.get("file_size")
        try:
            size = int(size or 0)
        except Exception:
            size = 0
        if file_id:
            return {"file_id": file_id, "file_unique_id": uniq or file_id, "file_size": size}

    audio = msg.get("audio")
    if isinstance(audio, dict):
        file_id = str(audio.get("file_id") or "").strip()
        uniq = str(audio.get("file_unique_id") or "").strip()
        size = audio.get("file_size")
        try:
            size = int(size or 0)
        except Exception:
            size = 0
        if file_id:
            return {"file_id": file_id, "file_unique_id": uniq or file_id, "file_size": size}

    doc = msg.get("document")
    if isinstance(doc, dict):
        mime = str(doc.get("mime_type") or "").lower().strip()
        fname = str(doc.get("file_name") or "").lower().strip()
        is_audio = mime.startswith("audio/") or fname.endswith((".ogg", ".opus", ".mp3", ".m4a", ".wav", ".webm", ".flac"))
        if is_audio:
            file_id = str(doc.get("file_id") or "").strip()
            uniq = str(doc.get("file_unique_id") or "").strip()
            size = doc.get("file_size")
            try:
                size = int(size or 0)
            except Exception:
                size = 0
            if file_id:
                return {"file_id": file_id, "file_unique_id": uniq or file_id, "file_size": size}

    return None


def _transcribe_telegram_audio(*, token: str, file_id: str, lang_hint: Optional[str] = None) -> Tuple[bool, str]:
    dl = _download_telegram_file(token, file_id)
    if not isinstance(dl, dict):
        return False, "语音下载失败。"
    fp = str(dl.get("file_path") or "").strip()
    content = dl.get("content")
    if not fp or not isinstance(content, (bytes, bytearray)) or not content:
        return False, "语音下载失败。"

    try:
        from anima_backend_shared.settings import load_settings
        from anima_backend_shared.voice import (
            _convert_audio_to_wav_if_needed,
            _is_local_model_dir_installed,
            _is_remote_model_installed,
            _normalize_whisper_model_id,
            get_voice_pipeline,
        )
    except Exception:
        return False, "语音模块不可用。"

    raw = load_settings()
    settings_obj = raw.get("settings") if isinstance(raw, dict) else None
    voice_obj = settings_obj.get("voice") if isinstance(settings_obj, dict) else None
    voice_model_raw = voice_obj.get("model") if isinstance(voice_obj, dict) else ""
    voice_lang = voice_obj.get("language") if isinstance(voice_obj, dict) else "auto"
    model_id = _normalize_whisper_model_id(voice_model_raw)
    if not model_id:
        return False, "未配置语音识别模型。请在设置中配置 Voice model。"

    if model_id.startswith("local:"):
        local_path = model_id[len("local:") :].strip()
        if not local_path or not os.path.exists(local_path):
            return False, "本地语音识别模型路径不存在。"
        model_key = local_path
    else:
        remote_models = voice_obj.get("remoteModels") if isinstance(voice_obj, dict) else None
        remote_models = remote_models if isinstance(remote_models, list) else []
        mapped_dir: Optional[str] = None
        for rm in remote_models:
            if not isinstance(rm, dict):
                continue
            if str(rm.get("id") or "").strip() != model_id:
                continue
            p = str(rm.get("path") or "").strip()
            if p and _is_local_model_dir_installed(Path(p)):
                mapped_dir = p
                break

        if mapped_dir:
            model_key = mapped_dir
        else:
            if not _is_remote_model_installed(model_id):
                return False, "语音识别模型未安装。请先下载并安装。"
            model_key = model_id

    audio_ext = os.path.splitext(fp)[1].strip().lower() or ".ogg"
    if audio_ext in (".oga", ".opus"):
        audio_ext = ".ogg"
    tmp_path = ""
    wav_path: Optional[str] = None
    wav_delete = False
    try:
        with tempfile.NamedTemporaryFile(suffix=audio_ext, delete=False) as tmp:
            tmp.write(bytes(content))
            tmp_path = tmp.name

        pipe = get_voice_pipeline(model_key)
        generate_kwargs: Dict[str, Any] = {"task": "transcribe", "temperature": 0.0, "num_beams": 1}
        lang = str(voice_lang or "").strip().lower()
        if not lang or lang == "auto":
            hint = str(lang_hint or "").strip().lower()
            if hint:
                lang = hint.split("-", 1)[0].strip()
        if not lang or lang == "auto":
            lang = "zh"
        if lang:
            lang_map = {
                "en": "english",
                "zh": "chinese",
                "ja": "japanese",
                "ko": "korean",
                "fr": "french",
                "de": "german",
                "es": "spanish",
                "it": "italian",
                "pt": "portuguese",
                "ru": "russian",
            }
            generate_kwargs["language"] = lang_map.get(lang, lang)

        wav_path, wav_delete = _convert_audio_to_wav_if_needed(tmp_path)

        debug_meta_out = None
        debug_meta = None

        if _tg_voice_debug_enabled():
            try:
                from anima_backend_shared.settings import config_root
                import shutil
                import wave

                debug_dir = config_root() / "voice_debug" / "telegram"
                debug_dir.mkdir(parents=True, exist_ok=True)
                ts = int(time.time() * 1000)
                base = f"{ts}_{str(file_id or uuid.uuid4().hex)[:40]}"
                raw_out = debug_dir / f"{base}{audio_ext}"
                wav_out = debug_dir / f"{base}.wav"
                meta_out = debug_dir / f"{base}.json"
                try:
                    raw_out.write_bytes(bytes(content))
                except Exception:
                    pass
                if wav_path and os.path.exists(wav_path):
                    try:
                        shutil.copyfile(wav_path, wav_out)
                    except Exception:
                        pass
                dur = None
                try:
                    if wav_path and os.path.exists(wav_path):
                        with wave.open(wav_path, "rb") as wf:
                            frames = int(wf.getnframes())
                            rate = int(wf.getframerate()) or 0
                            if rate > 0:
                                dur = frames / rate
                except Exception:
                    dur = None

                meta = {
                    "fileId": str(file_id or ""),
                    "sourceExt": audio_ext,
                    "sourceBytes": int(len(content) if isinstance(content, (bytes, bytearray)) else 0),
                    "voiceModelRaw": str(voice_model_raw or ""),
                    "voiceModelId": str(model_id or ""),
                    "voiceModelKey": str(model_key or ""),
                    "voiceLanguageSetting": str(voice_lang or ""),
                    "telegramLanguageHint": str(lang_hint or ""),
                    "generateKwargs": generate_kwargs,
                    "tmpAudioPath": tmp_path,
                    "tmpWavPath": wav_path,
                    "wavSeconds": dur,
                    "debugRawPath": str(raw_out),
                    "debugWavPath": str(wav_out),
                }
                try:
                    meta_out.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
                except Exception:
                    pass
                debug_meta_out = meta_out
                debug_meta = meta
                _tg_debug(
                    "voice debug "
                    + json.dumps(
                        {
                            "fileId": str(file_id or ""),
                            "voiceModelId": str(model_id or ""),
                            "voiceLanguageSetting": str(voice_lang or ""),
                            "telegramLanguageHint": str(lang_hint or ""),
                            "generateKwargs": generate_kwargs,
                            "wavSeconds": dur,
                            "debugDir": str(debug_dir),
                        },
                        ensure_ascii=False,
                    )
                )
            except Exception:
                pass

        try:
            m = getattr(pipe, "model", None)
            gc = getattr(m, "generation_config", None)
            if gc is not None:
                if getattr(gc, "forced_decoder_ids", None) is not None:
                    gc.forced_decoder_ids = None
                try:
                    setattr(gc, "task", "transcribe")
                except Exception:
                    pass
                try:
                    if isinstance(generate_kwargs.get("language"), str) and generate_kwargs["language"].strip():
                        setattr(gc, "language", generate_kwargs["language"])
                except Exception:
                    pass
        except Exception:
            pass

        result = pipe(wav_path, generate_kwargs=generate_kwargs)
        text = result.get("text", "") if isinstance(result, dict) else ""
        out = str(text or "").strip()

        retry_out = ""
        retry_kwargs = None
        if _is_bad_transcript(out):
            retry_kwargs = dict(generate_kwargs)
            retry_kwargs.update({"num_beams": 5, "temperature": 0.0})
            try:
                result2 = pipe(wav_path, generate_kwargs=retry_kwargs)
                text2 = result2.get("text", "") if isinstance(result2, dict) else ""
                retry_out = str(text2 or "").strip()
                if retry_out and not _is_bad_transcript(retry_out):
                    out = retry_out
                    if _tg_voice_debug_enabled():
                        _tg_debug("voice retry used")
            except Exception:
                retry_out = ""

        if debug_meta_out and isinstance(debug_meta, dict):
            try:
                debug_meta["transcript"] = out
                if retry_out:
                    debug_meta["retryTranscript"] = retry_out
                if isinstance(retry_kwargs, dict):
                    debug_meta["retryKwargs"] = retry_kwargs
                debug_meta_out.write_text(json.dumps(debug_meta, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass

        if not out:
            return False, "未识别到有效语音内容。"
        return True, out
    except Exception as e:
        msg = str(e or "").strip()
        lower = msg.lower()
        if "voice model is not installed" in lower or "not installed" in lower:
            return False, "语音识别模型未安装。请先下载并安装。"
        if "ffmpeg is required" in lower:
            return False, "缺少 ffmpeg，无法解码该语音格式。"
        if "ffmpeg failed to decode audio" in lower:
            tail = msg[-200:] if len(msg) > 200 else msg
            return False, f"语音解码失败：{tail}".strip()
        if "no module named" in lower and ("transformers" in lower or "torch" in lower):
            return False, "语音模块依赖缺失（transformers/torch）。"
        if msg:
            tail = msg[-240:] if len(msg) > 240 else msg
            return False, f"语音识别失败：{tail}".strip()
        return False, "语音识别失败。"
    finally:
        if wav_path and wav_delete and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except Exception:
                pass
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _save_telegram_image_to_workspace(*, token: str, file_id: str, file_unique_id: str, workspace_dir: str) -> Optional[str]:
    if not (token and file_id and workspace_dir):
        return None
    try:
        from anima_backend_shared.util import is_within, norm_abs
    except Exception:
        return None
    try:
        wdir = norm_abs(workspace_dir)
    except Exception:
        return None
    if not wdir:
        return None
    dl = _download_telegram_file(token, file_id)
    if not isinstance(dl, dict):
        return None
    fp = str(dl.get("file_path") or "").strip()
    content = dl.get("content")
    if not fp or not isinstance(content, (bytes, bytearray)) or not content:
        return None

    ext = os.path.splitext(fp)[1].lower().strip()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".jpg"
    name_seed = str(file_unique_id or file_id or uuid.uuid4().hex).strip()
    ts = int(time.time() * 1000)
    safe_name = "".join([c for c in name_seed if c.isalnum() or c in ("-", "_")])[:60] or uuid.uuid4().hex
    rel = os.path.join("telegram_uploads", f"{ts}_{safe_name}{ext}")
    out_path = os.path.join(wdir, rel)
    try:
        out_path = norm_abs(out_path)
    except Exception:
        return None
    if not is_within(wdir, out_path):
        return None
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(bytes(content))
    return out_path


def _extract_image_to_send_from_reply(reply_text: str, base_dir: str) -> Tuple[Optional[str], str]:
    text = str(reply_text or "")
    wdir = str(base_dir or "").strip()
    if not wdir or not text.strip():
        return None, text
    try:
        from anima_backend_shared.util import is_within, norm_abs
    except Exception:
        return None, text
    try:
        wdir = norm_abs(wdir)
    except Exception:
        return None, text
    if not wdir:
        return None, text

    candidates = _extract_image_candidates_from_text(text)

    picked: Optional[str] = None
    picked_raw: Optional[str] = None
    for c in candidates:
        p = c
        if not os.path.isabs(p):
            p = os.path.join(wdir, p)
        try:
            ap = norm_abs(p)
        except Exception:
            continue
        if not is_within(wdir, ap):
            continue
        if os.path.isfile(ap):
            picked = ap
            picked_raw = c
            break

    if not picked:
        return None, text

    cleaned = text
    for v in [picked_raw, f"file://{picked_raw}" if picked_raw else None, picked, f"file://{picked}"]:
        if isinstance(v, str) and v:
            cleaned = cleaned.replace(v, "")
    cleaned = cleaned.strip()
    return picked, cleaned



def _thread_id_from_message(msg: Dict[str, Any]) -> str:
    chat = msg.get("chat")
    if not isinstance(chat, dict):
        return ""
    chat_id = str(chat.get("id") or "").strip()
    chat_type = str(chat.get("type") or "").strip()
    frm = msg.get("from")
    if not isinstance(frm, dict):
        frm = {}
    from_id = str(frm.get("id") or "").strip()
    if not chat_id:
        return ""
    if chat_type in ("group", "supergroup"):
        return f"tg:group:{chat_id}"
    if from_id:
        return f"tg:dm:{from_id}"
    return f"tg:dm:{chat_id}"


def _chat_id_from_message(msg: Dict[str, Any]) -> str:
    chat = msg.get("chat")
    if not isinstance(chat, dict):
        return ""
    return str(chat.get("id") or "").strip()


def _is_group_message(msg: Dict[str, Any]) -> bool:
    chat = msg.get("chat")
    if not isinstance(chat, dict):
        return False
    tp = str(chat.get("type") or "").strip()
    return tp in ("group", "supergroup")


def _from_user_id(msg: Dict[str, Any]) -> str:
    frm = msg.get("from")
    if not isinstance(frm, dict):
        return ""
    return str(frm.get("id") or "").strip()


def _default_composer_for_telegram(settings_obj: Dict[str, Any]) -> Dict[str, Any]:
    s = settings_obj.get("settings")
    if not isinstance(s, dict):
        s = {}

    tg = _extract_telegram_config(settings_obj)

    enabled_tool_ids = s.get("toolsEnabledIds")
    if not isinstance(enabled_tool_ids, list):
        enabled_tool_ids = []

    enabled_mcp_server_ids = s.get("mcpEnabledServerIds")
    if not isinstance(enabled_mcp_server_ids, list):
        enabled_mcp_server_ids = []

    enabled_skill_ids = s.get("skillsEnabledIds")
    if not isinstance(enabled_skill_ids, list):
        enabled_skill_ids = []

    workspace_dir = str(s.get("workspaceDir") or "").strip()
    project_id = str(tg.get("projectId") or "").strip()
    if project_id:
        projects = s.get("projects")
        if isinstance(projects, list):
            for p in projects:
                if not isinstance(p, dict):
                    continue
                if str(p.get("id") or "").strip() != project_id:
                    continue
                d = str(p.get("dir") or "").strip()
                if d:
                    workspace_dir = d
                break
    provider_override_id = str(tg.get("providerOverrideId") or "").strip()
    model_override = str(tg.get("modelOverride") or "").strip()

    return {
        "channel": "telegram",
        "workspaceDir": workspace_dir,
        "toolMode": "auto",
        "enabledToolIds": [str(x) for x in enabled_tool_ids if str(x).strip()],
        "enabledMcpServerIds": [str(x) for x in enabled_mcp_server_ids if str(x).strip()],
        "skillMode": "auto",
        "enabledSkillIds": [str(x) for x in enabled_skill_ids if str(x).strip()],
        "providerOverrideId": provider_override_id,
        "modelOverride": model_override,
    }



class TelegramPoller:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._enabled = False
        self._token = ""
        self._allowed_users: Set[str] = set()
        self._allow_groups = False
        self._composer: Dict[str, Any] = {"channel": "telegram", "toolMode": "auto"}
        self._poll_interval_ms = 1500

    def reconcile(self, settings_obj: Dict[str, Any]) -> None:
        provider = ""
        try:
            s = settings_obj.get("settings")
            if isinstance(s, dict):
                im = s.get("im")
                if isinstance(im, dict):
                    provider = str(im.get("provider") or "").strip()
        except Exception:
            provider = ""
        tg = _extract_telegram_config(settings_obj)

        enabled = bool(tg.get("enabled"))
        token = str(tg.get("botToken") or "").strip()
        allowed_raw = tg.get("allowedUserIds")
        allowed = set([str(x).strip() for x in allowed_raw]) if isinstance(allowed_raw, list) else set()
        allowed = set([x for x in allowed if x])
        allow_groups = bool(tg.get("allowGroups"))
        poll_interval_ms = tg.get("pollingIntervalMs")
        if isinstance(poll_interval_ms, (int, float)) and int(poll_interval_ms) > 0:
            poll_interval_ms = int(poll_interval_ms)
        else:
            poll_interval_ms = 1500

        should_run = enabled and bool(token) and bool(allowed)
        workspace_dir = ""
        try:
            s = settings_obj.get("settings")
            if isinstance(s, dict):
                workspace_dir = str(s.get("workspaceDir") or "").strip()
        except Exception:
            workspace_dir = ""

        _tg_debug(
            "reconcile "
            + " ".join(
                [
                    f"provider={provider or '(empty)'}",
                    f"enabled={int(bool(enabled))}",
                    f"token={int(bool(token))}",
                    f"allowed={len(allowed)}",
                    f"allowGroups={int(bool(allow_groups))}",
                    f"pollMs={int(poll_interval_ms)}",
                    f"workspaceDir={int(bool(workspace_dir))}",
                    f"running={int(bool(should_run))}",
                ]
            )
        )

        with self._lock:
            self._enabled = bool(should_run)
            self._token = token if should_run else ""
            self._allowed_users = allowed if should_run else set()
            self._allow_groups = bool(allow_groups) if should_run else False
            self._composer = _default_composer_for_telegram(settings_obj) if should_run else {"channel": "telegram", "toolMode": "auto"}
            self._poll_interval_ms = poll_interval_ms if should_run else 1500

            alive = self._thread is not None and self._thread.is_alive()
            if should_run and not alive:
                self._stop.clear()
                self._thread = threading.Thread(target=self._run, name="telegram-poller", daemon=True)
                self._thread.start()
                return
            if (not should_run) and alive:
                self._stop.set()

    def stop(self) -> None:
        with self._lock:
            self._enabled = False
            self._token = ""
            self._allowed_users = set()
            self._allow_groups = False
            self._poll_interval_ms = 1500
            self._composer = {"channel": "telegram", "toolMode": "auto"}
            if self._thread is None:
                return
            self._stop.set()
            t = self._thread
        try:
            t.join(timeout=2.0)
        except Exception:
            pass

    def _snapshot(self) -> Tuple[bool, str, Set[str], bool, int, Dict[str, Any]]:
        with self._lock:
            return (
                self._enabled,
                self._token,
                set(self._allowed_users),
                self._allow_groups,
                int(self._poll_interval_ms),
                dict(self._composer) if isinstance(self._composer, dict) else {"channel": "telegram", "toolMode": "auto"},
            )

    def _run(self) -> None:
        offset: Optional[int] = None
        synced = False
        last_getupdates_err_ts = 0.0
        last_bad_updates_ts = 0.0
        last_unauth_ts = 0.0
        last_group_filtered_ts = 0.0
        last_run_err_ts = 0.0
        last_send_err_ts = 0.0

        while not self._stop.is_set():
            enabled, token, allowed_users, allow_groups, poll_interval_ms, composer = self._snapshot()
            if not enabled or not token or not allowed_users:
                time.sleep(0.2)
                continue

            try:
                updates = _tg_api_call(
                    token,
                    "getUpdates",
                    {
                        "timeout": 25,
                        "offset": offset,
                        "allowed_updates": json.dumps(["message", "edited_message"], ensure_ascii=False),
                    },
                )
            except Exception as e:
                now = time.time()
                if now - last_getupdates_err_ts >= 5.0:
                    _tg_debug(f"getUpdates exception={repr(e)}")
                    last_getupdates_err_ts = now
                time.sleep(max(0.2, poll_interval_ms / 1000.0))
                continue

            ok = bool(updates.get("ok"))
            result = updates.get("result")
            if not ok or not isinstance(result, list):
                now = time.time()
                if now - last_bad_updates_ts >= 5.0:
                    desc = ""
                    try:
                        desc = str(updates.get("description") or updates.get("error") or "").strip()
                    except Exception:
                        desc = ""
                    _tg_debug(f"getUpdates bad ok={int(bool(ok))} resultType={type(result).__name__} desc={desc[:200]}")
                    last_bad_updates_ts = now
                time.sleep(max(0.2, poll_interval_ms / 1000.0))
                continue

            if not synced:
                if result:
                    mx = 0
                    for u in result:
                        if not isinstance(u, dict):
                            continue
                        try:
                            mx = max(mx, int(u.get("update_id") or 0))
                        except Exception:
                            continue
                    if mx > 0:
                        offset = mx + 1
                synced = True
                time.sleep(max(0.2, poll_interval_ms / 1000.0))
                continue

            for u in result:
                if not isinstance(u, dict):
                    continue
                try:
                    update_id = int(u.get("update_id") or 0)
                except Exception:
                    update_id = 0
                if update_id > 0:
                    offset = update_id + 1

                msg = u.get("message")
                if not isinstance(msg, dict):
                    msg = u.get("edited_message")
                if not isinstance(msg, dict):
                    continue

                text = msg.get("text")
                if not isinstance(text, str) or not text.strip():
                    caption = msg.get("caption")
                    text = caption if isinstance(caption, str) else ""
                if not isinstance(text, str):
                    text = ""

                from_id = _from_user_id(msg)
                if not from_id or from_id not in allowed_users:
                    now = time.time()
                    if now - last_unauth_ts >= 10.0:
                        _tg_debug(f"skip unauthorized from={from_id or '(empty)'} allowed={len(allowed_users)}")
                        last_unauth_ts = now
                    continue

                if _is_group_message(msg) and not allow_groups:
                    now = time.time()
                    if now - last_group_filtered_ts >= 10.0:
                        cid = _chat_id_from_message(msg)
                        _tg_debug(f"skip group chat={cid or '(empty)'} allowGroups=0")
                        last_group_filtered_ts = now
                    continue

                thread_id = _thread_id_from_message(msg)
                chat_id = _chat_id_from_message(msg)
                if not thread_id or not chat_id:
                    continue
                try:
                    reply_to_message_id = int(msg.get("message_id") or 0)
                except Exception:
                    reply_to_message_id = 0

                workspace_dir = str(composer.get("workspaceDir") or "").strip()
                saved_images: List[str] = []
                photo = msg.get("photo")
                has_image = False
                if isinstance(photo, list) and photo:
                    has_image = True
                    best = None
                    for item in photo:
                        if not isinstance(item, dict):
                            continue
                        if not isinstance(item.get("file_id"), str):
                            continue
                        sz = item.get("file_size")
                        if best is None:
                            best = item
                            continue
                        try:
                            if int(sz or 0) >= int(best.get("file_size") or 0):
                                best = item
                        except Exception:
                            best = item
                    if isinstance(best, dict):
                        file_id = str(best.get("file_id") or "").strip()
                        uniq = str(best.get("file_unique_id") or "").strip()
                        if file_id and workspace_dir:
                            outp = _save_telegram_image_to_workspace(
                                token=token,
                                file_id=file_id,
                                file_unique_id=uniq,
                                workspace_dir=workspace_dir,
                            )
                            if isinstance(outp, str) and outp:
                                saved_images.append(outp)

                if not saved_images:
                    doc = msg.get("document")
                    if isinstance(doc, dict):
                        mime = str(doc.get("mime_type") or "").lower().strip()
                        fname = str(doc.get("file_name") or "").strip()
                        if mime.startswith("image/") or _is_image_file_name(fname):
                            has_image = True
                        if (mime.startswith("image/") or _is_image_file_name(fname)) and workspace_dir:
                            file_id = str(doc.get("file_id") or "").strip()
                            uniq = str(doc.get("file_unique_id") or "").strip()
                            if file_id:
                                outp = _save_telegram_image_to_workspace(
                                    token=token,
                                    file_id=file_id,
                                    file_unique_id=uniq,
                                    workspace_dir=workspace_dir,
                                )
                                if isinstance(outp, str) and outp:
                                    saved_images.append(outp)

                if saved_images and workspace_dir:
                    try:
                        from anima_backend_shared.util import norm_abs

                        wdir_abs = norm_abs(workspace_dir)
                        rels = []
                        for p in saved_images:
                            try:
                                rels.append(os.path.relpath(p, wdir_abs))
                            except Exception:
                                rels.append(p)
                        addon = "\n\nTelegram images saved:\n" + "\n".join([f"- {r}" for r in rels])
                        text = (text or "").strip()
                        text = (text + addon).strip() if text else addon.strip()
                    except Exception:
                        pass

                if not (str(text or "").strip()):
                    audio_spec = _extract_audio_file_spec_from_message(msg)
                    if isinstance(audio_spec, dict):
                        file_id = str(audio_spec.get("file_id") or "").strip()
                        size = audio_spec.get("file_size")
                        try:
                            size = int(size or 0)
                        except Exception:
                            size = 0
                        if size and size > (25 * 1024 * 1024):
                            try:
                                _tg_send_message(token, chat_id, "语音文件过大，无法处理。", reply_to_message_id=reply_to_message_id)
                            except Exception:
                                pass
                            continue
                        if file_id:
                            lang_hint = ""
                            try:
                                lang_hint = str((msg.get("from") or {}).get("language_code") or "").strip()
                            except Exception:
                                lang_hint = ""
                            ok, out = _transcribe_telegram_audio(token=token, file_id=file_id, lang_hint=lang_hint)
                            if ok:
                                text = out
                            else:
                                try:
                                    _tg_send_message(token, chat_id, out, reply_to_message_id=reply_to_message_id)
                                except Exception:
                                    pass
                                continue

                if not (str(text or "").strip()) and not saved_images:
                    if has_image and not workspace_dir:
                        try:
                            _tg_send_message(
                                token,
                                chat_id,
                                "未配置 workspaceDir，无法保存图片。请在设置中选择工作区目录。",
                                reply_to_message_id=reply_to_message_id,
                            )
                        except Exception:
                            pass
                    continue

                txt_preview = ""
                try:
                    compact = str(text or "").strip().replace("\r", "\n").replace("\n", " ")
                    txt_preview = compact[:120]
                except Exception:
                    txt_preview = ""
                _tg_debug(
                    "inbound "
                    + " ".join(
                        [
                            f"chat={chat_id}",
                            f"thread={thread_id}",
                            f"from={from_id}",
                            f"textLen={len(str(text or '').strip())}",
                            f"images={len(saved_images)}",
                            f"workspaceDir={int(bool(workspace_dir))}",
                            f"textPreview={json.dumps(txt_preview, ensure_ascii=False)}",
                        ]
                    )
                )

                try:
                    from anima_backend_shared.database import add_message

                    add_message(
                        thread_id,
                        {
                            "role": "user",
                            "content": text,
                            "meta": {
                                "source": "telegram",
                                "telegram": {
                                    "fromUserId": from_id,
                                    "chatId": chat_id,
                                    "savedImagePaths": saved_images if saved_images else None,
                                },
                            },
                        },
                    )
                except Exception:
                    pass

                try:
                    from anima_backend_core.api.runs_stream import handle_post_runs_non_stream_via_stream_executor

                    status, payload = handle_post_runs_non_stream_via_stream_executor(
                        {
                            "threadId": thread_id,
                            "useThreadMessages": True,
                            "messages": [{"role": "user", "content": text}],
                            "composer": composer,
                        }
                    )
                except Exception:
                    status, payload = 500, {"ok": False, "error": "run failed"}

                if status == 200 and isinstance(payload, dict) and payload.get("ok") is True:
                    reply = str(payload.get("content") or "").strip() or "(empty)"
                    run_id = str(payload.get("runId") or "").strip()
                    try:
                        from anima_backend_shared.database import add_message

                        add_message(
                            thread_id,
                            {
                                "role": "assistant",
                                "content": reply,
                                "meta": {"source": "telegram", "runId": run_id or None},
                            },
                        )
                    except Exception:
                        pass
                else:
                    err = ""
                    if isinstance(payload, dict):
                        err = str(payload.get("error") or "").strip()
                    reply = err or "Failed to generate a response."
                    now = time.time()
                    if now - last_run_err_ts >= 5.0:
                        _tg_debug(f"run failed status={status} err={json.dumps(reply[:300], ensure_ascii=False)}")
                        last_run_err_ts = now
                _tg_debug(f"reply len={len(reply)}")

                try:
                    send_base_dir = _default_send_base_dir(workspace_dir)
                    img_path = _extract_image_from_artifacts(payload.get("artifacts") if isinstance(payload, dict) else None, send_base_dir)
                    video_path = None
                    if not img_path:
                        video_path = _extract_video_from_artifacts(payload.get("artifacts") if isinstance(payload, dict) else None, send_base_dir)
                    file_path = None
                    if not img_path and not video_path:
                        file_path = _extract_file_from_artifacts(payload.get("artifacts") if isinstance(payload, dict) else None, send_base_dir)
                    if not img_path:
                        img_path = _extract_image_from_traces(payload.get("traces") if isinstance(payload, dict) else None, send_base_dir)
                    caption = reply
                    if not img_path:
                        img_path, caption = _extract_image_to_send_from_reply(reply, send_base_dir)
                    if img_path:
                        try:
                            too_large = False
                            try:
                                too_large = int(os.path.getsize(img_path)) > (9 * 1024 * 1024)
                            except Exception:
                                too_large = False
                            if too_large:
                                _tg_send_document(token, chat_id, img_path, caption, reply_to_message_id=reply_to_message_id)
                            else:
                                _tg_send_photo(token, chat_id, img_path, caption, reply_to_message_id=reply_to_message_id)
                        except Exception:
                            try:
                                _tg_send_document(token, chat_id, img_path, caption, reply_to_message_id=reply_to_message_id)
                            except Exception:
                                _tg_send_message(token, chat_id, reply, reply_to_message_id=reply_to_message_id)
                    elif video_path:
                        try:
                            too_large = False
                            try:
                                too_large = int(os.path.getsize(video_path)) > (49 * 1024 * 1024)
                            except Exception:
                                too_large = False
                            if too_large:
                                _tg_send_document(token, chat_id, video_path, caption, reply_to_message_id=reply_to_message_id)
                            else:
                                _tg_send_video(token, chat_id, video_path, caption, reply_to_message_id=reply_to_message_id)
                        except Exception:
                            try:
                                _tg_send_document(token, chat_id, video_path, caption, reply_to_message_id=reply_to_message_id)
                            except Exception:
                                _tg_send_message(token, chat_id, reply, reply_to_message_id=reply_to_message_id)
                    elif file_path:
                        try:
                            _tg_send_document(token, chat_id, file_path, caption, reply_to_message_id=reply_to_message_id)
                        except Exception:
                            _tg_send_message(token, chat_id, reply, reply_to_message_id=reply_to_message_id)
                    else:
                        _tg_send_message(token, chat_id, reply, reply_to_message_id=reply_to_message_id)
                except Exception as e:
                    now = time.time()
                    if now - last_send_err_ts >= 5.0:
                        _tg_debug(f"send exception={repr(e)}")
                        last_send_err_ts = now

            time.sleep(max(0.2, poll_interval_ms / 1000.0))


_TELEGRAM_POLLER = TelegramPoller()


def reconcile_telegram_from_settings(settings_obj: Dict[str, Any]) -> None:
    _TELEGRAM_POLLER.reconcile(settings_obj)


def stop_telegram_poller() -> None:
    _TELEGRAM_POLLER.stop()
