---
name: mac-reminders
description: 在需要创建或管理本机提醒事项时使用此技能，比如「今晚7点提醒我跑数据」，通过 bash 调用已审核的 AppleScript 脚本。
---

# mac-reminders

## 总体说明

当用户明确要求“在 macOS 提醒事项中创建 / 查询 / 完成提醒”时，可以使用本技能。
不要直接构造任意 AppleScript 或危险 shell 命令，只能调用本仓库内预先约定好的脚本。

脚本位置（在仓库内）：

- skills/mac-reminders/scripts/create_reminder.applescript
- skills/mac-reminders/scripts/list_reminders.applescript
- skills/mac-reminders/scripts/complete_reminder.applescript

这些脚本会输出单行 JSON，便于解析：

- ok: true/false
- error/code: 失败时返回
- create/complete: id
- list: items 数组（id/title/notes/due/completed/completedAt）

前置条件（必要）：

- 需要允许终端（或 osascript）自动化控制“提醒事项/Reminders”
- 如遇到 “Not authorised to send Apple events to Reminders” / -1743 等错误：系统设置 → 隐私与安全性 → 自动化 → 终端（或你的运行宿主）→ 勾选“提醒事项”

脚本目录变量（推荐用法）：

- SCRIPT_DIR="$(pwd)/skills/mac-reminders/scripts"

## 创建提醒

1. 通过 bash 工具执行类似命令：

   - osascript "$SCRIPT_DIR/create_reminder.applescript" "<title>" "<notes>" "<listName>" "<dueAt>"

2. 根据脚本输出 JSON 确认创建是否成功，并把 id 回传给用户（便于后续完成）。

说明：

- notes/listName/dueAt 都可传空字符串
- dueAt 建议传 macOS 可解析的日期字符串（例如 "2026-02-11 09:30:00"），解析失败会自动忽略 due date

## 列出提醒

1. 使用 bash 工具执行：

   - osascript "$SCRIPT_DIR/list_reminders.applescript" "<listName>" "<status>" "<limit>"

2. 解析输出并以列表形式展示。

status 取值：

- incomplete（默认）
- completed
- all

## 完成提醒

1. 使用 bash 工具执行：

   - osascript "$SCRIPT_DIR/complete_reminder.applescript" "<id-or-title>" "<listName>"

2. 根据输出确认是否成功。

## 自检（无副作用）

以下命令不会创建/修改提醒事项，只会返回 usage JSON：

- osascript "$SCRIPT_DIR/create_reminder.applescript"
- osascript "$SCRIPT_DIR/list_reminders.applescript"
- osascript "$SCRIPT_DIR/complete_reminder.applescript"
