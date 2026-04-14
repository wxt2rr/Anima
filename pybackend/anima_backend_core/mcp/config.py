from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from anima_backend_shared.paths import config_root_by_platform

from .constants import (
    DEFAULT_REQUEST_TIMEOUT_MS,
    DEFAULT_STARTUP_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,
    MCP_CONFIG_VERSION,
    MIN_REQUEST_TIMEOUT_MS,
    SENSITIVE_KEYWORDS,
    SUPPORTED_SERVER_TYPES,
)

DEFAULT_MCP_CONFIG: Dict[str, Any] = {
    "version": MCP_CONFIG_VERSION,
    "inputs": [],
    "mcpServers": {},
}


ConfigError = Dict[str, str]


def default_user_mcp_config_path() -> Path:
    root = config_root_by_platform()
    root.mkdir(parents=True, exist_ok=True)
    return root / "mcp.json"


def default_project_mcp_config_path(workspace_dir: str) -> Path:
    return Path(str(workspace_dir or "").strip()).expanduser().resolve() / ".mcp.json"


def _error(path: str, code: str, message: str) -> ConfigError:
    return {"path": path, "code": code, "message": message}


def _is_string_map(obj: Any) -> bool:
    return isinstance(obj, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in obj.items())


def _as_bool(v: Any, default: bool) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return default
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "1", "yes", "on"):
            return True
        if s in ("false", "0", "no", "off"):
            return False
    return default


def _normalize_tools(raw: Any, path: str, errors: List[ConfigError]) -> List[str]:
    if not isinstance(raw, list) or not raw:
        errors.append(_error(path, "missing_tools", "`tools` 必须是非空数组，且需显式配置最小权限"))
        return []
    out: List[str] = []
    seen = set()
    for i, item in enumerate(raw):
        if not isinstance(item, str) or not item.strip():
            errors.append(_error(f"{path}[{i}]", "invalid_tool_item", "工具项必须是非空字符串"))
            continue
        v = item.strip()
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    if not out:
        errors.append(_error(path, "empty_tools", "`tools` 至少需要一项"))
    return out


def _contains_secret_literal(key: str, value: str) -> bool:
    lk = key.strip().lower().replace("-", "").replace("_", "")
    if any(k in lk for k in SENSITIVE_KEYWORDS):
        return "${" not in value
    if lk == "authorization":
        return ("bearer" in value.lower()) and ("${" not in value)
    return False


def _validate_secret_map(raw: Any, path: str, errors: List[ConfigError]) -> Dict[str, str]:
    if raw is None:
        return {}
    if not _is_string_map(raw):
        errors.append(_error(path, "invalid_string_map", "必须是 `string -> string` 的对象"))
        return {}
    out: Dict[str, str] = {}
    for k, v in raw.items():
        key = str(k).strip()
        val = str(v)
        out[key] = val
        if _contains_secret_literal(key, val):
            errors.append(
                _error(
                    f"{path}.{key}",
                    "insecure_secret_literal",
                    "敏感字段不允许明文，必须使用 `${input:...}` 或 `${env:...}` 引用",
                )
            )
    return out


def _normalize_timeout(raw: Any, default: int, path: str, errors: List[ConfigError]) -> int:
    if raw is None:
        return default
    try:
        v = int(raw)
    except Exception:
        errors.append(_error(path, "invalid_timeout", "超时时间必须是整数毫秒"))
        return default
    if v < MIN_REQUEST_TIMEOUT_MS or v > MAX_REQUEST_TIMEOUT_MS:
        errors.append(
            _error(
                path,
                "timeout_out_of_range",
                f"超时时间必须在 {MIN_REQUEST_TIMEOUT_MS}-{MAX_REQUEST_TIMEOUT_MS} ms 之间",
            )
        )
        return default
    return v


def _normalize_input(item: Any, idx: int, errors: List[ConfigError]) -> Optional[Dict[str, Any]]:
    base = f"$.inputs[{idx}]"
    if not isinstance(item, dict):
        errors.append(_error(base, "invalid_input", "输入定义必须是对象"))
        return None
    input_id = str(item.get("id") or "").strip()
    if not input_id:
        errors.append(_error(f"{base}.id", "missing_input_id", "`id` 不能为空"))
        return None
    if not re.fullmatch(r"[A-Za-z0-9._-]+", input_id):
        errors.append(_error(f"{base}.id", "invalid_input_id", "`id` 只允许字母/数字/._-"))
        return None
    itype = str(item.get("type") or "promptString").strip()
    if itype != "promptString":
        errors.append(_error(f"{base}.type", "unsupported_input_type", "当前仅支持 `promptString`"))
        return None
    out = {
        "id": input_id,
        "type": "promptString",
        "description": str(item.get("description") or "").strip(),
        "password": bool(item.get("password")),
        "required": _as_bool(item.get("required"), True),
    }
    default_value = item.get("default")
    if isinstance(default_value, str):
        out["default"] = default_value
    return out


def _normalize_server(server_id: str, raw: Any, errors: List[ConfigError]) -> Optional[Dict[str, Any]]:
    base = f"$.mcpServers.{server_id}"
    if not isinstance(raw, dict):
        errors.append(_error(base, "invalid_server", "Server 配置必须是对象"))
        return None

    server_type = str(raw.get("type") or "").strip().lower()
    if not server_type:
        if str(raw.get("command") or "").strip():
            server_type = "stdio"
        elif str(raw.get("url") or "").strip():
            server_type = "http"
    if server_type not in SUPPORTED_SERVER_TYPES:
        errors.append(_error(f"{base}.type", "unsupported_type", "`type` 仅支持 stdio/http/sse"))
        return None

    name = str(raw.get("name") or server_id).strip() or server_id
    enabled = _as_bool(raw.get("enabled"), True)
    auto_start = _as_bool(raw.get("autoStart"), False)
    trust = _as_bool(raw.get("trust"), False)

    request_timeout_ms = _normalize_timeout(raw.get("requestTimeoutMs"), DEFAULT_REQUEST_TIMEOUT_MS, f"{base}.requestTimeoutMs", errors)
    startup_timeout_ms = _normalize_timeout(raw.get("startupTimeoutMs"), DEFAULT_STARTUP_TIMEOUT_MS, f"{base}.startupTimeoutMs", errors)

    tools = _normalize_tools(raw.get("tools"), f"{base}.tools", errors)

    out: Dict[str, Any] = {
        "name": name,
        "type": server_type,
        "enabled": enabled,
        "autoStart": auto_start,
        "trust": trust,
        "tools": tools,
        "requestTimeoutMs": request_timeout_ms,
        "startupTimeoutMs": startup_timeout_ms,
    }

    if server_type == "stdio":
        command = str(raw.get("command") or "").strip()
        if not command:
            errors.append(_error(f"{base}.command", "missing_command", "stdio server 必须提供 `command`"))
        args = raw.get("args")
        if args is None:
            args_list: List[str] = []
        elif isinstance(args, list) and all(isinstance(x, str) for x in args):
            args_list = [str(x) for x in args]
        else:
            errors.append(_error(f"{base}.args", "invalid_args", "`args` 必须是字符串数组"))
            args_list = []
        env = _validate_secret_map(raw.get("env"), f"{base}.env", errors)
        out.update({"command": command, "args": args_list, "env": env})
    else:
        url = str(raw.get("url") or "").strip()
        if not url:
            errors.append(_error(f"{base}.url", "missing_url", "http/sse server 必须提供 `url`"))
        elif not re.match(r"^https?://", url, flags=re.IGNORECASE):
            errors.append(_error(f"{base}.url", "invalid_url", "`url` 必须以 http:// 或 https:// 开头"))
        headers = _validate_secret_map(raw.get("headers"), f"{base}.headers", errors)
        out.update({"url": url, "headers": headers})

    if enabled and not trust:
        errors.append(_error(base, "untrusted_enabled", "启用前必须显式设置 `trust: true`"))

    return out


def normalize_and_validate_config(config_obj: Any) -> Tuple[Dict[str, Any], List[ConfigError]]:
    errors: List[ConfigError] = []
    if not isinstance(config_obj, dict):
        return dict(DEFAULT_MCP_CONFIG), [_error("$", "invalid_root", "配置根节点必须是对象")]

    version = str(config_obj.get("version") or MCP_CONFIG_VERSION).strip() or MCP_CONFIG_VERSION
    if version != MCP_CONFIG_VERSION:
        errors.append(_error("$.version", "unsupported_version", f"仅支持 version={MCP_CONFIG_VERSION}"))

    raw_inputs = config_obj.get("inputs")
    inputs: List[Dict[str, Any]] = []
    seen_input_ids = set()
    if raw_inputs is None:
        raw_inputs = []
    if not isinstance(raw_inputs, list):
        errors.append(_error("$.inputs", "invalid_inputs", "`inputs` 必须是数组"))
        raw_inputs = []
    for idx, item in enumerate(raw_inputs):
        normalized = _normalize_input(item, idx, errors)
        if not normalized:
            continue
        input_id = normalized["id"]
        if input_id in seen_input_ids:
            errors.append(_error(f"$.inputs[{idx}].id", "duplicate_input_id", "`id` 不能重复"))
            continue
        seen_input_ids.add(input_id)
        inputs.append(normalized)

    raw_servers = config_obj.get("mcpServers")
    if raw_servers is None:
        raw_servers = config_obj.get("servers")
    if raw_servers is None:
        raw_servers = {}
    if not isinstance(raw_servers, dict):
        errors.append(_error("$.mcpServers", "invalid_servers", "`mcpServers` 必须是对象"))
        raw_servers = {}

    servers: Dict[str, Dict[str, Any]] = {}
    for sid_raw, server_raw in raw_servers.items():
        sid = str(sid_raw or "").strip()
        if not sid:
            errors.append(_error("$.mcpServers", "invalid_server_id", "server id 不能为空"))
            continue
        if not re.fullmatch(r"[A-Za-z0-9._-]+", sid):
            errors.append(_error(f"$.mcpServers.{sid}", "invalid_server_id", "server id 只允许字母/数字/._-"))
            continue
        normalized = _normalize_server(sid, server_raw, errors)
        if normalized is None:
            continue
        servers[sid] = normalized

    normalized_config = {
        "version": MCP_CONFIG_VERSION,
        "inputs": inputs,
        "mcpServers": servers,
    }
    return normalized_config, errors


def parse_config_text(raw_text: str) -> Tuple[Optional[Dict[str, Any]], List[ConfigError]]:
    text = str(raw_text or "").strip()
    if not text:
        return None, [_error("$", "empty_text", "配置文本不能为空")]
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as e:
        return None, [
            _error(
                "$",
                "invalid_json",
                f"JSON 语法错误: {e.msg} (line={e.lineno}, col={e.colno})",
            )
        ]
    return obj, []


def load_config_from_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return dict(DEFAULT_MCP_CONFIG)
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return dict(DEFAULT_MCP_CONFIG)
    parsed, parse_errors = parse_config_text(raw)
    if parse_errors or parsed is None:
        raise ValueError(parse_errors[0]["message"] if parse_errors else "Invalid MCP config")
    normalized, errors = normalize_and_validate_config(parsed)
    if errors:
        raise ValueError(errors[0]["message"])
    return normalized


def save_config_to_file(path: Path, config_obj: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix="mcp.", suffix=".json", dir=str(path.parent))
    os.close(fd)
    tmp = Path(tmp_path)
    try:
        tmp.write_text(json.dumps(config_obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def choose_config_path(scope: str, workspace_dir: str = "") -> Path:
    s = str(scope or "user").strip().lower()
    if s == "project":
        if not str(workspace_dir or "").strip():
            raise ValueError("workspaceDir is required when scope=project")
        return default_project_mcp_config_path(workspace_dir)
    return default_user_mcp_config_path()
