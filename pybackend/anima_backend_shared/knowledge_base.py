from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .memory_embedding import embed_text
from .settings import load_settings


def _now_ms() -> int:
    return int(time.time() * 1000)


def _kb_db_path(workspace_dir: str) -> Path:
    root = Path(str(workspace_dir or "").strip()).expanduser().resolve()
    return root / ".anima" / "knowledge_base.db"


def _safe_float(raw: Any, default_v: float) -> float:
    try:
        v = float(raw)
    except Exception:
        return float(default_v)
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return v


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n <= 0:
        return 0.0
    return float(sum(a[i] * b[i] for i in range(n)))


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
                bits |= 1 << (j % 31)
        out.append(f"b{i}:{bits:08x}")
    return out


def _connect(workspace_dir: str) -> sqlite3.Connection:
    p = _kb_db_path(workspace_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kb_documents (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            file_hash TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            mtime_ms INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kb_documents_updated ON kb_documents (updated_at DESC)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kb_chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            header_path TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(document_id) REFERENCES kb_documents(id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks (document_id, chunk_index)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS kb_chunk_ann (
            bucket TEXT NOT NULL,
            chunk_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (bucket, chunk_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_kb_chunk_ann_chunk ON kb_chunk_ann (chunk_id)")
    try:
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts
            USING fts5(chunk_id UNINDEXED, content)
            """
        )
    except sqlite3.OperationalError:
        pass
    return conn


def _refresh_chunk_ann(conn: sqlite3.Connection, chunk_id: str, emb: List[float], created_at: int) -> None:
    cid = str(chunk_id or "").strip()
    if not cid:
        return
    conn.execute("DELETE FROM kb_chunk_ann WHERE chunk_id=?", (cid,))
    for b in _embedding_buckets(emb):
        conn.execute(
            "INSERT OR REPLACE INTO kb_chunk_ann (bucket, chunk_id, created_at) VALUES (?, ?, ?)",
            (str(b), cid, int(created_at)),
        )


def _split_markdown_sections(text: str) -> List[Tuple[str, str]]:
    lines = str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    sections: List[Tuple[str, str]] = []
    stack: List[str] = []
    cur_header = ""
    cur_lines: List[str] = []
    for line in lines:
        m = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if m:
            body = "\n".join(cur_lines).strip()
            if body:
                sections.append((cur_header, body))
            level = len(m.group(1))
            title = str(m.group(2) or "").strip()
            if len(stack) >= level:
                stack = stack[: level - 1]
            stack.append(title)
            cur_header = " > ".join([x for x in stack if x])
            cur_lines = []
            continue
        cur_lines.append(line)
    tail = "\n".join(cur_lines).strip()
    if tail:
        sections.append((cur_header, tail))
    if sections:
        return sections
    raw = str(text or "").strip()
    return [("", raw)] if raw else []


def _chunk_text(header_path: str, body: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    head = str(header_path or "").strip()
    payload = str(body or "").strip()
    if not payload:
        return []
    prefix = f"{head}\n\n" if head else ""
    raw = f"{prefix}{payload}".strip()
    cap = max(200, min(int(chunk_size or 1200), 4000))
    ov = max(0, min(int(chunk_overlap or 200), cap // 2))
    if len(raw) <= cap:
        return [raw]
    out: List[str] = []
    i = 0
    n = len(raw)
    while i < n:
        end = min(n, i + cap)
        if end < n:
            pivot = raw.rfind("\n", i + int(cap * 0.6), end)
            if pivot > i + int(cap * 0.3):
                end = pivot
        piece = raw[i:end].strip()
        if piece:
            out.append(piece)
        if end >= n:
            break
        i = max(i + 1, end - ov)
    return out


def _hash_bytes(content: bytes) -> str:
    h = hashlib.sha256()
    h.update(content)
    return h.hexdigest()


def _upsert_document(
    conn: sqlite3.Connection,
    *,
    path: str,
    file_hash: str,
    size_bytes: int,
    mtime_ms: int,
    now_ms: int,
) -> Tuple[str, bool]:
    row = conn.execute(
        "SELECT id, file_hash, status FROM kb_documents WHERE path=?",
        (path,),
    ).fetchone()
    if row is not None:
        doc_id = str(row["id"] or "").strip()
        unchanged = str(row["file_hash"] or "") == str(file_hash) and str(row["status"] or "") == "active"
        conn.execute(
            """
            UPDATE kb_documents
            SET file_name=?, file_hash=?, size_bytes=?, mtime_ms=?, status='active', updated_at=?
            WHERE id=?
            """,
            (Path(path).name, file_hash, int(size_bytes), int(mtime_ms), int(now_ms), doc_id),
        )
        return doc_id, unchanged
    doc_id = f"doc_{now_ms}_{abs(hash(path)) % 1000000}"
    conn.execute(
        """
        INSERT INTO kb_documents (id, path, file_name, file_hash, size_bytes, mtime_ms, chunk_count, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)
        """,
        (doc_id, path, Path(path).name, file_hash, int(size_bytes), int(mtime_ms), int(now_ms), int(now_ms)),
    )
    return doc_id, False


def _delete_document_chunks(conn: sqlite3.Connection, document_id: str) -> None:
    rows = conn.execute("SELECT id FROM kb_chunks WHERE document_id=?", (document_id,)).fetchall()
    ids = [str(r["id"] or "").strip() for r in rows if str(r["id"] or "").strip()]
    if ids:
        marks = ",".join(["?"] * len(ids))
        conn.execute(f"DELETE FROM kb_chunk_ann WHERE chunk_id IN ({marks})", tuple(ids))
        try:
            conn.execute(f"DELETE FROM kb_chunks_fts WHERE chunk_id IN ({marks})", tuple(ids))
        except sqlite3.OperationalError:
            pass
    conn.execute("DELETE FROM kb_chunks WHERE document_id=?", (document_id,))


def import_markdown_files(
    *,
    workspace_dir: str,
    paths: List[str],
    chunk_size: int = 1200,
    chunk_overlap: int = 200,
    max_chunks_per_doc: int = 2000,
    progress_cb: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    ws = str(workspace_dir or "").strip()
    if not ws:
        raise RuntimeError("workspace_dir is required")
    raw_paths = [str(x or "").strip() for x in (paths or []) if str(x or "").strip()]
    if not raw_paths:
        return {"imported": 0, "skipped": 0, "failed": 0, "files": []}
    total_files = len(raw_paths)
    processed_files = 0
    processed_chunks = 0
    total_chunks = 0

    def _emit_progress(payload: Dict[str, Any]) -> None:
        if progress_cb is None:
            return
        try:
            progress_cb(payload)
        except Exception:
            return

    now_ms = _now_ms()
    out_files: List[Dict[str, Any]] = []
    settings_obj = load_settings()
    _emit_progress(
        {
            "stage": "start",
            "totalFiles": total_files,
            "processedFiles": 0,
            "totalChunks": 0,
            "processedChunks": 0,
            "percent": 0,
        }
    )
    for p in raw_paths:
        ap = str(Path(p).expanduser().resolve())
        _emit_progress(
            {
                "stage": "file_start",
                "currentFile": ap,
                "totalFiles": total_files,
                "processedFiles": processed_files,
                "totalChunks": total_chunks,
                "processedChunks": processed_chunks,
            }
        )
        if not Path(ap).is_file():
            out_files.append({"path": ap, "status": "failed", "error": "file not found"})
            processed_files += 1
            continue
        ext = Path(ap).suffix.lower()
        if ext not in (".md", ".markdown"):
            out_files.append({"path": ap, "status": "failed", "error": "only .md/.markdown is supported"})
            processed_files += 1
            continue
        try:
            raw = Path(ap).read_bytes()
            text = raw.decode("utf-8", errors="ignore")
            fhash = _hash_bytes(raw)
            st = Path(ap).stat()
            mtime_ms = int(st.st_mtime * 1000)
            size_bytes = int(st.st_size)
        except Exception as e:
            out_files.append({"path": ap, "status": "failed", "error": str(e)})
            processed_files += 1
            continue
        try:
            with _connect(ws) as conn:
                doc_id, unchanged = _upsert_document(
                    conn,
                    path=ap,
                    file_hash=fhash,
                    size_bytes=size_bytes,
                    mtime_ms=mtime_ms,
                    now_ms=now_ms,
                )
                if unchanged:
                    out_files.append({"path": ap, "status": "skipped", "reason": "unchanged", "documentId": doc_id})
                    processed_files += 1
                    continue
                _delete_document_chunks(conn, doc_id)
                sections = _split_markdown_sections(text)
                chunks: List[Tuple[str, str]] = []
                for header_path, body in sections:
                    for c in _chunk_text(header_path, body, chunk_size=chunk_size, chunk_overlap=chunk_overlap):
                        chunks.append((header_path, c))
                if len(chunks) > int(max_chunks_per_doc):
                    chunks = chunks[: int(max_chunks_per_doc)]
                total_chunks += len(chunks)
                chunk_count = 0
                for idx, (header_path, content) in enumerate(chunks):
                    emb = embed_text(content, settings_obj)
                    chunk_id = f"chk_{now_ms}_{abs(hash((doc_id, idx, content[:64]))) % 1000000}"
                    conn.execute(
                        """
                        INSERT INTO kb_chunks (id, document_id, chunk_index, header_path, content, embedding_json, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (chunk_id, doc_id, int(idx), str(header_path or ""), content, json.dumps(emb, ensure_ascii=False), int(now_ms)),
                    )
                    _refresh_chunk_ann(conn, chunk_id, emb, now_ms)
                    try:
                        conn.execute(
                            "INSERT INTO kb_chunks_fts (chunk_id, content) VALUES (?, ?)",
                            (chunk_id, content),
                        )
                    except sqlite3.OperationalError:
                        pass
                    chunk_count += 1
                    processed_chunks += 1
                    percent = int(
                        min(
                            99,
                            (
                                ((processed_files / float(max(1, total_files))) * 0.7)
                                + ((processed_chunks / float(max(1, total_chunks))) * 0.3)
                            )
                            * 100.0,
                        )
                    )
                    _emit_progress(
                        {
                            "stage": "chunking",
                            "currentFile": ap,
                            "currentFileProcessedChunks": chunk_count,
                            "currentFileTotalChunks": len(chunks),
                            "totalFiles": total_files,
                            "processedFiles": processed_files,
                            "totalChunks": total_chunks,
                            "processedChunks": processed_chunks,
                            "percent": percent,
                        }
                    )
                conn.execute("UPDATE kb_documents SET chunk_count=?, updated_at=?, status='active' WHERE id=?", (chunk_count, int(now_ms), doc_id))
                out_files.append(
                    {
                        "path": ap,
                        "status": "imported",
                        "documentId": doc_id,
                        "chunkCount": chunk_count,
                    }
                )
                processed_files += 1
                percent_file = int(min(99, (processed_files / float(max(1, total_files))) * 100.0))
                _emit_progress(
                    {
                        "stage": "file_done",
                        "currentFile": ap,
                        "totalFiles": total_files,
                        "processedFiles": processed_files,
                        "totalChunks": total_chunks,
                        "processedChunks": processed_chunks,
                        "percent": percent_file,
                    }
                )
        except Exception as e:
            out_files.append({"path": ap, "status": "failed", "error": str(e)})
            processed_files += 1
    imported = len([x for x in out_files if x.get("status") == "imported"])
    skipped = len([x for x in out_files if x.get("status") == "skipped"])
    failed = len([x for x in out_files if x.get("status") == "failed"])
    _emit_progress(
        {
            "stage": "done",
            "totalFiles": total_files,
            "processedFiles": processed_files,
            "totalChunks": total_chunks,
            "processedChunks": processed_chunks,
            "percent": 100,
        }
    )
    return {"imported": imported, "skipped": skipped, "failed": failed, "files": out_files, "totalFiles": total_files, "totalChunks": total_chunks}


def list_kb_documents(*, workspace_dir: str, limit: int = 500) -> List[Dict[str, Any]]:
    ws = str(workspace_dir or "").strip()
    if not ws:
        raise RuntimeError("workspace_dir is required")
    cap = max(1, min(int(limit or 500), 5000))
    with _connect(ws) as conn:
        rows = conn.execute(
            """
            SELECT id, path, file_name, file_hash, size_bytes, mtime_ms, chunk_count, status, created_at, updated_at
            FROM kb_documents
            WHERE status='active'
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (cap,),
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": str(r["id"] or "").strip(),
                "path": str(r["path"] or "").strip(),
                "fileName": str(r["file_name"] or "").strip(),
                "fileHash": str(r["file_hash"] or "").strip(),
                "sizeBytes": int(r["size_bytes"] or 0),
                "mtimeMs": int(r["mtime_ms"] or 0),
                "chunkCount": int(r["chunk_count"] or 0),
                "status": str(r["status"] or "").strip(),
                "createdAt": int(r["created_at"] or 0),
                "updatedAt": int(r["updated_at"] or 0),
            }
        )
    return out


def delete_kb_documents(*, workspace_dir: str, ids: Optional[List[str]] = None, paths: Optional[List[str]] = None) -> Dict[str, Any]:
    ws = str(workspace_dir or "").strip()
    if not ws:
        raise RuntimeError("workspace_dir is required")
    id_set = set([str(x).strip() for x in (ids or []) if str(x).strip()])
    path_set = set([str(Path(str(x).strip()).expanduser().resolve()) for x in (paths or []) if str(x).strip()])
    if not id_set and not path_set:
        return {"deleted": 0}
    deleted = 0
    with _connect(ws) as conn:
        rows = conn.execute("SELECT id, path FROM kb_documents WHERE status='active'").fetchall()
        for row in rows:
            doc_id = str(row["id"] or "").strip()
            p = str(row["path"] or "").strip()
            if doc_id not in id_set and p not in path_set:
                continue
            _delete_document_chunks(conn, doc_id)
            conn.execute("UPDATE kb_documents SET status='deleted', updated_at=? WHERE id=?", (_now_ms(), doc_id))
            deleted += 1
    return {"deleted": deleted}


def _dense_candidates(
    conn: sqlite3.Connection, q_emb: List[float], top_k: int
) -> List[Tuple[str, float]]:
    buckets = _embedding_buckets(q_emb)
    if not buckets:
        return []
    marks = ",".join(["?"] * len(buckets))
    cand = conn.execute(
        f"""
        SELECT chunk_id
        FROM kb_chunk_ann
        WHERE bucket IN ({marks})
        GROUP BY chunk_id
        ORDER BY COUNT(1) DESC, MAX(created_at) DESC
        LIMIT ?
        """,
        tuple(buckets) + (max(120, top_k * 60),),
    ).fetchall()
    ids = [str(x["chunk_id"] or "").strip() for x in cand if str(x["chunk_id"] or "").strip()]
    if not ids:
        return []
    marks2 = ",".join(["?"] * len(ids))
    rows = conn.execute(
        f"""
        SELECT c.id, c.embedding_json
        FROM kb_chunks c
        JOIN kb_documents d ON d.id=c.document_id
        WHERE c.id IN ({marks2}) AND d.status='active'
        """,
        tuple(ids),
    ).fetchall()
    out: List[Tuple[str, float]] = []
    for row in rows:
        cid = str(row["id"] or "").strip()
        if not cid:
            continue
        try:
            emb_raw = json.loads(str(row["embedding_json"] or "[]"))
            emb = [float(x) for x in emb_raw] if isinstance(emb_raw, list) else []
        except Exception:
            emb = []
        sim = _cosine(q_emb, emb)
        out.append((cid, sim))
    out.sort(key=lambda x: x[1], reverse=True)
    return out


def _keyword_candidates(conn: sqlite3.Connection, query: str, top_k: int) -> List[str]:
    q = str(query or "").strip()
    if not q:
        return []
    try:
        rows = conn.execute(
            "SELECT chunk_id, bm25(kb_chunks_fts) AS rank FROM kb_chunks_fts WHERE kb_chunks_fts MATCH ? LIMIT ?",
            (q, max(20, int(top_k))),
        ).fetchall()
        ids = [str(x["chunk_id"] or "").strip() for x in rows if str(x["chunk_id"] or "").strip()]
        if ids:
            return ids
    except Exception:
        pass
    rows = conn.execute(
        """
        SELECT c.id
        FROM kb_chunks c
        JOIN kb_documents d ON d.id=c.document_id
        WHERE d.status='active' AND c.content LIKE ?
        ORDER BY c.created_at DESC
        LIMIT ?
        """,
        (f"%{q[:80]}%", max(20, int(top_k))),
    ).fetchall()
    return [str(x["id"] or "").strip() for x in rows if str(x["id"] or "").strip()]


def query_kb_chunks(
    *,
    workspace_dir: str,
    query: str,
    top_k: int = 6,
    similarity_threshold: float = 0.35,
    hybrid_enabled: bool = True,
    keyword_top_k: int = 30,
    max_content_chars: int = 700,
) -> List[Dict[str, Any]]:
    ws = str(workspace_dir or "").strip()
    q = str(query or "").strip()
    if not ws:
        raise RuntimeError("workspace_dir is required")
    if not q:
        return []
    k = max(1, min(int(top_k or 6), 20))
    threshold = _safe_float(similarity_threshold, 0.35)
    settings_obj = load_settings()
    q_emb = embed_text(q, settings_obj)
    with _connect(ws) as conn:
        dense_pairs = _dense_candidates(conn, q_emb, k)
        dense_rank: Dict[str, int] = {}
        dense_sim: Dict[str, float] = {}
        idx = 1
        for cid, sim in dense_pairs:
            if sim < threshold:
                continue
            dense_rank[cid] = idx
            dense_sim[cid] = sim
            idx += 1
        keyword_ids: List[str] = _keyword_candidates(conn, q, keyword_top_k) if hybrid_enabled else []
        kw_rank: Dict[str, int] = {cid: i + 1 for i, cid in enumerate(keyword_ids)}
        id_set = set(dense_rank.keys())
        id_set.update(kw_rank.keys())
        if not id_set and dense_pairs:
            id_set.update([x[0] for x in dense_pairs[:k]])
        if not id_set:
            return []
        marks = ",".join(["?"] * len(id_set))
        rows = conn.execute(
            f"""
            SELECT c.id, c.document_id, c.chunk_index, c.header_path, c.content, d.path, d.file_name
            FROM kb_chunks c
            JOIN kb_documents d ON d.id=c.document_id
            WHERE c.id IN ({marks}) AND d.status='active'
            """,
            tuple(id_set),
        ).fetchall()
    rrf_k = 60.0
    fused: List[Dict[str, Any]] = []
    for row in rows:
        cid = str(row["id"] or "").strip()
        if not cid:
            continue
        dr = dense_rank.get(cid)
        kr = kw_rank.get(cid)
        sim = float(dense_sim.get(cid) or 0.0)
        rrf_score = 0.0
        if dr is not None:
            rrf_score += 1.0 / (rrf_k + float(dr))
        if kr is not None:
            rrf_score += 1.0 / (rrf_k + float(kr))
        final_score = 0.72 * sim + 0.28 * rrf_score
        fused.append(
            {
                "id": cid,
                "documentId": str(row["document_id"] or "").strip(),
                "documentPath": str(row["path"] or "").strip(),
                "fileName": str(row["file_name"] or "").strip(),
                "chunkIndex": int(row["chunk_index"] or 0),
                "headerPath": str(row["header_path"] or "").strip(),
                "content": str(row["content"] or "")[: max(200, int(max_content_chars or 700))],
                "similarity": sim,
                "score": float(final_score),
                "denseRank": int(dr) if dr is not None else None,
                "keywordRank": int(kr) if kr is not None else None,
            }
        )
    fused.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
    return fused[:k]


def get_kb_stats(*, workspace_dir: str) -> Dict[str, Any]:
    ws = str(workspace_dir or "").strip()
    if not ws:
        raise RuntimeError("workspace_dir is required")
    with _connect(ws) as conn:
        d = conn.execute("SELECT COUNT(1) AS c FROM kb_documents WHERE status='active'").fetchone()
        c = conn.execute(
            """
            SELECT COUNT(1) AS c
            FROM kb_chunks c
            JOIN kb_documents d ON d.id=c.document_id
            WHERE d.status='active'
            """
        ).fetchone()
    doc_n = int(d["c"] or 0) if d is not None else 0
    chunk_n = int(c["c"] or 0) if c is not None else 0
    return {"documents": doc_n, "chunks": chunk_n}
