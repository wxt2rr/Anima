import json
import time
from typing import Any, Dict, Optional

from .database import get_db_connection


def _ensure_table(conn: Any) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS oauth_flows (
            flow_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            state TEXT NOT NULL,
            data TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_oauth_flows_kind_state ON oauth_flows (kind, state)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_oauth_flows_expires_at ON oauth_flows (expires_at)")


def upsert_flow(flow_id: str, kind: str, state: str, data: Dict[str, Any], expires_at: int) -> None:
    fid = str(flow_id or "").strip()
    k = str(kind or "").strip()
    st = str(state or "").strip()
    if not fid:
        raise ValueError("flow_id is required")
    if not k:
        raise ValueError("kind is required")
    if expires_at <= 0:
        raise ValueError("expires_at is required")
    payload = json.dumps(data or {}, ensure_ascii=False)
    now = int(time.time() * 1000)
    conn = get_db_connection()
    _ensure_table(conn)
    conn.execute(
        """
        INSERT INTO oauth_flows (flow_id, kind, state, data, expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(flow_id) DO UPDATE SET
          kind = excluded.kind,
          state = excluded.state,
          data = excluded.data,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
        """,
        (fid, k, st, payload, int(expires_at), now, now),
    )
    conn.commit()


def get_flow(flow_id: str) -> Optional[Dict[str, Any]]:
    fid = str(flow_id or "").strip()
    if not fid:
        return None
    conn = get_db_connection()
    _ensure_table(conn)
    row = conn.execute(
        "SELECT flow_id, kind, state, data, expires_at, created_at, updated_at FROM oauth_flows WHERE flow_id = ?",
        (fid,),
    ).fetchone()
    if not row:
        return None
    try:
        data = json.loads(row["data"])
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {
        "flowId": str(row["flow_id"] or ""),
        "kind": str(row["kind"] or ""),
        "state": str(row["state"] or ""),
        "data": data,
        "expiresAt": int(row["expires_at"] or 0),
        "createdAt": int(row["created_at"] or 0),
        "updatedAt": int(row["updated_at"] or 0),
    }


def find_flow_by_kind_state(kind: str, state: str) -> Optional[Dict[str, Any]]:
    k = str(kind or "").strip()
    st = str(state or "").strip()
    if not k or not st:
        return None
    conn = get_db_connection()
    _ensure_table(conn)
    row = conn.execute(
        "SELECT flow_id, kind, state, data, expires_at, created_at, updated_at FROM oauth_flows WHERE kind = ? AND state = ? ORDER BY updated_at DESC LIMIT 1",
        (k, st),
    ).fetchone()
    if not row:
        return None
    try:
        data = json.loads(row["data"])
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {
        "flowId": str(row["flow_id"] or ""),
        "kind": str(row["kind"] or ""),
        "state": str(row["state"] or ""),
        "data": data,
        "expiresAt": int(row["expires_at"] or 0),
        "createdAt": int(row["created_at"] or 0),
        "updatedAt": int(row["updated_at"] or 0),
    }


def patch_flow_data(flow_id: str, patch: Dict[str, Any]) -> None:
    fid = str(flow_id or "").strip()
    if not fid:
        return
    if not isinstance(patch, dict):
        return
    conn = get_db_connection()
    _ensure_table(conn)
    row = conn.execute("SELECT data FROM oauth_flows WHERE flow_id = ?", (fid,)).fetchone()
    if not row:
        return
    try:
        data = json.loads(row["data"])
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    for k, v in patch.items():
        data[k] = v
    payload = json.dumps(data, ensure_ascii=False)
    now = int(time.time() * 1000)
    conn.execute("UPDATE oauth_flows SET data = ?, updated_at = ? WHERE flow_id = ?", (payload, now, fid))
    conn.commit()


def delete_flow(flow_id: str) -> None:
    fid = str(flow_id or "").strip()
    if not fid:
        return
    conn = get_db_connection()
    _ensure_table(conn)
    conn.execute("DELETE FROM oauth_flows WHERE flow_id = ?", (fid,))
    conn.commit()


def cleanup_expired(now_ms: int) -> None:
    conn = get_db_connection()
    _ensure_table(conn)
    conn.execute("DELETE FROM oauth_flows WHERE expires_at > 0 AND ? > expires_at + 30000", (int(now_ms),))
    conn.commit()

