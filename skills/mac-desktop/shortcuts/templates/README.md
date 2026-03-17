# Shortcuts 模板目录

用途：当脚本运行时发现某个快捷指令不存在，会自动在这里查找同名模板并尝试导入。

## 命名规则

模板文件名必须与快捷指令名称完全一致：

- 快捷指令名：`MacDesktop.Calendar.ListEvents`
- 模板文件：`MacDesktop.Calendar.ListEvents.shortcut`

## 自动导入行为

- 默认开启：`MAC_SHORTCUT_AUTO_CREATE=1`
- 导入超时秒数：`MAC_SHORTCUT_AUTO_CREATE_TIMEOUT_SEC`（默认 `8`）
- 模板目录可覆盖：`MAC_SHORTCUT_TEMPLATE_DIR`

说明：
- 当前系统 `shortcuts` CLI 不支持直接创建快捷指令。
- 这里的“自动创建”实际是自动导入你预先准备好的 `.shortcut` 模板。
