---
name: mac-desktop
description: 统一处理 macOS 本机能力，适用于日历、邮件、联系人、备忘录、文件、Spotlight、截图、剪贴板、窗口、系统控制、通知、蓝牙、Wifi等。
---

# mac-desktop

## 目标

把 Mac 本机能力封装为「总入口 + 子能力脚本」，统一 JSON 输出，降低运行时拼接命令的风险。

## 目录

```text
skills/mac-desktop/
├── SKILL.md
└── scripts/
    ├── common/
    ├── reminders/
    ├── calendar/
    ├── mail/
    ├── contacts/
    ├── notes/
    ├── files/
    ├── spotlight/
    ├── screenshot/
    ├── clipboard/
    ├── window-manager/
    ├── system/
    ├── notification/
    └── shortcuts/
```

## 统一变量

```bash
SCRIPT_DIR="$(pwd)/skills/mac-desktop/scripts"
REMINDERS_DIR="$SCRIPT_DIR/reminders"
SHORTCUTS_DIR="$SCRIPT_DIR/shortcuts"
```

## 执行策略

1. 能稳定 AppleScript 的能力优先直连 AppleScript
2. 系统控制和跨版本差异大的能力优先走 shell 命令
3. 复杂自动化能力走 Shortcuts
4. 每个操作脚本内部自行回退并输出反馈，不要求调用方判断后端

## 输出约定

- 成功：`{"ok":true,...}`
- 失败：`{"ok":false,"error":"...","code":"..."}`
- 统一反馈字段：`operation`、`backend`、`strategy`（以及可选 `attempts`、`output`）

## Shortcuts 缺失自动处理

- 运行脚本时若发现快捷指令不存在，会自动尝试从 `skills/mac-desktop/shortcuts/templates/` 导入同名 `.shortcut` 模板
- 可通过环境变量控制：
  - `MAC_SHORTCUT_AUTO_CREATE=1|0`（默认 `1`）
  - `MAC_SHORTCUT_AUTO_CREATE_TIMEOUT_SEC`（默认 `8` 秒）
  - `MAC_SHORTCUT_TEMPLATE_DIR`（自定义模板目录）
- 注意：系统 `shortcuts` CLI 不支持直接新建快捷指令，自动创建基于模板导入

## 能力入口

### reminders（内置 AppleScript）

- 创建提醒：

```bash
osascript "$SCRIPT_DIR/reminders/create_reminder.applescript" "<title>" "<notes>" "<listName>" "<dueAt>"
```

- 查询提醒：

```bash
osascript "$SCRIPT_DIR/reminders/list_reminders.applescript" "<listName>" "<status>" "<limit>"
```

- 完成提醒：

```bash
osascript "$SCRIPT_DIR/reminders/complete_reminder.applescript" "<id-or-title>" "<listName>"
```

### shortcuts bridge

- 运行快捷指令：

```bash
bash "$SCRIPT_DIR/shortcuts/run_shortcut.sh" "<shortcutName>" "<optionalInputText>"
```

- 列出快捷指令：

```bash
bash "$SCRIPT_DIR/shortcuts/list_shortcuts.sh"
```

### calendar

- `scripts/calendar/create_event.sh <jsonPayload>`
- `scripts/calendar/list_events.sh [jsonPayload]`
- `scripts/calendar/detect_conflicts.sh [jsonPayload]`
- `scripts/calendar/reschedule_event.sh <jsonPayload>`

默认调用以下快捷指令名（可用环境变量覆盖）：

- `MacDesktop.Calendar.CreateEvent`
- `MacDesktop.Calendar.ListEvents`
- `MacDesktop.Calendar.DetectConflicts`
- `MacDesktop.Calendar.RescheduleEvent`

### mail

- `scripts/mail/read_summary.sh [jsonPayload]`
- `scripts/mail/archive_by_rule.sh <jsonPayload>`
- `scripts/mail/draft_reply.sh <jsonPayload>`

默认快捷指令名：

- `MacDesktop.Mail.ReadSummary`
- `MacDesktop.Mail.ArchiveByRule`
- `MacDesktop.Mail.DraftReply`

### contacts

- `scripts/contacts/find_contact.sh <keywordOrJson>`
- `scripts/contacts/add_contact.sh <jsonPayload>`

默认快捷指令名：

- `MacDesktop.Contacts.Find`
- `MacDesktop.Contacts.Add`

### notes

- `scripts/notes/create_note.sh <jsonPayload>`
- `scripts/notes/append_note.sh <jsonPayload>`
- `scripts/notes/tag_note.sh <jsonPayload>`

默认快捷指令名：

- `MacDesktop.Notes.Create`
- `MacDesktop.Notes.Append`
- `MacDesktop.Notes.Tag`

### files（直接脚本）

- 批量重命名：`scripts/files/batch_rename.sh <dir> <search> <replace> [dryRun=true|false]`
- 归档移动：`scripts/files/archive_items.sh <archiveDir> <path1> [path2 ...]`
- 定向移动：`scripts/files/move_items.sh <targetDir> <path1> [path2 ...]`
- 清理下载：`scripts/files/clean_downloads.sh [days=30] [dryRun=true|false] [downloadsDir]`

### spotlight（直接脚本）

- 搜索：`scripts/spotlight/search.sh <query> [limit=20]`
- 打开：`scripts/spotlight/open_path.sh <pathOrApp>`

### screenshot

- 截图：`scripts/screenshot/capture.sh [outputPath] [full|interactive]`
- OCR：`scripts/screenshot/ocr.sh <imagePath>`（默认走 `MacDesktop.Screenshot.OCR`）

### clipboard

- 读取：`scripts/clipboard/get_text.sh`
- 写入：`scripts/clipboard/set_text.sh <text>`
- 清洗：`scripts/clipboard/clean_text.sh`
- 历史：`scripts/clipboard/history.sh [jsonPayload]`（默认 `MacDesktop.Clipboard.History`）
- 模板粘贴：`scripts/clipboard/paste_template.sh <templateText>`

### window-manager

- 布局应用：`scripts/window-manager/apply_layout.sh <layoutNameOrJson>`（默认 `MacDesktop.Window.ApplyLayout`）

### system

- 音量：`scripts/system/set_volume.sh <0-100>`
- Wi-Fi：`scripts/system/toggle_wifi.sh <on|off>`
- 蓝牙：`scripts/system/toggle_bluetooth.sh <on|off>`（默认 `MacDesktop.System.ToggleBluetooth`）
- 勿扰：`scripts/system/toggle_do_not_disturb.sh <on|off>`（默认 `MacDesktop.System.ToggleDND`）
- 亮度：`scripts/system/set_brightness.sh <0-100>`（默认 `MacDesktop.System.SetBrightness`）

### notification

- 本地通知：`scripts/notification/push.sh <title> [body] [subtitle]`

## 安全规则

- 删除/移动/归档/批量改名默认先 dry-run 或先确认
- 外发动作（邮件发送、联系人写入）默认先草稿或预览
- 未明确确认时，不执行不可逆写操作

## 环境依赖

- `shortcuts` 命令可用（用于 bridge 与多数高级能力）
- 部分脚本依赖：`mdfind`、`open`、`screencapture`、`pbcopy`、`pbpaste`、`networksetup`

## 无副作用自检

```bash
bash "$SCRIPT_DIR/shortcuts/list_shortcuts.sh"
bash "$SCRIPT_DIR/shortcuts/run_shortcut.sh"
bash "$SCRIPT_DIR/files/batch_rename.sh"
bash "$SCRIPT_DIR/spotlight/search.sh"
bash "$SCRIPT_DIR/screenshot/capture.sh"
bash "$SCRIPT_DIR/clipboard/get_text.sh"
bash "$SCRIPT_DIR/system/set_volume.sh"
bash "$SCRIPT_DIR/notification/push.sh"
```
