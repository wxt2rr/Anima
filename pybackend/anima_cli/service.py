from __future__ import annotations

import copy
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from anima_backend_shared.database import (
    add_settings_revision,
    get_settings_revision,
    list_settings_revisions,
    set_app_settings,
)
from anima_backend_shared.settings import load_settings
from anima_backend_shared.settings import list_skills

from .registry import ConfigKeySpec, GROUPS, list_group_keys, resolve_key


class CliError(Exception):
    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.code = int(code)


def load_settings_safe() -> Dict[str, Any]:
    try:
        return load_settings()
    except Exception:
        seed = {"settings": {}, "providers": []}
        set_app_settings(seed)
        return load_settings()


def _split_path(path: str) -> List[str]:
    return [x for x in str(path or "").strip().split(".") if x]


def get_path_value(obj: Any, path: str) -> Any:
    cur = obj
    for part in _split_path(path):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def set_path_value(obj: Dict[str, Any], path: str, value: Any) -> None:
    parts = _split_path(path)
    if not parts:
        raise CliError("空路径不可写入", 2)
    cur: Dict[str, Any] = obj
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value


def delete_path_value(obj: Dict[str, Any], path: str) -> bool:
    parts = _split_path(path)
    if not parts:
        return False
    cur: Dict[str, Any] = obj
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            return False
        cur = nxt
    if parts[-1] in cur:
        del cur[parts[-1]]
        return True
    return False


def parse_value(spec: ConfigKeySpec, raw: str) -> Any:
    s = str(raw)
    t = spec.value_type
    if t == "string":
        v = s
    elif t == "bool":
        low = s.strip().lower()
        if low in {"1", "true", "on", "yes", "y"}:
            v = True
        elif low in {"0", "false", "off", "no", "n"}:
            v = False
        else:
            raise CliError(f"{spec.group}.{spec.key} 需要布尔值(on/off/true/false)", 4)
    elif t == "int":
        try:
            v = int(s)
        except Exception as exc:
            raise CliError(f"{spec.group}.{spec.key} 需要整数", 4) from exc
    elif t == "float":
        try:
            v = float(s)
        except Exception as exc:
            raise CliError(f"{spec.group}.{spec.key} 需要数字", 4) from exc
    elif t == "json":
        try:
            v = json.loads(s)
        except Exception as exc:
            raise CliError(f"{spec.group}.{spec.key} 需要 JSON 字符串", 4) from exc
    else:
        v = s
    if spec.choices and str(v) not in set(spec.choices):
        raise CliError(f"{spec.group}.{spec.key} 可选值: {', '.join(spec.choices)}", 4)
    return v


def _apply_setting(raw: Dict[str, Any], path: str, value: Any) -> Dict[str, Any]:
    next_raw = copy.deepcopy(raw)
    set_path_value(next_raw, path, value)
    return next_raw


def _reset_setting(raw: Dict[str, Any], path: str) -> tuple[Dict[str, Any], bool]:
    next_raw = copy.deepcopy(raw)
    changed = delete_path_value(next_raw, path)
    return next_raw, changed


def _diff_obj(old: Any, new: Any, prefix: str = "") -> List[Dict[str, Any]]:
    if isinstance(old, dict) and isinstance(new, dict):
        keys = sorted(set(old.keys()) | set(new.keys()))
        out: List[Dict[str, Any]] = []
        for k in keys:
            np = f"{prefix}.{k}" if prefix else k
            out.extend(_diff_obj(old.get(k), new.get(k), np))
        return out
    if old != new:
        return [{"path": prefix, "old": old, "new": new}]
    return []


def _record_revision(
    before: Dict[str, Any],
    after: Dict[str, Any],
    action: str,
    target: str,
    reason: str = "",
    actor: str = "cli",
) -> int:
    return add_settings_revision(
        actor=actor,
        action=action,
        scope="global",
        target=target,
        reason=reason,
        before_data=before,
        after_data=after,
        meta={"source": "anima-cli"},
    )


def get_registry_overview() -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for group, title in GROUPS.items():
        out[group] = {
            "title": title,
            "keys": [asdict(x) for x in list_group_keys(group)],
        }
    return out


def list_keys(group: str) -> List[Dict[str, Any]]:
    g = str(group or "").strip()
    if g not in GROUPS:
        raise CliError(f"未知分组: {g}", 3)
    if g == "provider":
        raw = load_settings_safe()
        providers = raw.get("providers") if isinstance(raw, dict) else []
        out: List[Dict[str, Any]] = []
        if isinstance(providers, list):
            for p in providers:
                if not isinstance(p, dict):
                    continue
                pid = str(p.get("id") or "").strip()
                if not pid:
                    continue
                out.extend(
                    [
                        {
                            "group": "provider",
                            "key": f"{pid}.enabled",
                            "storage_path": f"providers[{pid}].isEnabled",
                            "value_type": "bool",
                            "description": f"提供商 {pid} 是否启用",
                            "ui_path": "设置 -> 提供商",
                            "risk": "medium",
                        },
                        {
                            "group": "provider",
                            "key": f"{pid}.model",
                            "storage_path": f"providers[{pid}].config.selectedModel",
                            "value_type": "string",
                            "description": f"提供商 {pid} 默认模型",
                            "ui_path": "设置 -> 提供商 -> 模型",
                            "risk": "low",
                        },
                        {
                            "group": "provider",
                            "key": f"{pid}.base_url",
                            "storage_path": f"providers[{pid}].config.baseUrl",
                            "value_type": "string",
                            "description": f"提供商 {pid} Base URL",
                            "ui_path": "设置 -> 提供商 -> Base URL",
                            "risk": "high",
                        },
                        {
                            "group": "provider",
                            "key": f"{pid}.api_key",
                            "storage_path": f"providers[{pid}].config.apiKey",
                            "value_type": "string",
                            "description": f"提供商 {pid} API Key",
                            "ui_path": "设置 -> 提供商 -> API Key",
                            "risk": "high",
                        },
                    ]
                )
        return out
    return [asdict(x) for x in list_group_keys(g)]


def list_installed_skills() -> Dict[str, Any]:
    try:
        dir_path, skills = list_skills()
    except Exception as exc:
        raise CliError(f"读取已安装技能失败: {exc}", 6) from exc
    return {
        "ok": True,
        "dir": dir_path,
        "skills": skills if isinstance(skills, list) else [],
    }


def describe_key(group: str, key: str) -> Dict[str, Any]:
    if str(group or "").strip() == "provider":
        parts = str(key or "").strip().split(".", 1)
        if len(parts) != 2:
            raise CliError("provider key 格式应为 <providerId>.<enabled|model|base_url|api_key>", 3)
        suffix = parts[1].strip()
        if suffix not in {"enabled", "model", "base_url", "api_key"}:
            raise CliError("provider key 后缀仅支持 enabled/model/base_url/api_key", 3)
        risk = "high" if suffix in {"base_url", "api_key"} else "medium" if suffix == "enabled" else "low"
        return {
            "group": "provider",
            "key": key,
            "storagePath": f"providers[{parts[0]}].{suffix}",
            "valueType": "bool" if suffix == "enabled" else "string",
            "risk": risk,
            "uiPath": "设置 -> 提供商",
            "description": f"提供商 {parts[0]} 的 {suffix}",
        }
    spec = resolve_key(group, key)
    if spec is None:
        raise CliError(f"未知配置项: {group}.{key}", 3)
    return asdict(spec)


def get_value(group: str, key: str) -> Dict[str, Any]:
    if str(group or "").strip() == "provider":
        raw = load_settings_safe()
        parts = str(key or "").strip().split(".", 1)
        if len(parts) != 2:
            raise CliError("provider key 格式应为 <providerId>.<enabled|model|base_url|api_key>", 3)
        pid, suffix = parts[0].strip(), parts[1].strip()
        providers = raw.get("providers")
        if not isinstance(providers, list):
            raise CliError("providers 配置不存在", 6)
        target = next((p for p in providers if isinstance(p, dict) and str(p.get("id") or "").strip() == pid), None)
        if not isinstance(target, dict):
            raise CliError(f"未找到 provider: {pid}", 3)
        value = None
        if suffix == "enabled":
            value = bool(target.get("isEnabled"))
        elif suffix == "model":
            cfg = target.get("config") if isinstance(target.get("config"), dict) else {}
            value = str(cfg.get("selectedModel") or "")
        elif suffix == "base_url":
            cfg = target.get("config") if isinstance(target.get("config"), dict) else {}
            value = str(cfg.get("baseUrl") or "")
        elif suffix == "api_key":
            cfg = target.get("config") if isinstance(target.get("config"), dict) else {}
            value = str(cfg.get("apiKey") or "")
        else:
            raise CliError("provider key 后缀仅支持 enabled/model/base_url/api_key", 3)
        risk = "high" if suffix in {"base_url", "api_key"} else "medium" if suffix == "enabled" else "low"
        return {
            "ok": True,
            "group": "provider",
            "key": key,
            "value": value,
            "risk": risk,
            "uiPath": "设置 -> 提供商",
        }
    spec = resolve_key(group, key)
    if spec is None:
        raise CliError(f"未知配置项: {group}.{key}", 3)
    raw = load_settings_safe()
    value = get_path_value(raw, spec.storage_path)
    return {
        "ok": True,
        "group": spec.group,
        "key": spec.key,
        "storagePath": spec.storage_path,
        "value": value,
        "risk": spec.risk,
        "uiPath": spec.ui_path,
    }


def set_value(group: str, key: str, value_raw: str, yes: bool = False) -> Dict[str, Any]:
    if str(group or "").strip() == "provider":
        raw = load_settings_safe()
        parts = str(key or "").strip().split(".", 1)
        if len(parts) != 2:
            raise CliError("provider key 格式应为 <providerId>.<enabled|model|base_url|api_key>", 3)
        pid, suffix = parts[0].strip(), parts[1].strip()
        providers = raw.get("providers")
        if not isinstance(providers, list):
            raise CliError("providers 配置不存在", 6)
        idx = -1
        for i, p in enumerate(providers):
            if isinstance(p, dict) and str(p.get("id") or "").strip() == pid:
                idx = i
                break
        if idx < 0:
            raise CliError(f"未找到 provider: {pid}", 3)
        next_raw = copy.deepcopy(raw)
        p = next_raw["providers"][idx]
        cfg = p.get("config")
        if not isinstance(cfg, dict):
            cfg = {}
            p["config"] = cfg
        old_value = None
        new_value: Any = None
        risk = "low"
        if suffix == "enabled":
            old_value = bool(p.get("isEnabled"))
            new_value = parse_value(ConfigKeySpec("provider", "enabled", "", "bool", "", "", "medium"), value_raw)
            p["isEnabled"] = bool(new_value)
            risk = "medium"
        elif suffix == "model":
            old_value = str(cfg.get("selectedModel") or "")
            new_value = str(value_raw)
            cfg["selectedModel"] = new_value
        elif suffix == "base_url":
            old_value = str(cfg.get("baseUrl") or "")
            new_value = str(value_raw)
            if not yes:
                raise CliError("高风险配置项需要 --yes 确认", 5)
            cfg["baseUrl"] = new_value
            risk = "high"
        elif suffix == "api_key":
            old_value = str(cfg.get("apiKey") or "")
            new_value = str(value_raw)
            if not yes:
                raise CliError("高风险配置项需要 --yes 确认", 5)
            cfg["apiKey"] = new_value
            risk = "high"
        else:
            raise CliError("provider key 后缀仅支持 enabled/model/base_url/api_key", 3)
        set_app_settings(next_raw)
        revision = _record_revision(raw, next_raw, "set", f"provider.{key}")
        return {
            "ok": True,
            "group": "provider",
            "key": key,
            "old": old_value,
            "new": new_value,
            "changed": old_value != new_value,
            "revision": revision,
            "risk": risk,
        }
    spec = resolve_key(group, key)
    if spec is None:
        raise CliError(f"未知配置项: {group}.{key}", 3)
    value = parse_value(spec, value_raw)
    if spec.risk == "high" and not yes:
        raise CliError("高风险配置项需要 --yes 确认", 5)
    before_raw = load_settings_safe()
    old_value = get_path_value(before_raw, spec.storage_path)
    next_raw = _apply_setting(before_raw, spec.storage_path, value)
    set_app_settings(next_raw)
    revision = _record_revision(before_raw, next_raw, "set", f"{spec.group}.{spec.key}")
    new_value = get_path_value(next_raw, spec.storage_path)
    return {
        "ok": True,
        "group": spec.group,
        "key": spec.key,
        "storagePath": spec.storage_path,
        "old": old_value,
        "new": new_value,
        "changed": old_value != new_value,
        "revision": revision,
        "risk": spec.risk,
    }


def reset_value(group: str, key: str, yes: bool = False) -> Dict[str, Any]:
    spec = resolve_key(group, key)
    if spec is None:
        raise CliError(f"未知配置项: {group}.{key}", 3)
    if spec.risk == "high" and not yes:
        raise CliError("高风险配置项需要 --yes 确认", 5)
    before_raw = load_settings_safe()
    old_value = get_path_value(before_raw, spec.storage_path)
    next_raw, changed = _reset_setting(before_raw, spec.storage_path)
    if changed:
        set_app_settings(next_raw)
        revision = _record_revision(before_raw, next_raw, "reset", f"{spec.group}.{spec.key}")
    else:
        revision = 0
    new_value = get_path_value(next_raw, spec.storage_path)
    return {
        "ok": True,
        "group": spec.group,
        "key": spec.key,
        "old": old_value,
        "new": new_value,
        "changed": bool(changed),
        "revision": revision,
        "risk": spec.risk,
    }


def diff_group(group: str) -> Dict[str, Any]:
    g = str(group or "").strip()
    if g not in GROUPS:
        raise CliError(f"未知分组: {g}", 3)
    raw = load_settings_safe()
    base = raw
    patches: List[Dict[str, Any]] = []
    for spec in list_group_keys(g):
        gv = get_path_value(raw, spec.storage_path)
        ev = get_path_value(base, spec.storage_path)
        if gv != ev:
            patches.append(
                {
                    "group": spec.group,
                    "key": spec.key,
                    "storagePath": spec.storage_path,
                    "global": gv,
                    "effective": ev,
                }
            )
    return {"ok": True, "group": g, "changes": patches}


def apply_patch_file(file_path: str, yes: bool = False, dry_run: bool = False) -> Dict[str, Any]:
    path = Path(str(file_path or "")).expanduser()
    if not path.exists():
        raise CliError(f"patch 文件不存在: {path}", 2)
    try:
        patch = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise CliError(f"patch 文件不是有效 JSON: {path}", 2) from exc
    if not isinstance(patch, dict):
        raise CliError("patch 顶层必须是对象", 2)
    before_raw = load_settings_safe()
    next_raw = copy.deepcopy(before_raw)
    rejected: List[str] = []
    for k, v in patch.items():
        if not isinstance(k, str):
            continue
        spec = resolve_key("", k)
        if spec is None:
            rejected.append(k)
            continue
        if spec.risk == "high" and not yes:
            rejected.append(k)
            continue
        parsed = parse_value(spec, json.dumps(v, ensure_ascii=False) if spec.value_type == "json" else str(v))
        next_raw = _apply_setting(next_raw, spec.storage_path, parsed)
    if rejected:
        raise CliError(f"以下键不允许自动应用: {', '.join(rejected)}", 5)
    changes = _diff_obj(before_raw, next_raw)
    if dry_run:
        return {"ok": True, "dryRun": True, "changes": changes}
    if changes:
        set_app_settings(next_raw)
        revision = _record_revision(before_raw, next_raw, "apply", str(path))
    else:
        revision = 0
    return {"ok": True, "dryRun": False, "changes": changes, "revision": revision}


def get_history(limit: int = 50) -> Dict[str, Any]:
    return {"ok": True, "items": list_settings_revisions(limit)}


def rollback(revision_id: int, yes: bool = False) -> Dict[str, Any]:
    rev = get_settings_revision(int(revision_id))
    if not rev:
        raise CliError(f"revision 不存在: {revision_id}", 3)
    before = rev.get("before")
    after = rev.get("after")
    if not isinstance(before, dict) or not isinstance(after, dict):
        raise CliError("revision 数据损坏，无法回滚", 6)
    if not yes:
        raise CliError("回滚需要 --yes 确认", 5)
    current = load_settings_safe()
    set_app_settings(before)
    new_revision = _record_revision(current, before, "rollback", str(revision_id), reason="rollback")
    return {"ok": True, "rolledBackTo": revision_id, "revision": new_revision}
