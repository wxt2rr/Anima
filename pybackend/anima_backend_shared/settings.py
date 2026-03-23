import json
import os
import re
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .constants import SCHEMA_VERSION
from .defaults import default_app_settings
from .database import get_app_settings, set_app_settings
from .paths import config_root_by_platform


_CONFIG_ROOT: Optional[Path] = None
_CONFIG_ROOT_LOCK = threading.Lock()


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


def skills_dir() -> Path:
    raw = str(os.environ.get("ANIMA_SKILLS_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return config_root() / "skills"


def project_skills_dir() -> Path:
    here = Path(__file__).resolve()
    try:
        root = here.parents[2]
    except IndexError:
        return skills_dir()
    return root / "skills"


def bundled_skills_dir() -> Optional[Path]:
    raw = str(os.environ.get("ANIMA_BUNDLED_SKILLS_DIR") or "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def _migrate_codex_provider(existing: Dict[str, Any]) -> bool:
    changed = False
    providers = existing.get("providers")
    if not isinstance(providers, list):
        existing["providers"] = []
        providers = existing["providers"]
        changed = True

    codex_idxs = []
    for i, p in enumerate(providers):
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "").strip().lower()
        ptype = str(p.get("type") or "").strip().lower()
        if pid == "openai_codex" or ptype == "openai_codex":
            codex_idxs.append(i)

    if not codex_idxs:
        providers.append(
            {
                "id": "openai_codex",
                "name": "OpenAI Codex (ChatGPT)",
                "type": "openai_codex",
                "isEnabled": False,
                "auth": {"mode": "oauth_openai_codex", "profileId": "default"},
                "config": {
                    "baseUrl": "https://chatgpt.com/backend-api",
                    "apiFormat": "responses",
                    "modelsFetched": True,
                    "models": [
                        {"id": "gpt-5.2-codex", "isEnabled": True, "config": {"id": "gpt-5.2-codex"}},
                        {"id": "gpt-5.2-codex-low", "isEnabled": True, "config": {"id": "gpt-5.2-codex-low"}},
                        {"id": "gpt-5.2-codex-medium", "isEnabled": True, "config": {"id": "gpt-5.2-codex-medium"}},
                        {"id": "gpt-5.2-codex-high", "isEnabled": True, "config": {"id": "gpt-5.2-codex-high"}},
                        {"id": "gpt-5.2-codex-xhigh", "isEnabled": True, "config": {"id": "gpt-5.2-codex-xhigh"}},
                    ],
                    "selectedModel": "gpt-5.2-codex",
                    "apiKey": "",
                },
            }
        )
        changed = True
    elif len(codex_idxs) > 1:
        keep = codex_idxs[0]
        next_providers = []
        for i, p in enumerate(providers):
            if i in codex_idxs and i != keep:
                changed = True
                continue
            next_providers.append(p)
        existing["providers"] = next_providers

    return changed


def migrate_settings() -> Dict[str, Any]:
    existing = get_app_settings()
    changed = False
    if existing is None:
        existing = default_app_settings()
        changed = True
    elif not isinstance(existing, dict):
        raise RuntimeError("Failed to load settings from database")

    changed = _migrate_codex_provider(existing) or changed
    if changed:
        set_app_settings(existing)
    return existing


def load_settings() -> Dict[str, Any]:
    existing = get_app_settings()
    if existing is None:
        existing = default_app_settings()
        set_app_settings(existing)
    elif not isinstance(existing, dict):
        raise RuntimeError("Failed to load settings from database")
    if not isinstance(existing.get("providers"), list):
        existing["providers"] = []
    return existing


def deep_merge(dst: Any, src: Any) -> Any:
    if isinstance(dst, dict) and isinstance(src, dict):
        for k, v in src.items():
            dst[k] = deep_merge(dst.get(k), v)
        return dst
    return src


def save_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = migrate_settings()
    merged = deep_merge(current, patch)
    set_app_settings(merged)
    return merged


def extract_first_heading(markdown: str) -> str:
    for line in (markdown or "").splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip()
    return ""


def extract_description(markdown: str) -> str:
    started = False
    for line in (markdown or "").splitlines():
        s = line.strip()
        if not s:
            continue
        if not started:
            if s.startswith("# "):
                started = True
                continue
            started = True
        if s.startswith("# "):
            continue
        for ch in ["`", "*", "_", ">", "#"]:
            s = s.replace(ch, "")
        return s.strip()
    return ""


def list_skills() -> Tuple[str, List[Dict[str, Any]]]:
    dir_path = skills_dir()
    dir_path.mkdir(parents=True, exist_ok=True)
    skills: List[Dict[str, Any]] = []
    roots = [dir_path]
    seen: Dict[str, Dict[str, Any]] = {}
    for base in roots:
        for entry in base.iterdir():
            if not entry.is_dir():
                continue
            skill_file = entry / "SKILL.md"
            if not skill_file.exists():
                continue
            try:
                content = skill_file.read_text(encoding="utf-8")
                meta, body = parse_skill_frontmatter(content)
                name = str(meta.get("name") or "").strip() or extract_first_heading(body) or entry.name
                description = str(meta.get("description") or "").strip() or extract_description(body)
                errors = validate_skill_meta(entry.name, meta)
                is_valid = len(errors) == 0
                stat = skill_file.stat()
                item = {
                    "id": entry.name,
                    "name": name,
                    "description": description,
                    "dir": str(entry),
                    "file": str(skill_file),
                    "isValid": is_valid,
                    "errors": errors,
                    "updatedAt": int(stat.st_mtime * 1000),
                }
                prev = seen.get(entry.name)
                if not prev or int(item["updatedAt"]) >= int(prev.get("updatedAt") or 0):
                    seen[entry.name] = item
            except Exception:
                continue
    skills = list(seen.values())
    skills.sort(key=lambda x: x.get("updatedAt", 0), reverse=True)
    return str(dir_path), skills


def get_skills_content(ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    dir_path = skills_dir()
    dir_path.mkdir(parents=True, exist_ok=True)
    wanted = set([str(x).strip() for x in (ids or []) if str(x).strip()])
    skills: List[Dict[str, Any]] = []
    roots = [dir_path]
    seen: Dict[str, Dict[str, Any]] = {}
    for base in roots:
        for entry in base.iterdir():
            if not entry.is_dir():
                continue
            if wanted and entry.name not in wanted:
                continue
            skill_file = entry / "SKILL.md"
            if not skill_file.exists():
                continue
            try:
                content = skill_file.read_text(encoding="utf-8")
                meta, body = parse_skill_frontmatter(content)
                name = str(meta.get("name") or "").strip() or extract_first_heading(body) or entry.name
                description = str(meta.get("description") or "").strip() or extract_description(body)
                errors = validate_skill_meta(entry.name, meta)
                is_valid = len(errors) == 0
                stat = skill_file.stat()
                item = {
                    "id": entry.name,
                    "name": name,
                    "description": description,
                    "dir": str(entry),
                    "file": str(skill_file),
                    "content": body.strip(),
                    "meta": meta,
                    "isValid": is_valid,
                    "errors": errors,
                    "updatedAt": int(stat.st_mtime * 1000),
                }
                prev = seen.get(entry.name)
                if not prev or int(item["updatedAt"]) >= int(prev.get("updatedAt") or 0):
                    seen[entry.name] = item
            except Exception:
                continue
    skills = list(seen.values())
    skills.sort(key=lambda x: x.get("updatedAt", 0), reverse=True)
    return skills


def parse_skill_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    s = content or ""
    if not s.startswith("---"):
        return {}, s
    lines = s.splitlines()
    if len(lines) < 3:
        return {}, s
    if lines[0].strip() != "---":
        return {}, s
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}, s
    fm_lines = lines[1:end_idx]
    body = "\n".join(lines[end_idx + 1 :])
    meta = _parse_frontmatter_yaml_minimal(fm_lines)
    return meta, body


def _parse_frontmatter_yaml_minimal(lines: List[str]) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    i = 0
    while i < len(lines):
        raw = lines[i]
        if not raw.strip() or raw.lstrip().startswith("#"):
            i += 1
            continue
        if ":" not in raw:
            i += 1
            continue

        k, v = raw.split(":", 1)
        key = k.strip()
        rest = v.strip()
        if rest:
            meta[key] = _strip_yaml_scalar(rest)
            i += 1
            continue

        i += 1
        items: List[str] = []
        obj: Dict[str, str] = {}
        while i < len(lines):
            ln = lines[i]
            if not ln.strip():
                i += 1
                continue
            if not ln.startswith(" "):
                break
            s = ln.strip()
            if s.startswith("#"):
                i += 1
                continue
            if s.startswith("- "):
                items.append(_strip_yaml_scalar(s[2:].strip()))
                i += 1
                continue
            if ":" in s:
                kk, vv = s.split(":", 1)
                obj[kk.strip()] = _strip_yaml_scalar(vv.strip())
                i += 1
                continue
            i += 1

        if items:
            meta[key] = items
        elif obj:
            meta[key] = obj
        else:
            meta[key] = ""
    return meta


def _strip_yaml_scalar(v: str) -> str:
    s = (v or "").strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


def validate_skill_meta(dir_name: str, meta: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    name = str(meta.get("name") or "").strip()
    desc = str(meta.get("description") or "").strip()
    compat = str(meta.get("compatibility") or "").strip()

    if not name:
        errors.append("missing_frontmatter_name")
    else:
        if len(name) < 1 or len(name) > 64:
            errors.append("invalid_name_length")
        if not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", name):
            errors.append("invalid_name_format")

    if not desc:
        errors.append("missing_frontmatter_description")
    elif len(desc) > 1024:
        errors.append("description_too_long")

    if compat and len(compat) > 500:
        errors.append("compatibility_too_long")

    return errors


def open_folder(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
        return
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
        return
    subprocess.Popen(["xdg-open", str(path)])
