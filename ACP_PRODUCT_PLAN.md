# ACP 产品化接入方案（预计划）

更新时间：2026-03-10  
适用范围：Anima（Electron + Python 后端）在“产品化可交付”标准下接入 Agent Client Protocol（ACP），使 Anima 可作为编排方驱动外部 ACP Coding Agents（Codex CLI / Claude Code / Gemini CLI 等），并在 UI 中以现有事件模型呈现文本流、推理流与工具调用步骤。

---

## 1. 背景与目标

### 1.1 背景

ACP 的价值在于：让编排方与 Coding Agent 之间用结构化协议交互（消息、工具调用、diff、取消等），替代“抓取终端输出并做字符串解析（PTY scraping）”的脆弱方案。

当前 Anima 已具备：

- 统一的流式 UI 协议：`delta / reasoning_delta / trace / stage / done / error`（前端消费点在 `src/renderer/src/AppShadcn.tsx` 的 runs streaming 分支）。
- Python 后端已实现 `/api/runs?stream=1` SSE（LangGraph 版）。
- Electron 主进程具备长连接式输出桥接经验（node-pty 终端能力）。

### 1.2 产品化目标（Definition of Done）

Anima “ACP 产品化支持”满足以下标准：

- 可在无 Node 环境的 macOS 上运行（dmg/zip 安装后即可用），不依赖用户自行安装 `node/npx/acpx`。
- 支持至少 1 个外部 ACP agent 在 UI 内可配置、可切换（如 Codex CLI ACP、Qwen CLI ACP）。
- 会话可恢复：按项目/工作区与线程绑定会话，应用重启后仍能续聊与继续执行。
- 工具调用可控：默认“需要用户批准”，且所有读写/命令执行均被限制在 `workspaceDir` 沙箱内（拒绝越界）。
- 可取消：用户取消会安全终止当前 prompt，且不会破坏会话状态（允许继续后续 prompt）。
- 可观测：提供最小诊断信息（运行状态、最近一次失败原因、agent 版本/能力），且不会泄露密钥。

---

## 1.3 本文档使用方式（开发完一项更新一项）

本文档作为“单一事实源”的执行清单，开发过程中按以下规则维护：

- 每个任务都有唯一编号（例如 `M1-ACP-03`），完成后将对应条目从 `[ ]` 改为 `[x]`，并在条目末尾补充完成日期与 PR/Commit（如有）。
- 任务状态以 Markdown checkbox 为准；不要另起多份清单，避免信息分叉。
- 任何影响范围/里程碑的变更，追加到“更新记录”中，保持可追溯。

---

## 2. 设计原则与关键决策

### 2.1 设计原则

- 复用现有 UI 事件模型：ACP 事件统一映射为现有 `delta/reasoning_delta/trace/done`，避免大改 UI。
- 最小可控依赖：产品化版本不依赖 acpx CLI 运行时；可以将 acpx 作为“开发期/灰度期”实现路径，但最终必须可内置。
- 默认最小权限：所有外部 agent 的文件与命令能力均必须经过 Anima 的权限门禁与工作区沙箱。
- 可降级：ACP agent 不可用时，不影响现有 LLM provider 后端路径。

### 2.2 关键决策（最终态）

最终态采用：

- **Anima 作为 ACP 编排方（ACP Client）**，不做 ACP Server（除非后续明确需要“外部工具驱动 Anima”）。
- **ACP Runtime 运行在 Electron 主进程**（Node 环境最稳定、便于打包内置二进制/依赖、便于做系统权限提示），Renderer 通过 IPC 订阅事件。
- **协议层实现“标准 ACP（JSON-RPC 2.0 over stdio）”客户端**，避免受 acpx alpha CLI 接口变更影响。
- **可选兼容层（短期）**：允许使用“固定版本的 acpx 作为桥接器”，但必须可被替换且不成为唯一实现。

---

## 3. 最终架构（产品化）

### 3.1 组件划分

- Renderer（UI）
  - 负责：用户输入、显示流式文本/推理/trace、授权弹窗、取消按钮。
  - 不直接执行外部 agent、也不直接读写工作区文件。
- Electron Main（ACP Runtime）
  - 负责：启动/管理 ACP agent 子进程、维护会话、协议编解码、权限门禁、工作区沙箱、事件聚合与转发。
- Python Backend（现有 LLM 运行时）
  - 保持：现有 `/api/runs`（provider 模式）不变。
  - 可选：将 ACP 运行时能力暴露给后端（仅当需要“统一 runs API 入口”时再做）。

### 3.2 IPC 与事件模型

新增 IPC 通道（示例命名，最终以现有风格为准）：

- `acp:session:create`：创建/加载会话（输入 workspaceDir、threadId、agentId）
- `acp:session:prompt`：提交 prompt（输入 messages、composer、runId/threadId）
- `acp:session:cancel`：取消当前执行
- `acp:session:close`：软关闭（保留历史，可后续恢复）
- `acp:event:<sessionId>`：流式事件推送（Renderer 订阅）

Main 将 ACP 事件映射为 UI 事件（兼容现有 runs streaming 消费逻辑）：

- `agent_message_chunk` → `delta`
- `agent_thought_chunk` → `reasoning_delta`
- `tool_call` / `tool_call_update` / `diff` → `trace`（必要时附带 artifacts）
- `done` / `error` → `done` / `error`

### 3.3 会话与线程绑定

推荐策略：

- 会话 Key：`{workspaceDir}:{threadId}:{agentId}`（同一工作区同一线程同一 agent 续用同一会话）
- 会话存储：
  - 轻量元数据放 Electron Store（例如 `sessionId`、最近使用时间、agent 版本、capabilities）
  - 历史与 checkpoint 由 agent 自身或本地缓存负责（取决于 agent 能力）；若 agent 不支持持久化，则由 Main 做最小化转存（仅必要字段）。

### 3.4 权限与沙箱（必须）

- 强制要求 `workspaceDir`，没有工作区则拒绝启动 ACP 任务。
- 文件能力（fs read/write/list）必须做：
  - 路径归一化与越界检查（禁止 `..` 逃逸）
  - 白名单操作：只允许读写工作区内文件
  - 写入必须经过用户批准（可“记住本项目选择”）
- 命令执行能力（terminal/run）必须做：
  - cwd 固定为 `workspaceDir`
  - 环境变量过滤（禁止注入敏感环境变量到子进程，除非明确允许）
  - 限制长时间运行与后台服务（产品内需明确 UX：允许/禁止）
- 网络能力：默认不额外提供（由 agent 自身决定）；若提供 WebFetch 等能力，应复用后端已有策略并提示用户。

### 3.5 依赖与打包策略

最终态不依赖外部 `npx`：

- 优先：直接 spawn agent 官方二进制（例如 codex/claude 等）并以 ACP 标准协议通信（stdio）。
- 若某 agent 仅支持非 ACP 原生协议：
  - 引入“适配器进程”（类似 cursor-acp 这类桥接器）并与其用 ACP 标准协议通信。
- 若阶段性采用 acpx：
  - 必须固定版本，并将可执行文件随应用发布（resources 目录），由 Main 通过绝对路径调用。

---

## 4. 配置与产品交互

### 4.1 设置项（建议）

在 Settings 中新增“ACP Agents”配置区：

- `enabled`：总开关
- `agents[]`：
  - `id`、`name`
  - `kind`：`native_acp | adapter | acpx_bridge`
  - `command`、`args`（可选）
  - `env`（受控白名单）
  - `capabilities`（运行时探测缓存）
- `defaultAgentId`
- `approvalMode`：
  - `per_action`（默认，读/写/命令每次确认）
  - `per_project`（对当前项目记住）
  - `always`（内部/高级用户）

### 4.2 UI 体验（最小闭环）

- Chat Composer 增加一个“运行时”选择：`Provider（现有） / ACP Agent（新）`
- 当选择 ACP Agent：
  - 显示 agent 名称、会话状态（running/idle/dead）、最近一次错误入口
  - 工具调用触发时弹出批准弹窗（含操作摘要、目标路径/命令、风险提示）
- 取消按钮：
  - 发送 `acp:session:cancel` 并将 UI 状态恢复可输入

---

## 5. 执行计划（可逐项勾选）

### 5.1 总体里程碑

- M0：技术验证（目标：跑通“流式输出 + 取消 + 基础会话”）  
- M1：MVP（目标：可内部日用，具备最小安全边界与可恢复会话）  
- M2：产品化 Beta（目标：打包开箱可用、可诊断、可降级）  
- M3：GA（目标：稳定发布、自动化回归、兼容矩阵）  

### 5.2 任务清单（按实现依赖排序）

#### M0：技术验证（PoC）

- [x] M0-ACP-01 选定目标 Agent（至少 1 个）与运行方式（原生 ACP / adapter / 固定版 acpx）（2026-03-10：支持配置 native_acp/adapter/acpx_bridge，并提供外部 ACP agent 模板）  
  - 验收：能在本机启动 agent 并获得 ACP 事件流（不限 UI 集成）。
- [x] M0-ACP-02 Main 进程新增 ACP Runtime 模块骨架（进程管理 + stdio 读写 + 生命周期）（2026-03-10）  
  - 验收：可启动/停止子进程，捕获退出码与 stderr，并向 Renderer 发出 `error` 事件。
- [x] M0-ACP-03 实现标准 ACP 协议最小闭环：`initialize`、`session/new`、`session/prompt`、`session/cancel`（2026-03-10：实现 JSON-RPC stdio 框架，并支持外部 ACP agent prompt/cancel）  
  - 验收：可以对 agent 发 prompt 得到流式响应；cancel 在 3 秒内生效。
- [x] M0-ACP-04 事件映射 MVP（ACP → UI 事件模型）（2026-03-10）  
  - 映射：文本 → `delta`，思考 → `reasoning_delta`，结束 → `done`，错误 → `error`  
  - 验收：UI 中能看到流式文本与推理输出（不要求工具调用）。
- [x] M0-ACP-05 会话键策略落地（`{workspaceDir}:{threadId}:{agentId}`）与内存级缓存（2026-03-10）  
  - 验收：同一 thread 连续两次 prompt 复用同一 ACP session（不丢上下文）。

#### M1：MVP（安全边界 + 可恢复会话 + 工具 trace）

- [x] M1-ACP-01 Settings 增加 ACP Agents 配置（enabled、agents、defaultAgentId、approvalMode）（2026-03-10）  
  - 验收：可在 UI 设置中添加/选择默认 ACP agent。
- [x] M1-ACP-02 Renderer 增加“运行时选择”（Provider / ACP Agent），并能驱动 ACP Runtime 跑一次 prompt（2026-03-10）  
  - 验收：不影响现有 Provider 路径；切换 ACP 模式可正常对话。
- [x] M1-ACP-03 会话持久化：session 元数据写入 Electron Store（恢复 attach/重建策略明确）（2026-03-10：remoteSessionId 按 `{workspaceDir}:{threadId}:{agentId}` 持久化，优先 session/load，失败回退 session/new）  
  - 验收：重启应用后，同一 thread 可继续对话（至少恢复到“可继续发 prompt”）。
- [x] M1-ACP-04 workspaceDir 沙箱：所有文件/命令动作必须限定在 workspace 内（越界拒绝）（2026-03-10：fs/* 与 terminal/run handlers 已实现越界拒绝）  
  - 验收：构造越界读写用例必定失败且不产生副作用。
- [x] M1-ACP-05 权限门禁 MVP：默认逐次审批（读/写/命令），支持“对本项目记住”（2026-03-10：写文件/命令执行使用主进程弹窗逐次审批；per_project 缓存已实现）  
  - 验收：未授权时 tool 调用被拦截并提示；授权后动作可执行并产出 trace。
- [x] M1-ACP-06 工具调用事件映射：ACP tool_call / diff 映射为 UI `trace`（含 running/succeeded/failed、耗时、参数/结果预览）（2026-03-10：tool/diff 通知归一化为 ToolTrace 并推送到 UI）  
  - 验收：UI“Steps & Tools”面板可稳定展示一次完整工具链（读→改→写→命令）。
- [x] M1-ACP-07 cancel 语义固化：取消只终止当前 prompt，不破坏会话（可继续下一轮）（2026-03-10：session/cancel 通知；不销毁 session）  
  - 验收：取消后立即发新 prompt 能正常执行。
- [x] M1-ACP-08 最小自动化回归（本地/CI 均可跑）：协议编解码、沙箱越界、取消（2026-03-10：新增 `npm run test:acp` 覆盖核心纯函数：toLines/isWithin/resolvePathInWorkspace/mapAcpUpdateToUiEvent）  
  - 验收：测试可重复通过，失败时信息可定位（不含敏感数据）。

#### M2：产品化 Beta（打包开箱可用 + 诊断 + 降级）

- [x] M2-ACP-01 打包策略定稿：arm64/x64 产物均可用，且无 Node 环境也能运行（2026-03-10：本机构建 `dist/mac-arm64` 与 `dist/mac`，并用 `npm run verify:dist:mac` 校验资源包含 pybackend/skills；Provider 路径开箱可用，ACP 通过外部 agent 配置接入）  
  - 验收：在干净 macOS 环境安装后可使用 Provider 功能，并可配置外部 ACP agent。
- [x] M2-ACP-02 外部 Agent 接入策略定稿（按选择的 agent 方案落地）（2026-03-10：默认提供 Qwen/Codex 外部 ACP 模板，不内置 `embedded` ACP agent）  
  - 原生 ACP：确保 agent 可被发现/安装指引明确  
  - adapter：内置 adapter 可执行文件并随架构分发  
  - 固定版 acpx：将 acpx 固定版本内置到 resources 并通过绝对路径调用  
  - 验收：ACP 运行时仅连接外部 agent，不再复用 Provider 伪装为 ACP。
- [x] M2-ACP-03 诊断与可观测：运行状态面板（session 状态、pid、uptime、最近错误、agent 版本/能力）（2026-03-10：Settings 展示 ACP sessions 状态；initialize 结果透传 agentInfo）  
  - 验收：用户可在 UI 内一键查看“为什么跑不起来”的最小信息，不泄露 token。
- [x] M2-ACP-04 降级策略：ACP agent 不可用/能力不足时，提示并自动回退到 Provider 路径（或禁用对应功能）（2026-03-10：ACP create/prompt 失败时自动走 Provider 路径）  
  - 验收：ACP 不可用不会阻塞聊天主流程。
- [x] M2-ACP-05 崩溃恢复：Main 进程检测到 agent 进程异常退出时，可重连/重建会话并提示用户（2026-03-10：进程退出会记录 lastError；下一次 prompt 自动 ensureSpawned 并尝试 session/load，失败回退 session/new）  
  - 验收：agent crash 后 UI 不死锁，允许继续使用（必要时重建会话）。
- [x] M2-ACP-06 安全审计：权限弹窗文案与默认策略复核（最小权限、可撤销、可重置）（2026-03-10：读/写/列目录/命令执行均默认审批；per_project 授权持久化；提供重置授权入口）  
  - 验收：默认策略满足产品安全底线。

#### M3：GA（正式发布 + 兼容矩阵 + 持续迭代）

- [ ] M3-ACP-01 ACP 兼容矩阵（至少覆盖：流式、tool、cancel、恢复）并纳入回归  
  - 验收：每次发布前能自动验证核心能力不回退。
- [ ] M3-ACP-02 完整验收用例脚本化（可由 QA/用户复现）  
  - 验收：脚本/步骤可在干净环境复现成功路径与失败路径。
- [ ] M3-ACP-03 权限体验优化：按项目记住、可导出诊断包、可审计历史操作（最小必要）  
  - 验收：用户能查到“做过什么动作”，且不暴露敏感信息。
- [ ] M3-ACP-04 维护策略：agent 版本更新策略、灰度开关、紧急关闭开关  
  - 验收：出现生态变更时可快速止血（禁用/降级），不影响主功能。

---

## 6. 更新记录（每次完成/调整请追加）

- 2026-03-10 初始化版本：确定最终态采用 Main 进程 ACP Runtime + 标准 ACP 协议；形成可勾选执行清单。
- 2026-03-10 完成 M0-ACP-01~05、M1-ACP-01/02/03/04/05：接入 Main ACP Runtime、Renderer 运行时选择与设置项、会话 remoteSessionId 持久化、基础沙箱与审批。
- 2026-03-10 增量：Settings 增加 ACP 会话状态拉取（status/agentInfo）；ACP 不可用类错误自动回退 Provider（权限拒绝/取消不会回退）。
- 2026-03-10 调整：移除内置 `Anima (Embedded)` ACP agent，收敛为“Provider / External ACP” 两条独立运行时；ACP 仅连接外部 agent。
- 2026-03-10 增量：新增 `npm run test:acp` 最小回归；并将 per_project 授权持久化（可在 Settings 重置）。
- 2026-03-10 增量：补齐打包校验脚本 `npm run verify:dist:mac`，并完成本机 arm64/x64 app dir 产物验证。

---

## 7. 验收用例（建议纳入自动化）

- 基本对话：连续 3 轮对话，输出正确且无 UI 卡死。
- 流式输出：`delta` 与 `reasoning_delta` 均可持续增量到 UI，最终 `done` 正常收口。
- 工具链路：读取 workspace 内文件 → 修改 → 写回 → 执行短命令（如 `npm test`）→ 返回结果以 `trace` 呈现。
- 沙箱：尝试读取/写入 `workspaceDir` 外路径，必须失败且不产生副作用（同时在 UI 给出可理解错误）。
- 取消：运行中点击取消，3 秒内停止输出并恢复输入；下一轮 prompt 可继续且会话不丢。
- 恢复：重启应用后，能恢复到同一 thread 的会话并继续执行（必要时重建并提示）。

---

## 8. 风险与对策

- ACP 生态差异：不同 agent 对 ACP 标准支持不一  
  - 对策：优先选原生支持 ACP 的 agent；非原生通过 adapter；建立兼容矩阵与灰度开关。
- 工具权限风险：agent 可能尝试越界或执行危险命令  
  - 对策：强制 workspace 沙箱 + 默认逐次审批 + 受控 env + 命令执行策略（可禁用）。
- 打包复杂度：内置二进制跨架构（arm64/x64）  
  - 对策：构建时按架构产物分发；resources 内按 `process.arch` 选择。
- 取消与队列语义：多 prompt 排队与取消的边界  
  - 对策：产品化版本先实现“单会话单运行中任务”；队列作为后续增强。

---

## 9. 产出清单（最终交付物）

- Electron Main：ACP Runtime 模块（协议 + 会话 + 权限 + 沙箱 + 事件桥接）。
- Renderer：ACP agent 选择与权限弹窗、运行状态 UI（复用现有 trace 展示）。
- Settings：ACP Agents 配置页与默认策略。
- 打包：内置所需二进制/适配器，完成 arm64/x64 产物验证。
- 自动化：最小回归用例与兼容矩阵（至少覆盖 1 个目标 agent，后续逐步扩展）。
