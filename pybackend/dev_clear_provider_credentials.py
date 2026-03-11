from anima_backend_shared.database import config_root, db_path, init_db
from anima_backend_shared.provider_credentials import delete_credential, list_profiles


def main() -> int:
    init_db()
    print("config_root:", str(config_root()))
    print("db_path:", str(db_path()))
    for pid in ("openai_codex", "qwen"):
        profiles = list_profiles(pid)
        print("before", pid, profiles)
        for p in profiles:
            delete_credential(pid, str(p.get("profileId") or "default"))
        print("after", pid, list_profiles(pid))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

