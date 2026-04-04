from __future__ import annotations

import json
import math
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .memory_embedding import embed_text
from .settings import config_root, load_settings


def _now_ms() -> int:
    return int(time.time() * 1000)


def _memory_db_path(workspace_dir: str) -> Path:
    root = Path(str(workspace_dir or "").strip()).expanduser().resolve()
    return root / ".anima" / "memory_store.db"


def _global_memory_workspace_dir() -> str:
    root = config_root() / "global_memory"
    root.mkdir(parents=True, exist_ok=True)
    return str(root.resolve())


def global_memory_workspace_dir() -> str:
    return _global_memory_workspace_dir()


def _safe_float(raw: Any, default_v: float) -> float:
    try:
        v = float(raw)
    except Exception:
        v = float(default_v)
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return v


def _tokenize(text: str) -> List[str]:
    s = str(text or "").lower().strip()
    if not s:
        return []
    toks = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]", s)
    return [x for x in toks if x.strip()]


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n <= 0:
        return 0.0
    return float(sum(a[i] * b[i] for i in range(n)))


def _text_jaccard(a: str, b: str) -> float:
    ta = set(_tokenize(a))
    tb = set(_tokenize(b))
    if not ta or not tb:
        return 0.0
    inter = len(ta.intersection(tb))
    union = len(ta.union(tb))
    if union <= 0:
        return 0.0
    return float(inter / union)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            type TEXT NOT NULL,
            importance REAL NOT NULL,
            confidence REAL NOT NULL,
            source TEXT,
            run_id TEXT,
            user_id TEXT,
            evidence_json TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            embedding_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            status TEXT NOT NULL,
            forgotten_at INTEGER NOT NULL DEFAULT 0,
            superseded_by TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memories_status_created ON memories (status, created_at DESC)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_ann (
            bucket TEXT NOT NULL,
            memory_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (bucket, memory_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_ann_memory_id ON memory_ann (memory_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_edges (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            relation TEXT NOT NULL,
            weight REAL NOT NULL,
            source TEXT,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_edges_from ON memory_edges (from_id, status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_edges_to ON memory_edges (to_id, status)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_conflicts (
            id TEXT PRIMARY KEY,
            old_memory_id TEXT NOT NULL,
            new_memory_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            similarity REAL NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS memory_metrics_daily (
            day TEXT NOT NULL,
            event TEXT NOT NULL,
            total_count INTEGER NOT NULL,
            success_count INTEGER NOT NULL,
            total_latency_ms INTEGER NOT NULL,
            PRIMARY KEY (day, event)
        )
        """
    )


def _connect(workspace_dir: str) -> sqlite3.Connection:
    p = _memory_db_path(workspace_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, timeout=5.0)
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn)
    return conn


def _embedding_buckets(vec: List[float], buckets: int = 8, width: int = 24) -> List[str]:
    if not vec:
        return []
    out: List[str] = []
    dim = len(vec)
    for i in range(max(1, int(buckets))):
        start = (i * int(width)) % dim
        bits = 0
        for j in range(max(8, int(width))):
            v = vec[(start + j) % dim]
            if v >= 0:
                bits |= (1 << (j % 31))
        out.append(f"b{i}:{bits:08x}")
    return out


def _refresh_ann_rows(conn: sqlite3.Connection, memory_id: str, embedding: List[float], created_at: int) -> None:
    mid = str(memory_id or "").strip()
    if not mid:
        return
    conn.execute("DELETE FROM memory_ann WHERE memory_id=?", (mid,))
    for b in _embedding_buckets(embedding):
        conn.execute(
            "INSERT OR REPLACE INTO memory_ann (bucket, memory_id, created_at) VALUES (?, ?, ?)",
            (str(b), mid, int(created_at)),
        )


def _record_metric(conn: sqlite3.Connection, *, event: str, success: bool, latency_ms: int) -> None:
    day = time.strftime("%Y-%m-%d", time.localtime())
    conn.execute(
        """
        INSERT INTO memory_metrics_daily (day, event, total_count, success_count, total_latency_ms)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(day, event) DO UPDATE SET
            total_count = total_count + 1,
            success_count = success_count + excluded.success_count,
            total_latency_ms = total_latency_ms + excluded.total_latency_ms
        """,
        (day, str(event or "").strip() or "unknown", 1 if bool(success) else 0, max(0, int(latency_ms or 0))),
    )


def add_memory_item(
    *,
    workspace_dir: str,
    content: str,
    memory_type: str,
    importance: float,
    confidence: float,
    source: str,
    run_id: str,
    user_id: str,
    evidence: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    ttl_days: int = 0,
) -> Dict[str, Any]:
    started = _now_ms()
    text = str(content or "").strip()
    if not text:
        raise RuntimeError("content is required")
    t = str(memory_type or "").strip().lower() or "semantic"
    if t not in ("working", "episodic", "semantic", "perceptual"):
        raise RuntimeError("invalid memory type")
    imp = _safe_float(importance, 0.5)
    conf = _safe_float(confidence, 0.7)
    ev = [str(x).strip() for x in (evidence or []) if str(x).strip()]
    tg = [str(x).strip() for x in (tags or []) if str(x).strip()]
    now = _now_ms()
    expires_at = 0
    if int(ttl_days or 0) > 0:
        expires_at = now + int(ttl_days) * 24 * 60 * 60 * 1000
    item_id = f"mem_{now}_{abs(hash((text, t, source, run_id))) % 1000000}"
    settings_obj = load_settings()
    emb = embed_text(text, settings_obj)
    superseded_ids: List[str] = []
    with _connect(workspace_dir) as conn:
        if t == "semantic":
            cand_rows = conn.execute(
                """
                SELECT id, content, embedding_json
                FROM memories
                WHERE status='active' AND type='semantic'
                ORDER BY created_at DESC
                LIMIT 80
                """
            ).fetchall()
            for row in cand_rows:
                rid = str(row["id"] or "").strip()
                if not rid:
                    continue
                try:
                    old_emb_raw = json.loads(str(row["embedding_json"] or "[]"))
                    old_emb = [float(x) for x in old_emb_raw] if isinstance(old_emb_raw, list) else []
                except Exception:
                    old_emb = []
                sim = _cosine(emb, old_emb)
                if sim < 0.92:
                    continue
                if str(row["content"] or "").strip() == text:
                    continue
                conn.execute("UPDATE memories SET status='superseded', superseded_by=? WHERE id=?", (item_id, rid))
                cfid = f"cf_{_now_ms()}_{abs(hash((rid, item_id))) % 1000000}"
                conn.execute(
                    """
                    INSERT OR REPLACE INTO memory_conflicts (id, old_memory_id, new_memory_id, reason, similarity, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (cfid, rid, item_id, "high_similarity_update", float(sim), int(now)),
                )
                superseded_ids.append(rid)
        conn.execute(
            """
            INSERT INTO memories (
                id, content, type, importance, confidence, source, run_id, user_id,
                evidence_json, tags_json, embedding_json, created_at, expires_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
            """,
            (
                item_id,
                text,
                t,
                float(imp),
                float(conf),
                str(source or "").strip(),
                str(run_id or "").strip(),
                str(user_id or "").strip(),
                json.dumps(ev, ensure_ascii=False),
                json.dumps(tg, ensure_ascii=False),
                json.dumps(emb, ensure_ascii=False),
                int(now),
                int(expires_at),
            ),
        )
        _refresh_ann_rows(conn, item_id, emb, now)
        _record_metric(conn, event="add", success=True, latency_ms=_now_ms() - started)
    return {
        "id": item_id,
        "content": text,
        "type": t,
        "importance": imp,
        "confidence": conf,
        "source": str(source or "").strip(),
        "runId": str(run_id or "").strip(),
        "userId": str(user_id or "").strip(),
        "evidence": ev,
        "tags": tg,
        "createdAt": now,
        "expiresAt": int(expires_at),
        "status": "active",
        "supersededIds": superseded_ids,
    }


def _row_to_memory(row: sqlite3.Row, *, score: float, similarity: float, max_content_chars: int) -> Dict[str, Any]:
    evidence = []
    try:
        v = json.loads(str(row["evidence_json"] or "[]"))
        if isinstance(v, list):
            evidence = [str(x) for x in v if str(x).strip()]
    except Exception:
        evidence = []
    return {
        "id": str(row["id"] or ""),
        "content": str(row["content"] or "")[: max(50, int(max_content_chars or 300))],
        "type": str(row["type"] or "semantic"),
        "importance": float(row["importance"] or 0.0),
        "confidence": float(row["confidence"] or 0.0),
        "source": str(row["source"] or ""),
        "runId": str(row["run_id"] or ""),
        "createdAt": int(row["created_at"] or 0),
        "score": float(score),
        "similarity": float(similarity),
        "evidence": evidence,
    }


def _row_to_memory_item(row: sqlite3.Row) -> Dict[str, Any]:
    evidence = []
    tags = []
    try:
        v = json.loads(str(row["evidence_json"] or "[]"))
        if isinstance(v, list):
            evidence = [str(x) for x in v if str(x).strip()]
    except Exception:
        evidence = []
    try:
        v = json.loads(str(row["tags_json"] or "[]"))
        if isinstance(v, list):
            tags = [str(x) for x in v if str(x).strip()]
    except Exception:
        tags = []
    return {
        "id": str(row["id"] or ""),
        "content": str(row["content"] or ""),
        "type": str(row["type"] or ""),
        "importance": float(row["importance"] or 0.0),
        "confidence": float(row["confidence"] or 0.0),
        "source": str(row["source"] or ""),
        "runId": str(row["run_id"] or ""),
        "userId": str(row["user_id"] or ""),
        "evidence": evidence,
        "tags": tags,
        "createdAt": int(row["created_at"] or 0),
        "expiresAt": int(row["expires_at"] or 0),
        "status": str(row["status"] or ""),
        "forgottenAt": int(row["forgotten_at"] or 0),
        "supersededBy": str(row["superseded_by"] or ""),
    }


def query_memory_items(
    *,
    workspace_dir: str,
    query: str,
    top_k: int,
    similarity_threshold: float,
    memory_types: Optional[List[str]] = None,
    max_content_chars: int = 300,
) -> List[Dict[str, Any]]:
    started = _now_ms()
    q = str(query or "").strip()
    if not q:
        return []
    k = max(1, min(int(top_k or 5), 50))
    threshold = _safe_float(similarity_threshold, 0.0)
    allowed = set([str(x).strip().lower() for x in (memory_types or []) if str(x).strip()])
    now = _now_ms()
    settings_obj = load_settings()
    q_emb = embed_text(q, settings_obj)
    scored: List[Dict[str, Any]] = []
    with _connect(workspace_dir) as conn:
        buckets = _embedding_buckets(q_emb)
        rows = []
        if buckets:
            marks = ",".join(["?"] * len(buckets))
            cand = conn.execute(
                f"""
                SELECT memory_id
                FROM memory_ann
                WHERE bucket IN ({marks})
                GROUP BY memory_id
                ORDER BY COUNT(1) DESC, MAX(created_at) DESC
                LIMIT ?
                """,
                tuple(buckets) + (max(100, k * 50),),
            ).fetchall()
            cand_ids = [str(x["memory_id"] or "").strip() for x in cand if str(x["memory_id"] or "").strip()]
            if cand_ids:
                q2 = ",".join(["?"] * len(cand_ids))
                rows = conn.execute(
                    f"""
                    SELECT id, content, type, importance, confidence, source, run_id, evidence_json, embedding_json, created_at, expires_at
                    FROM memories
                    WHERE status='active' AND id IN ({q2})
                    """,
                    tuple(cand_ids),
                ).fetchall()
        if not rows:
            rows = conn.execute(
                """
                SELECT id, content, type, importance, confidence, source, run_id, evidence_json, embedding_json, created_at, expires_at
                FROM memories
                WHERE status='active'
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (max(200, k * 80),),
            ).fetchall()
    for row in rows:
        t = str(row["type"] or "").strip().lower()
        if allowed and t not in allowed:
            continue
        exp = int(row["expires_at"] or 0)
        if exp > 0 and exp <= now:
            continue
        try:
            emb = json.loads(str(row["embedding_json"] or "[]"))
            mem_emb = [float(x) for x in emb] if isinstance(emb, list) else []
        except Exception:
            mem_emb = embed_text(str(row["content"] or ""), settings_obj)
        sim = _cosine(q_emb, mem_emb)
        if sim < threshold:
            continue
        age_days = max(0.0, (now - int(row["created_at"] or now)) / (24 * 60 * 60 * 1000))
        recency = math.exp(-age_days / 30.0)
        importance = _safe_float(row["importance"], 0.5)
        confidence = _safe_float(row["confidence"], 0.7)
        score = 0.55 * sim + 0.20 * recency + 0.15 * importance + 0.10 * confidence
        scored.append(_row_to_memory(row, score=score, similarity=sim, max_content_chars=max_content_chars))
    scored.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
    with _connect(workspace_dir) as conn:
        _record_metric(conn, event="query", success=True, latency_ms=_now_ms() - started)
    return scored[:k]


def add_memory_item_scoped(
    *,
    workspace_dir: str,
    scope: str,
    content: str,
    memory_type: str,
    importance: float,
    confidence: float,
    source: str,
    run_id: str,
    user_id: str,
    evidence: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    ttl_days: int = 0,
) -> Dict[str, Any]:
    sc = str(scope or "workspace").strip().lower()
    if sc not in ("workspace", "global"):
        sc = "workspace"
    target_workspace = _global_memory_workspace_dir() if sc == "global" else str(workspace_dir or "").strip()
    if not target_workspace:
        raise RuntimeError("workspace_dir is required for workspace scope")
    item = add_memory_item(
        workspace_dir=target_workspace,
        content=content,
        memory_type=memory_type,
        importance=importance,
        confidence=confidence,
        source=source,
        run_id=run_id,
        user_id=user_id,
        evidence=evidence,
        tags=tags,
        ttl_days=ttl_days,
    )
    item["scope"] = sc
    return item


def query_memory_items_scoped(
    *,
    workspace_dir: str,
    query: str,
    top_k: int,
    similarity_threshold: float,
    memory_types: Optional[List[str]] = None,
    max_content_chars: int = 300,
    include_global: bool = False,
    global_top_k: int = 3,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    local_rows: List[Dict[str, Any]] = []
    ws = str(workspace_dir or "").strip()
    if ws:
        local_rows = query_memory_items(
            workspace_dir=ws,
            query=query,
            top_k=max(1, int(top_k or 1)),
            similarity_threshold=similarity_threshold,
            memory_types=memory_types,
            max_content_chars=max_content_chars,
        )
        for row in local_rows:
            if isinstance(row, dict):
                row["scope"] = "workspace"
                row["score"] = float(row.get("score") or 0.0) + 0.03
        out.extend(local_rows)

    if include_global:
        gk = max(1, int(global_top_k or 1))
        g_rows = query_memory_items(
            workspace_dir=_global_memory_workspace_dir(),
            query=query,
            top_k=gk,
            similarity_threshold=similarity_threshold,
            memory_types=memory_types,
            max_content_chars=max_content_chars,
        )
        for row in g_rows:
            if isinstance(row, dict):
                row["scope"] = "global"
        out.extend(g_rows)

    out.sort(key=lambda x: float((x or {}).get("score") or 0.0), reverse=True)
    merged: List[Dict[str, Any]] = []
    for row in out:
        if not isinstance(row, dict):
            continue
        scope = str(row.get("scope") or "workspace").strip().lower()
        if scope == "global":
            content = str(row.get("content") or "").strip()
            memory_type = str(row.get("type") or "").strip().lower()
            suppressed = False
            for keep in merged:
                keep_scope = str(keep.get("scope") or "workspace").strip().lower()
                if keep_scope != "workspace":
                    continue
                keep_type = str(keep.get("type") or "").strip().lower()
                if memory_type != "semantic" or keep_type != "semantic":
                    continue
                keep_content = str(keep.get("content") or "").strip()
                if _text_jaccard(content, keep_content) >= 0.45:
                    suppressed = True
                    break
            if suppressed:
                continue
        merged.append(row)
    cap = max(1, int(top_k or 1))
    return merged[:cap]


def list_memory_items(
    *,
    workspace_dir: str,
    limit: int = 200,
    include_inactive: bool = True,
    query: str = "",
) -> List[Dict[str, Any]]:
    cap = max(1, min(int(limit or 200), 2000))
    q = str(query or "").strip().lower()
    with _connect(workspace_dir) as conn:
        if include_inactive:
            rows = conn.execute(
                """
                SELECT id, content, type, importance, confidence, source, run_id, user_id, evidence_json, tags_json, created_at, expires_at, status, forgotten_at, superseded_by
                FROM memories
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (cap,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, content, type, importance, confidence, source, run_id, user_id, evidence_json, tags_json, created_at, expires_at, status, forgotten_at, superseded_by
                FROM memories
                WHERE status='active'
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (cap,),
            ).fetchall()
    items = [_row_to_memory_item(r) for r in rows]
    if not q:
        return items
    out: List[Dict[str, Any]] = []
    for it in items:
        content = str(it.get("content") or "").lower()
        if q in content:
            out.append(it)
    return out


def update_memory_item(
    *,
    workspace_dir: str,
    memory_id: str,
    patch: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    mid = str(memory_id or "").strip()
    if not mid:
        return None
    started = _now_ms()
    with _connect(workspace_dir) as conn:
        row = conn.execute(
            """
            SELECT id, content, type, importance, confidence, source, run_id, user_id, evidence_json, tags_json, embedding_json, created_at, expires_at, status, forgotten_at, superseded_by
            FROM memories
            WHERE id=?
            """,
            (mid,),
        ).fetchone()
        if row is None:
            return None

        content = str(patch.get("content") if "content" in patch else row["content"] or "").strip()
        memory_type = str(patch.get("type") if "type" in patch else row["type"] or "").strip().lower()
        if memory_type not in ("working", "episodic", "semantic", "perceptual"):
            memory_type = str(row["type"] or "semantic").strip().lower()
        importance = _safe_float(patch.get("importance") if "importance" in patch else row["importance"], 0.5)
        confidence = _safe_float(patch.get("confidence") if "confidence" in patch else row["confidence"], 0.7)
        status = str(patch.get("status") if "status" in patch else row["status"] or "active").strip().lower()
        if status not in ("active", "inactive", "superseded"):
            status = str(row["status"] or "active")
        evidence = patch.get("evidence")
        tags = patch.get("tags")
        if isinstance(evidence, list):
            evidence_json = json.dumps([str(x) for x in evidence if str(x).strip()], ensure_ascii=False)
        else:
            evidence_json = str(row["evidence_json"] or "[]")
        if isinstance(tags, list):
            tags_json = json.dumps([str(x) for x in tags if str(x).strip()], ensure_ascii=False)
        else:
            tags_json = str(row["tags_json"] or "[]")

        settings_obj = load_settings()
        embedding = embed_text(content, settings_obj)
        embedding_json = json.dumps(embedding, ensure_ascii=False)
        forgotten_at = int(row["forgotten_at"] or 0)
        if status == "inactive" and forgotten_at <= 0:
            forgotten_at = _now_ms()
        if status == "active":
            forgotten_at = 0
        conn.execute(
            """
            UPDATE memories
            SET content=?, type=?, importance=?, confidence=?, evidence_json=?, tags_json=?, embedding_json=?, status=?, forgotten_at=?
            WHERE id=?
            """,
            (content, memory_type, float(importance), float(confidence), evidence_json, tags_json, embedding_json, status, int(forgotten_at), mid),
        )
        _refresh_ann_rows(conn, mid, embedding, int(row["created_at"] or _now_ms()))
        _record_metric(conn, event="update", success=True, latency_ms=_now_ms() - started)
        next_row = conn.execute(
            """
            SELECT id, content, type, importance, confidence, source, run_id, user_id, evidence_json, tags_json, created_at, expires_at, status, forgotten_at, superseded_by
            FROM memories
            WHERE id=?
            """,
            (mid,),
        ).fetchone()
    return _row_to_memory_item(next_row) if next_row is not None else None


def delete_memory_item(
    *,
    workspace_dir: str,
    memory_id: str,
) -> bool:
    mid = str(memory_id or "").strip()
    if not mid:
        return False
    started = _now_ms()
    with _connect(workspace_dir) as conn:
        row = conn.execute("SELECT id FROM memories WHERE id=?", (mid,)).fetchone()
        if row is None:
            return False
        conn.execute("DELETE FROM memories WHERE id=?", (mid,))
        conn.execute("DELETE FROM memory_ann WHERE memory_id=?", (mid,))
        conn.execute("UPDATE memory_edges SET status='inactive' WHERE from_id=? OR to_id=?", (mid, mid))
        _record_metric(conn, event="delete", success=True, latency_ms=_now_ms() - started)
    return True


def forget_memory_items(
    *,
    workspace_dir: str,
    ids: Optional[List[str]] = None,
    memory_types: Optional[List[str]] = None,
    created_before_ms: int = 0,
    max_forget: int = 200,
) -> Dict[str, Any]:
    started = _now_ms()
    id_set = set([str(x).strip() for x in (ids or []) if str(x).strip()])
    type_set = set([str(x).strip().lower() for x in (memory_types or []) if str(x).strip()])
    before_ms = int(created_before_ms or 0)
    cap = max(1, min(int(max_forget or 200), 5000))
    changed = 0
    now = _now_ms()
    with _connect(workspace_dir) as conn:
        rows = conn.execute("SELECT id, type, created_at FROM memories WHERE status='active' ORDER BY created_at ASC").fetchall()
        for row in rows:
            if changed >= cap:
                break
            hit = False
            row_id = str(row["id"] or "").strip()
            row_type = str(row["type"] or "").strip().lower()
            created_at = int(row["created_at"] or 0)
            if id_set and row_id in id_set:
                hit = True
            if type_set and row_type in type_set:
                hit = True
            if before_ms > 0 and created_at > 0 and created_at < before_ms:
                hit = True
            if not hit:
                continue
            conn.execute("UPDATE memories SET status='inactive', forgotten_at=? WHERE id=?", (int(now), row_id))
            changed += 1
        total = int(conn.execute("SELECT COUNT(1) AS c FROM memories").fetchone()["c"])
        _record_metric(conn, event="forget", success=True, latency_ms=_now_ms() - started)
    return {"changed": changed, "total": total}


def consolidate_memory_items(
    *,
    workspace_dir: str,
    min_importance: float,
    min_confidence: float,
) -> Dict[str, Any]:
    started = _now_ms()
    min_imp = _safe_float(min_importance, 0.75)
    min_conf = _safe_float(min_confidence, 0.75)
    changed = 0
    with _connect(workspace_dir) as conn:
        rows = conn.execute("SELECT id, type, importance, confidence FROM memories WHERE status='active'").fetchall()
        for row in rows:
            t = str(row["type"] or "").strip().lower()
            if t == "semantic":
                continue
            importance = _safe_float(row["importance"], 0.5)
            confidence = _safe_float(row["confidence"], 0.7)
            if importance < min_imp or confidence < min_conf:
                continue
            conn.execute(
                "UPDATE memories SET type='semantic', importance=?, confidence=? WHERE id=?",
                (float(min(1.0, max(importance, 0.8))), float(min(1.0, max(confidence, 0.8))), str(row["id"] or "")),
            )
            changed += 1
        total = int(conn.execute("SELECT COUNT(1) AS c FROM memories").fetchone()["c"])
        _record_metric(conn, event="consolidate", success=True, latency_ms=_now_ms() - started)
    return {"changed": changed, "total": total}


def link_memory_items(
    *,
    workspace_dir: str,
    from_id: str,
    to_id: str,
    relation: str,
    weight: float = 1.0,
    source: str = "agent",
) -> Dict[str, Any]:
    started = _now_ms()
    fid = str(from_id or "").strip()
    tid = str(to_id or "").strip()
    rel = str(relation or "").strip().lower()
    if not fid or not tid or not rel:
        raise RuntimeError("from_id, to_id, relation are required")
    now = _now_ms()
    edge_id = f"edge_{now}_{abs(hash((fid, tid, rel))) % 1000000}"
    w = max(0.0, min(float(weight or 1.0), 1.0))
    with _connect(workspace_dir) as conn:
        conn.execute(
            """
            INSERT INTO memory_edges (id, from_id, to_id, relation, weight, source, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
            """,
            (edge_id, fid, tid, rel, float(w), str(source or "").strip(), int(now)),
        )
        _record_metric(conn, event="link", success=True, latency_ms=_now_ms() - started)
    return {"id": edge_id, "fromId": fid, "toId": tid, "relation": rel, "weight": w, "createdAt": now}


def query_memory_graph(
    *,
    workspace_dir: str,
    anchor_ids: List[str],
    hops: int = 1,
    max_nodes: int = 20,
) -> Dict[str, Any]:
    started = _now_ms()
    seeds = [str(x).strip() for x in (anchor_ids or []) if str(x).strip()]
    if not seeds:
        return {"nodes": [], "edges": []}
    hop_n = max(1, min(int(hops or 1), 2))
    cap = max(1, min(int(max_nodes or 20), 100))
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []
    frontier = set(seeds)
    visited = set(seeds)
    with _connect(workspace_dir) as conn:
        for sid in seeds:
            row = conn.execute("SELECT id, content, type FROM memories WHERE id=?", (sid,)).fetchone()
            if row:
                nodes[sid] = {"id": sid, "content": str(row["content"] or ""), "type": str(row["type"] or "")}
        for _ in range(hop_n):
            if not frontier or len(nodes) >= cap:
                break
            next_frontier = set()
            q_marks = ",".join(["?"] * len(frontier))
            cur = conn.execute(
                f"""
                SELECT id, from_id, to_id, relation, weight
                FROM memory_edges
                WHERE status='active' AND (from_id IN ({q_marks}) OR to_id IN ({q_marks}))
                ORDER BY created_at DESC
                LIMIT 200
                """,
                tuple(frontier) + tuple(frontier),
            )
            for row in cur.fetchall():
                e = {
                    "id": str(row["id"] or ""),
                    "fromId": str(row["from_id"] or ""),
                    "toId": str(row["to_id"] or ""),
                    "relation": str(row["relation"] or ""),
                    "weight": float(row["weight"] or 0.0),
                }
                edges.append(e)
                for nid in (e["fromId"], e["toId"]):
                    if nid in nodes:
                        continue
                    nrow = conn.execute("SELECT id, content, type FROM memories WHERE id=?", (nid,)).fetchone()
                    if nrow:
                        nodes[nid] = {"id": nid, "content": str(nrow["content"] or ""), "type": str(nrow["type"] or "")}
                    if nid not in visited:
                        visited.add(nid)
                        next_frontier.add(nid)
                    if len(nodes) >= cap:
                        break
                if len(nodes) >= cap:
                    break
            frontier = next_frontier
        _record_metric(conn, event="graph_query", success=True, latency_ms=_now_ms() - started)
    return {"nodes": list(nodes.values())[:cap], "edges": edges[: cap * 2]}


def get_memory_metrics_summary(*, workspace_dir: str, days: int = 7) -> Dict[str, Any]:
    day_n = max(1, min(int(days or 7), 60))
    now = int(time.time())
    cutoff = time.strftime("%Y-%m-%d", time.localtime(now - day_n * 24 * 60 * 60))
    with _connect(workspace_dir) as conn:
        rows = conn.execute(
            """
            SELECT day, event, total_count, success_count, total_latency_ms
            FROM memory_metrics_daily
            WHERE day >= ?
            ORDER BY day DESC, event ASC
            """,
            (cutoff,),
        ).fetchall()
    by_event: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        ev = str(row["event"] or "").strip() or "unknown"
        entry = by_event.get(ev)
        if entry is None:
            entry = {"event": ev, "totalCount": 0, "successCount": 0, "totalLatencyMs": 0}
            by_event[ev] = entry
        entry["totalCount"] += int(row["total_count"] or 0)
        entry["successCount"] += int(row["success_count"] or 0)
        entry["totalLatencyMs"] += int(row["total_latency_ms"] or 0)
    items = []
    for ev, x in by_event.items():
        total = int(x["totalCount"] or 0)
        success = int(x["successCount"] or 0)
        latency = int(x["totalLatencyMs"] or 0)
        items.append(
            {
                "event": ev,
                "totalCount": total,
                "successCount": success,
                "successRate": (float(success) / float(total)) if total > 0 else 0.0,
                "avgLatencyMs": (float(latency) / float(total)) if total > 0 else 0.0,
            }
        )
    items.sort(key=lambda x: str(x.get("event") or ""))
    return {"days": day_n, "events": items}
