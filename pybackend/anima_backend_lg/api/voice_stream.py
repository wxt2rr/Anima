from __future__ import annotations

import json
import os
import queue
import tempfile
import threading
import time
import uuid
import wave
from http import HTTPStatus
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import load_settings
from anima_backend_shared.voice import (
    _is_local_model_dir_installed,
    _is_remote_model_installed,
    _normalize_whisper_model_id,
    get_voice_pipeline,
)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _resolve_voice_model_key_from_settings() -> Tuple[str, str]:
    raw = load_settings()
    settings_obj = raw.get("settings") if isinstance(raw, dict) else None
    voice_obj = settings_obj.get("voice") if isinstance(settings_obj, dict) else None
    voice_model_raw = voice_obj.get("model") if isinstance(voice_obj, dict) else ""
    voice_lang = voice_obj.get("language") if isinstance(voice_obj, dict) else "auto"
    model_id = _normalize_whisper_model_id(voice_model_raw)
    if not model_id:
        raise RuntimeError("Voice model is not configured")

    if model_id.startswith("local:"):
        local_path = model_id[len("local:") :].strip()
        if not local_path or not os.path.exists(local_path):
            raise RuntimeError("Local voice model path not found")
        return local_path, str(voice_lang or "auto").strip() or "auto"

    remote_models = voice_obj.get("remoteModels") if isinstance(voice_obj, dict) else None
    remote_models = remote_models if isinstance(remote_models, list) else []
    for rm in remote_models:
        if not isinstance(rm, dict):
            continue
        if str(rm.get("id") or "").strip() != model_id:
            continue
        p = str(rm.get("path") or "").strip()
        if p and _is_local_model_dir_installed(Path(p)):
            return p, str(voice_lang or "auto").strip() or "auto"

    if not _is_remote_model_installed(model_id):
        raise RuntimeError("Voice model is not installed")
    return model_id, str(voice_lang or "auto").strip() or "auto"


def _lang_generate_kwargs(voice_lang: str) -> Optional[Dict[str, Any]]:
    lang = str(voice_lang or "").strip()
    if not lang or lang == "auto":
        return None
    lang_map = {"en": "english", "zh": "chinese", "ja": "japanese"}
    return {"language": lang_map.get(lang, lang)}


def _write_wav_pcm16le(path: str, pcm: bytes, sample_rate: int) -> None:
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm)


def _transcribe_pcm16le(pcm: bytes, sample_rate: int, model_key: str, voice_lang: str) -> str:
    if not pcm:
        return ""
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name
        _write_wav_pcm16le(tmp_path, pcm, sample_rate)
        pipe = get_voice_pipeline(model_key)
        gk = _lang_generate_kwargs(voice_lang)
        result = pipe(tmp_path, generate_kwargs=gk) if gk else pipe(tmp_path)
        text = result.get("text", "") if isinstance(result, dict) else ""
        return str(text or "").strip()
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _longest_common_prefix_len(a: str, b: str) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def _stable_boundary(text: str, min_len: int) -> int:
    n = min(len(text), max(0, min_len))
    if n <= 0:
        return 0
    boundary = max(text.rfind(" ", 0, n), text.rfind("\n", 0, n), text.rfind("。", 0, n), text.rfind("，", 0, n), text.rfind(",", 0, n), text.rfind(".", 0, n), text.rfind("?", 0, n), text.rfind("!", 0, n))
    if boundary <= 0:
        return 0
    return boundary + 1


class _VoiceStreamSession:
    def __init__(self, session_id: str, sample_rate: int, update_interval_ms: int, min_update_bytes: int):
        self.session_id = session_id
        self.sample_rate = int(sample_rate)
        self.update_interval_ms = int(update_interval_ms)
        self.min_update_bytes = int(min_update_bytes)
        self.created_at = _now_ms()

        self._lock = threading.Lock()
        self._audio = bytearray()
        self._last_sent_len = 0
        self._last_update_ms = 0
        self._stop_requested = False
        self._closed = False

        self._q: "queue.Queue[Dict[str, Any]]" = queue.Queue()

        self._model_key: Optional[str] = None
        self._voice_lang: str = "auto"

        self._prev_text: str = ""
        self._committed: str = ""

        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def is_closed(self) -> bool:
        with self._lock:
            return bool(self._closed)

    def request_stop(self) -> None:
        with self._lock:
            self._stop_requested = True

    def put_audio(self, chunk: bytes) -> None:
        if not chunk:
            return
        with self._lock:
            if self._closed:
                return
            self._audio.extend(chunk)

    def get_event(self, timeout_s: float) -> Optional[Dict[str, Any]]:
        try:
            return self._q.get(timeout=timeout_s)
        except queue.Empty:
            return None

    def _emit(self, evt: Dict[str, Any]) -> None:
        try:
            self._q.put(evt, timeout=0.1)
        except Exception:
            return

    def _snapshot_audio(self) -> bytes:
        with self._lock:
            return bytes(self._audio)

    def _should_update(self, now_ms: int) -> bool:
        with self._lock:
            if self._closed:
                return False
            audio_len = len(self._audio)
            if audio_len < self._last_sent_len + self.min_update_bytes:
                return False
            if now_ms - self._last_update_ms < self.update_interval_ms:
                return False
            return True

    def _mark_updated(self, now_ms: int, audio_len: int) -> None:
        with self._lock:
            self._last_update_ms = now_ms
            self._last_sent_len = audio_len

    def _get_stop_requested(self) -> bool:
        with self._lock:
            return bool(self._stop_requested)

    def _close(self) -> None:
        with self._lock:
            self._closed = True

    def _ensure_model(self) -> None:
        if self._model_key is not None:
            return
        model_key, voice_lang = _resolve_voice_model_key_from_settings()
        self._model_key = model_key
        self._voice_lang = voice_lang

    def _compute_update(self, text: str) -> Tuple[str, str]:
        current = str(text or "").strip()
        if not current:
            return self._committed, ""

        if self._committed and not current.startswith(self._committed):
            return self._committed, current

        lcp = _longest_common_prefix_len(self._prev_text, current) if self._prev_text else 0
        boundary = _stable_boundary(current, lcp)
        if boundary > len(self._committed):
            self._committed = current[:boundary]

        interim = current[len(self._committed) :]
        self._prev_text = current
        return self._committed, interim.lstrip()

    def _run(self) -> None:
        self._emit({"type": "ready", "sessionId": self.session_id})
        try:
            while True:
                now_ms = _now_ms()
                if self._should_update(now_ms):
                    audio = self._snapshot_audio()
                    self._mark_updated(now_ms, len(audio))
                    try:
                        self._ensure_model()
                        model_key = str(self._model_key or "").strip()
                        if model_key:
                            text = _transcribe_pcm16le(audio, self.sample_rate, model_key, self._voice_lang)
                            final_text, interim_text = self._compute_update(text)
                            self._emit(
                                {
                                    "type": "voice_update",
                                    "sessionId": self.session_id,
                                    "finalText": final_text,
                                    "interimText": interim_text,
                                }
                            )
                    except Exception as e:
                        self._emit({"type": "error", "sessionId": self.session_id, "error": str(e)})

                if self._get_stop_requested():
                    audio = self._snapshot_audio()
                    try:
                        self._ensure_model()
                        model_key = str(self._model_key or "").strip()
                        text = _transcribe_pcm16le(audio, self.sample_rate, model_key, self._voice_lang) if model_key else ""
                        self._emit({"type": "voice_final", "sessionId": self.session_id, "text": str(text or "").strip()})
                    except Exception as e:
                        self._emit({"type": "error", "sessionId": self.session_id, "error": str(e)})
                    self._emit({"type": "done", "sessionId": self.session_id})
                    self._close()
                    return

                time.sleep(0.12)
        finally:
            self._close()


_SESSIONS: Dict[str, _VoiceStreamSession] = {}
_SESSIONS_LOCK = threading.Lock()


def _get_session(session_id: str) -> Optional[_VoiceStreamSession]:
    sid = str(session_id or "").strip()
    if not sid:
        return None
    with _SESSIONS_LOCK:
        return _SESSIONS.get(sid)


def handle_post_voice_stream_start(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        body = body if isinstance(body, dict) else {}
        sample_rate = int(body.get("sampleRate") or 16000)
        update_interval_ms = int(body.get("updateIntervalMs") or 1200)
        min_update_bytes = int(body.get("minUpdateBytes") or (sample_rate * 2 * 1))
        session_id = str(uuid.uuid4())
        sess = _VoiceStreamSession(session_id, sample_rate=sample_rate, update_interval_ms=update_interval_ms, min_update_bytes=min_update_bytes)
        with _SESSIONS_LOCK:
            _SESSIONS[session_id] = sess
        json_response(handler, HTTPStatus.OK, {"ok": True, "sessionId": session_id, "sampleRate": sample_rate})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_voice_stream_chunk(handler: Any) -> None:
    try:
        q = getattr(handler, "query", None) or {}
        session_id = str(q.get("sessionId") or "").strip()
        sess = _get_session(session_id)
        if not sess:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "session not found"})
            return
        content_length = int(handler.headers.get("Content-Length", 0))
        if content_length <= 0:
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "No content"})
            return
        chunk = handler.rfile.read(content_length)
        sess.put_audio(chunk)
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_voice_stream_stop(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return
        session_id = str(body.get("sessionId") or "").strip()
        sess = _get_session(session_id)
        if not sess:
            json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "session not found"})
            return
        sess.request_stop()
        json_response(handler, HTTPStatus.OK, {"ok": True})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_get_voice_stream_events(handler: Any) -> None:
    q = getattr(handler, "query", None) or {}
    session_id = str(q.get("sessionId") or "").strip()
    sess = _get_session(session_id)
    if not sess:
        json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "session not found"})
        return

    handler.send_response(HTTPStatus.OK)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("X-Accel-Buffering", "no")
    handler.send_header("Connection", "keep-alive")
    handler.end_headers()

    def _send(evt: Dict[str, Any]) -> None:
        payload = json.dumps(evt, ensure_ascii=False)
        handler.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
        try:
            handler.wfile.flush()
        except Exception:
            return

    _send({"type": "open", "sessionId": session_id})
    try:
        while True:
            evt = sess.get_event(timeout_s=0.5)
            if evt is not None:
                _send(evt)
                if str(evt.get("type") or "") == "done":
                    break
            if sess.is_closed():
                break
    except Exception:
        return
    finally:
        with _SESSIONS_LOCK:
            if session_id in _SESSIONS and _SESSIONS[session_id].is_closed():
                _SESSIONS.pop(session_id, None)

