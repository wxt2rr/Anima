import json
import os
import sqlite3
import time
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from .paths import config_root_by_platform

_DB_INITIALIZED = False
_CONFIG_ROOT: Optional[Path] = None
_CONFIG_ROOT_LOCK = threading.Lock()
_DB_LOCAL = threading.local()
_LG_DB_INITIALIZED = False
_LG_DB_LOCAL = threading.local()

SQLITE_BUSY_TIMEOUT_MS = 5000


def config_root() -> Path:
    global _CONFIG_ROOT
    cached = _CONFIG_ROOT
    if cached is not None:
        return cached
    with _CONFIG_ROOT_LOCK:
        cached = _CONFIG_ROOT
        if cached is not None:
            return cached
    root = config_root_by_platform()
    print(f"[config_root] using rule={root}")
    root.mkdir(parents=True, exist_ok=True)
    probe = root / f".probe.{uuid.uuid4().hex}"
    probe.write_text("ok", encoding="utf-8")
    try:
        probe.unlink()
    except FileNotFoundError:
        pass
    print(f"[config_root] writable ok={root}")
    _CONFIG_ROOT = root
    return root


def db_path() -> Path:
    return config_root() / "chats.db"


def langgraph_db_path() -> Path:
    root = config_root()
    lg_dir = root / "langgraph"
    lg_dir.mkdir(parents=True, exist_ok=True)
    return lg_dir / "checkpoints.db"


def init_db() -> None:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=max(1.0, SQLITE_BUSY_TIMEOUT_MS / 1000.0))
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    c = conn.cursor()

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            meta TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """
    )

    try:
        c.execute("ALTER TABLE chats ADD COLUMN meta TEXT")
    except sqlite3.OperationalError:
        pass

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            turn_id TEXT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            meta TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
        )
    """
    )
    try:
        c.execute("ALTER TABLE messages ADD COLUMN turn_id TEXT")
    except sqlite3.OperationalError:
        pass

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS settings_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            scope TEXT NOT NULL,
            target TEXT,
            reason TEXT,
            before_data TEXT NOT NULL,
            after_data TEXT NOT NULL,
            meta TEXT,
            created_at INTEGER NOT NULL
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS provider_credentials (
            provider_id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider_id, profile_id)
        )
        """
    )

    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages (chat_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats (updated_at DESC)")

    conn.commit()
    conn.close()


def init_langgraph_db() -> None:
    path = langgraph_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=max(1.0, SQLITE_BUSY_TIMEOUT_MS / 1000.0))
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    c = conn.cursor()
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            status TEXT NOT NULL,
            input TEXT,
            output TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs (updated_at DESC)")
    conn.commit()
    conn.close()


def _ensure_db_initialized() -> None:
    global _DB_INITIALIZED
    if _DB_INITIALIZED:
        return
    init_db()
    _DB_INITIALIZED = True


def _ensure_langgraph_db_initialized() -> None:
    global _LG_DB_INITIALIZED
    if _LG_DB_INITIALIZED:
        return
    init_langgraph_db()
    _LG_DB_INITIALIZED = True


def _ensure_app_settings_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )


def _ensure_settings_revisions_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS settings_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            scope TEXT NOT NULL,
            target TEXT,
            reason TEXT,
            before_data TEXT NOT NULL,
            after_data TEXT NOT NULL,
            meta TEXT,
            created_at INTEGER NOT NULL
        )
        """
    )


def get_app_settings() -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        _ensure_app_settings_table(conn)
        row = conn.execute("SELECT data FROM app_settings WHERE id = 1").fetchone()
    except sqlite3.OperationalError:
        close_db_connection()
        return None
    if not row:
        return None
    try:
        return json.loads(row["data"])
    except Exception:
        return None


def get_app_settings_info() -> Tuple[Optional[Dict[str, Any]], Optional[int]]:
    conn = get_db_connection()
    try:
        _ensure_app_settings_table(conn)
        row = conn.execute("SELECT data, updated_at FROM app_settings WHERE id = 1").fetchone()
    except sqlite3.OperationalError:
        close_db_connection()
        return None, None
    if not row:
        return None, None
    updated_at = row["updated_at"]
    try:
        obj = json.loads(row["data"])
        return (obj if isinstance(obj, dict) else None), updated_at
    except Exception:
        return None, updated_at


def set_app_settings(data: Dict[str, Any]) -> None:
    conn = get_db_connection()
    now = int(time.time() * 1000)
    payload = json.dumps(data, ensure_ascii=False)
    _ensure_app_settings_table(conn)
    try:
        conn.execute(
            "INSERT INTO app_settings (id, data, updated_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (payload, now),
        )
    except sqlite3.OperationalError:
        cur = conn.execute("UPDATE app_settings SET data = ?, updated_at = ? WHERE id = 1", (payload, now))
        if cur.rowcount == 0:
            conn.execute("INSERT INTO app_settings (id, data, updated_at) VALUES (1, ?, ?)", (payload, now))
    conn.commit()
    return


def add_settings_revision(
    actor: str,
    action: str,
    scope: str,
    before_data: Dict[str, Any],
    after_data: Dict[str, Any],
    target: str = "",
    reason: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> int:
    conn = get_db_connection()
    _ensure_settings_revisions_table(conn)
    now = int(time.time() * 1000)
    before_payload = json.dumps(before_data, ensure_ascii=False)
    after_payload = json.dumps(after_data, ensure_ascii=False)
    meta_payload = json.dumps(meta, ensure_ascii=False) if isinstance(meta, dict) else None
    cur = conn.execute(
        """
        INSERT INTO settings_revisions
        (actor, action, scope, target, reason, before_data, after_data, meta, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(actor or "unknown"),
            str(action or "update"),
            str(scope or "global"),
            str(target or ""),
            str(reason or ""),
            before_payload,
            after_payload,
            meta_payload,
            now,
        ),
    )
    conn.commit()
    return int(cur.lastrowid or 0)


def get_settings_revision(revision_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    _ensure_settings_revisions_table(conn)
    row = conn.execute(
        "SELECT id, actor, action, scope, target, reason, before_data, after_data, meta, created_at FROM settings_revisions WHERE id = ?",
        (int(revision_id),),
    ).fetchone()
    if not row:
        return None
    out: Dict[str, Any] = {
        "id": int(row["id"]),
        "actor": str(row["actor"] or ""),
        "action": str(row["action"] or ""),
        "scope": str(row["scope"] or ""),
        "target": str(row["target"] or ""),
        "reason": str(row["reason"] or ""),
        "createdAt": int(row["created_at"] or 0),
    }
    try:
        out["before"] = json.loads(row["before_data"])
    except Exception:
        out["before"] = None
    try:
        out["after"] = json.loads(row["after_data"])
    except Exception:
        out["after"] = None
    try:
        out["meta"] = json.loads(row["meta"]) if row["meta"] else None
    except Exception:
        out["meta"] = None
    return out


def list_settings_revisions(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    _ensure_settings_revisions_table(conn)
    n = max(1, min(500, int(limit or 50)))
    rows = conn.execute(
        """
        SELECT id, actor, action, scope, target, reason, created_at
        FROM settings_revisions
        ORDER BY id DESC
        LIMIT ?
        """,
        (n,),
    ).fetchall()
    out: List[Dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "id": int(row["id"]),
                "actor": str(row["actor"] or ""),
                "action": str(row["action"] or ""),
                "scope": str(row["scope"] or ""),
                "target": str(row["target"] or ""),
                "reason": str(row["reason"] or ""),
                "createdAt": int(row["created_at"] or 0),
            }
        )
    return out


def _configure_connection(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.row_factory = sqlite3.Row


def close_db_connection() -> None:
    conn = getattr(_DB_LOCAL, "conn", None)
    if conn is None:
        return
    try:
        conn.close()
    finally:
        _DB_LOCAL.conn = None


def close_langgraph_db_connection() -> None:
    conn = getattr(_LG_DB_LOCAL, "conn", None)
    if conn is None:
        return
    try:
        conn.close()
    finally:
        _LG_DB_LOCAL.conn = None


def get_db_connection() -> sqlite3.Connection:
    _ensure_db_initialized()
    cached = getattr(_DB_LOCAL, "conn", None)
    if cached is not None:
        return cached

    dp = db_path()
    conn = sqlite3.connect(dp, timeout=max(1.0, SQLITE_BUSY_TIMEOUT_MS / 1000.0))
    _configure_connection(conn)
    _DB_LOCAL.conn = conn
    return conn


def get_langgraph_db_connection() -> sqlite3.Connection:
    _ensure_langgraph_db_initialized()
    cached = getattr(_LG_DB_LOCAL, "conn", None)
    if cached is not None:
        return cached

    dp = langgraph_db_path()
    conn = sqlite3.connect(dp, timeout=max(1.0, SQLITE_BUSY_TIMEOUT_MS / 1000.0))
    _configure_connection(conn)
    _LG_DB_LOCAL.conn = conn
    return conn


def create_run(run_id: str, thread_id: str, input_obj: Dict[str, Any]) -> None:
    conn = get_langgraph_db_connection()
    now = int(time.time() * 1000)
    payload = json.dumps(input_obj, ensure_ascii=False)
    conn.execute(
        "INSERT INTO runs (id, thread_id, status, input, output, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (run_id, thread_id, "running", payload, None, now, now),
    )
    conn.commit()


def update_run(run_id: str, status: str, output_obj: Optional[Dict[str, Any]] = None) -> None:
    conn = get_langgraph_db_connection()
    now = int(time.time() * 1000)
    payload = json.dumps(output_obj, ensure_ascii=False) if isinstance(output_obj, dict) else None
    conn.execute(
        "UPDATE runs SET status = ?, output = ?, updated_at = ? WHERE id = ?",
        (status, payload, now, run_id),
    )
    conn.commit()


def get_run(run_id: str) -> Optional[Dict[str, Any]]:
    conn = get_langgraph_db_connection()
    row = conn.execute(
        "SELECT id, thread_id, status, input, output, created_at, updated_at FROM runs WHERE id = ?",
        (run_id,),
    ).fetchone()
    if not row:
        return None
    input_obj = None
    output_obj = None
    if row["input"]:
        try:
            input_obj = json.loads(row["input"])
        except Exception:
            input_obj = None
    if row["output"]:
        try:
            output_obj = json.loads(row["output"])
        except Exception:
            output_obj = None
    return {
        "id": row["id"],
        "threadId": row["thread_id"],
        "status": row["status"],
        "input": input_obj,
        "output": output_obj,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_chats() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    chats = conn.execute("SELECT * FROM chats ORDER BY updated_at DESC").fetchall()

    res = []
    for c in chats:
        d = {
            "id": c["id"],
            "title": c["title"],
            "createdAt": c["created_at"],
            "updatedAt": c["updated_at"],
        }
        if c["meta"]:
            try:
                d["meta"] = json.loads(c["meta"])
            except Exception:
                d["meta"] = None
        res.append(d)
    return res


def get_chat(chat_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    chat = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if not chat:
        return None

    messages = conn.execute("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC", (chat_id,)).fetchall()

    res = {"id": chat["id"], "title": chat["title"], "createdAt": chat["created_at"], "updatedAt": chat["updated_at"]}
    if chat["meta"]:
        try:
            res["meta"] = json.loads(chat["meta"])
        except Exception:
            res["meta"] = None

    msgs = []
    for m in messages:
        d = {"id": m["id"], "role": m["role"], "content": m["content"], "timestamp": m["created_at"]}
        if "turn_id" in m.keys():
            turn_id = str(m["turn_id"] or "").strip()
            if turn_id:
                d["turnId"] = turn_id
        if m["meta"]:
            try:
                d["meta"] = json.loads(m["meta"])
            except Exception:
                d["meta"] = None
        msgs.append(d)
    res["messages"] = msgs
    return res


def get_chat_meta(chat_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    chat = conn.execute("SELECT meta FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if not chat:
        return None
    raw = chat["meta"]
    if not raw:
        return {}
    try:
        v = json.loads(raw)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def _deep_merge_meta(dst: Any, src: Any) -> Any:
    if isinstance(dst, dict) and isinstance(src, dict):
        for k, v in src.items():
            dst[k] = _deep_merge_meta(dst.get(k), v)
        return dst
    return src


def merge_chat_meta(chat_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = get_chat_meta(chat_id)
    base: Dict[str, Any] = current if isinstance(current, dict) else {}
    merged = _deep_merge_meta(dict(base), patch)
    update_chat(chat_id, {"meta": merged})
    return merged if isinstance(merged, dict) else {}


def create_chat(title: str = "New Chat") -> Dict[str, Any]:
    conn = get_db_connection()
    now = int(time.time() * 1000)
    chat_id = str(uuid4())
    conn.execute("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", (chat_id, title, now, now))
    conn.commit()
    return {"id": chat_id, "title": title, "createdAt": now, "updatedAt": now, "messages": []}


def update_chat(chat_id: str, updates: Dict[str, Any]) -> None:
    conn = get_db_connection()
    now = int(time.time() * 1000)

    fields = []
    values = []
    if "title" in updates:
        fields.append("title = ?")
        values.append(updates["title"])

    if "meta" in updates:
        fields.append("meta = ?")
        val = json.dumps(updates["meta"]) if updates["meta"] else None
        values.append(val)

    fields.append("updated_at = ?")
    values.append(now)

    values.append(chat_id)

    conn.execute(f"UPDATE chats SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()


def delete_chat(chat_id: str) -> None:
    conn = get_db_connection()
    conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    conn.commit()


def add_message(chat_id: str, message: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    now = int(time.time() * 1000)

    chat = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if not chat:
        conn.execute("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", (chat_id, "New Chat", now, now))

    msg_id = message.get("id") or str(uuid4())
    turn_id = str(message.get("turnId") or "").strip() or None
    role = message.get("role") or "user"
    content = message.get("content") or ""
    meta = json.dumps(message.get("meta")) if message.get("meta") else None
    timestamp = message.get("timestamp") or now

    conn.execute(
        "INSERT INTO messages (id, chat_id, turn_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (msg_id, chat_id, turn_id, role, content, meta, timestamp),
    )
    conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id))
    conn.commit()

    out = {"id": msg_id, "role": role, "content": content, "meta": message.get("meta"), "timestamp": timestamp}
    if turn_id:
        out["turnId"] = turn_id
    return out


def update_message(chat_id: str, msg_id: str, updates: Dict[str, Any]) -> None:
    conn = get_db_connection()
    fields = []
    values = []
    if "content" in updates:
        fields.append("content = ?")
        values.append(updates["content"])
    if "meta" in updates:
        fields.append("meta = ?")
        val = json.dumps(updates["meta"]) if updates["meta"] else None
        values.append(val)
    if "role" in updates:
        fields.append("role = ?")
        values.append(updates["role"])
    if "turnId" in updates:
        fields.append("turn_id = ?")
        values.append(str(updates["turnId"] or "").strip() or None)

    if not fields:
        return

    values.append(chat_id)
    values.append(msg_id)

    conn.execute(f"UPDATE messages SET {', '.join(fields)} WHERE chat_id = ? AND id = ?", values)
    conn.commit()


def import_chats(chats: List[Dict[str, Any]]) -> None:
    conn = get_db_connection()

    for chat in chats:
        chat_id = chat.get("id")
        if not chat_id:
            continue

        curr = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if curr:
            continue

        title = chat.get("title") or "New Chat"
        created_at = chat.get("createdAt") or int(time.time() * 1000)
        updated_at = chat.get("updatedAt") or created_at
        meta = json.dumps(chat.get("meta")) if chat.get("meta") else None

        conn.execute("INSERT INTO chats (id, title, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", (chat_id, title, meta, created_at, updated_at))

        messages = chat.get("messages") or []
        for msg in messages:
            msg_id = msg.get("id") or str(uuid4())
            turn_id = str(msg.get("turnId") or "").strip() or None
            role = msg.get("role") or "user"
            content = msg.get("content") or ""
            meta = json.dumps(msg.get("meta")) if msg.get("meta") else None
            msg_created = msg.get("timestamp") or updated_at

            conn.execute(
                "INSERT INTO messages (id, chat_id, turn_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (msg_id, chat_id, turn_id, role, content, meta, msg_created),
            )

    conn.commit()
    return


def is_db_empty() -> bool:
    conn = get_db_connection()
    count = conn.execute("SELECT count(*) as c FROM chats").fetchone()["c"]
    return count == 0


def export_snapshot() -> Dict[str, Any]:
    conn = get_db_connection()
    chats = conn.execute("SELECT * FROM chats ORDER BY updated_at DESC").fetchall()
    messages = conn.execute("SELECT * FROM messages ORDER BY created_at ASC, rowid ASC").fetchall()
    row = conn.execute("SELECT data, updated_at FROM app_settings WHERE id = 1").fetchone()

    by_chat_id: Dict[str, List[Dict[str, Any]]] = {}
    for m in messages:
        meta_val: Any = None
        if m["meta"]:
            try:
                meta_val = json.loads(m["meta"])
            except Exception:
                meta_val = None
        by_chat_id.setdefault(m["chat_id"], []).append(
            {
                "id": m["id"],
                "turnId": str(m["turn_id"]).strip() if ("turn_id" in m.keys() and m["turn_id"] is not None) else None,
                "role": m["role"],
                "content": m["content"],
                "timestamp": m["created_at"],
                "meta": meta_val,
            }
        )

    exported_chats: List[Dict[str, Any]] = []
    for c in chats:
        meta_val: Any = None
        if c["meta"]:
            try:
                meta_val = json.loads(c["meta"])
            except Exception:
                meta_val = None
        exported_chats.append(
            {
                "id": c["id"],
                "title": c["title"],
                "createdAt": c["created_at"],
                "updatedAt": c["updated_at"],
                "meta": meta_val,
                "messages": by_chat_id.get(c["id"], []),
            }
        )

    app_settings: Any = None
    if row and row["data"]:
        try:
            app_settings = json.loads(row["data"])
        except Exception:
            app_settings = None
    if isinstance(app_settings, dict):
        providers = app_settings.get("providers")
        if isinstance(providers, list):
            for p in providers:
                if not isinstance(p, dict):
                    continue
                cfg = p.get("config")
                if isinstance(cfg, dict):
                    cfg["apiKey"] = ""
        s = app_settings.get("settings")
        if isinstance(s, dict):
            im = s.get("im")
            if isinstance(im, dict):
                tg = im.get("telegram")
                if isinstance(tg, dict):
                    tg["botToken"] = ""

    return {"version": 4, "exportedAt": int(time.time() * 1000), "appSettings": app_settings, "chats": exported_chats}


def import_snapshot(data: Dict[str, Any]) -> None:
    if not isinstance(data, dict):
        raise ValueError("Invalid JSON")

    if isinstance(data.get("appSettings"), dict):
        set_app_settings(data["appSettings"])
    elif isinstance(data.get("settings"), dict) and isinstance(data.get("providers"), list):
        set_app_settings(
            {"schemaVersion": int(data.get("schemaVersion") or 0), "settings": data.get("settings"), "providers": data.get("providers")}
        )

    if isinstance(data.get("chats"), list):
        import_chats(data["chats"])
    elif isinstance(data.get("messages"), list):
        chat_id = str(uuid4())
        now = int(time.time() * 1000)
        conn = get_db_connection()
        conn.execute("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", (chat_id, "Imported Chat", now, now))
        for msg in data["messages"]:
            if not isinstance(msg, dict):
                continue
            msg_id = str(msg.get("id") or uuid4())
            turn_id = str(msg.get("turnId") or "").strip() or None
            role = str(msg.get("role") or "user")
            content = str(msg.get("content") or "")
            meta = json.dumps(msg.get("meta")) if msg.get("meta") else None
            ts = int(msg.get("timestamp") or now)
            conn.execute(
                "INSERT INTO messages (id, chat_id, turn_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (msg_id, chat_id, turn_id, role, content, meta, ts),
            )
        conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id))
        conn.commit()
        return


def clear_all_data() -> None:
    conn = get_db_connection()
    conn.execute("DELETE FROM messages")
    conn.execute("DELETE FROM chats")
    conn.execute("DELETE FROM provider_credentials")
    conn.commit()

    current = get_app_settings()
    if not isinstance(current, dict):
        return

    next_settings = json.loads(json.dumps(current))

    providers = next_settings.get("providers")
    if isinstance(providers, list):
        for p in providers:
            if not isinstance(p, dict):
                continue
            cfg = p.get("config")
            if isinstance(cfg, dict):
                cfg["apiKey"] = ""

    s = next_settings.get("settings")
    if isinstance(s, dict):
        s["memories"] = []
        s["memoryEnabled"] = False

    set_app_settings(next_settings)
