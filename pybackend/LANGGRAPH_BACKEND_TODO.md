# LangGraph 后端开发 Todo List

规则：每次开始开发前先对照本清单；每个 Todo 完成后立刻更新本文件进度（勾选 + 记录完成日期/PR 或 commit 可选）。

更新时间：2026-02-04

---

## 状态说明

- [ ] 未开始
- [~] 进行中
- [x] 已完成

---

## P0：跑通最小闭环（必须）

- [x] 初始化新包结构 `pybackend/anima_backend_lg`
  - 完成日期：2026-02-03
  - 说明：创建 `api/runtime/llm/tools/store/schemas` 子包与 `__init__.py`

- [x] 定义运行态 State 与 Event schema
  - 完成日期：2026-02-03
  - 说明：新增 `runtime/types.py`，定义 RunState/RuntimeEvent/ToolTrace/ChatMessage 等核心类型

- [x] 实现 Provider Adapter（复用现有 providers 能力）
  - 完成日期：2026-02-03
  - 说明：新增 `llm/adapter.py`，复用 `anima_backend/providers.py` 完成 provider 选择与调用封装

- [x] 实现 ToolSpec + ToolExecutor（builtin + MCP 统一）
  - 完成日期：2026-02-03
  - 说明：新增 `tools/executor.py`，复用 legacy builtin/mcp 工具发现与执行并统一输出 trace/tool message

- [x] 实现 LangGraph 图（prepare/model/tools/finalize + 循环）
  - 完成日期：2026-02-03
  - 说明：新增 `runtime/graph.py`，实现最小闭环的 model/tools 循环与 finalize 收口

- [x] 实现 HTTP handler（/api/runs 非流式）
  - 完成日期：2026-02-03
  - 说明：新增 `api/runs.py`，并在 legacy handler 通过 env `ANIMA_BACKEND_IMPL=langgraph` 路由到新实现

- [x] 实现 HTTP handler（/api/runs?stream=1 流式 SSE）
  - 完成日期：2026-02-03
  - 说明：新增 `api/runs_stream.py`，并在 legacy handler 通过 env `ANIMA_BACKEND_IMPL=langgraph` 路由到新实现

- [x] 保证 tool_call_id 永远满足上游 schema
  - 完成日期：2026-02-03
  - 说明：在 model 调用前严格规范化 tool_calls.id；过滤不满足约束的 tool 消息

- [x] 处理历史污染策略（不可修复 tool 消息过滤并产出事件/trace）
  - 完成日期：2026-02-03
  - 说明：新增 sanitize_history_messages 并将丢弃原因以 trace 输出

- [x] 增加最小集成测试（mock provider 跑通工具调用链）
  - 完成日期：2026-02-03
  - 说明：mock provider 跑通 model->tools->model 并断言 tool_call_id 合法

---

## P1：可观测与稳定性

- [x] 统一事件输出适配（内部事件 -> SSE `delta/trace/done`）
  - 完成日期：2026-02-03
  - 说明：LangGraph 流式路径通过统一适配器映射内部事件到 SSE

- [x] 规范化上游请求日志（脱敏 apiKey）
  - 完成日期：2026-02-03
  - 说明：上游异常信息统一追加 provider 元信息并对 apiKey 做替换脱敏

- [x] checkpoint 路径与 chats/messages 数据路径彻底隔离
  - 完成日期：2026-02-03
  - 说明：langgraph.db 迁移到独立 langgraph 子目录作为 checkpoint 存储

- [x] 增加回归对照脚本（同输入旧后端 vs 新后端）
  - 完成日期：2026-02-03
  - 说明：新增 `compare_backends.py`，使用 mock provider 对比 legacy 图与 LangGraph 图输出（含工具调用链与最终 content），可本地一键跑对照

---

## P1.5：对齐 OpenClaw Workspace + Heartbeat（必须）

目标：实现 OpenClaw 风格的 workspace 记忆文件与 heartbeat（1/2/3/4）。

- [ ] 1) Workspace bootstrap（OpenClaw 默认文件）
  - 说明：当 workspaceDir 启用且文件缺失时，自动创建：
    - `AGENTS.md` / `SOUL.md` / `USER.md` / `TOOLS.md` / `IDENTITY.md` / `HEARTBEAT.md`
  - 模板来源：使用 OpenClaw 官方 templates 内容（SOUL/USER/AGENTS/TOOLS/IDENTITY；HEARTBEAT 默认保持“等价为空”以便跳过）

- [ ] 2) System prompt 使用 OpenClaw 默认提示词
  - 说明：新增 openclaw 模式，将 workspace 文件内容按顺序注入 system prompt：
    - `AGENTS.md` → `SOUL.md` → `USER.md` → `IDENTITY.md` → `TOOLS.md` → （可选）`MEMORY.md`
  - 兼容：保持现有插件/skills/date/runtime env 注入逻辑

- [ ] 3) Heartbeat（定时唤醒）
  - 说明：用现有 cron 实现 heartbeat 定时唤醒（默认 30m），每次读取 `HEARTBEAT.md`：
    - 文件缺失：按 OpenClaw 行为仍可运行
    - 文件等价为空（仅空白/仅 markdown 标题）：跳过本次 heartbeat（节省 token）
  - 默认 heartbeat prompt（作为 user 消息，逐字一致）：
    - Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.

- [ ] 4) HEARTBEAT_OK 抑制对外投递
  - 说明：当回复开头/结尾出现 HEARTBEAT_OK，且剥离后剩余内容长度 ≤ ackMaxChars（默认 300），则不做任何对外投递

验收标准：
- 启用 openclaw 模式后，system prompt 的开头包含上述文件注入内容
- 缺失 workspace 文件时自动生成默认文件，且不会覆盖用户已有内容
- Heartbeat job 可运行且在 HEARTBEAT.md 空时不会触发模型调用
- Heartbeat 返回 HEARTBEAT_OK 时不会发送 Telegram 消息

---

## P2：迁移与切流

- [x] 在 `pybackend/server.py` 增加后端实现切换开关（env/flag）
  - 完成日期：2026-02-03
  - 说明：支持通过 ANIMA_BACKEND_IMPL 或 --impl 选择后端实现

---

## P3：业务接口稳迁移与旧后端退场

> 目标：将现有业务接口从 `anima_backend` 稳定迁移到 `anima_backend_lg`，最终删除旧后端实现，仅保留 LangGraph 版（含共享模块）。

- [x] 整理路由清单与迁移分组
  - 完成日期：2026-02-03
  - 说明：按功能域整理现有路由分组，并与下方迁移子任务对齐：
    - Chats & Messages：
      - `GET /api/chats`
      - `GET /api/chats/{id}`
      - `POST /api/chats`
      - `PATCH /api/chats/{id}`
      - `PATCH /api/chats/{chat_id}/messages/{msg_id}`
      - `DELETE /api/chats/{id}`
      - `POST /api/chats/{id}/messages`
      - `POST /api/chats/sync`
    - Settings / Skills / Tools：
      - `GET /settings`
      - `PATCH /settings`
      - `GET /skills/list`
      - `POST /skills/content`
      - `POST /skills/openDir`
      - `GET /tools/list`
    - DB：
      - `GET /api/db/status`
      - `GET /api/db/path`
      - `GET /api/db/export`
      - `POST /api/db/import`
      - `POST /api/db/clear`
    - Runs：
      - `POST /api/runs`（含 `?stream=1`）
      - `GET /api/runs/{id}`
      - `POST /api/runs/{id}/resume`（含 `?stream=1`）
    - Chat HTTP API：
      - `POST /chat/prepare`
      - `POST /chat`（含 `?stream=1`）
    - Voice：
      - `GET /voice/models/base_dir`
      - `GET /voice/models/catalog`
      - `GET /voice/models/installed`
      - `GET /voice/models/download/status`
      - `POST /voice/models/download`
      - `POST /voice/models/download/cancel`
      - `POST /voice/transcribe`
    - Providers：
      - `POST /api/providers/fetch_models`
    - 其他：
      - `GET /health`

- [ ] 抽取共享基础模块（不依赖 handler 的通用能力）
  - 完成日期：
  - 说明：将当前被 LangGraph 往返引用的模块（如 util、tools、settings、database、voice 共用逻辑等）收敛为“共享层”，避免 `anima_backend_lg` 直接依赖旧 handler

- [x] 迁移 Chats & Messages 相关接口到 LangGraph 包
  - 完成日期：2026-02-03
  - 说明：在 `anima_backend_lg/api/chats.py` 中实现：
    - `GET /api/chats`
    - `GET /api/chats/{id}`
    - `POST /api/chats`
    - `PATCH /api/chats/{id}`
    - `PATCH /api/chats/{chat_id}/messages/{msg_id}`
    - `DELETE /api/chats/{id}`
    - `POST /api/chats/{id}/messages`（追加消息）
    - `POST /api/chats/sync`
    并在 legacy handler 中基于 `ANIMA_BACKEND_IMPL=langgraph` 路由到新实现，保持请求/响应 schema 与旧实现兼容

- [x] 迁移 Settings / Skills / Tools 列表类接口
  - 完成日期：2026-02-03
  - 说明：在 `anima_backend_lg/api/settings_tools.py` 中实现并接管：
    - `GET /settings`
    - `PATCH /settings`
    - `GET /skills/list`
    - `POST /skills/content`
    - `POST /skills/openDir`
    - `GET /tools/list`
    并在 legacy handler 中基于 `ANIMA_BACKEND_IMPL=langgraph` 路由到新实现，沿用原有 settings/skills/tools 模块与磁盘结构

- [x] 迁移 DB 管理与导入导出接口
  - 完成日期：2026-02-03
  - 说明：在 `anima_backend_lg/api/db.py` 中实现并接管：
    - `GET /api/db/status`
    - `GET /api/db/path`
    - `GET /api/db/export`
    - `POST /api/db/import`
    - `POST /api/db/clear`
    并在 legacy handler 中基于 `ANIMA_BACKEND_IMPL=langgraph` 路由到新实现，保持请求/响应兼容

- [x] 迁移 Runs 相关辅助接口（除主 /api/runs 之外）
  - 完成日期：2026-02-03
  - 说明：在 LangGraph 包中实现：
    - `GET /api/runs/{id}`
    - `POST /api/runs/{id}/resume`（含流式与非流式）
    并与新的 LangGraph checkpoint / runs 表模型对齐

- [x] 迁移 Chat HTTP API (`/chat` 系列) 到基于 LangGraph 的实现
  - 完成日期：2026-02-03
  - 说明：用 LangGraph 图替换旧的 `/chat`、`/chat?stream=1`、`/chat/prepare` 路径下的 LLM 调用逻辑，保持现有 SSE/JSON 协议不变（`delta/trace/done` 等）

- [x] 迁移 Voice 相关接口
  - 完成日期：2026-02-04
  - 说明：在 LangGraph 或共享层中实现：
    - `GET /voice/models/base_dir`
    - `GET /voice/models/catalog`
    - `GET /voice/models/installed`
    - `GET /voice/models/download/status`
    - `POST /voice/models/download`
    - `POST /voice/models/download/cancel`
    - `POST /voice/transcribe`
    并确认与 electron 前端的调用、HuggingFace 下载与本地缓存行为保持一致

- [x] 迁移 Providers 辅助接口
  - 完成日期：2026-02-03
  - 说明：迁移 `POST /api/providers/fetch_models` 到 LangGraph 包或共享层，保持请求/响应结构与错误信息的兼容性

- [x] 替换 Handler 为 LangGraph 版路由器（旧 handler 仅作薄壳转发）
  - 完成日期：2026-02-04
  - 说明：将 `anima_backend/handler.py` 收口为薄壳：统一转发到 `anima_backend_lg.api.dispatch`，仅保留 `/health` 兜底

- [x] 增加端到端回归测试覆盖业务接口
  - 完成日期：2026-02-04
  - 说明：补齐 `test_langgraph_backend.py` 覆盖 chats/settings/tools/skills/db/runs/providers/voice 等核心路径

- [ ] 删除旧后端实现（在验证完成后）
  - 完成日期：
  - 说明：在确保：
    - 所有对外 HTTP 接口均由 LangGraph 包或共享层提供
    - Electron 前端使用的接口全部通过新实现回归
    - `anima_backend_lg` 不再依赖旧 `anima_backend` 中的大块业务逻辑（目前仍依赖 database/settings/tools/providers/util/chat/voice/http/constants 等模块）
    后，删除 `pybackend/anima_backend` 中不再需要的模块，仅保留必要的共享代码或将其迁移到新的共享包

---

## P4：路线 B（彻底删除 `pybackend/anima_backend` 包）

> 目标：将 `anima_backend` 当前承担的“共享模块 + 启动入口/handler 壳”能力迁出，最终删除整个 `pybackend/anima_backend/` 目录，且 Electron + Python 后端功能与对外接口保持兼容。

### P4.0：准备与基线

- [ ] 记录当前可用验收基线（启动 + 关键接口 + 测试）
  - 完成日期：
  - 说明：明确必须保持兼容的行为清单与现有回归测试入口（建议以 `test_langgraph_backend.py` 为主）

- [ ] 盘点 `anima_backend_lg` 对 `anima_backend.*` 的依赖点
  - 完成日期：
  - 说明：列出依赖模块清单与调用关系，作为迁移改动范围依据

### P4.1：建立“共享层”新包（替代 `anima_backend` 的共享模块）

- [ ] 确定共享包命名与导出策略（import 路径稳定）
  - 完成日期：
  - 说明：建议独立包名（例如 `anima_backend_shared` / `anima_shared`），避免与业务后端实现耦合

- [ ] 迁移 HTTP 基础能力到共享包
  - 完成日期：
  - 说明：迁移 `json_response/read_body_json` 等，确保 handler/dispatch 可复用

- [ ] 迁移 util/constants 到共享包
  - 完成日期：
  - 说明：迁移 `now_ms/preview_json/norm_abs/MAX_TOOL_STEPS` 等通用函数与常量

- [ ] 迁移 settings/skills/tools/providers 到共享包
  - 完成日期：
  - 说明：保持 settings 文件结构、skills 目录定位、tool 列表与 MCP 调用行为不变

- [ ] 迁移 database（含导入导出与 runs 表/初始化）到共享包
  - 完成日期：
  - 说明：保持 DB 路径规则与数据结构兼容；包含 LangGraph checkpoint DB 初始化逻辑迁移后的归属

- [ ] 迁移 chat/voice 相关通用逻辑到共享包
  - 完成日期：
  - 说明：迁移 attachment 处理、tool args 解析、SSE 客户端断开异常、语音模型目录与下载逻辑等

### P4.2：切换 LangGraph 后端与测试到共享包

- [ ] 替换 `anima_backend_lg` 全部 `from anima_backend...` imports
  - 完成日期：
  - 说明：全部指向新的共享包；保证对外 API 行为不变

- [ ] 替换 `test_langgraph_backend.py` 等测试对旧包的 imports
  - 完成日期：
  - 说明：测试只依赖共享包 + `anima_backend_lg`

- [ ] 处理 `compare_backends.py` 的去留
  - 完成日期：
  - 说明：若继续保留对照脚本，需改为不依赖 `anima_backend`（或将脚本标记为废弃并移除）

### P4.3：迁移启动入口与 Handler（不再经过 `anima_backend/server.py`）

- [ ] 在非 `anima_backend` 包内提供新的 Python server 入口
  - 完成日期：
  - 说明：实现 `ThreadingHTTPServer + Handler` 启动，handler 直接使用 `anima_backend_lg.api.dispatch`，并保留 `/health`

- [ ] 更新 `pybackend/server.py` 指向新的入口（Electron 启动链路）
  - 完成日期：
  - 说明：确保 Electron 仍通过 `pybackend/server.py` 启动后端且无需额外参数即可工作

### P4.4：删除旧包与全量验收

- [ ] 删除 `pybackend/anima_backend/` 目录
  - 完成日期：
  - 说明：确认仓库内不存在 `import anima_backend` / `from anima_backend` 的引用残留

- [ ] 本地运行 Python 回归测试并通过
  - 完成日期：
  - 说明：以现有测试入口为准，确保核心接口（chats/settings/tools/skills/db/runs/providers/voice/health）覆盖仍然通过

- [ ] Electron 启动验证（开发态 + 打包态至少其一）
  - 完成日期：
  - 说明：确认后端可启动、前端能正常请求、stream/SSE 路径无回归

### P4.5：路线 B 验收门槛（必须同时满足）

- [ ] 代码库内不存在对 `anima_backend` 包的 import/引用
  - 完成日期：
  - 说明：包含 Python 源码与测试

- [ ] 所有对外 HTTP 接口与响应 schema 保持兼容
  - 完成日期：
  - 说明：以 `test_langgraph_backend.py` 与 Electron 调用链覆盖为准

- [ ] Python 后端启动链路不依赖 `anima_backend` 目录
  - 完成日期：
  - 说明：Electron 仍启动 `pybackend/server.py`，但 server.py 不再 import `anima_backend.*`
