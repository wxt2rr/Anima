---
name: anima-cli-config
description: 通过 anima CLI 读取和修改Anima(就是你自己)的配置信息，比如获取主题色、获取模型提供商，开启/关闭xxx配置，当你觉得用户是在询问你的配置或者开启/关闭你的配置的时候使用。
---

# anima-cli-config

## 目标
在识别到“配置查询/配置修改”意图时调用 `anima` CLI，而不是直接猜测配置状态。
并且先通过一级命令 `--help` 确认可用二级命令，再执行具体动作。

## 适用场景

用户在问关于Anima,或者理解是关于你的配置时，示例：
- 用户问“为什么某功能没生效”，"现在主题色是什么"
- 用户要求“把某设置打开/关闭/改成某值”，“把主题色设置为红色”
- 用户要求查看某分组可配置项、某配置项帮助或历史变更

## 执行协议

0. 强制入口（必须遵守）
   - 所有命令直接执行 `anima ...`
   - 不允许执行环境探测命令：`pwd`、`which anima`、`echo $PATH`、`ls`、`find`
   - 不允许“先查半天再查配置”，必须先执行与用户意图直接对应的一级命令 `--help`，再执行二级命令

1. 一级命令发现（必须先做）
   - 先执行：`anima --help`
   - 已注册一级命令（依据 `anima --help`）：
     - `general`
     - `provider`
     - `chat`
     - `memory`
     - `im`
     - `skill`
     - `network`
     - `data`
     - `voice`
     - `shortcut`
     - `about`
     - `history`
     - `rollback`
     - `schema`
   - 根据用户意图选择一级命令后，先执行：`anima <一级命令> --help`
   - 再根据二级命令执行实际操作

2. 二级命令下钻规则
   - 对配置组命令（`general/provider/chat/memory/im/skill/network/data/voice/shortcut/about`），二级命令以 `--help` 为准，通常为：
     - `list/get/set/describe/reset/diff/apply`
   - `skill` 组额外支持：
     - `installed`：列出已安装技能列表（非配置键）
   - 对特殊一级命令：
     - `history`：`anima history --help`（支持 `--limit`、`--json`）
     - `rollback`：`anima rollback --help`（支持 `revision`、`--yes`、`--json`）
     - `schema`：`anima schema --help`

3. 查询类请求
   - 优先执行 `anima <group> get <key> --json`
   - 若 key 不确定，先执行 `anima <group> list --json` 或 `describe`
   - 基于 CLI 输出回答，不要臆测

4. 修改类请求
   - 先给出计划：将修改哪些 key、风险等级
   - 再询问用户确认
   - 用户确认后执行 `anima <group> set <key> <value> --json`
   - 高风险项必须带 `--yes`

5. 回滚与审计
   - 查询历史：`anima history --json`
   - 回滚：`anima rollback <revision> --yes --json`

6. 技能相关语义约束（必须遵守）
   - `load_skill` 或“已加载技能”仅表示“读取了技能内容”
   - 不能把“已加载技能”表述为“已启用技能”
   - “已启用技能”必须有可验证证据：`settings.skillsEnabledIds` 已包含对应 id（例如通过 `anima skill get ... --json` 或设置页状态）
   - 若只有加载证据，输出必须写“已加载，未确认启用”
   - 查询“已安装技能列表”必须执行：`anima skill installed --json`
   - `anima skill list --json` 仅表示“skill 配置组可配置项”，不能当作已安装技能列表

## 意图到首条命令映射（必须直达）

- “为什么没有流式返回/流式没生效”
  - 首条命令：`anima chat get stream --json`
- “当前主题/主题色是什么”
  - 首条命令：`anima general get theme --json`
  - 或：`anima general get theme_color --json`
- “当前模型提供商/模型是什么”
  - 首条命令：`anima provider list --json`
- “某配置在哪个分组/有哪些可配项”
  - 首条命令：`anima <group> list --json`
- “这个 key 是干什么的”
  - 首条命令：`anima <group> describe <key> --json`
- “有哪些已安装技能”
  - 首条命令：`anima skill installed --json`

## 常用命令

```bash
anima --help
anima general --help
anima chat get stream --json
anima chat set stream on --json
anima chat describe stream --json
anima chat list --json
anima skill --help
anima skill installed --json
anima history --help
anima rollback --help
anima history --json
```

## 输出要求

- 回复中明确区分：
  - 结论
  - 依据（CLI 返回值）
  - 变更（若执行了 set/apply）
  - revision（若有）

## 限制

- 不直接写数据库
- 不跳过确认直接改高风险配置
- 当 CLI 报错时，返回错误信息并给可执行下一步
- 不使用不存在的分组（例如 `ui`）；仅使用 CLI 已注册分组
