import json

from anima_backend_shared.database import config_root, db_path, get_db_connection, init_db


def main() -> int:
    init_db()
    print("config_root:", str(config_root()))
    print("db_path:", str(db_path()))
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT provider_id, profile_id, type, updated_at, data FROM provider_credentials ORDER BY updated_at DESC LIMIT 50"
    ).fetchall()
    print("rows:", len(rows))
    for r in rows:
        pid = str(r["provider_id"])
        pf = str(r["profile_id"])
        typ = str(r["type"])
        updated_at = int(r["updated_at"] or 0)
        data_raw = str(r["data"] or "")
        try:
            data = json.loads(data_raw) if data_raw else {}
        except Exception:
            data = {"_raw": data_raw[:200]}
        out = {
            "provider_id": pid,
            "profile_id": pf,
            "type": typ,
            "updated_at": updated_at,
            "keys": sorted(list(data.keys())) if isinstance(data, dict) else [],
            "accessToken_len": len(str(data.get("accessToken") or "")) if isinstance(data, dict) else 0,
            "refreshToken_len": len(str(data.get("refreshToken") or "")) if isinstance(data, dict) else 0,
            "expiresAt": int(data.get("expiresAt") or 0) if isinstance(data, dict) else 0,
            "resourceUrl": str(data.get("resourceUrl") or "") if isinstance(data, dict) else "",
        }
        print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

