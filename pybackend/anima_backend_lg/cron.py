from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from anima_backend_shared.database import close_db_connection, close_langgraph_db_connection
from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import config_root
from anima_backend_shared.util import is_within, norm_abs, now_ms, read_text_file


_STORE_LOCK = threading.Lock()


def _cron_dir() -> Path:
    p = config_root() / "cron"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _jobs_path() -> Path:
    return _cron_dir() / "jobs.json"


def _load_store() -> Dict[str, Any]:
    path = _jobs_path()
    if not path.exists():
        return {"version": 1, "jobs": []}
    try:
        raw = path.read_text(encoding="utf-8")
        obj = json.loads(raw)
        if isinstance(obj, dict) and isinstance(obj.get("jobs"), list):
            return obj
    except Exception:
        pass
    return {"version": 1, "jobs": []}


def _save_store(store: Dict[str, Any]) -> None:
    path = _jobs_path()
    tmp = path.with_suffix(f".tmp.{uuid.uuid4().hex}.json")
    raw = json.dumps(store, ensure_ascii=False, indent=2)
    tmp.write_text(raw, encoding="utf-8")
    os.replace(str(tmp), str(path))


def _get_jobs(store: Dict[str, Any]) -> List[Dict[str, Any]]:
    jobs = store.get("jobs")
    if not isinstance(jobs, list):
        return []
    out: List[Dict[str, Any]] = []
    for j in jobs:
        if isinstance(j, dict):
            out.append(j)
    return out


def _find_job(store: Dict[str, Any], job_id: str) -> Optional[Dict[str, Any]]:
    jid = str(job_id or "").strip()
    if not jid:
        return None
    for j in _get_jobs(store):
        if str(j.get("id") or "").strip() == jid:
            return j
    return None


def _normalize_tz(tz_name: str) -> timezone:
    name = str(tz_name or "").strip()
    if not name or name.upper() == "UTC":
        return timezone.utc
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:
        return timezone.utc


def _parse_cron_field(field: str, min_v: int, max_v: int) -> Tuple[bool, Set[int]]:
    s = str(field or "").strip()
    if not s or s == "*":
        return True, set()

    allowed: Set[int] = set()
    for part in s.split(","):
        p = part.strip()
        if not p:
            continue
        step = 1
        if "/" in p:
            base, step_s = p.split("/", 1)
            base = base.strip() or "*"
            try:
                step = int(step_s.strip())
            except Exception:
                step = 1
            step = max(1, step)
        else:
            base = p

        if base == "*":
            start, end = min_v, max_v
        elif "-" in base:
            a, b = base.split("-", 1)
            try:
                start = int(a.strip())
                end = int(b.strip())
            except Exception:
                continue
        else:
            try:
                v = int(base.strip())
            except Exception:
                continue
            start, end = v, v

        start = max(min_v, start)
        end = min(max_v, end)
        if start > end:
            continue
        for v in range(start, end + 1, step):
            allowed.add(v)

    if not allowed:
        return False, set()
    return False, allowed


def _cron_match(expr: str, tz_name: str, dt_utc: datetime) -> bool:
    parts = [p for p in str(expr or "").strip().split() if p.strip()]
    if len(parts) != 5:
        return False
    minute_s, hour_s, dom_s, month_s, dow_s = parts

    tz = _normalize_tz(tz_name)
    local = dt_utc.astimezone(tz)

    any_min, mins = _parse_cron_field(minute_s, 0, 59)
    any_hour, hours = _parse_cron_field(hour_s, 0, 23)
    any_dom, doms = _parse_cron_field(dom_s, 1, 31)
    any_month, months = _parse_cron_field(month_s, 1, 12)
    any_dow, dows = _parse_cron_field(dow_s, 0, 7)

    if not any_min and local.minute not in mins:
        return False
    if not any_hour and local.hour not in hours:
        return False
    if not any_month and local.month not in months:
        return False

    dow = (local.weekday() + 1) % 7
    dow_ok = True
    if not any_dow:
        dows_norm = set([0 if x == 7 else x for x in dows])
        dow_ok = dow in dows_norm

    dom_ok = True
    if not any_dom:
        dom_ok = local.day in doms

    if any_dom and any_dow:
        return True
    if any_dom:
        return dow_ok
    if any_dow:
        return dom_ok
    return dom_ok or dow_ok


def _compute_next_run_at(schedule: Dict[str, Any], after_ms: int) -> Optional[int]:
    at_ms = schedule.get("atMs")
    try:
        at_ms_i = int(at_ms)
    except Exception:
        return None
    if at_ms_i <= after_ms:
        return None
    return at_ms_i


def _compute_next_run_every(schedule: Dict[str, Any], after_ms: int) -> Optional[int]:
    every_ms = schedule.get("everyMs")
    try:
        interval = int(every_ms)
    except Exception:
        return None
    if interval <= 0:
        return None
    return after_ms + interval


def _compute_next_run_cron(schedule: Dict[str, Any], after_ms: int) -> Optional[int]:
    expr = str(schedule.get("expr") or "").strip()
    if not expr:
        return None
    tz_name = str(schedule.get("tz") or "UTC").strip() or "UTC"
    tz = _normalize_tz(tz_name)

    start_utc = datetime.fromtimestamp(after_ms / 1000.0, tz=timezone.utc)
    start_local = start_utc.astimezone(tz)
    cursor_local = (start_local.replace(second=0, microsecond=0) + timedelta(minutes=1)).astimezone(tz)
    deadline_local = cursor_local + timedelta(days=366)

    while cursor_local <= deadline_local:
        cursor_utc = cursor_local.astimezone(timezone.utc)
        if _cron_match(expr, tz_name, cursor_utc):
            return int(cursor_utc.timestamp() * 1000)
        cursor_local = cursor_local + timedelta(minutes=1)
    return None


def _compute_next_run(job: Dict[str, Any], after_ms: int) -> Optional[int]:
    if not bool(job.get("enabled")):
        return None
    schedule = job.get("schedule")
    if not isinstance(schedule, dict):
        return None
    kind = str(schedule.get("kind") or "").strip()
    if kind == "at":
        return _compute_next_run_at(schedule, after_ms)
    if kind == "every":
        return _compute_next_run_every(schedule, after_ms)
    if kind == "cron":
        return _compute_next_run_cron(schedule, after_ms)
    return None


def _upsert_job(job: Dict[str, Any]) -> Dict[str, Any]:
    now = now_ms()
    out = json.loads(json.dumps(job or {}))
    if not isinstance(out, dict):
        out = {}
    jid = str(out.get("id") or "").strip()
    if not jid:
        jid = f"cj_{uuid.uuid4().hex}"
        out["id"] = jid

    out.setdefault("name", "")
    out["name"] = str(out.get("name") or "").strip()
    out["enabled"] = bool(out.get("enabled"))

    schedule = out.get("schedule")
    if not isinstance(schedule, dict):
        schedule = {}
    out["schedule"] = schedule

    payload = out.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    out["payload"] = payload

    delivery = out.get("delivery")
    if delivery is not None and not isinstance(delivery, dict):
        delivery = {}
    out["delivery"] = delivery

    if not isinstance(out.get("createdAtMs"), int):
        out["createdAtMs"] = now
    out["updatedAtMs"] = now

    next_run = _compute_next_run(out, now)
    out["nextRunAtMs"] = next_run
    return out


def _execute_job_payload(job: Dict[str, Any]) -> Tuple[bool, str, Optional[str]]:
    payload = job.get("payload")
    if not isinstance(payload, dict):
        return False, "", "Invalid payload"
    kind = str(payload.get("kind") or "run").strip() or "run"

    if kind == "telegramMessage":
        chat_id = str(payload.get("chatId") or "").strip()
        text = str(payload.get("text") or "")
        if not chat_id:
            return False, "", "chatId is required"
        if bool(payload.get("ifNonEmpty")) and not text.strip():
            return True, "", None
        settings_obj = {}
        try:
            from anima_backend_shared.settings import load_settings

            settings_obj = load_settings()
        except Exception:
            settings_obj = {}

        token = ""
        try:
            s = settings_obj.get("settings")
            if isinstance(s, dict):
                im = s.get("im")
                if isinstance(im, dict):
                    tg = im.get("telegram")
                    if isinstance(tg, dict):
                        token = str(tg.get("botToken") or "").strip()
        except Exception:
            token = ""
        if not token:
            return False, "", "Telegram bot token not configured"

        try:
            from anima_backend_lg.telegram_integration import _tg_send_message

            _tg_send_message(token, chat_id, text)
            return True, "ok", None
        except Exception as e:
            return False, "", str(e)

    if kind != "run":
        return False, "", "Unsupported payload kind"

    heartbeat = payload.get("heartbeat")
    hb: Dict[str, Any] = heartbeat if isinstance(heartbeat, dict) else {}

    body: Dict[str, Any] = {}
    if isinstance(payload.get("run"), dict):
        body = json.loads(json.dumps(payload.get("run")))
    if not isinstance(body, dict):
        body = {}

    run_id = str(body.get("runId") or "").strip() or str(uuid.uuid4())
    body["runId"] = run_id
    if "threadId" not in body:
        body["threadId"] = str(payload.get("threadId") or "").strip() or run_id

    if hb:
        composer = body.get("composer")
        if not isinstance(composer, dict):
            composer = {}
            body["composer"] = composer
        workspace_dir = str(composer.get("workspaceDir") or "").strip()
        if workspace_dir:
            try:
                workspace_dir = norm_abs(workspace_dir)
            except Exception:
                workspace_dir = ""

        hb_path = ""
        if workspace_dir:
            try:
                target = norm_abs(str(Path(workspace_dir) / "HEARTBEAT.md"))
                if is_within(workspace_dir, target):
                    hb_path = target
            except Exception:
                hb_path = ""

        if hb_path and Path(hb_path).exists():
            try:
                text, _ = read_text_file(hb_path, max_bytes=200_000)
            except Exception:
                text = ""
            if _is_effectively_empty_heartbeat_md(str(text or "")):
                return True, "", None

        prompt = str(
            hb.get("prompt")
            or "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK."
        )
        body["messages"] = [{"role": "user", "content": prompt}]

    from anima_backend_lg.api.runs import handle_post_runs_non_stream

    status, resp = handle_post_runs_non_stream(body)
    if int(status) != int(HTTPStatus.OK) or not (isinstance(resp, dict) and resp.get("ok") is True):
        err = ""
        if isinstance(resp, dict):
            err = str(resp.get("error") or "").strip()
        return False, "", err or "Run failed"

    content = str(resp.get("content") or "")

    if hb:
        ack_max_chars = int(hb.get("ackMaxChars") or 300)
        if _should_suppress_heartbeat_delivery(content, ack_max_chars=ack_max_chars):
            return True, content, None

    delivery = job.get("delivery")
    if isinstance(delivery, dict) and str(delivery.get("kind") or "").strip() == "telegram":
        chat_id = str(delivery.get("chatId") or "").strip()
        if chat_id and not (bool(delivery.get("ifNonEmpty")) and not content.strip()):
            token = ""
            try:
                from anima_backend_shared.settings import load_settings

                settings_obj = load_settings()
            except Exception:
                settings_obj = {}

            try:
                s = settings_obj.get("settings")
                if isinstance(s, dict):
                    im = s.get("im")
                    if isinstance(im, dict):
                        tg = im.get("telegram")
                        if isinstance(tg, dict):
                            token = str(tg.get("botToken") or "").strip()
            except Exception:
                token = ""
            if token:
                try:
                    from anima_backend_lg.telegram_integration import _tg_send_message

                    _tg_send_message(token, chat_id, content or "(empty)")
                except Exception:
                    pass

    return True, content, None


def _is_effectively_empty_heartbeat_md(text: str) -> bool:
    for raw in (text or "").splitlines():
        s = str(raw or "").strip()
        if not s:
            continue
        if s.startswith("#"):
            continue
        if s.startswith("<!--") and s.endswith("-->"):
            continue
        return False
    return True


def _should_suppress_heartbeat_delivery(content: str, ack_max_chars: int) -> bool:
    s = str(content or "")
    if not s:
        return False
    stripped = s.strip()
    if not stripped:
        return False

    token = "HEARTBEAT_OK"
    remaining = stripped
    if remaining.startswith(token):
        remaining = remaining[len(token) :].strip()
    elif remaining.endswith(token):
        remaining = remaining[: -len(token)].strip()
    else:
        return False
    return len(remaining) <= max(0, int(ack_max_chars))


class CronService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._enabled = False
        self._poll_interval_ms = 500
        self._running: Set[str] = set()

    def reconcile(self, settings_obj: Dict[str, Any]) -> None:
        s = settings_obj.get("settings")
        if not isinstance(s, dict):
            s = {}
        cron = s.get("cron")
        if not isinstance(cron, dict):
            cron = {}
        enabled = bool(cron.get("enabled"))
        poll_ms = int(cron.get("pollIntervalMs") or 500)
        poll_ms = max(200, min(30_000, poll_ms))

        with self._lock:
            self._poll_interval_ms = poll_ms
            if enabled and not self._enabled:
                self._enabled = True
                self._stop.clear()
                t = threading.Thread(target=self._loop, name="cron-service", daemon=True)
                self._thread = t
                t.start()
                return
            if not enabled and self._enabled:
                self._enabled = False
                self._stop.set()
                return

    def stop(self) -> None:
        with self._lock:
            self._enabled = False
            self._stop.set()

    def run_now(self, job_id: str) -> bool:
        jid = str(job_id or "").strip()
        if not jid:
            return False
        with _STORE_LOCK:
            store = _load_store()
            job = _find_job(store, jid)
            if not job:
                return False
            job["enabled"] = True
            job["nextRunAtMs"] = now_ms()
            job["updatedAtMs"] = now_ms()
            _save_store(store)
        return True

    def _loop(self) -> None:
        while not self._stop.is_set():
            due_jobs: List[str] = []
            next_due_ms: Optional[int] = None
            now = now_ms()
            changed = False

            with _STORE_LOCK:
                store = _load_store()
                for job in _get_jobs(store):
                    jid = str(job.get("id") or "").strip()
                    if not jid:
                        continue
                    if not bool(job.get("enabled")):
                        if job.get("nextRunAtMs") is not None:
                            job["nextRunAtMs"] = None
                            changed = True
                        continue

                    nr = job.get("nextRunAtMs")
                    nr_i: Optional[int] = None
                    try:
                        nr_i = int(nr) if nr is not None else None
                    except Exception:
                        nr_i = None

                    if nr_i is None:
                        job["nextRunAtMs"] = _compute_next_run(job, now)
                        changed = True
                        nr_i = job.get("nextRunAtMs")
                        try:
                            nr_i = int(nr_i) if nr_i is not None else None
                        except Exception:
                            nr_i = None

                    if nr_i is not None and nr_i <= now:
                        if jid not in self._running:
                            due_jobs.append(jid)
                    if nr_i is not None:
                        if next_due_ms is None or nr_i < next_due_ms:
                            next_due_ms = nr_i

                if changed:
                    _save_store(store)

            for jid in due_jobs:
                with self._lock:
                    if self._stop.is_set():
                        break
                    if jid in self._running:
                        continue
                    self._running.add(jid)
                t = threading.Thread(target=self._run_job_thread, args=(jid,), name=f"cron-job-{jid}", daemon=True)
                t.start()

            sleep_ms = self._poll_interval_ms
            if next_due_ms is not None:
                delta = max(0, int(next_due_ms - now_ms()))
                sleep_ms = min(sleep_ms, max(200, delta))
            self._stop.wait(sleep_ms / 1000.0)

    def _run_job_thread(self, job_id: str) -> None:
        jid = str(job_id or "").strip()
        started = now_ms()
        ok = False
        out = ""
        err: Optional[str] = None

        try:
            with _STORE_LOCK:
                store = _load_store()
                job = _find_job(store, jid)
                if job:
                    job["lastRunStartedAtMs"] = started
                    job["lastStatus"] = "running"
                    job["updatedAtMs"] = started
                    _save_store(store)

            with _STORE_LOCK:
                store = _load_store()
                job = _find_job(store, jid)
                snapshot = json.loads(json.dumps(job)) if isinstance(job, dict) else None

            if isinstance(snapshot, dict):
                ok, out, err = _execute_job_payload(snapshot)
            else:
                ok, out, err = False, "", "Job not found"
        except Exception as e:
            ok, out, err = False, "", str(e)
        finally:
            ended = now_ms()
            try:
                with _STORE_LOCK:
                    store = _load_store()
                    job = _find_job(store, jid)
                    if job:
                        job["lastRunEndedAtMs"] = ended
                        job["lastRunAtMs"] = ended
                        job["lastStatus"] = "succeeded" if ok else "failed"
                        job["lastError"] = str(err or "").strip() if not ok else ""
                        job["lastOutputPreview"] = str(out or "")[:2000]
                        job["updatedAtMs"] = ended
                        job["nextRunAtMs"] = _compute_next_run(job, ended)
                        if job.get("schedule", {}).get("kind") == "at":
                            job["enabled"] = False
                        _save_store(store)
            except Exception:
                pass

            try:
                close_db_connection()
                close_langgraph_db_connection()
            except Exception:
                pass

            with self._lock:
                self._running.discard(jid)


_CRON_SERVICE = CronService()

_OPENCLAW_HEARTBEAT_JOB_ID = "cj_openclaw_heartbeat"


def _reconcile_openclaw_heartbeat_job(settings_obj: Dict[str, Any]) -> None:
    s = settings_obj.get("settings")
    if not isinstance(s, dict):
        return
    openclaw = s.get("openclaw")
    if not isinstance(openclaw, dict):
        openclaw = {}
    enabled = bool(openclaw.get("enabled")) and bool(openclaw.get("heartbeatEnabled"))

    interval_ms = int(openclaw.get("heartbeatEveryMs") or 1_800_000)
    interval_ms = max(60_000, min(24 * 60 * 60 * 1000, interval_ms))
    ack_max_chars = int(openclaw.get("heartbeatAckMaxChars") or 300)
    ack_max_chars = max(0, min(2000, ack_max_chars))

    workspace_dir = str(s.get("workspaceDir") or "").strip()
    if workspace_dir:
        try:
            workspace_dir = norm_abs(workspace_dir)
        except Exception:
            workspace_dir = ""

    tg_chat_id = str(openclaw.get("heartbeatTelegramChatId") or "").strip()

    job: Dict[str, Any] = {
        "id": _OPENCLAW_HEARTBEAT_JOB_ID,
        "name": "OpenClaw Heartbeat",
        "enabled": bool(enabled),
        "schedule": {"kind": "every", "everyMs": interval_ms},
        "payload": {
            "kind": "run",
            "run": {"threadId": "openclaw-heartbeat", "composer": {"workspaceDir": workspace_dir, "isMainSession": True}},
            "heartbeat": {"ackMaxChars": ack_max_chars},
        },
        "delivery": {"kind": "telegram", "chatId": tg_chat_id, "ifNonEmpty": True},
    }

    with _STORE_LOCK:
        store = _load_store()
        job_norm = _upsert_job(job)
        existing = _find_job(store, _OPENCLAW_HEARTBEAT_JOB_ID)
        if existing is None:
            jobs = store.get("jobs")
            if not isinstance(jobs, list):
                jobs = []
                store["jobs"] = jobs
            jobs.append(job_norm)
        else:
            existing.clear()
            existing.update(job_norm)
        store["version"] = int(store.get("version") or 1)
        if store["version"] <= 0:
            store["version"] = 1
        _save_store(store)


def reconcile_cron_from_settings(settings_obj: Dict[str, Any]) -> None:
    try:
        if isinstance(settings_obj, dict):
            _reconcile_openclaw_heartbeat_job(settings_obj)
    except Exception:
        pass
    effective = settings_obj
    try:
        s = settings_obj.get("settings")
        if isinstance(s, dict):
            openclaw = s.get("openclaw")
            if isinstance(openclaw, dict) and bool(openclaw.get("enabled")) and bool(openclaw.get("heartbeatEnabled")):
                patched = json.loads(json.dumps(settings_obj))
                ps = patched.get("settings")
                if isinstance(ps, dict):
                    cron = ps.get("cron")
                    if not isinstance(cron, dict):
                        cron = {}
                        ps["cron"] = cron
                    cron["enabled"] = True
                effective = patched
    except Exception:
        effective = settings_obj
    _CRON_SERVICE.reconcile(effective)


def stop_cron_service() -> None:
    _CRON_SERVICE.stop()


def handle_get_cron_jobs(handler: Any) -> None:
    try:
        with _STORE_LOCK:
            store = _load_store()
        json_response(handler, HTTPStatus.OK, {"ok": True, "store": store})
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def handle_post_cron_jobs(handler: Any) -> None:
    try:
        body = read_body_json(handler)
        if not isinstance(body, dict):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid JSON body"})
            return

        action = str(body.get("action") or "").strip()
        if action not in ("upsert", "delete", "run"):
            json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Unsupported action"})
            return

        if action == "run":
            jid = str(body.get("id") or "").strip()
            ok = _CRON_SERVICE.run_now(jid)
            if not ok:
                json_response(handler, HTTPStatus.NOT_FOUND, {"ok": False, "error": "Job not found"})
                return
            json_response(handler, HTTPStatus.OK, {"ok": True})
            return

        with _STORE_LOCK:
            store = _load_store()
            if action == "delete":
                jid = str(body.get("id") or "").strip()
                jobs = [j for j in _get_jobs(store) if str(j.get("id") or "").strip() != jid]
                store["jobs"] = jobs
                _save_store(store)
                json_response(handler, HTTPStatus.OK, {"ok": True, "store": store})
                return

            job_in = body.get("job")
            if not isinstance(job_in, dict):
                json_response(handler, HTTPStatus.BAD_REQUEST, {"ok": False, "error": "job must be an object"})
                return
            job_norm = _upsert_job(job_in)

            existing = _find_job(store, str(job_norm.get("id") or "").strip())
            if existing is None:
                jobs = store.get("jobs")
                if not isinstance(jobs, list):
                    jobs = []
                    store["jobs"] = jobs
                jobs.append(job_norm)
            else:
                existing.clear()
                existing.update(job_norm)

            store["version"] = int(store.get("version") or 1)
            if store["version"] <= 0:
                store["version"] = 1
            _save_store(store)
            json_response(handler, HTTPStatus.OK, {"ok": True, "job": job_norm, "store": store})
            return
    except Exception as e:
        json_response(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(e)})


def cron_list_store() -> Dict[str, Any]:
    with _STORE_LOCK:
        return _load_store()


def cron_upsert_job(job: Dict[str, Any]) -> Dict[str, Any]:
    with _STORE_LOCK:
        store = _load_store()
        job_norm = _upsert_job(job)
        existing = _find_job(store, str(job_norm.get("id") or "").strip())
        if existing is None:
            jobs = store.get("jobs")
            if not isinstance(jobs, list):
                jobs = []
                store["jobs"] = jobs
            jobs.append(job_norm)
        else:
            existing.clear()
            existing.update(job_norm)
        store["version"] = int(store.get("version") or 1)
        if store["version"] <= 0:
            store["version"] = 1
        _save_store(store)
        return job_norm


def cron_delete_job(job_id: str) -> bool:
    jid = str(job_id or "").strip()
    if not jid:
        return False
    with _STORE_LOCK:
        store = _load_store()
        before = len(_get_jobs(store))
        store["jobs"] = [j for j in _get_jobs(store) if str(j.get("id") or "").strip() != jid]
        after = len(_get_jobs(store))
        if after == before:
            return False
        _save_store(store)
        return True


def cron_run_job(job_id: str) -> bool:
    jid = str(job_id or "").strip()
    if not jid:
        return False
    return _CRON_SERVICE.run_now(jid)
