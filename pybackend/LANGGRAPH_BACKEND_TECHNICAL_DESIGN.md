# LangGraph 版后端（无历史包袱）技术设计

目标：在保留现有 `pybackend/anima_backend` 的前提下，新建一套“纯 LangGraph 最佳实践”的后端实现，用于后续逐步替换/对照测试。本文档将作为后续开发的单一参考来源。

更新时间：2026-02-03

---

## 1. 背景与动机

当前 `anima_backend` 具备可用的 HTTP API、Provider 适配（OpenAI/Anthropic/OpenAI-compatible 等）、工具执行（builtin + MCP）、以及 Electron 侧的 SSE 消费协议（`delta/trace/done`）。

痛点来自“历史演进 + 双路径分叉 + 兼容性陷阱”：

- 流式与非流式路径在一段时间内存在不同实现，容易出现行为差异（例如 `tool_call_id` 字段要求）。
- 上游对消息 schema 的约束（`role: tool` 必须携带 `tool_call_id`）一旦被历史消息污染，会在运行期产生 400 类硬错误。
- 现有架构混合了“业务数据（chats/messages）”和“运行态（tool traces、推理摘要、流式事件）”的表达，后续要做可恢复/可回放/中断确认时需要较大重构。

新的 LangGraph 版本目标是：从一开始以 LangGraph 的“状态机 + 事件流 + checkpoint”作为一等公民，清晰区分边界，避免历史包袱。

---

## 2. 目标与非目标

### 2.1 目标

1. **统一的 Agent Runtime**
   - 流式/非流式使用同一张 LangGraph 图，差异仅在 runner（invoke vs stream events）以及输出适配层。
2. **严格的消息规范**
   - 对外调用上游时，保证消息满足 OpenAI 兼容 schema：工具调用链包含稳定的 `tool_call_id`、`tool_calls[].id`。
3. **事件驱动**
   - LangGraph 内部产生结构化事件（token delta、tool trace、usage、stage），SSE 只是事件投影。
4. **Checkpoint 可恢复**
   - 运行态 checkpoint 与聊天库数据解耦；以 `thread_id` 作为 checkpoint key。
5. **可验证**
   - 有可跑的最小端到端路径（`/api/runs` + `/api/runs?stream=1`），并可与旧后端做对照。

### 2.2 非目标（第一阶段不做）

- 不在第一阶段引入 LangSmith 或外部 trace 平台。
- 不在第一阶段改动 Electron 前端的 SSE 消费协议（仍兼容现有 `delta/trace/done`）。
- 不在第一阶段引入新的第三方 LLM SDK（优先复用当前 `providers.py` 的网络实现）。
- 不在第一阶段做“复杂的多 agent 协作/长期记忆规划器”等增强能力。

---

## 3. 约束与现状对接点

### 3.1 启动方式约束

Electron 主进程通过 `pybackend/server.py` 启动 Python 后端（`spawn(python, [scriptPath, ...])`），见：

- [index.ts](file:///Users/wangxt/myspace/Anima/src/main/index.ts#L55-L68)

因此 LangGraph 新后端需提供：

- 方案 A：仍由 `pybackend/server.py` 启动，但通过环境变量/参数选择不同 handler（推荐，改动最小）
- 方案 B：新增 server 入口并改 Electron 启动参数（改动更大，不建议作为第一步）

本文档以方案 A 为主。

### 3.2 依赖约束

当前 Python 依赖包含 `langgraph` 与 `langgraph-checkpoint-sqlite`：

- [requirements.txt](file:///Users/wangxt/myspace/Anima/pybackend/requirements.txt#L1-L7)

因此 LangGraph 版后端将：

- 复用当前 `providers.py` 的 HTTP 实现作为 LLM provider adapter
- 复用当前工具实现（builtin tools + MCP）作为 tool executor（但以“协议 + 执行器”方式组织）

---

## 4. 新后端总体架构

### 4.1 包与模块划分（建议）

在 `pybackend/` 下新增一个独立包（命名建议）：

- `pybackend/anima_backend_lg/`（LangGraph clean-room 实现）

保持现有：

- `pybackend/anima_backend/`（旧实现，继续可运行）

LangGraph 包建议分层：

1. `api/`：HTTP handler 与 SSE 输出适配（薄层，不含业务逻辑）
2. `runtime/`：LangGraph 图、状态定义、事件定义、runner
3. `llm/`：对接 `providers.py` 的 LLM adapter（统一接口）
4. `tools/`：工具 spec、执行器、MCP 路由
5. `store/`：聊天库（chats/messages）与 checkpoint 存储的边界封装
6. `schemas/`：请求/响应 schema（Pydantic 可选；也可 TypedDict + 手写校验）

关键原则：HTTP 层只做输入/输出适配；LangGraph runtime 不直接写 HTTP。

### 4.2 数据存储边界

必须严格区分两类持久化：

- **产品数据（Product DB）**
  - chats/messages/runs 等业务数据（复用现有 `database.py` 或新建 store 层封装）
- **运行态 checkpoint（Runtime DB）**
  - LangGraph SqliteSaver 的 checkpoint 数据（独立 sqlite 文件，复用 `langgraph_db_path()` 或新路径）

两者可共用同一个 sqlite 文件，但强烈建议分离路径，避免 schema 互相污染与升级难题。

---

## 5. API 设计（兼容现有前端）

### 5.1 `/api/runs`（非流式）

输入（保持兼容）：

- `runId`、`threadId`
- `messages`：数组（system/user/assistant/tool）
- `useThreadMessages`：是否拼接 DB 历史
- `composer`：包含 workspaceDir、attachments、toolMode、enabledToolIds、enabledMcpServerIds、skillMode、enabledSkillIds、providerOverrideId、modelOverride、contextWindowOverride、jsonConfig 等
- `temperature`、`maxTokens`

输出（保持兼容）：

- `ok: true`
- `content: string`
- `usage?: object`
- `rateLimit?: object`
- `traces?: ToolTrace[]`
- `reasoning?: string`

### 5.2 `/api/runs?stream=1`（流式 SSE）

保持 SSE event 兼容：

- `data: {"type":"run","status":"running",...}`
- `data: {"type":"delta","content":"..."}`
- `data: {"type":"reasoning_delta","content":"..."}`
- `data: {"type":"trace","trace":{...}}`
- `data: {"type":"done","usage":{...},"reasoning":"...","rateLimit":{...}}`

注意：SSE 是 UI 协议；LangGraph 内部事件会被映射到以上结构。

---

## 6. 运行态模型：状态、事件、消息规范

### 6.1 规范化后的 OpenAI 兼容消息（上游输入）

上游最小要求：

- `assistant.tool_calls[].id` 必须存在且非空
- `tool.tool_call_id` 必须存在且能对应到某个 tool call id

因此必须在“进入 LLM 调用前”对消息做一次规范化：

- 如果历史中存在 `role: tool` 但缺少 `tool_call_id`：
  - 若 meta 中存在 `toolTraces[0].toolCallId`，可回填
  - 否则该 tool 消息不得被发送给上游（策略见 6.4）

### 6.2 LangGraph 状态（建议）

建议用 `TypedDict`/`dataclass` 定义：

- `messages: list[dict]`：严格 OpenAI schema（准备给 LLM）
- `usage: dict | None`
- `rate_limit: dict | None`
- `traces: list[dict]`：工具调用 trace（UI/调试用）
- `reasoning: str`：累积推理（如果 provider 支持）
- `step: int`：工具循环步数
- `run_id: str`、`thread_id: str`
- `composer: dict`、`settings: dict`（必要字段）

### 6.3 事件模型（LangGraph 内部）

内部事件是“单一事实源”，建议最小集合：

- `ModelDelta(text_chunk)`
- `ReasoningDelta(text_chunk)`（可选）
- `ToolStarted(trace)`
- `ToolFinished(trace)`
- `UsageUpdated(usage)`
- `StageChanged(stage, step)`
- `RunDone(final_content, usage, rate_limit, reasoning, traces)`

这些事件通过 output adapter 映射为 SSE 或非流式结果。

### 6.4 对历史污染的处理策略（必须明确）

策略需要“确定性”，避免 silent bug：

- 默认策略（推荐）：**过滤不可修复的历史 tool 消息**
  - 只要 `role: tool` 且 `tool_call_id` 无法恢复，就在发送给上游前丢弃该条 tool 消息
  - 同时产出一个 trace/event，标记“history_tool_message_dropped”，便于排障
- 可选策略：为不可修复消息生成虚拟 `tool_call_id`
  - 不推荐：因为上游要求 tool_call_id 必须对应某个 `assistant.tool_calls[].id`，虚拟生成仍可能语义不一致

---

## 7. LangGraph 图设计（最佳实践版本）

### 7.1 节点拆分

建议图节点（第一阶段）：

1. `prepare`
   - 读取 settings/provider spec
   - 处理 attachments inline
   - 拼 system prompt（含 skills metadata / memory / plugins / date）
   - 合并 thread 历史（如果 useThreadMessages）
   - 规范化历史 tool 消息（见 6.1/6.4）
2. `model`
   - 调用 LLM（流式/非流式统一入口）
   - 产出：assistant message（含 tool_calls 或纯文本）
   - 产出事件：delta/reasoning/usage
3. `tools`
   - 执行 tool_calls（builtin/mcp）
   - 产出：tool messages（严格带 tool_call_id）
   - 产出事件：trace started/finished
4. `finalize`
   - 生成最终 content（通常是最后一个 assistant content）
   - 汇总 traces/usage/rateLimit/reasoning
   - 选择性写业务库（runs 表、messages 表）或由 HTTP 层处理

循环结构：

- `prepare -> model`
- `model -> (tools if tool_calls else finalize)`
- `tools -> model`

### 7.2 runner 选择

- 非流式：`graph.invoke(initial_state, config={"configurable":{"thread_id": ...}})`
- 流式：优先使用 LangGraph 的事件流 runner（例如 `astream_events`），将事件直接映射 SSE

如果由于当前依赖/实现原因暂时做不到 `astream_events`：

- 允许第一阶段在 `model` 节点内部使用 provider 的 streaming 并向外 emit
- 但必须保证：对外 emit 仍然来自“统一事件接口”，避免到处写 `emit({"type":"delta"})`

---

## 8. LLM Provider Adapter 设计

### 8.1 统一接口

保持简单（避免引入额外 SDK）：

- `chat(messages, temperature, max_tokens, tools, tool_choice, model_override, extra_body) -> ModelResult`
- `chat_stream(...) -> Iterator[StreamEvent]`（与现有 providers 兼容）

### 8.2 兼容不同 provider 的差异

已知差异点（来自现有 `providers.py`）：

- OpenAI-compatible 可能支持 `chat/completions` 或 `responses`（由 spec.api_format 决定）
- Anthropic 是 messages API，需要 system prompt 与 messages 结构转换

新架构里建议：

- 在 adapter 内部完成“转换成 OpenAI 兼容结果”的工作
- LangGraph runtime 只处理一种标准结果：`content/tool_calls/usage/rate_limit/reasoning_content`

---

## 9. 工具体系（Tool Spec + Executor）

### 9.1 ToolSpec（给模型看的）

字段：

- `name`
- `description`
- `parameters`（JSON schema）
- `strictness`（可选）

来源：

- builtin tools（复用现有 `tools.py` 的 schema）
- MCP tools（复用现有 `mcp_tools` 的发现逻辑）
- skills 工具（例如 `load_skill`，已经在 builtin tools 中）

### 9.2 ToolExecutor（执行器）

输入：

- `tool_name`
- `args`（dict）
- `workspace_dir`
- `mcp_index`（如果需要）

输出（标准化）：

- `tool_content: str`（将回填到 tool message 的 content）
- `trace: ToolTrace`（包含 toolCallId、duration、status、argsPreview、resultPreview、diffs 等）

强约束：

- 工具执行产出的 tool message 必须包含 `tool_call_id`，且等于对应 tool call id

---

## 10. Observability 与 Debug

第一阶段建议保留两类观测输出：

1. 给 UI 的 traces（现有 ToolTrace 格式）
2. 给开发调试的内部事件（可选单独 endpoint 输出，第一阶段可不做）

最重要的排障信息：

- 被过滤的历史 tool 消息计数及原因
- 每次上游请求的 provider_id/type/base_url（注意脱敏 apiKey）

---

## 11. 安全与合规

必须保持现有安全边界：

- workspace_dir 路径必须做 `is_within` 校验（现有工具已做）
- 对外日志不可打印明文 API Key
- WebFetch/WebSearch 等外部请求必须限制长度、超时、禁止危险 schema

新后端需要保证：

- 任何从前端传入的 `composer.workspaceDir` 都需要规范化并校验
- 任何从前端传入的 `extra_body/jsonConfig` 都不得直接拼接进日志

---

## 12. 测试与验收标准（第一阶段）

### 12.1 验收目标（必须可验证）

1. **非流式 runs 可用**
   - 至少完成一轮：model -> tools -> model -> finalize
2. **流式 runs 可用**
   - 能持续输出 `delta`，并最终输出 `done`
3. **tool_call_id 正确**
   - 任意 tool message 发给上游时均携带 `tool_call_id`
   - 任意 tool_call 均有 `id`（缺失时可 deterministic 生成）
4. **历史污染可处理**
   - 构造历史 tool 消息缺少 tool_call_id 的情况下：不会触发上游 400

### 12.2 建议测试类型

- 单元测试：message normalization、tool executor、事件映射
- 集成测试：在 mock provider 下跑完整图（无需真实网络）
- 回归对照：同输入分别打到旧后端/新后端，对比 output 的可接受差异范围（例如 token 化 delta 不同但最终 content 相同）

---

## 13. 迁移计划（并行运行与切流）

### 13.1 并行运行

在 `pybackend/server.py` 增加一个开关：

- `ANIMA_BACKEND_IMPL=legacy|langgraph`

默认仍为 legacy，确保不影响现有用户。

### 13.2 切流策略

1. 开发期：本地用 env 切到 langgraph 后端
2. 稳定后：在 UI 增加隐藏开关（或 config）选择后端实现
3. 最终：langgraph 成为默认，legacy 保留一段时间作为 fallback

---

## 14. 第一阶段实现清单（按依赖顺序）

1. 新包骨架 `anima_backend_lg`（仅模块与导出，不引入额外复杂度）
2. State + Event schema
3. Provider adapter（复用现有 providers）
4. ToolSpec + ToolExecutor（复用现有 tools + mcp）
5. LangGraph 图：prepare/model/tools/finalize + 循环
6. HTTP handler：/api/runs + /api/runs?stream=1 的兼容输出
7. 最小集成测试：mock provider + 断言 tool_call_id

