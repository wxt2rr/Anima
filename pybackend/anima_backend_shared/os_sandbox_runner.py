import os
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional

from .util import norm_abs, safe_env


def _escape_profile_literal(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace('"', '\\"')


def _unique_roots(values: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in values:
        s = str(raw or "").strip()
        if not s:
            continue
        p = norm_abs(s)
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def _build_macos_profile(write_roots: List[str]) -> str:
    rules: List[str] = []
    for root in _unique_roots(write_roots):
        s = _escape_profile_literal(root)
        rules.append(f'(allow file-read* (literal "{s}") (subpath "{s}"))')
        rules.append(f'(allow file-write* (literal "{s}") (subpath "{s}"))')
    return "\n".join(
        [
            "(version 1)",
            "(deny default)",
            '(import "system.sb")',
            "(allow process*)",
            "(allow signal (target self))",
            "(allow sysctl-read)",
            "(allow file-read*",
            '  (subpath "/System")',
            '  (subpath "/usr")',
            '  (subpath "/bin")',
            '  (subpath "/sbin")',
            '  (subpath "/private/etc")',
            '  (subpath "/private/var")',
            '  (subpath "/dev")',
            ")",
            "(deny network*)",
            *rules,
            "",
        ]
    )


def run_bash_with_os_sandbox(
    *,
    command: str,
    cwd: str,
    timeout_ms: int,
    permission_mode: str,
    workspace_dir: str,
    allowed_roots: Optional[List[str]] = None,
    env: Optional[Dict[str, str]] = None,
    max_chars: int = 20000,
) -> Dict[str, Any]:
    cmd = str(command or "").strip()
    if not cmd:
        raise RuntimeError("command is required")

    run_cwd = norm_abs(str(cwd or "").strip())
    timeout = max(1000, min(int(timeout_ms or 20000), 120000))
    base_env = dict(env) if isinstance(env, dict) else safe_env()

    write_roots = _unique_roots([workspace_dir, tempfile.gettempdir(), *(allowed_roots or [])])
    use_sandbox = sys.platform == "darwin" and str(permission_mode or "").strip() != "full_access"

    bash_base = ["/bin/bash", "--noprofile", "--norc", "-c", cmd]
    if use_sandbox:
        command_list = ["sandbox-exec", "-p", _build_macos_profile(write_roots), *bash_base]
        sandbox = {"enabled": True, "kind": "macos_sandbox_exec", "reason": "permission_mode_workspace_whitelist"}
    else:
        command_list = list(bash_base)
        sandbox = {
            "enabled": False,
            "kind": "none",
            "reason": "permission_mode_full_access" if str(permission_mode or "").strip() == "full_access" else f"platform_{sys.platform}",
        }

    p = subprocess.run(
        command_list,
        cwd=run_cwd,
        capture_output=True,
        text=True,
        env=base_env,
        timeout=timeout / 1000.0,
    )
    stdout = p.stdout or ""
    stderr = p.stderr or ""
    out_trunc = len(stdout) > max_chars
    err_trunc = len(stderr) > max_chars
    if out_trunc:
        stdout = stdout[:max_chars]
    if err_trunc:
        stderr = stderr[:max_chars]
    return {
        "ok": True,
        "exitCode": int(p.returncode),
        "stdout": stdout,
        "stderr": stderr,
        "truncated": {"stdout": out_trunc, "stderr": err_trunc},
        "cwd": run_cwd,
        "sandbox": sandbox,
    }
