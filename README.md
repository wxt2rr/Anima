# Anima
<img src="https://github.com/wxt2rr/Anima/blob/main/images/logo_padded.png" width="100">

Anima 是一个面向 macOS 的 AI 桌面助手，采用 Electron + 本地 Python 后端架构。它把聊天、工具调用、模型管理、技能系统、自动化任务和桌面能力整合在一个本地应用里，重点是可控、可验证、可扩展。

## 功能概览

- 对话执行引擎，支持普通执行、SSE 流式输出、继续执行与运行记录查询
- 多模型服务商管理，支持云端模型、本地模型和 ACP Provider
- 内置工具系统，覆盖文件、终端、检索、网页抓取、截图、图像/视频生成等场景
- Skills 机制，支持扫描、校验、按需加载 `SKILL.md`
- 自动化任务（Cron/定时任务）
- Telegram 通道集成（可选）
- 语音能力，包括模型管理、转写与流式语音接口
- 内置 Python 后端，随桌面应用一起打包
- GitHub Releases 自动更新

![主界面示意](https://github.com/wxt2rr/Anima/blob/main/images/files.png)
![Git 相关界面示意](https://github.com/wxt2rr/Anima/blob/main/images/git.png)
![终端界面示意](https://github.com/wxt2rr/Anima/blob/main/images/terminal.png)
![网页工具界面示意](https://github.com/wxt2rr/Anima/blob/main/images/web.png)
![设置页示意](https://github.com/wxt2rr/Anima/blob/main/images/setting.png)

## 当前内置模型服务商

当前默认配置已内置以下模型服务商：

- `Qwen`：普通 OpenAI Compatible Provider，默认使用 DashScope 兼容接口，需填写 API Key
- `Codex Auth`：基于 ChatGPT/Codex OAuth 的专用 Provider
- `OpenAI`
- `Anthropic`
- `Google`
- `DeepSeek`
- `Moonshot`
- `Ollama (Local)`
- `LM Studio (Local)`
- `Qwen Code (ACP)`
- `Codex (codex-acp)`

说明：

- `Qwen Auth` 相关 OAuth 代码仍保留在仓库中用于兼容旧数据，但已从设置页默认入口隐藏，不再作为当前推荐接入方式。
- 本地 Provider 里，`Ollama` 和 `LM Studio` 走 OpenAI Compatible 接口；ACP Provider 则走本地命令进程。

## 功能详解

### 1. 对话与运行引擎

- 后端提供 `/api/runs` 与 `/api/runs?stream=1` 两条执行路径，分别对应普通执行与流式执行。
- 支持继续执行（`/api/runs/{id}/resume`）与运行记录查询（`/api/runs/{id}`）。
- 聊天线程与运行数据通过 `/api/chats/*` 分层管理。
- 前端支持工具轨迹展示、运行状态展示、diff 结果查看等调试信息。

### 2. 模型与服务商管理

- 通过 `/api/providers/fetch_models` 拉取和管理模型列表。
- 支持按会话覆盖 provider / model 等运行参数。
- 支持 OpenAI Compatible、专有 Provider、ACP、本地模型服务等多种接入形式。
- 设置页内置 `Codex Auth` 登录流程，也提供普通 `Qwen`、`OpenAI`、`Anthropic` 等 API Key 入口。

### 3. 工具系统（Builtin + MCP）

- 内置工具包括：
  - 工作区文件能力：`glob_files`、`list_dir`、`read_file`、`edit_file`、`write_file`、`rg_search`
  - 终端执行：`bash`
  - 网络检索与抓取：`WebSearch`、`WebFetch`
  - 多媒体：`screenshot`、`generate_image`、`generate_video`
  - 技能加载：`load_skill`
  - 自动化控制：`cron_list`、`cron_upsert`、`cron_delete`、`cron_run`
- 支持 MCP 工具发现与统一调度，通过 `/tools/list` 聚合 builtin + MCP tools。
- 对工具执行结果支持轨迹记录、diff 展示和错误可视化。

### 4. 权限与安全机制

- `bash` 支持两种权限模式：
  - `workspace_whitelist`：仅允许工作区与白名单路径
  - `full_access`：完全访问
- 支持命令黑白名单。
- 默认权限下，命中风险命令可触发人工确认。
- 网页抓取默认拦截本地地址和私网地址，降低 SSRF 风险。
- 编辑工具冲突场景下，运行时会阻止同文件直接重复提交旧 patch，避免连续错误重试。

### 5. Skills 体系

- 支持本地技能目录扫描、frontmatter 校验和内容按需加载。
- 设置页可查看技能列表、读取技能内容、打开技能目录。
- 支持内置技能与用户技能共存，适合沉淀可复用工作流。

### 6. 自动化（Cron Jobs）

- 提供任务增删改查与手动触发接口（`/api/cron/jobs`、`cron_run`）。
- 支持一次性任务、间隔任务和 Cron 表达式任务。
- 服务启动时会根据设置自动恢复调度状态。

### 7. Telegram 通道（可选）

- 后端启动时根据设置自动启停 Telegram 集成。
- 支持从 Telegram 收到消息后触发运行并回传结果。
- 支持文本、图片、文档、视频回包，适合远程使用。

### 8. 语音能力

- 支持语音模型目录、模型清单、安装状态、下载状态查询。
- 支持语音转写接口（`/voice/transcribe`）和分片流式语音接口（`/voice/stream/*`）。
- 支持 Qwen TTS、本地模型托管与自定义 HTTP TTS 预览。

### 9. 桌面端与开发辅助

- 内置 PTY 终端服务，支持创建、写入、缩放、销毁。
- 可识别终端输出中的本地预览 URL 并回传到界面。
- 集成自动更新状态流（检查、下载、安装）。
- 支持打包内置 Python 后端与技能目录。

## 环境要求

- macOS
- Node.js + npm
- Python 3

## 本地开发

```bash
npm install
npm run dev
```

如果本机 Python 路径不是默认值，可在启动前设置：

```bash
ANIMA_PYTHON=/path/to/python3 npm run dev
```

## 构建与打包（macOS）

```bash
npm install
npm run build
npm run dist:mac
```

也可以直接执行：

```bash
npm install
npm run dist:mac
```

产物默认位于 `dist/`：

- `dist/*.dmg`
- `dist/*.zip`
- `dist/mac-*/Anima.app`

## 常用脚本

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test:acp
npm run dist:mac
npm run dist:mac:publish
npm run verify:dist:mac
```

## 自动更新

项目已接入 `electron-updater` + `electron-builder`，发布到 GitHub Releases 后可自动拉取更新。

![更新界面示意](https://github.com/wxt2rr/Anima/blob/main/images/updates.png)

## 发布流程

1. 更新 `package.json` 版本号并提交
2. 打 tag 并推送：

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. CI 执行 `npm run dist:mac:publish` 并上传产物到对应 Release

一键发版脚本：

```bash
npm run release -- 0.1.1
```

也支持交互式：

```bash
npm run release
```

## 项目结构

```text
.
├── src/              # Electron main / preload / renderer
├── pybackend/        # 本地 Python 后端
├── skills/           # 内置技能
├── build/            # 打包资源
├── images/           # 文档与界面截图
└── scripts/          # 构建、发版与校验脚本
```

## 常见问题

- 看到旧图标：macOS 可能缓存 Dock/Finder 图标，必要时执行 `killall Dock`
- 未签名/未公证：可能触发 Gatekeeper 提示，可右键“打开”或移除隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/Anima.app
```

## 许可证

[MIT](./LICENSE)
