# Codex 工具迁移开发 TODO

## 当前理解

- 目标：把 Anima 当前面向 agent 的工具体系替换为 Codex 风格工具体系。
- 范围：后端工具定义、工具执行入口、提示词、前端设置页、工具列表与相关状态展示。
- 不做：`functions.request_user_input`、所有 agent 相关工具。
- 工具名要求：对 agent 暴露的工具名使用 Codex 风格名称，不保留旧的 `bash`、`rg_search`、`WebSearch`、`WebFetch`、`edit_file`、`write_file` 等名称。
- 实现方式：按现有 Anima 工具体系的组织方式实现新工具，再把旧工具逻辑删除。

## 关键假设

- “注册到 agent” 指运行时传给模型的工具清单改为 Codex 工具清单。
- 可以复用现有 PTY、MCP、HTTP API、前端页面骨架，但旧工具名和旧工具注册逻辑最终要移除。
- `web.run` 第一阶段允许先落最小可用子集，但接口名和输入结构必须按 Codex 组织。

## 成功标准

- `/tools/list` 默认只返回 Codex 工具。
- run loop 只向模型暴露 Codex 工具名。
- 设置页和工具列表页不再显示旧工具名。
- 系统提示词不再引用旧工具名。
- 旧工具入口删除后，后端测试与关键交互链路仍通过。

## 工具范围

本次迁移只覆盖以下工具：

- `web.run`
- `functions.exec_command`
- `functions.write_stdin`
- `functions.list_mcp_resources`
- `functions.list_mcp_resource_templates`
- `functions.read_mcp_resource`
- `functions.update_plan`
- `functions.view_image`
- `functions.read_thread_terminal`
- `functions.apply_patch`
- `multi_tool_use.parallel`

明确不纳入：

- `functions.request_user_input`
- `functions.spawn_agent`
- `functions.send_input`
- `functions.resume_agent`
- `functions.wait_agent`
- `functions.close_agent`

## 开发顺序

1. 先新增 Codex 工具定义与执行入口 → 验证：后端单测可直接调用新工具
2. 再切换 run loop、设置接口和提示词 → 验证：模型侧只看到 Codex 工具名
3. 然后改前端设置页和工具列表页 → 验证：页面只展示 Codex 工具
4. 最后删除旧工具逻辑 → 验证：无旧工具调用方，回归测试通过

## 按文件拆分的 TODO

### 1. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/tools.py`

- [ ] 删除或下线当前 `builtin_tools()` 中的旧工具定义，不再向外暴露 `bash`、`rg_search`、`WebSearch`、`WebFetch`、`edit_file`、`write_file` 等旧工具。
- [ ] 新增 Codex 风格工具定义函数，统一返回本次范围内的 Codex 工具 schema。
- [ ] 保留可复用的底层公共函数，例如路径校验、命令安全检查、网络请求辅助函数，但不要再把它们组织成旧工具协议。
- [ ] 把 MCP tool 相关逻辑与 Codex MCP resource 相关逻辑区分开，避免继续沿用旧的 “MCP tools 列表 = 对模型暴露能力” 的结构。
- [ ] 为 `web.run` 预留聚合式参数解析入口，不再继续维护分散的 `WebSearch`、`WebFetch` 定义。

验证：

- [ ] 调用工具定义接口时，不再返回旧工具名。
- [ ] 旧工具名在代码中不再作为默认暴露项出现。

### 2. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/executor.py`

- [ ] 重写 `select_tools()`，让默认工具集合改为 Codex 工具集合。
- [ ] 重写 `execute_tool()` 的分发逻辑，按 Codex 工具名路由到新的 handler。
- [ ] 删除对旧 `execute_builtin_tool()` 主路径的依赖，避免执行链继续以旧工具名为中心。
- [ ] 为 `multi_tool_use.parallel` 增加并发执行封装，只允许并发调用本次已实现的开发工具。
- [ ] 保留 trace 输出结构，但 trace 的 `name` 改为 Codex 工具名。

验证：

- [ ] `select_tools()` 返回结果中只包含 Codex 工具名。
- [ ] `execute_tool()` 能正确执行 `functions.exec_command`、`functions.apply_patch`、`web.run`。
- [ ] trace 中不再出现旧工具名。

### 3. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/__init__.py`

- [ ] 导出新的 Codex runtime 入口，避免其它模块继续引用旧工具实现入口。
- [ ] 清理旧导出，减少旧接口残留调用。

验证：

- [ ] 运行时模块只从新的 Codex 执行入口导入工具能力。

### 4. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/api/settings_tools.py`

- [ ] 修改 `/tools/list` 返回结构，使默认返回 Codex 工具清单。
- [ ] 如果前端仍需要“工具状态”信息，在这里补充 Codex 工具的实现状态字段，而不是继续透传旧工具。
- [ ] 去掉旧工具列表与前端设置页的耦合字段，避免页面继续按旧工具名渲染。

验证：

- [ ] `GET /tools/list` 返回的 `tools` 中只包含 Codex 工具。
- [ ] 前端不依赖旧工具字段也能正常渲染工具列表。

### 5. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/api/runs_stream.py`

- [ ] 确认 tool loop 中调用的工具清单来自新的 Codex 工具选择逻辑。
- [ ] 调整危险命令审批、暂停恢复、tool trace 事件的命名，使前端接收到的事件名与 Codex 工具一致。
- [ ] 检查 `web.run`、`functions.exec_command` 的返回内容是否适合现有 SSE 事件流；必要时补齐序列化逻辑。

验证：

- [ ] 典型 run 请求中，模型侧可见工具名为 Codex 风格。
- [ ] tool trace 事件里不再出现 `bash`、`WebSearch` 等旧名。

### 6. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/api/runs.py`

- [ ] 同步非流式 run 路径的工具选择与执行逻辑，避免只修了 streaming 路径。
- [ ] 确认同步与流式接口的 tool trace / error 格式一致。

验证：

- [ ] 非流式 run 也只暴露 Codex 工具，并能执行核心工具。

### 7. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/runtime/graph.py`

- [ ] 修改系统消息注入逻辑，确保提示词和技能拼装阶段引用的工具能力描述改为 Codex 工具体系。
- [ ] 清理任何直接从旧 `builtin_tools()` 生成工具说明的逻辑。
- [ ] 如有工具约束文案，统一改成 Codex 工具名与对应语义。

验证：

- [ ] 生成的系统消息中不再包含旧工具名。

### 8. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/runtime/prompts/system_base.md`

- [ ] 把所有旧工具相关描述替换为 Codex 工具描述。
- [ ] 明确：
  - 用命令搜索文件时，应通过 `functions.exec_command` 执行 `rg`
  - 手工改文件优先用 `functions.apply_patch`
  - 联网能力统一通过 `web.run`
- [ ] 删除与旧工具名绑定的说明，避免模型继续请求旧工具。

验证：

- [ ] 提示词全文搜索不再出现旧工具名。

### 9. `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/runtime/prompts/tool_telegram.md`

- [ ] 检查 Telegram 通道专用提示词是否引用旧工具名。
- [ ] 若当前 Telegram 通道仍允许工具调用，也要同步切到 Codex 工具文案。
- [ ] 若 Telegram 通道暂不支持全部 Codex 工具，要明确写限制，而不是保留旧工具说明。

验证：

- [ ] Telegram 通道提示词与主运行时工具体系一致。

### 10. `/Users/wangxt/myspace/Anima/src/renderer/src/store/useStore.ts`

- [ ] 调整前端 store 中与工具模式、启用工具 ID、工具清单缓存相关的数据结构，使其适配 Codex 工具名。
- [ ] 删除任何依赖旧工具 ID 的默认值或兼容分支。
- [ ] 如果仍需按工具开关做选择，确保用新的 Codex 工具 ID 存储。

验证：

- [ ] 前端本地状态里不再保存旧工具 ID。

### 11. `/Users/wangxt/myspace/Anima/src/renderer/src/AppShadcn.tsx`

- [ ] 修改 composer 工具选择 UI，使其展示 Codex 工具名。
- [ ] 删除旧工具 ID 的勾选逻辑和旧文案。
- [ ] 检查 run 请求拼装逻辑，确保发送给后端的 `enabledToolIds` 与 Codex 工具 ID 一致。
- [ ] 检查 tool trace 展示逻辑，统一显示 Codex 工具名。

验证：

- [ ] 会话页工具选择区域只显示 Codex 工具。
- [ ] 实际发出的 run 请求只包含 Codex 工具 ID。

### 12. `/Users/wangxt/myspace/Anima/src/renderer/src/components/SettingsDialog.tsx`

- [ ] 调整设置页中的工具配置文案与结构，使其围绕 Codex 工具体系描述。
- [ ] 如果页面展示工具能力说明，改成 Codex 工具范围和限制说明。
- [ ] 删除旧工具命名残留，避免用户界面与实际运行时不一致。

验证：

- [ ] 设置页中不再出现旧工具名。

### 13. `/Users/wangxt/myspace/Anima/pybackend/test_backend_core.py`

- [ ] 为新的工具定义接口补测试，确认 `/tools/list` 返回 Codex 工具。
- [ ] 为 `functions.exec_command` 增加最小执行测试。
- [ ] 为 `functions.apply_patch` 增加成功、失败、越界测试。
- [ ] 为 `web.run` 增加最小可用子集测试。
- [ ] 为 `select_tools()`、`execute_tool()` 补回归测试，确认不再引用旧工具名。
- [ ] 删除或重写依赖旧工具名的测试。

验证：

- [ ] 新测试通过。
- [ ] 不再有旧工具名相关断言。

### 14. 新增后端文件：Codex 工具实现模块

建议新增以下文件，而不是把所有新逻辑继续堆回旧 `tools.py`：

- [ ] `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/codex_contract.py`
  - 负责定义 Codex 工具 schema
- [ ] `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/codex_executor.py`
  - 负责按 Codex 工具名执行 handler
- [ ] `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/codex_exec_session.py`
  - 负责 `functions.exec_command` / `functions.write_stdin` session
- [ ] `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/codex_patch.py`
  - 负责 `functions.apply_patch`
- [ ] `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/codex_web.py`
  - 负责 `web.run`
- [ ] `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/codex_plan.py`
  - 负责 `functions.update_plan`
- [ ] `/Users/wangxt/myspace/Anima/pybackend/anima_backend_core/tools/codex_mcp_resources.py`
  - 负责 MCP resources 三件套

验证：

- [ ] 新模块职责清晰，不与旧 native tool 协议混写。

### 15. 旧工具删除清单

以下旧能力在新工具完成并验证后删除：

- [ ] `builtin_tools()` 中旧工具定义
- [ ] `execute_builtin_tool()` 中仅服务旧工具协议的分支
- [ ] 前端中所有旧工具 ID 与旧工具文案
- [ ] 提示词中旧工具说明
- [ ] 测试中对旧工具名的断言

删除前检查：

- [ ] 全仓库搜索 `bash`、`rg_search`、`WebSearch`、`WebFetch`、`edit_file`、`write_file` 的 agent 工具语义引用
- [ ] 确认旧工具名只剩非 agent 语义或历史文档残留

## 建议的提交批次

### 批次 1：后端 Codex contract 与执行入口

- [ ] 新增 Codex 工具定义模块
- [ ] 新增执行入口
- [ ] 接入 runs/runs_stream
- [ ] 补最小后端测试

### 批次 2：提示词与工具列表接口

- [ ] 修改 system prompt
- [ ] 修改 Telegram prompt
- [ ] 修改 `/tools/list`
- [ ] 验证模型侧工具名切换

### 批次 3：前端设置页与工具列表页

- [ ] 修改 store
- [ ] 修改聊天页工具选择 UI
- [ ] 修改设置页
- [ ] 验证前端不再显示旧工具名

### 批次 4：删除旧工具逻辑

- [ ] 删除旧工具定义与执行分支
- [ ] 删除旧前端字段与文案
- [ ] 删除旧测试
- [ ] 跑回归验证

## 验证清单

- [ ] `GET /tools/list` 只返回 Codex 工具
- [ ] 流式 run 可调用 `functions.exec_command`
- [ ] 流式 run 可调用 `functions.apply_patch`
- [ ] `web.run` 最小子集可用
- [ ] 设置页和聊天页只展示 Codex 工具名
- [ ] 系统提示词与 Telegram 提示词不再引用旧工具名
- [ ] 删除旧工具后，全量相关测试通过

## 风险备注

- `web.run` 的 `open/click/find` 需要维护页面引用状态，这部分复杂度高于旧 `WebFetch`。
- `functions.apply_patch` 不能用简单 search/replace 代替，否则行为会偏离目标。
- MCP resources 三件套如果当前后端没有现成资源接口，需要补底层实现，不能只改名字。

