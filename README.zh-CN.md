# Anima

[中文](./README.zh-CN.md) | [English](./README.en.md)

Anima 是一个面向 macOS 的 AI 桌面助手，采用 Electron + 本地 Python 后端架构。

![Anima 封面图](https://github.com/wxt2rr/Anima/blob/main/images/logo_padded.png)

## 功能概览

- 对话执行引擎（支持普通对话与流式输出）
- 多提供商模型配置与模型拉取
- 本地工具调用（文件、终端、检索、图像/视频生成等）
- Skills 机制（按需加载 `SKILL.md`）
- 自动化任务（Cron/定时任务）
- Telegram 通道集成（可选）
- 语音转写（模型管理、下载、转写）
- 内置 Python 后端随应用打包
- GitHub Releases 自动更新

![Main UI Placeholder](https://github.com/wxt2rr/Anima/blob/main/images/files.png)
![Main UI Placeholder](https://github.com/wxt2rr/Anima/blob/main/images/git.png)
![Main UI Placeholder](https://github.com/wxt2rr/Anima/blob/main/images/terminal.png)
![Main UI Placeholder](https://github.com/wxt2rr/Anima/blob/main/images/web.png)
![Main UI Placeholder](https://github.com/wxt2rr/Anima/blob/main/images/setting.png)

## 功能详解

### 1. 对话与运行引擎

- 后端提供 `/api/runs` 与 `/api/runs?stream=1` 两条执行路径（非流式/流式）。
- 支持继续执行（`/api/runs/{id}/resume`）和运行记录查询（`/api/runs/{id}`）。
- 对话数据与运行数据分层管理，支持聊天历史与消息同步接口（`/api/chats/*`）。

### 2. 模型与提供商管理

- 支持多提供商配置与模型拉取（`/api/providers/fetch_models`）。
- 内置 OpenAI Codex（OAuth）配置入口，可在设置中启用/切换。
- 支持按会话覆盖 provider/model 等运行参数。

### 3. 工具系统（Builtin + MCP）

- 内置工具支持：
  - 工作区文件能力：`glob_files`、`list_dir`、`read_file`、`edit_file`、`write_file`、`rg_search`
  - 终端执行：`bash`
  - 网络检索：`WebSearch`、`WebFetch`
  - 多媒体：`screenshot`、`generate_image`、`generate_video`
  - 技能加载：`load_skill`
  - 自动化控制：`cron_list`、`cron_upsert`、`cron_delete`、`cron_run`
- 支持 MCP 工具发现与统一调度（通过 `/tools/list` 聚合 builtin + mcpTools）。

### 4. 权限与安全机制

- `bash` 支持两种权限模式：
  - `workspace_whitelist`（默认）：仅允许工作区与白名单路径
  - `full_access`：完全访问模式
- 支持命令黑白名单（命令词条模式，不要求正则）。
- 默认权限下命中黑名单可触发人工确认后再执行（交互确认流）。
- 网络抓取能力默认拦截本地/私网地址，降低 SSRF 风险。

### 5. Skills 体系

- 支持本地技能目录扫描、技能元信息校验、内容按需加载。
- 设置页可查看技能列表、读取技能内容、打开技能目录。
- 支持内置技能与用户技能共存，适合沉淀可复用工作流。

### 6. 自动化（Cron Jobs）

- 提供任务增删改查与手动触发接口（`/api/cron/jobs`、`cron_run`）。
- 支持一次性任务、间隔任务、Cron 表达式任务。
- 服务启动时会根据设置自动对齐任务状态并恢复调度。

### 7. Telegram 通道（可选）

- 后端启动时根据设置自动启停 Telegram 集成。
- 支持从 Telegram 收到消息后触发运行并回传结果。
- 支持文本/图片/文档/视频回包，便于远程使用。

### 8. 语音能力

- 支持语音模型目录查询、模型目录清单、下载/取消下载状态查询。
- 支持语音转写接口（`/voice/transcribe`）和分片流式语音接口（`/voice/stream/*`）。

### 9. 桌面端与开发辅助

- 内置终端面板（pty）能力，支持创建/写入/缩放/销毁。
- 可识别终端输出中的本地预览 URL 并回传到界面。
- 集成自动更新状态管理（检查、下载、安装）。

## 环境要求

- macOS
- Node.js + npm
- Python 3

## 本地开发

```bash
npm install
npm run dev
```

如果本机 Python 路径特殊，可在启动前设置：

```bash
ANIMA_PYTHON=/path/to/python3 npm run dev
```

## 构建与打包（macOS）

```bash
npm install
npm run build
npm run dist:mac
```

也可以直接：

```bash
npm install
npm run dist:mac
```

产物默认位于 `dist/`：

- `dist/*.dmg`
- `dist/*.zip`
- `dist/mac-*/Anima.app`（部分构建模式）

## 自动更新

项目已接入 `electron-updater` + `electron-builder`，发布到 GitHub Releases 后可自动拉取更新。

![更新弹窗截图占位](https://github.com/wxt2rr/Anima/blob/main/images/updates.png)

## 发布流程

1. 更新 `package.json` 版本号并提交。
2. 打 tag 并推送：

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. CI 执行 `npm run dist:mac:publish` 并上传到对应 Release。

一键发版脚本：

```bash
npm run release -- 0.1.1
```

或交互式：

```bash
npm run release
```

## 常见问题

- 看到旧图标：macOS 可能缓存 Dock/Finder 图标，必要时执行 `killall Dock`。
- 未签名/未公证：可能触发 Gatekeeper 提示，可右键“打开”或移除隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/Anima.app
```

## 许可证

[MIT](./LICENSE)
