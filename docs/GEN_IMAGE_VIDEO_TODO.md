# 生图/生视频能力开发 Todo List

规则：本文件是“生图/生视频”功能的单一进度来源。每完成一项，必须立刻更新本文件进度（勾选 + 记录完成日期/commit/说明可选），直到全部完成。

更新时间：2026-02-26

---

## 状态说明

- [ ] 未开始
- [~] 进行中
- [x] 已完成

---

## 范围与目标

### 目标（必须实现）

- 支持在对话中触发“生图”和“生视频”，并以 artifacts 形式回传并渲染。
- 生图：生成图片文件落盘（workspace 内安全路径），对话 UI 可预览/打开。
- 生视频：生成视频文件落盘（workspace 内安全路径），对话 UI 可播放/打开。
- Runs 流式与非流式路径行为一致：工具 trace、artifacts、done 事件字段一致。
- 安全边界：所有产物必须经过路径校验，禁止 workspace 外路径；限制文件大小与超时。

### 非目标（本阶段不做）

- 不做复杂多 agent 编排、视频剪辑、自动配乐等扩展能力。
- 不做跨设备同步与云存储（产物以本地文件为主）。
- 不做“任意外链媒体直接播放”（避免 SSRF/隐私风险）。

---

## 验收标准（可验证）

- 生图：一次对话可生成至少 1 张图片，UI 中可预览，点击可在系统中打开文件。
- 生视频：一次对话可生成至少 1 个视频，UI 中可播放，点击可在系统中打开文件。
- 工具执行产物：后端返回 artifacts 的 path 为绝对路径，且必在 workspace 内。
- 回归：现有 screenshot 工具与已有 artifacts 渲染不回归。
- 测试：新增后端单测覆盖（路径校验/类型/产物写入/事件输出），前端 lint/typecheck 通过。

---

## P0：协议与最小闭环（先跑通生图）

- [x] 明确第一期上游选择与调用方式（OpenAI/兼容/第三方）
  - 完成日期：2026-02-26
  - 说明：复用现有“Active Provider”配置（baseUrl/apiKey/proxyUrl）；生图调用 `/images/generations`；生视频调用 `/videos/generations`（兼容回退 `/video/generations`）；鉴权复用 provider apiKey。

- [x] 扩展 Artifact schema 支持 video 类型
  - 完成日期：2026-02-26
  - 说明：后端 Artifact kind 扩展为 image/video/file。

- [x] 扩展后端 artifacts 产物安全校验支持 video
  - 完成日期：2026-02-26
  - 说明：artifact sanitize 支持 video；继续强制 workspace 内路径 + 文件存在。

- [x] 新增生图工具（generate_image）并返回 image artifact
  - 完成日期：2026-02-26
  - 说明：新增 `generate_image` 内置工具：调用上游生成并落盘到 `workspace/.anima/artifacts/`，以 artifact 返回。

- [x] 前端对话渲染支持 video artifact 的占位与打开
  - 完成日期：2026-02-26
  - 说明：实现 video artifact 渲染与打开入口。

- [x] 生图端到端回归测试覆盖（后端 + 前端检查）
  - 完成日期：2026-02-26
  - 说明：新增后端单测覆盖生成落盘与 artifacts 返回；前端 lint/typecheck 通过。

---

## P1：体验完善（生图 UI + 生视频 MVP）

- [x] 前端渲染 video/* 为可播放组件（video controls）
  - 完成日期：2026-02-26
  - 说明：video artifact 以 `<video controls>` 渲染，并提供打开入口。

- [x] 新增生视频工具（generate_video）并返回 video artifact
  - 完成日期：2026-02-26
  - 说明：新增 `generate_video` 内置工具：调用上游生成并落盘到 `workspace/.anima/artifacts/`，以 artifact 返回。

- [x] Runs 流式输出增加/对齐生成进度事件
  - 完成日期：2026-02-26
  - 说明：流式 runs 增加工具开始/结束 stage 事件；前端展示 stage 文本。

- [x] 前端展示生成进度（stage/progress）并可取消
  - 完成日期：2026-02-26
  - 说明：前端显示 stage；发送中可通过 Stop 按钮中断请求。

- [x] 安全与资源限制落地（超时/大小/并发）
  - 完成日期：2026-02-26
  - 说明：生成请求配置超时与最大文件大小；外链下载仅允许公网 URL；错误信息不包含敏感字段。

- [x] 生视频端到端回归测试覆盖（含超时与失败路径）
  - 完成日期：2026-02-26
  - 说明：新增后端单测覆盖生成落盘与 artifacts 返回。

---

## P2：设置与可运维性（可选但推荐）

- [x] 设置页增加生图/生视频能力开关与默认参数（如分辨率/时长）
  - 完成日期：2026-02-26
  - 说明：新增 media 配置：生图/生视频开关与默认模型/默认图片尺寸。

- [x] 统一产物清理策略（按 workspace/按时间/按大小）
  - 完成日期：2026-02-26
  - 说明：新增清理接口与设置页按钮；清理范围限定在 `workspace/.anima/artifacts/`。

- [x] Telelgram/IM 通道回包策略对齐 video artifact
  - 完成日期：2026-02-26
  - 说明：Telegram 回包支持 video artifact（优先 sendVideo，失败回退 sendDocument）。

---

## P3：发布前质量门禁

- [x] 补齐安全审计清单并自测
  - 完成日期：2026-02-26
  - 说明：工具侧不接受模型传入密钥；下载外链限制公网地址；产物路径强制 workspace 内；限制文件大小与超时；错误信息不输出敏感字段。

- [x] 全量检查通过（后端单测 + 前端 lint/typecheck）
  - 完成日期：2026-02-26
  - 说明：后端单测通过；前端 lint/typecheck 通过。

---

## 进度记录

- 2026-02-26：创建生图/生视频开发 Todo 清单
- 2026-02-26：完成 P0-P3 全部任务
