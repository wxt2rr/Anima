from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Callable, Dict

from .registry import GROUPS
from .service import (
    CliError,
    apply_patch_file,
    describe_key,
    diff_group,
    get_history,
    get_registry_overview,
    get_value,
    list_keys,
    list_installed_skills,
    reset_value,
    rollback,
    set_value,
)


def _emit(data: Dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    print(json.dumps(data, ensure_ascii=False))


def _run_action(fn: Callable[[], Dict[str, Any]], as_json: bool) -> int:
    try:
        out = fn()
        _emit(out, as_json)
        return 0
    except CliError as exc:
        err = {"ok": False, "error": str(exc), "code": exc.code}
        _emit(err, True if as_json else True)
        return int(exc.code)
    except Exception as exc:
        err = {"ok": False, "error": str(exc), "code": 1}
        _emit(err, True if as_json else True)
        return 1


def _add_group_parser(sub: argparse._SubParsersAction, group: str, title: str) -> None:
    p = sub.add_parser(group, help=f"{title} 配置")
    p.add_argument("--json", action="store_true", help="输出 JSON")
    gsub = p.add_subparsers(dest="action", required=True)

    p_list = gsub.add_parser("list", help="列出本组可配置项")
    p_list.add_argument("--json", action="store_true", help="输出 JSON")
    p_list.set_defaults(_handler=lambda a: list_keys(group))

    p_get = gsub.add_parser("get", help="读取配置项")
    p_get.add_argument("key", help="组内 key，如 stream")
    p_get.add_argument("--json", action="store_true", help="输出 JSON")
    p_get.set_defaults(_handler=lambda a: get_value(group, a.key))

    p_set = gsub.add_parser("set", help="修改配置项")
    p_set.add_argument("key", help="组内 key")
    p_set.add_argument("value", help="值")
    p_set.add_argument("--yes", action="store_true", help="确认高风险操作")
    p_set.add_argument("--json", action="store_true", help="输出 JSON")
    p_set.set_defaults(_handler=lambda a: set_value(group, a.key, a.value, a.yes))

    p_desc = gsub.add_parser("describe", help="查看 key 说明")
    p_desc.add_argument("key", help="组内 key")
    p_desc.add_argument("--json", action="store_true", help="输出 JSON")
    p_desc.set_defaults(_handler=lambda a: {"ok": True, "item": describe_key(group, a.key)})

    p_reset = gsub.add_parser("reset", help="重置配置项")
    p_reset.add_argument("key", help="组内 key")
    p_reset.add_argument("--yes", action="store_true", help="确认高风险操作")
    p_reset.add_argument("--json", action="store_true", help="输出 JSON")
    p_reset.set_defaults(_handler=lambda a: reset_value(group, a.key, a.yes))

    p_diff = gsub.add_parser("diff", help="查看组内差异")
    p_diff.add_argument("--json", action="store_true", help="输出 JSON")
    p_diff.set_defaults(_handler=lambda a: diff_group(group))

    p_apply = gsub.add_parser("apply", help="从 patch JSON 文件批量应用")
    p_apply.add_argument("--file", required=True, help="patch 文件路径")
    p_apply.add_argument("--dry-run", action="store_true", help="仅预览")
    p_apply.add_argument("--yes", action="store_true", help="确认高风险操作")
    p_apply.add_argument("--json", action="store_true", help="输出 JSON")
    p_apply.set_defaults(_handler=lambda a: apply_patch_file(a.file, a.yes, a.dry_run))

    if group == "skill":
        p_installed = gsub.add_parser("installed", help="列出已安装技能")
        p_installed.add_argument("--json", action="store_true", help="输出 JSON")
        p_installed.set_defaults(_handler=lambda a: list_installed_skills())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="anima",
        description="Anima CLI（分组子命令 + 组内 key 操作）",
        epilog="示例: anima chat get stream --json",
    )
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    sub = parser.add_subparsers(dest="group", required=True)

    for group, title in GROUPS.items():
        _add_group_parser(sub, group, title)

    p_history = sub.add_parser("history", help="查看配置变更历史")
    p_history.add_argument("--limit", type=int, default=50)
    p_history.add_argument("--json", action="store_true", help="输出 JSON")
    p_history.set_defaults(_handler=lambda a: get_history(a.limit))

    p_rollback = sub.add_parser("rollback", help="回滚到某次 revision 的前状态")
    p_rollback.add_argument("revision", type=int, help="revision ID")
    p_rollback.add_argument("--yes", action="store_true", help="确认回滚")
    p_rollback.add_argument("--json", action="store_true", help="输出 JSON")
    p_rollback.set_defaults(_handler=lambda a: rollback(a.revision, a.yes))

    p_schema = sub.add_parser("schema", help="输出所有分组和 key 注册信息")
    p_schema.add_argument("--json", action="store_true", help="输出 JSON")
    p_schema.set_defaults(_handler=lambda a: {"ok": True, "groups": get_registry_overview()})

    return parser


def main(argv: Any = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = getattr(args, "_handler", None)
    if handler is None:
        parser.print_help()
        return 2
    as_json = bool(getattr(args, "json", False))
    return _run_action(lambda: handler(args), as_json)


if __name__ == "__main__":
    sys.exit(main())
