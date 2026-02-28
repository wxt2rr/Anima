# Telegram 接入方案（参考 OpenClaw）

本文档给出当前项目（Electron + 本地 Python 后端）接入 Telegram 的详细技术方案，并参考 OpenClaw 的“Gateway + 多通道适配 + 会话隔离 + 策略体检”思路进行拆分与取舍。

参考：
- OpenClaw 仓库与 README：https://github.com/openclaw/openclaw
- 当前项目后端入口：`pybackend/server.py`
- 当前项目 runs API：`pybackend/anima_backend_lg/api/runs.py`、`pybackend/anima_backend_lg/api/runs_stream.py`

---

## 1. 背景与目标

### 1.1 背景

当前项目的交互入口是桌面端 UI。后端为本机 Python HTTP 服务（默认仅监听 `127.0.0.1`），提供 chats/settings/tools/skills/runs 等接口。

Telegram 接入意味着新增一个“外部消息通道”：用户在 Telegram 发消息，项目在本机/服务器上代为执行（调用 LLM、工具等），再把结果回发到 Telegram。

### 1.2 目标（必须实现）

- 支持 Telegram 用户发送文本消息，触发一次对话执行并回传回复。
- 支持“同一个 Telegram 对话持续上下文”：同一 chat/thread 的多轮对话复用 threadId。
- 具备最小安全边界：未授权用户/群聊默认不可用（通过设置页的开关与白名单控制）。
- 不改变现有前端协议；复用现有后端 runs 能力作为执行引擎。

### 1.3 非目标（第一阶段不做）

- 不实现复杂的多 Agent 编排与自动规划器。
- 不追求 Telegram 的全量能力（贴纸、投票、复杂按钮等）。
- 不在第一阶段追求严格的 token 流式回传（可以先用非流式消息回传）。
- 不引入额外第三方 Web 框架（保持当前 `http.server` 体系不变）。

---

## 2. 参考 OpenClaw：可借鉴的关键点

OpenClaw 的思路可以抽象为：

1. **Gateway 控制平面**：统一管理 channels、sessions、tools、events；通道适配只是“输入/输出”。
2. **多通道 Inbox**：每个通道一个 adapter，统一归一化后进入路由与执行。
3. **会话隔离与路由**：不同来源/群聊/私聊的策略不同，避免上下文串线。
4. **策略体检（doctor）**：把“谁能触发、能做什么”当成一等能力，减少误配置导致的高风险暴露。

迁移到本项目的最小落地策略：
- 把 Telegram 看成“通道适配层”，在后端侧独立实现，不侵入 runs/graph 核心逻辑。
- 通过绑定表把 `telegram_chat_id -> threadId` 固化，确保上下文稳定可追溯。
- 引入 allowlist + 默认禁用群聊（或仅允许特定群），形成最小安全边界。

---

## 3. 总体方案概览

### 3.1 两种运行模式

#### 模式 A：Bot Long Polling（推荐，桌面/本地优先）

- 后端常驻运行一个轮询循环，定期调用 Telegram Bot API `getUpdates` 拉取增量消息。
- 不需要公网域名和 HTTPS；适合当前“本机后端仅监听 127.0.0.1”的形态。

适用场景：
- Anima 主要在用户电脑上运行。
- 用户希望“手机 Telegram 远程对话”，但不想部署公网服务。

#### 模式 B：Webhook（服务器化/团队化）

- Telegram 通过 HTTPS webhook 把 update 推到一个公网可达的 endpoint。
- 适合把 Anima 做成服务部署，或通过反向代理暴露 webhook。

适用场景：
- 有稳定域名、证书、反代（Nginx/Caddy）与运维体系。
- 希望多用户、多设备统一接入。

### 3.2 组件拆分（建议）

建议新增一个“集成层”子系统（概念层面）：

- TelegramAdapter
  - UpdateReceiver（Polling/Webhook）
  - UpdateParser（抽取 text、reply、sender、chat 信息）
  - Sender（sendMessage / 可选 editMessageText）
- MessageNormalizer
  - 统一为内部 InboundMessage（不依赖 Telegram 结构）
- BindingStore
  - 授权与策略：allowlist、群聊策略、默认执行上下文
- RunExecutor（复用现有）
  - 将 InboundMessage 映射为 `/api/runs` 请求体（messages + composer + threadId）

---

## 4. 接入点与数据流

### 4.1 关键接入点（对齐现有后端能力）

现有执行引擎：
- 非流式：`POST /api/runs`（一次请求得到最终 content）
- 流式：`POST /api/runs?stream=1`（SSE 输出 delta/trace/done）

第一阶段建议：
- Telegram 走非流式 runs：实现最少、稳定、便于控制超时与重试。
- 第二阶段再考虑“边生成边编辑 Telegram 消息”的体验优化。

### 4.2 消息流（Polling 模式示意）

1. TelegramAdapter 轮询 `getUpdates`（携带 offset）获取 updates
2. UpdateParser 解析 update -> InboundMessage
3. BindingStore 校验：是否允许该 user/chat；若未允许则忽略或回拒绝提示
4. MessageNormalizer 生成 runs 入参：
   - `threadId`：由绑定关系决定（默认可用 `tg:<chat_id>`）
   - `messages`：把 Telegram 文本映射为 `{"role":"user","content": "..."}`
   - `composer`：通道默认 composer（workspaceDir、toolMode 等）
5. RunExecutor 调用现有 `POST /api/runs`
6. Sender 将 `content` 回发 Telegram
7. 更新 offset，进入下一轮轮询

---

## 5. 关键设计细节

### 5.1 会话与 threadId 设计

目标是：同一 Telegram 对话稳定映射到同一个 threadId。

建议 threadId 规则：
- 私聊：`tg:dm:<telegram_user_id>`
- 群聊：`tg:group:<telegram_chat_id>`

说明：
- 使用前缀可以避免与本地 UI 创建的 chatId 冲突。
- 第一阶段不要求显式“绑定表”。threadId 可由 chatId 规则直接导出，从而做到“配置保存后即可聊天”。

### 5.2 设置页驱动的开通流程（保存后即可聊天）

目标：用户在“设置页”完成 Telegram 配置并保存后，无需在 Telegram 侧执行 `/bind` 等命令即可开始对话。

强约束：任何能触发 runs 的外部通道都要有明确授权。

建议策略（第一阶段）：
1. 默认关闭 Telegram 集成，关闭时不消费 Telegram 消息
2. 仅允许 `allowedUserIds` 中的 Telegram user
3. 默认仅允许私聊（group 默认拒绝，需显式开启）
4. threadId 映射采用固定规则（见 5.1），不引入人工绑定步骤

### 5.3 composer 默认值（通道级执行上下文）

Telegram 作为远程入口，建议默认采取更保守的 composer：
- workspaceDir：固定为某个安全目录（例如用户明确选择的 workspace），不允许来自 Telegram 的自由指定
- toolMode：默认受限（例如仅允许“只读工具”），并支持按绑定提升权限
- enabledToolIds：白名单（明确允许的工具集合）

### 5.6 设置页：IM 服务商筛选与 Telegram 配置项

设置页新增 “IM”/“集成”区域（概念），核心交互：

- **IM 服务商筛选**：下拉选择 IM Provider
  - 第一阶段仅提供 `Telegram`
  - 选择后展示对应配置项
- **启用开关**：`Enable Telegram`
- **连接方式**：
  - 第一阶段默认 `Polling (getUpdates)`，Webhook 作为第二阶段
- **Bot Token**：Telegram Bot Token（敏感）
- **允许的用户列表**：`allowedUserIds`（必填，至少 1 个）
- **群聊策略**：
  - `allowGroups`（默认 false）
  - 可选：群聊触发条件（例如必须 @bot 或以特定前缀开头）
- **执行上下文（建议初版就有）**：
  - `workspaceDir`（固定目录选择）
  - `toolMode` / `enabledToolIds`（外部入口默认受限）

保存行为（关键）：
- 保存后立即持久化到 settings，并驱动后端启动/停止 Telegram 轮询循环
- 开启后由轮询循环自动处理 allowlist 内用户的消息，直接进入 runs（不需要绑定命令）

### 5.4 幂等与重复消息处理

Polling 模式天然可能重复投递（网络抖动、offset 更新失败）。

建议最小策略：
- 使用 update_id 做去重：保存 `last_processed_update_id`，仅处理更大的 update_id
- 对每条 update 生成 `request_id`，并记录最近 N 条（内存或持久化）避免短时间重复

### 5.5 超时、重试与用户体验

建议目标：
- 端到端（一次 runs）控制在 60s 内；超过则向 Telegram 回“任务处理中/稍后重试”的提示，并允许用户手动重试。

推荐做法：
- 调用 runs 时设置合理 maxTokens（或限制工具步数）
- 遇到后端异常时，回传可读错误，并记录内部 trace（但不泄露敏感信息）

---

## 6. Webhook 模式补充设计（可选第二阶段）

Webhook 模式相比 Polling 多出的关键问题：

- 需要公网 HTTPS endpoint（Telegram 要求）
- 当前后端只监听本机 127.0.0.1，需要：
  - 要么改成监听 0.0.0.0 并放到反代之后
  - 要么单独部署一个 TelegramGateway（公网服务）转发到本机（需要隧道/反向连接）

建议的“最小侵入”策略：
- 不直接暴露 Anima 后端
- 单独部署 TelegramGateway（可很薄），只做：
  - 验证 webhook secret
  - 把 update 转发给本机 Anima（通过用户自建 tunnel，例如 Tailscale/ZeroTier/反代隧道）

---

## 7. 安全清单（必须满足）

- allowlist：默认只允许指定 Telegram userId 触发执行
- 默认禁用群聊：群聊需要显式开启并设置 mention/触发条件
- Token 脱敏：
  - botToken 不可出现在日志与导出设置中
  - 错误信息返回 Telegram 时不可包含敏感配置与本地路径细节
- 工具权限：
  - 外部入口默认仅允许低风险工具
  - 若允许执行 shell/写文件，应有二次确认或至少单独的绑定策略开关

---

## 8. 运维与可观测

### 8.1 日志与指标（最小）

- 每条 update 记录：update_id、chat_id、user_id、绑定的 threadId、执行耗时、成功/失败
- 对 runs 的失败：记录失败类型（网络、上游模型、工具执行），便于排障

### 8.2 启停行为

- Polling 循环应随后端进程启动/退出而启动/退出，避免僵尸线程
- 崩溃恢复：重新启动后依赖 update_id offset 继续消费

---

## 9. 测试与验收

### 9.1 测试建议

- 单元测试：
  - Telegram update -> InboundMessage 的解析正确
  - 允许/拒绝策略：未授权 user 拒绝、私聊/群聊策略符合预期
- 集成测试（最小闭环）：
  - 模拟收到 Telegram 文本 -> 调用 `POST /api/runs` -> 输出 content -> 模拟 sendMessage
- 回归测试：
  - 桌面端 UI 与现有 runs/chats/settings 不受影响

### 9.2 验收标准（第一阶段）

- 设置保存后可用：启用 Telegram 并配置 allowlist 后，允许用户可直接聊天
- 私聊场景可用：同一对话连续发 3 轮消息能保持上下文连续（threadId 不变）
- 未授权用户无法触发执行
- 失败可见：当上游模型不可用/超时时，Telegram 能收到明确失败提示

---

## 10. 分阶段落地路线

### Phase 1（最小可行）

- Polling 模式（getUpdates）
- 设置页选择 IM 服务商（仅 Telegram）+ Telegram 配置保存生效
- 私聊 + allowlist（群聊默认关闭）
- 非流式 runs

### Phase 2（体验与覆盖面）

- 可选：流式 runs + Telegram 编辑消息（模拟实时输出）
- 可选：媒体能力（图片/语音）进入 attachments pipeline
- 可选：群聊模式（mention 触发、群规则）

### Phase 3（服务化）

- Webhook 模式 + 公网部署/反代/隧道方案
- 更完整的策略体检（类似 OpenClaw doctor 的配置检查）

---

## 11. 开发 Todo 与进度

说明：后续开发按下述 Todo 顺序推进；每完成一项即更新本节状态与进度记录。

### 11.1 Todo 列表

- [ ] 1. 设置页新增 IM 服务商选择与 Telegram 配置表单
- [ ] 2. 扩展 settings 结构并持久化 Telegram 配置
- [ ] 3. 后端实现 Telegram 轮询并随设置启停
- [ ] 4. Telegram 消息触发 runs 并回发回复
- [ ] 5. 导出脱敏 Telegram Token 并补最小测试

### 11.2 进度记录

- 2026-02-10：初始化 Todo 列表

### 11.3 Artifact（方案B：attachments pipeline）Todo 列表

- [x] B1. 定义 Artifact 数据结构与 runs 输出协议（流式/非流式）
- [x] B2. 工具执行层支持产物上报与路径安全校验（artifact resolve）
- [x] B3. 新增 screenshot 内置工具并以 artifact 形式返回图片
- [x] B4. Telegram 回包改为优先消费 artifacts（sendPhoto/sendDocument）
- [x] B5. 桌面端 UI 渲染 artifacts（图片预览/文件链接）
- [x] B6. 补充单测并跑通后端单测 + 前端 lint/typecheck

#### 11.3.1 Artifact 进度记录

- 2026-02-11：创建方案B Todo 列表
- 2026-02-11：完成 B1（Artifact schema + runs 输出字段）
- 2026-02-11：完成 B2-B6（artifact 上报/截图工具/Telegram 回包/UI 渲染/测试与检查）
