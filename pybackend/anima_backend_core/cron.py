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

from anima_backend_shared.database import close_db_connection, close_runs_db_connection
from anima_backend_shared.http import json_response, read_body_json
from anima_backend_shared.settings import config_root
from anima_backend_shared.util import norm_abs, now_ms


_STORE_LOCK = threading.Lock()
_MAX_RUN_HISTORY = 20


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
    if str(payload.get("kind") or "run").strip() == "run":
        run = payload.get("run")
        if not isinstance(run, dict):
            run = {}
        payload["run"] = run
        thread_mode = str(run.get("threadMode") or "fixed").strip().lower()
        if thread_mode not in ("fixed", "new_chat"):
            thread_mode = "fixed"
        run["threadMode"] = thread_mode
        thread_id = str(run.get("threadId") or payload.get("threadId") or "").strip()
        if thread_mode == "fixed" and not thread_id:
            thread_id = f"cron_thread_{jid}"
        run["threadId"] = thread_id if thread_mode == "fixed" else ""
        composer = run.get("composer")
        if not isinstance(composer, dict):
            composer = {}
        run["composer"] = composer
        messages = run.get("messages")
        if not isinstance(messages, list):
            messages = []
        run["messages"] = [m for m in messages if isinstance(m, dict)]

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


def _preserve_runtime_fields(existing: Dict[str, Any], job_norm: Dict[str, Any]) -> None:
    for key in (
        "lastRunStartedAtMs",
        "lastRunEndedAtMs",
        "lastRunAtMs",
        "lastStatus",
        "lastError",
        "lastOutputPreview",
        "runHistory",
    ):
        if key in existing and key not in job_norm:
            job_norm[key] = json.loads(json.dumps(existing.get(key)))


def _automation_chat_patch(job: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    composer = body.get("composer")
    composer = composer if isinstance(composer, dict) else {}
    patch: Dict[str, Any] = {
        "automationJobId": str(job.get("id") or "").strip(),
        "automationJobName": str(job.get("name") or "").strip(),
    }
    project_id = str(composer.get("projectId") or "").strip()
    if project_id:
        patch["projectId"] = project_id
    provider_override_id = str(composer.get("providerOverrideId") or "").strip()
    if provider_override_id:
        patch["providerOverrideId"] = provider_override_id
    model_override = str(composer.get("modelOverride") or "").strip()
    if model_override:
        patch["modelOverride"] = model_override
    return patch


def _maybe_update_automation_chat_title(thread_id: str, job_name: str) -> None:
    if not thread_id:
        return
    title = str(job_name or "").strip()
    if not title:
        return
    from anima_backend_shared.database import get_chat, update_chat

    chat = get_chat(thread_id)
    current_title = str((chat or {}).get("title") or "").strip()
    if current_title and current_title != "New Chat":
        return
    update_chat(thread_id, {"title": f"Automation · {title}"})


def _append_run_history(job: Dict[str, Any], entry: Dict[str, Any]) -> None:
    history = job.get("runHistory")
    items = [x for x in history if isinstance(x, dict)] if isinstance(history, list) else []
    items.insert(0, entry)
    job["runHistory"] = items[:_MAX_RUN_HISTORY]


def _execute_job_payload(job: Dict[str, Any]) -> Dict[str, Any]:
    payload = job.get("payload")
    if not isinstance(payload, dict):
        return {"ok": False, "output": "", "error": "Invalid payload"}
    kind = str(payload.get("kind") or "run").strip() or "run"

    if kind == "telegramMessage":
        chat_id = str(payload.get("chatId") or "").strip()
        text = str(payload.get("text") or "")
        if not chat_id:
            return {"ok": False, "output": "", "error": "chatId is required"}
        if bool(payload.get("ifNonEmpty")) and not text.strip():
            return {"ok": True, "output": "", "error": None}
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
            return {"ok": False, "output": "", "error": "Telegram bot token not configured"}

        try:
            from anima_backend_core.telegram_integration import _tg_send_message

            _tg_send_message(token, chat_id, text)
            return {"ok": True, "output": "ok", "error": None}
        except Exception as e:
            return {"ok": False, "output": "", "error": str(e)}

    if kind != "run":
        return {"ok": False, "output": "", "error": "Unsupported payload kind"}

    body: Dict[str, Any] = {}
    if isinstance(payload.get("run"), dict):
        body = json.loads(json.dumps(payload.get("run")))
    if not isinstance(body, dict):
        body = {}

    run_id = str(body.get("runId") or "").strip() or str(uuid.uuid4())
    body["runId"] = run_id
    run_cfg = payload.get("run") if isinstance(payload.get("run"), dict) else {}
    thread_mode = str(run_cfg.get("threadMode") or "fixed").strip().lower()
    if thread_mode not in ("fixed", "new_chat"):
        thread_mode = "fixed"
    configured_thread_id = str(body.get("threadId") or payload.get("threadId") or "").strip()
    thread_id = run_id if thread_mode == "new_chat" else (configured_thread_id or run_id)
    body["threadId"] = thread_id

    from anima_backend_core.api.runs import handle_post_runs_non_stream

    status, resp = handle_post_runs_non_stream(body)
    if int(status) != int(HTTPStatus.OK) or not (isinstance(resp, dict) and resp.get("ok") is True):
        err = ""
        if isinstance(resp, dict):
            err = str(resp.get("error") or "").strip()
        return {"ok": False, "output": "", "error": err or "Run failed", "runId": run_id, "threadId": thread_id}

    content = str(resp.get("content") or "")
    try:
        from anima_backend_shared.database import merge_chat_meta

        merge_chat_meta(thread_id, _automation_chat_patch(job, body))
        _maybe_update_automation_chat_title(thread_id, str(job.get("name") or "").strip())
    except Exception:
        pass

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
                    from anima_backend_core.telegram_integration import _tg_send_message

                    _tg_send_message(token, chat_id, content or "(empty)", reply_to_message_id=None)
                except Exception:
                    pass

    composer = body.get("composer")
    composer = composer if isinstance(composer, dict) else {}
    return {
        "ok": True,
        "output": content,
        "error": None,
        "runId": run_id,
        "threadId": thread_id,
        "projectId": str(composer.get("projectId") or "").strip(),
        "providerOverrideId": str(composer.get("providerOverrideId") or "").strip(),
        "modelOverride": str(composer.get("modelOverride") or "").strip(),
    }


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
                result = _execute_job_payload(snapshot)
                ok = bool(result.get("ok"))
                out = str(result.get("output") or "")
                err = str(result.get("error") or "").strip() or None
            else:
                ok, out, err = False, "", "Job not found"
                result = {"threadId": "", "runId": ""}
        except Exception as e:
            ok, out, err = False, "", str(e)
            result = {"threadId": "", "runId": ""}
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
                        _append_run_history(
                            job,
                            {
                                "id": f"cjr_{uuid.uuid4().hex}",
                                "runId": str(result.get("runId") or "").strip(),
                                "threadId": str(result.get("threadId") or "").strip(),
                                "projectId": str(result.get("projectId") or "").strip(),
                                "providerOverrideId": str(result.get("providerOverrideId") or "").strip(),
                                "modelOverride": str(result.get("modelOverride") or "").strip(),
                                "status": "succeeded" if ok else "failed",
                                "startedAtMs": started,
                                "endedAtMs": ended,
                                "durationMs": max(0, ended - started),
                                "error": str(err or "").strip(),
                                "outputPreview": str(out or "")[:2000],
                            },
                        )
                        if job.get("schedule", {}).get("kind") == "at":
                            job["enabled"] = False
                        _save_store(store)
            except Exception:
                pass

            try:
                close_db_connection()
                close_runs_db_connection()
            except Exception:
                pass

            with self._lock:
                self._running.discard(jid)


_CRON_SERVICE = CronService()

def reconcile_cron_from_settings(settings_obj: Dict[str, Any]) -> None:
    _CRON_SERVICE.reconcile(settings_obj)


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
                _preserve_runtime_fields(existing, job_norm)
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
