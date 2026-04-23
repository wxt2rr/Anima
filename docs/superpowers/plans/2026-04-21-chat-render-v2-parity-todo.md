# Chat Render V2 Parity Todo Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不回退 v1 全量同步渲染路径的前提下，补齐 v2 聊天渲染缺失的 v1 可见能力。

**Architecture:** 保持 `ChatSurface` 虚拟列表、Markdown worker/cache、代码块行虚拟化、详情懒挂载。新增能力通过小组件、纯函数和事件委托恢复，避免重新把大段渲染逻辑塞回 `AppShadcn`。

**Tech Stack:** React 18, Zustand, Electron, `@tanstack/react-virtual`, existing TypeScript node tests.

---

## Scope And Assumptions

- 不恢复旧 `displayMessages.map` 主路径。
- 不恢复旧聊天主路径的 `ReactMarkdown` 同步渲染。
- raw HTML 不按旧 `rehypeRaw` 执行渲染；继续转义显示，避免安全边界扩大。
- 需要补齐的是用户已确认的 v1 聊天可见能力：链接/文件预览、消息复制、附件/产物、审批、压缩、记忆注入、工具详情、Mermaid/Markdown 图片/代码预览、摘要 Markdown、右侧用户消息导航与高亮跳转。

---

## Task Progress Overview

| Task | Status | Evidence |
| --- | --- | --- |
| Task 1: Plan and tests | done | `npm run test:chat-render` RED: TS2307 missing `features/chat/chatLinks` |
| Task 2: Link and Markdown parity | done | `npm run test:chat-render` 6 通过；`npm run typecheck` 退出码 0 |
| Task 3: Message row parity | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；恢复用户消息导航与高亮跳转 |
| Task 4: Process and approval cards | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 6 通过 |
| Task 5: Tool trace parity | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 6 通过 |
| Task 6: Code block and summary parity | done | `npm run test:chat-render` 7 通过；`npm run typecheck` 退出码 0；补齐 Mermaid、HTML/SVG 预览、摘要 Markdown、公式渲染、历史轮次展开 |
| Task 7: Final verification | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；`npm run build` 退出码 0；静态检查 `static check ok` |
| Task 8: Tool call UI + copy parity with v1 | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；修复重复“工具调用 1 项”、恢复按段聚合摘要与详情 Markdown |
| Task 9: Tool action text + diff summary parity | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；补齐按动作状态文案（搜索/编辑/执行等）与 diff 行数摘要 |
| Task 10: Structured tool result parity | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；补齐 WebSearch/WebFetch/rg_search/list_dir/read_file 结构化结果摘要与详情 |
| Task 11: Dangerous approval trace parity | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；补齐 bash 审批状态徽标和“未执行”语义 |
| Task 12: v1-style concise tool traces | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；非编辑工具改为“状态+工具名+关键参数”单行句式（如 `Read List directory .`）并展开文本结果（非 JSON），编辑工具保留 diff 视图；去除非编辑兜底路径胶囊，进一步贴近 v1 视觉密度 |
| Task 13: Chat typography and spacing parity | done | `npm run typecheck` 退出码 0；新增 `chatPresentation.ts` 统一 assistant/user/tool/process 的字体、字重、字号、行高与垂直节奏，并收敛 Markdown `prose` 间距 |
| Task 14: Expand and collapse animation parity | done | `npm run typecheck` 退出码 0；`LazyDetails` 恢复为统一动画折叠容器，思考过程、记忆注入、工具详情与压缩详情回到同一套展开/折叠过渡 |
| Task 15: Process card interaction parity | done | `npm run typecheck` 退出码 0；统一思考/记忆/压缩/工具摘要的标题样式、箭头节奏与 hover 反馈，并修正无详情项的展开提示 |
| Task 16: Final parity verification | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；最终剩余差异收口任务全部回写完成 |
| Task 17: Process wording and tool sentence parity | done | `npm run typecheck` 退出码 0；恢复旧版过程摘要词面、非编辑工具标题去工具名并把耗时拼回句尾，补齐更明显的 hover 强化 |
| Task 18: Compact tool detail parity | done | `npm run typecheck` 退出码 0；`npm run test:chat-render` 8 通过；工具展开详情支持 compact 排版，搜索结果恢复为更小更紧的 `① ②` 风格 |
| Task 19: Up-scroll jitter root-cause fix | done | `npm run test:chat-render` 14 通过；`npm run typecheck` 退出码 0；真实 Telegram 82 条消息对话连续 3 次向上滚动 300px 的 split-step probe 中，`immediate.top === after.top`，无自动回跳 |

---

## Task 1: Plan And Tests

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-chat-render-v2-parity-todo.md`
- Modify: `tests/chatMarkdownCompiler.test.ts`
- Create: `tests/chatLinkTargets.test.ts`
- Modify: `tsconfig.chat-render-tests.json`

**Goal:** 先用纯函数测试锁定链接识别、Markdown 图片/文件 token 和 helper 行为。

- [x] **Step 1: Add RED tests for chat link helpers**

Expected tests:
- `classifyChatLinkTarget('https://example.com')` returns `preview`.
- `classifyChatLinkTarget('/tmp/a.md')` returns `file`.
- `classifyChatLinkTarget('src/App.tsx')` returns `file`.
- `linkifyQuotedFileNames('open `src/App.tsx`')` emits a Markdown link.

- [x] **Step 2: Add RED tests for Markdown parity**

Expected tests:
- `![Alt](sandbox:/file.png)` produces an image marker.
- `~~gone~~` produces `<del>gone</del>`.
- `- [x] done` produces a disabled checkbox.
- inline file code `` `src/App.tsx` `` carries a clickable target marker.

- [x] **Step 3: Run focused tests and record RED evidence**

Command:

```bash
npm run test:chat-render
```

Expected: fails because helper module or new Markdown behavior is missing.

---

## Task 2: Link And Markdown Parity

**Files:**
- Create: `src/renderer/src/features/chat/chatLinks.ts`
- Modify: `src/renderer/src/features/chat/markdownCompilerCore.ts`
- Modify: `src/renderer/src/features/chat/MarkdownContent.tsx`
- Modify: `src/renderer/src/AppShadcn.tsx`

**Goal:** 恢复蓝色链接、本地文件点击右侧文件预览、网站点击右侧网页预览、inline file token 可点击、Markdown 图片语法。

- [x] **Step 1: Implement `chatLinks.ts` pure helpers**

Helpers:
- `normalizeChatLinkTarget(raw)`
- `classifyChatLinkTarget(raw)`
- `isFileLikeTarget(raw)`
- `linkifyQuotedFileNames(input)`
- `resolveChatAssetUrl(path, backendBaseUrl, workspaceDir, endpoint)`

- [x] **Step 2: Enhance Markdown compiler**

Requirements:
- explicit links emit `class="anima-chat-link"` and `data-chat-link-target`.
- inline file code emits `class="anima-chat-inline-file"` and `data-chat-link-target`.
- Markdown image emits `img` with `data-chat-image-src`.
- task list, ordered list, strikethrough, autolink are supported.
- raw HTML remains escaped.

- [x] **Step 3: Add event delegation in `MarkdownContent`**

Requirements:
- click on `[data-chat-link-target]` calls `onOpenLinkTarget`.
- image `src` is resolved after compile using backend/workspace props.
- links remain blue/underlined through generated classes.

- [x] **Step 4: Wire `ChatSurface` from `AppShadcn`**

Pass:
- `onOpenLinkTarget={openLinkTarget}`
- `backendBaseUrl`
- `workspaceDir={resolveWorkspaceDir()}`

- [x] **Step 5: Run tests and update evidence**

Command:

```bash
npm run test:chat-render
```

Expected: new link/Markdown tests pass.

---

## Task 3: Message Row Parity

**Files:**
- Modify: `src/renderer/src/features/chat/UserMessage.tsx`
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Modify: `src/renderer/src/features/chat/ChatSurface.tsx`

**Goal:** 恢复用户/assistant 消息复制按钮、用户图片附件缩略图、assistant artifacts、普通 stage 文本、右侧用户消息导航与高亮跳转。

- [x] **Step 1: Add shared row action props**

Add props for copied message id, copy callback, link callback, backend URL, workspace dir.

- [x] **Step 2: Restore copy buttons**

Requirement:
- user and final assistant message show copy button on hover.
- copied state uses `copiedMessageId`.

- [x] **Step 3: Restore user image attachment thumbnails**

Requirement:
- read `message.meta.userAttachments`.
- only render image thumbnails in visible user row.
- thumbnail click calls `onOpenLinkTarget`.

- [x] **Step 4: Restore assistant artifacts and stage text**

Requirement:
- render `message.meta.artifacts` with lazy thumbnail/file chips.
- render non-tool stage text below assistant body.

- [x] **Step 5: Restore user message navigation and highlight**

Requirement:
- right-side user message markers are computed from virtual rows, not DOM refs.
- clicking a marker scrolls the virtual list to the target user message.
- target user message shows transient highlight state.

- [x] **Step 6: Run typecheck and focused tests**

Command:

```bash
npm run typecheck
npm run test:chat-render
```

Expected: TypeScript passes and navigation helper tests pass.

---

## Task 4: Process And Approval Cards

**Files:**
- Create: `src/renderer/src/features/chat/CompressionCard.tsx`
- Create: `src/renderer/src/features/chat/MemoryInjectionPanel.tsx`
- Create: `src/renderer/src/features/chat/DangerousApprovalCard.tsx`
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`
- Modify: `src/renderer/src/AppShadcn.tsx`

**Goal:** 恢复压缩状态、记忆注入详情、危险命令审批交互。

- [x] **Step 1: Add compression card**

Requirement:
- `compressionState=running|done` renders a collapsed/expandable card.

- [x] **Step 2: Add memory injection panel**

Requirement:
- show injected memory count and duration.
- expand only when clicked and visible.

- [x] **Step 3: Add dangerous command approval card**

Requirement:
- pending approval shows command, once/thread/reject options, submit button.
- submit calls App callback that updates message meta and resumes run.

- [x] **Step 4: Wire App callback**

Requirement:
- preserve old approval semantics: approve once, approve thread, reject, run resume ids.

- [x] **Step 5: Run typecheck**

Command:

```bash
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 5: Tool Trace Parity

**Files:**
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Create: `src/renderer/src/features/chat/ArtifactStrip.tsx`
- Create: `src/renderer/src/features/chat/ToolDiffList.tsx`

**Goal:** 把 tool trace 从 JSON dump 恢复为摘要、实体、耗时、状态、错误、artifact、diff 的懒展开视图。

- [x] **Step 1: Add artifact strip**

Requirement:
- image/video/file artifacts render as lazy thumbnails or chips.
- click calls `onOpenLinkTarget`.

- [x] **Step 2: Add diff list**

Requirement:
- trace diffs render only when detail is open.
- file path chip calls `onOpenLinkTarget`.

- [x] **Step 3: Enhance tool trace summary**

Requirement:

---

## Task 19: Up-scroll Jitter Root-Cause Fix

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-chat-render-v2-parity-todo.md`
- Create: `tests/chatVirtualListModel.test.ts`
- Create: `tests/markdownCompileCache.test.ts`
- Modify: `tsconfig.chat-render-tests.json`
- Create: `src/renderer/src/features/chat/chatVirtualListModel.ts`
- Create: `src/renderer/src/features/chat/markdownCompileCache.ts`
- Modify: `src/renderer/src/features/chat/ChatVirtualList.tsx`
- Modify: `src/renderer/src/features/chat/MarkdownContent.tsx`
- Modify: `src/renderer/src/features/chat/markdownCompiler.ts`

**Goal:** 根治长对话上滑时的抖动：减小错误估高、在用户主动上滑期间禁止尺寸变化自动补偿、命中缓存时不再先回退到纯文本占位。

- [x] **Step 1: Add RED tests for virtual list sizing and adjustment policy**

Expected tests:
- 长 assistant 行估高明显高于短 assistant / user 行。
- 历史 process 行估高会累加内部 assistant/tool 条目。
- 用户主动上滑后的短时间窗口内，尺寸变化不允许自动调整滚动位置。

- [x] **Step 2: Add RED tests for markdown synchronous cache reads**

Expected tests:
- 写入编译结果后，同 key 可以同步读取。
- 不同 messageId/content hash 不会串缓存。

- [x] **Step 3: Run focused chat-render tests and capture RED evidence**

Command:

```bash
npm run test:chat-render
```

Expected: fails because sizing helper / cache helper do not exist yet.

- [x] **Step 4: Implement sizing model and scroll-adjust suppression**

Requirement:
- `ChatVirtualList` 不再统一 `estimateSize=140`。
- 改为按 `row.role`、正文长度、代码块/列表标记、process 条目数量估高。
- 用户主动上滑后的短窗口内，`shouldAdjustScrollPositionOnItemSizeChange` 返回 `false`。

- [x] **Step 5: Implement markdown compile result sync cache**

Requirement:
- 缓存同时保存 pending promise 和 resolved result。
- `MarkdownContent` 初始渲染优先读取 resolved result。
- 命中缓存时不再先 `setCompiled(null)` 再切回正式内容。

- [x] **Step 6: Run verification and update evidence**

Command:

```bash
npm run test:chat-render
npm run typecheck
```

Expected: 新增测试通过，类型检查通过。
- collapsed row shows trace count, status, tool name, duration, entity/path when present.
- running/failed/succeeded status visible.

- [x] **Step 4: Enhance tool trace detail**

Requirement:
- detail shows formatted args/result, artifacts, diffs, error message.

---

## Task 12: v1-Style Concise Tool Traces

**Files:**
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Modify: `docs/superpowers/plans/2026-04-21-chat-render-v2-parity-todo.md`

**Goal:** 非编辑工具展示回归 v1 的简洁文本流样式，避免 JSON 墙；编辑工具仍保留 diff 和文件改动能力，不回退性能优化主链路。

- [x] **Step 1: Split edit vs non-edit trace rendering**

Requirement:
- non-edit traces show concise single-line headline.
- edit traces keep file/diff focused rendering.

- [x] **Step 2: Inline key argument beside tool name**

Requirement:
- headline format includes tool name and key entity (query/path/url/command).
- `list_dir` path rendered inline (e.g. `.`).

- [x] **Step 3: Replace non-edit detail with plain readable text**

Requirement:
- expand panel shows readable text (search list, fetch status, directory entries, match lines).
- no args/result JSON blocks for non-edit traces.

- [x] **Step 4: Keep validation green**

Command:

```bash
npm run typecheck
npm run test:chat-render
```

Expected: both pass.

---

## Task 13: Chat Typography And Spacing Parity

**Files:**
- Create: `src/renderer/src/features/chat/chatPresentation.ts`
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`
- Modify: `src/renderer/src/features/chat/UserMessage.tsx`
- Modify: `src/renderer/src/features/chat/MarkdownContent.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Modify: `src/renderer/src/features/chat/MemoryInjectionPanel.tsx`
- Modify: `src/renderer/src/features/chat/CompressionCard.tsx`

**Goal:** 统一 assistant / user / tool / process 区域的字体族、字重、字号、行高，以及消息与工具、工具内部之间的垂直间距，消除 v2 当前多套排版基线。

- [x] **Step 1: Extract shared chat presentation constants**

Requirement:
- 提供统一的 PingFang 字体族。
- 提供消息正文、辅助文本、过程标题的统一 class。

- [x] **Step 2: Align assistant and markdown typography**

Requirement:
- assistant 纯文本与 markdown 正文使用同一套字号/字重/行高。
- 覆盖 `prose` 默认 margin/weight 偏差，避免段落和列表间距过大。

- [x] **Step 3: Align user bubble and process/tool spacing**

Requirement:
- 用户消息气泡、assistant 正文、工具区、过程摘要之间的上下节奏统一。
- 工具组内部条目与详情间距统一。

- [x] **Step 4: Verify**

Command:

```bash
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 14: Expand And Collapse Animation Parity

**Files:**
- Modify: `src/renderer/src/features/chat/LazyDetails.tsx`
- Modify: `src/renderer/src/features/chat/CompressionCard.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Modify: `src/renderer/src/features/chat/MemoryInjectionPanel.tsx`
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`

**Goal:** 恢复 v1 风格的统一展开/折叠动画，避免当前直接挂载/卸载造成的突兀切换。

- [x] **Step 1: Rebuild `LazyDetails` with animated collapse**

Requirement:
- 保留按需挂载与可视区懒渲染。
- 增加统一的展开/折叠过渡动画。

- [x] **Step 2: Reconnect all collapsible chat sections**

Requirement:
- 思考过程、记忆注入、工具详情、压缩详情都走同一套动画容器。

- [x] **Step 3: Verify**

Command:

```bash
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 15: Process Card Interaction Parity

**Files:**
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Modify: `src/renderer/src/features/chat/MemoryInjectionPanel.tsx`
- Modify: `src/renderer/src/features/chat/CompressionCard.tsx`
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`

**Goal:** 统一过程区各类摘要卡片的交互语言，包括标题样式、箭头显隐、hover 反馈、展开按钮位置，恢复 v1 的一致性。

- [x] **Step 1: Align summary row interactions**

Requirement:
- 过程摘要、记忆注入、工具组、压缩卡片使用统一的标题与箭头节奏。
- 不再混用“纯文本按钮”“hover 才出现箭头”“常显箭头”等多套规则。

- [x] **Step 2: Align reasoning disclosure**

Requirement:
- 思考过程从孤立文本按钮改为与其他过程卡片一致的摘要头。

- [x] **Step 3: Verify**

Command:

```bash
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 16: Final Parity Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-chat-render-v2-parity-todo.md`

**Goal:** 完成最终验证并把证据回写到计划文档。

- [x] **Step 1: Run verification**

Command:

```bash
npm run typecheck
npm run test:chat-render
```

Expected: both pass.

- [x] **Step 2: Mark all remaining tasks done with evidence**

---

## Task 17: Process Wording And Tool Sentence Parity

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-chat-render-v2-parity-todo.md`
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`

**Goal:** 恢复旧版过程摘要文案，以及非编辑工具标题的句式、耗时位置和 hover 反馈，不影响现有虚拟化与懒渲染路径。

- [x] **Step 1: Restore process summary wording**

Requirement:
- 使用旧版词面模板，而不是当前“过程摘要：...”句式。

- [x] **Step 2: Restore non-edit tool headline wording**

Requirement:
- 非编辑工具标题不展示工具名称。
- 耗时回到句尾，而不是独立右侧列。
- hover 反馈恢复为更明显的视觉强化。

- [x] **Step 3: Verify**

Command:

```bash
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 18: Compact Tool Detail Parity

**Files:**
- Modify: `src/renderer/src/features/chat/MarkdownContent.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`

**Goal:** 恢复旧版搜索/浏览工具展开详情的小字、紧间距、轻量列表感。

- [x] **Step 1: Add compact markdown density for tool detail**

Requirement:
- tool 详情支持比正文更小更紧凑的排版。

- [x] **Step 2: Restore search detail formatting**

Requirement:
- 搜索结果使用 `① ②` 这类编号风格。
- 标题、链接、摘要的块间距更紧。

- [x] **Step 3: Verify**

Command:

```bash
npm run typecheck
npm run test:chat-render
```

Expected: both pass.
- no detail DOM when collapsed.

- [x] **Step 5: Run typecheck**

Command:

```bash
npm run typecheck
```

Expected: TypeScript passes.

---

## Task 8: Tool Call UI + Copy Parity With v1

**Files:**
- Modify: `src/renderer/src/features/chat/messageViewModel.ts`
- Modify: `src/renderer/src/features/chat/types.ts`
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Create: `src/renderer/src/features/chat/toolTraceUtils.ts`

**Goal:** 工具调用区块恢复 v1 的按段聚合展示和摘要文案语义，避免重复“工具调用 1 项”，并补齐工具详情 Markdown 能力。

- [x] **Step 1: 按 tool 段聚合 traces，并只在组头渲染**

验证：
- `messageViewModel` 在 `isToolGroupHead` 上挂载 `toolGroup` 聚合数据。
- `ChatMessageRow` 非组头 tool row 不渲染 `ToolTraceGroup`。

- [x] **Step 2: 恢复 v1 类别摘要文案**

验证：
- 新增 `toolTraceUtils.ts`，实现 `Explored/Edited/Ran/Context` 分类与摘要拼接。
- `ToolTraceGroup` 顶部摘要改为分类文案，非固定“工具调用 N 项”。

- [x] **Step 3: 补齐 running/completed 去重**

验证：
- `dedupeToolTracesForDisplay` 跳过“同签名 running 且已存在 completed”的重复轨迹。

- [x] **Step 4: 恢复名称规范化与详情 Markdown**

验证：
- 工具名移除 `tool_start:/tool_done:/tool_end:` 前缀。
- `args/result` 在启用 Markdown 时使用 `MarkdownContent` 渲染，保留可点击链接与文件目标。

- [x] **Step 5: 回归验证**

命令：

```bash
npm run typecheck
npm run test:chat-render
```

结果：
- 两个命令均通过（退出码 0）。

---

## Task 9: Tool Action Text + Diff Summary Parity

**Files:**
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Modify: `src/renderer/src/features/chat/toolTraceUtils.ts`
- Modify: `src/renderer/src/features/chat/ToolDiffList.tsx`

**Goal:** 工具调用状态文案和文件编辑摘要与 v1 对齐，且保持懒渲染性能边界。

- [x] **Step 1: 补齐工具动作态文案映射**

验证：
- 使用 `APP_RUNTIME_STRINGS.trace.statusText` 按动作类型输出 `running/done/failed`（执行/搜索/浏览/读取/编辑）。
- 工具名显示优先使用 `APP_RUNTIME_STRINGS.builtinTools`。

- [x] **Step 2: 补齐 diff 统计摘要**

验证：
- trace 行增加 `N 文件 +A -D` 摘要。
- diff 详情区增加“修改文件数 + 新增/删除行数”总览。

- [x] **Step 3: 保持性能边界并验证**

验证：
- 未改虚拟列表主路径，diff 正文仍在详情展开后渲染。
- 命令通过：

```bash
npm run typecheck
npm run test:chat-render
```

结果：
- 两个命令均通过（退出码 0）。

---

## Task 10: Structured Tool Result Parity

**Files:**
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Modify: `src/renderer/src/features/chat/ToolDiffList.tsx`

**Goal:** 对齐 v1 的工具结果结构化展示，包含搜索结果摘要、网页抓取状态、文件匹配行、读取结果摘要等。

- [x] **Step 1: 迁移 v1 的 trace 结果解析能力**

验证：
- 增加 `parseMaybeJson` / fenced-json 清洗 / JSON 子串提取能力。
- 兼容 `results/items/entries/matches/meta.path/ok=false` 结构。

- [x] **Step 2: 补齐结构化摘要与详情**

验证：
- `WebSearch` 行内显示“Found/已搜索到 N 条结果”，详情以链接列表展示标题+snippet。
- `WebFetch` 详情展示页面链接 + HTTP/类型/截断状态。
- `rg_search` 详情展示 `path + line + matched content`。
- `list_dir/read_file` 详情展示目录项与读取摘要。

- [x] **Step 3: 多语言与性能约束**

验证：
- 文案复用 `APP_RUNTIME_STRINGS` / `APP_SHADCN_DICTIONARIES`，并补齐 diff 摘要多语言。
- 结构化详情仍在 trace detail 展开后渲染，不改虚拟列表主路径。
- 命令通过：

```bash
npm run typecheck
npm run test:chat-render
```

结果：
- 两个命令均通过（退出码 0）。

---

## Task 11: Dangerous Approval Trace Parity

**Files:**
- Modify: `src/renderer/src/features/chat/types.ts`
- Modify: `src/renderer/src/features/chat/messageViewModel.ts`
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`

**Goal:** 对齐 v1 中 bash 工具审批状态在工具轨迹行内的展示（已允许/本次对话已允许/已拒绝）和拒绝后“未执行”语义。

- [x] **Step 1: 汇总 turn 级审批状态**

验证：
- `messageViewModel` 收集 assistant `dangerousCommandApproval`，写入 `processStats.dangerousApprovals`。

- [x] **Step 2: 透传到工具轨迹组件**

验证：
- `ChatMessageRow` 向 `ToolTraceGroup` 传入 `dangerousApprovals`。

- [x] **Step 3: 行内徽标与拒绝语义**

验证：
- `ToolTraceGroup` 对 bash 命令匹配审批状态并展示对应徽标颜色/文案。
- 用户拒绝时状态显示 `notExecuted`（未执行）。

- [x] **Step 4: 回归验证**

命令：

```bash
npm run typecheck
npm run test:chat-render
```

结果：
- 两个命令均通过（退出码 0）。

---

## Task 6: Code Block And Summary Parity

**Files:**
- Modify: `src/renderer/src/features/chat/CodeBlockView.tsx`
- Modify: `src/renderer/src/features/chat/MarkdownContent.tsx`
- Modify: `src/renderer/src/AppShadcn.tsx`

**Goal:** 恢复 Mermaid、HTML/SVG 预览、摘要弹窗 Markdown，并补齐数学公式渲染与历史轮次过程展开。

- [x] **Step 1: Add Mermaid lazy render**

Requirement:
- `mermaid` code block is lazy rendered only when mounted.
- if render fails, fallback to `<pre>`.

- [x] **Step 2: Add HTML/SVG preview toggle**

Requirement:
- `html` and `svg` code blocks can switch between code and preview.
- preview only mounts after click.

- [x] **Step 3: Restore summary Markdown using v2 MarkdownContent**

Requirement:
- summary dialog uses `MarkdownContent`, not old `ReactMarkdown`.

- [x] **Step 4: Run typecheck and tests**

Commands:

```bash
npm run typecheck
npm run test:chat-render
```

Expected: both pass.

---

## Task 7: Final Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-chat-render-v2-parity-todo.md`

**Goal:** 用测试、构建和运行态证据证明补齐完成。

- [x] **Step 1: Run full verification**

Command:

```bash
npm run typecheck && npm run test:chat-render && npm run build
```

Expected: exit code 0.

- [x] **Step 2: Run static regression check**

Command:

```bash
rg -n "displayMessages\\.map|react-syntax-highlighter|<ReactMarkdown" src/renderer/src/AppShadcn.tsx src/renderer/src/features/chat
```

Expected: no old chat main-path matches.

- [x] **Step 3: Update overview**

Requirement:
- all task rows are `done`.
- every task has evidence.

---

## Task 19: Historical Process Collapse Animation Fix

**Files:**
- Modify: `src/renderer/src/features/chat/types.ts`
- Modify: `src/renderer/src/features/chat/messageViewModel.ts`
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Add: `src/renderer/src/features/chat/ProcessTurnBody.tsx`
- Modify: `tests/chatMessageViewModel.test.ts`

**Goal:** 修复历史 turn 的“过程摘要”收起时出现中间态闪动的问题，改为整块过程体统一折叠，而不是 assistant/tool 行分别折叠。

- [x] **Step 1: 聚合历史过程体为单独 row**

验证：
- `messageViewModel` 为历史 turn 生成 `process` row。
- `process` row 内的 `processBodyEntries` 聚合非最终 assistant 与 tool group。

- [x] **Step 2: 移除逐行动画并接入整块折叠**

验证：
- `ChatMessageRow` 不再依赖 `turnAnimationState`。
- 历史过程通过 `ProcessTurnBody + LazyDetails` 统一展开/收起。

- [x] **Step 3: 回归测试更新到新模型**

验证：
- `tests/chatMessageViewModel.test.ts` 改为断言 `summary row + process-body row + final assistant row`。

- [x] **Step 4: 运行验证**

命令：

```bash
npm run typecheck
npm run test:chat-render
```

结果：
- 两个命令均通过（退出码 0）。
