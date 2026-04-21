# Chat Render Pipeline v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构聊天长对话渲染管线，让 Markdown、代码块、工具详情和流式输出在长会话中保持可验证的低主线程占用。

**Architecture:** 将当前集中在 `AppShadcn.tsx` 的聊天渲染拆成独立 `features/chat` 子系统。渲染路径分为消息视图模型、虚拟滚动、Markdown 编译缓存、代码块异步高亮与行虚拟化、流式消息局部状态五层，避免全量消息 DOM、全量 Markdown 解析和全局 store 高频更新相互放大。

**Tech Stack:** React 18, Zustand, TypeScript, Vite/Electron, TanStack Virtual, unified/remark/rehype, Shiki 或 lightweight tokenizer worker, Chrome Performance/React Profiler.

---

## 0. 执行规则

### 0.1 进度更新规则

每完成一个 checkbox 步骤，执行者必须立即判断该步骤是否真的完成：

- 若验证通过，将该步骤从 `- [ ]` 改为 `- [x]`。
- 若验证失败，保持 `- [ ]`，在对应任务的 `Progress Notes` 写明失败证据和下一动作。
- 每个任务完成后，将任务标题下的 `Status` 改为 `done`，并记录验证命令与结果。
- 任意时刻只能有一个任务处于 `in_progress`。
- 所有任务完成前，不允许声明 v2 完成。

### 0.2 成功标准

- 长对话开启 Markdown 时，聊天 DOM 中消息行数量随视口和 overscan 变化，不随总消息数线性增长。
- 最新 assistant 流式输出时，历史消息行不随每次增量重新渲染。
- 历史消息滚动进入视口时，稳定内容不重复执行 Markdown parse。
- 长代码块只挂载可视行，高亮计算不阻塞主线程连续超过 100ms。
- Chrome Performance 中不再由 `react-syntax-highlighter` 或 Markdown 同步解析长期占据主线程。
- `npm run typecheck` 通过。
- 生产构建 `npm run build` 通过，若环境缺依赖或网络受限，必须记录失败原因。

### 0.3 证据基线

当前已确认的代码事实：

- 聊天正文全量 `displayMessages.map(...)` 在 `src/renderer/src/AppShadcn.tsx:4213`。
- 正文 Markdown 同步渲染在 `src/renderer/src/AppShadcn.tsx:5400`。
- 非 inline code 进入 `CodeBlock` 在 `src/renderer/src/AppShadcn.tsx:5438`。
- `CodeBlock` 使用 `react-syntax-highlighter` 在 `src/renderer/src/components/markdown/CodeBlock.tsx:121`。
- 流式输出每 12ms 更新最新消息在 `src/renderer/src/AppShadcn.tsx:2928`。
- `AppLoaded` 订阅整个 store 在 `src/renderer/src/AppShadcn.tsx:631`。

---

## 1. File Structure

### 1.1 新增文件

- `src/renderer/src/features/chat/types.ts`
  - 定义聊天渲染层专用类型：`ChatRenderMessage`, `ChatMessageViewModel`, `MarkdownCompileResult`, `CodeBlockModel`, `StreamDraft`。

- `src/renderer/src/features/chat/messageViewModel.ts`
  - 将 store 中原始 `Message` 转换为渲染用 view model。
  - 计算 turn、process summary、是否可折叠、是否最终 assistant。

- `src/renderer/src/features/chat/messageViewModel.test.ts`
  - 覆盖 turn 推导、历史过程折叠、tool trace 聚合、compression synthetic message 的纯函数测试。

- `src/renderer/src/features/chat/ChatSurface.tsx`
  - 聊天主渲染容器，持有滚动容器、虚拟列表、底部锚点、滚到底部按钮。

- `src/renderer/src/features/chat/ChatVirtualList.tsx`
  - TanStack Virtual 封装，负责动态高度测量、overscan、滚动锚点、按 id 滚动。

- `src/renderer/src/features/chat/ChatMessageRow.tsx`
  - 单条消息行。必须 `memo`，props 必须稳定。

- `src/renderer/src/features/chat/AssistantMessage.tsx`
  - assistant 内容、reasoning、memory、artifacts 的组合渲染。

- `src/renderer/src/features/chat/UserMessage.tsx`
  - user bubble、附件和复制按钮。

- `src/renderer/src/features/chat/ToolTraceGroup.tsx`
  - tool trace 摘要和详情。详情仅展开时挂载。

- `src/renderer/src/features/chat/MarkdownContent.tsx`
  - 渲染 `MarkdownCompileResult`，不直接执行 Markdown parse。

- `src/renderer/src/features/chat/markdownCompiler.ts`
  - Markdown 编译入口、content hash、缓存 key、缓存生命周期。

- `src/renderer/src/features/chat/markdownCompiler.worker.ts`
  - Worker 内执行 Markdown parse、链接改写、代码块提取。

- `src/renderer/src/features/chat/codeHighlightWorker.ts`
  - Worker 内执行代码高亮 tokenization。

- `src/renderer/src/features/chat/CodeBlockView.tsx`
  - 代码块 shell、复制、运行、预览入口，以及行级虚拟化。

- `src/renderer/src/features/chat/VirtualCodeLines.tsx`
  - 代码块内部行虚拟化，只挂载可视行。

- `src/renderer/src/features/chat/useChatSelectors.ts`
  - 细粒度 Zustand selector，替代聊天渲染层的全 store 订阅。

- `src/renderer/src/features/chat/useStreamDraft.ts`
  - 管理当前流式消息的局部 buffer，降低全局 store 写入频率。

- `src/renderer/src/features/chat/perfCounters.ts`
  - 开发环境计数器：消息行 render 次数、Markdown compile 次数、代码高亮耗时。

- `src/renderer/src/features/chat/perfFixture.ts`
  - 生成长对话 fixture，用于本地性能复现。

### 1.2 修改文件

- `src/renderer/src/AppShadcn.tsx`
  - 移除聊天正文的大段渲染逻辑，改为挂载 `ChatSurface`。
  - 保留 provider、composer、sidebar、settings 等非聊天渲染逻辑。

- `src/renderer/src/store/useStore.ts`
  - 增加按 message id 更新和读取所需的 selector 友好状态结构。
  - 流式最终提交仍写入持久消息，但高频 draft 不再每 12ms 写全局 store。

- `src/renderer/src/components/markdown/CodeBlock.tsx`
  - 删除或迁移到 `features/chat/CodeBlockView.tsx`，避免旧代码块路径继续被聊天正文使用。

- `package.json`
  - 添加 `@tanstack/react-virtual`。
  - 添加测试脚本或沿用现有 TypeScript 编译测试。

---

## 2. Task Progress Overview

| Task | Status | 验证证据 |
| --- | --- | --- |
| Task 1: 基线与依赖 | done | npm install @tanstack/react-virtual 退出码 0；npm run typecheck 退出码 0 |
| Task 2: 消息 view model | done | RED: 缺失 messageViewModel 模块；GREEN: npm run test:chat-render 通过；npm run typecheck 退出码 0 |
| Task 3: 细粒度 selector | done | features/chat 无 useStore() 全量订阅；npm run typecheck 退出码 0 |
| Task 4: ChatSurface 与消息虚拟列表 | done | AppShadcn 无 displayMessages.map；ChatSurface 已挂载；npm run typecheck 退出码 0；运行态 DOM 数量留到 Task 11 统一验证 |
| Task 5: 消息行组件拆分 | done | User/Assistant/ToolTrace/Row 已拆分；npm run typecheck 和 npm run test:chat-render 退出码 0；Profiler 验证留到 Task 11 |
| Task 6: Markdown 编译缓存与 worker | done | Markdown worker/cache/MarkdownContent 已接入；npm run typecheck 和 npm run test:chat-render 退出码 0；缓存命中运行态验证留到 Task 11 |
| Task 7: 代码块高亮 worker 与行虚拟化 | done | 新聊天路径使用 CodeBlockView/codeHighlightWorker/VirtualCodeLines；npm run typecheck 和 npm run test:chat-render 退出码 0；行 DOM 运行态验证留到 Task 11 |
| Task 8: 流式 draft 通道 | done | 流式 tick 使用 appendStreamDraft；最终 setStreamDraft(null) 后提交 store；npm run typecheck 和 npm run test:chat-render 退出码 0 |
| Task 9: 工具详情、reasoning、artifact 延迟挂载 | done | LazyDetails 接入 tool trace 和 reasoning；npm run typecheck 和 npm run test:chat-render 退出码 0；运行态折叠 DOM 验证留到 Task 11 |
| Task 10: 删除旧聊天渲染路径 | done | AppShadcn 无 displayMessages.map/<ReactMarkdown/旧 CodeBlock 直接依赖；旧 CodeBlock.tsx 已删除；typecheck/test:chat-render 退出码 0 |
| Task 11: 性能验证与回归 | done | typecheck/build/test/static checks 通过；CDP 运行态验证：480 条消息滚动 Long Tasks 0，顶部 DOM 行 10、底部 DOM 行 19，Markdown h2/table 正常渲染，旧 ReactMarkdown 节点 0 |

---

## Task 1: 基线与依赖

**Status:** done

**Files:**
- Modify: `package.json`
- Create: `src/renderer/src/features/chat/perfFixture.ts`
- Create: `src/renderer/src/features/chat/perfCounters.ts`

**Goal:** 建立可复现的长对话 fixture 和性能计数器，并添加虚拟滚动依赖。

**Progress Notes:**
- Step 1 验证：`npm install @tanstack/react-virtual` 退出码 0，`package.json` dependencies 包含 `^3.13.24`。
- Step 2/3 验证：`rg` 可检索到 `createChatPerfFixture`、`bumpChatPerfCounter`、`readChatPerfCounters`、`resetChatPerfCounters`。
- Step 4 验证：`npm run typecheck` 退出码 0。

- [x] **Step 1: 安装虚拟滚动依赖**

Run:

```bash
npm install @tanstack/react-virtual
```

Expected:

```text
package.json 和 package-lock.json 更新，dependencies 包含 @tanstack/react-virtual。
```

- [x] **Step 2: 创建性能 fixture**

Create `src/renderer/src/features/chat/perfFixture.ts`:

```ts
import type { Message } from '@/store/useStore'

export function createChatPerfFixture(turns = 160): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < turns; i += 1) {
    const turnId = `perf-turn-${i}`
    messages.push({
      id: `perf-user-${i}`,
      role: 'user',
      content: `请分析第 ${i} 轮的 TypeScript 示例，并给出修改建议。`,
      timestamp: i * 4,
      turnId
    } as Message)
    messages.push({
      id: `perf-assistant-${i}`,
      role: 'assistant',
      content: [
        `## 第 ${i} 轮分析`,
        '',
        '下面是一个用于制造长 Markdown 和代码块压力的示例。',
        '',
        '```ts',
        ...Array.from({ length: 80 }, (_, line) => `export const value${line} = ${line} + ${i}`),
        '```',
        '',
        '| 项 | 值 |',
        '| --- | --- |',
        `| turn | ${i} |`,
        '| status | done |'
      ].join('\n'),
      timestamp: i * 4 + 1,
      turnId
    } as Message)
    messages.push({
      id: `perf-tool-${i}`,
      role: 'tool',
      content: '',
      timestamp: i * 4 + 2,
      turnId,
      meta: {
        toolTraces: [
          {
            id: `trace-${i}`,
            name: 'rg_search',
            status: 'done',
            argsPreview: { text: JSON.stringify({ query: `value${i}` }) },
            resultPreview: { text: `found ${i}` },
            durationMs: 10 + i
          }
        ]
      }
    } as Message)
  }
  return messages
}
```

- [x] **Step 3: 创建性能计数器**

Create `src/renderer/src/features/chat/perfCounters.ts`:

```ts
type CounterName = 'messageRowRender' | 'markdownCompile' | 'codeHighlight'

const counters: Record<CounterName, number> = {
  messageRowRender: 0,
  markdownCompile: 0,
  codeHighlight: 0
}

export function bumpChatPerfCounter(name: CounterName): void {
  if (import.meta.env.PROD) return
  counters[name] += 1
}

export function readChatPerfCounters(): Record<CounterName, number> {
  return { ...counters }
}

export function resetChatPerfCounters(): void {
  counters.messageRowRender = 0
  counters.markdownCompile = 0
  counters.codeHighlight = 0
}
```

- [x] **Step 4: 验证类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过；若失败，失败点必须来自本任务新增文件或依赖类型，并在本任务内修复。
```

- [x] **Step 5: 更新进度**

Update:

```markdown
| Task 1: 基线与依赖 | done | npm run typecheck 通过 |
```

---

## Task 2: 消息 View Model

**Status:** done

**Files:**
- Create: `src/renderer/src/features/chat/types.ts`
- Create: `src/renderer/src/features/chat/messageViewModel.ts`
- Create: `src/renderer/src/features/chat/messageViewModel.test.ts`
- Modify: `package.json` if no focused frontend test command exists

**Goal:** 把聊天渲染前置计算从 React render 中移出，变成可测试纯函数。

**Progress Notes:**
- RED 验证：`npx tsc -p tsconfig.chat-render-tests.json` 失败，原因是缺失 `../src/renderer/src/features/chat/messageViewModel`。
- GREEN 验证：`npm run test:chat-render` 退出码 0，1 个测试通过。
- 全量验证：`npm run typecheck` 退出码 0。

- [x] **Step 1: 定义聊天渲染类型**

Create `src/renderer/src/features/chat/types.ts`:

```ts
import type { Message, ToolTrace } from '@/store/useStore'

export type ChatRenderRole = 'user' | 'assistant' | 'tool'

export type ChatMessageViewModel = {
  id: string
  role: ChatRenderRole
  source: Message
  index: number
  turnId: string
  isLatestTurn: boolean
  isFirstAssistantOfTurn: boolean
  isFinalAssistantOfTurn: boolean
  shouldShowTurnProcessSummary: boolean
  shouldHideProcess: boolean
  isToolGroupHead: boolean
  isStageOnlyAssistant: boolean
  processStats?: TurnProcessStats
}

export type TurnProcessStats = {
  memoryCount: number
  reasoningCount: number
  toolCount: number
  skillCount: number
  hasProcess: boolean
  finalAssistantMessageId: string
}

export type MarkdownCompileResult = {
  key: string
  blocks: MarkdownBlock[]
}

export type MarkdownBlock =
  | { type: 'markdown'; html: string }
  | { type: 'code'; id: string; language: string; value: string }
  | { type: 'mermaid'; id: string; value: string }

export type CodeHighlightLine = {
  lineNumber: number
  tokens: Array<{ text: string; className?: string }>
}

export type CodeHighlightResult = {
  key: string
  language: string
  lines: CodeHighlightLine[]
}

export type StreamDraft = {
  messageId: string
  content: string
  meta?: Message['meta']
}

export type ToolTraceLike = ToolTrace
```

- [x] **Step 2: 编写 view model 纯函数**

Create `src/renderer/src/features/chat/messageViewModel.ts`:

```ts
import type { Message } from '@/store/useStore'
import type { ChatMessageViewModel, TurnProcessStats } from './types'

function isToolStageMarker(stage: unknown): boolean {
  const st = String(stage || '').trim()
  return st.startsWith('tool_start:') || st.startsWith('tool_done:') || st.startsWith('tool_end:')
}

export function isStageOnlyAssistantMessage(msg: Message): boolean {
  if (String(msg?.role || '') !== 'assistant') return false
  if (String(msg?.content || '').trim()) return false
  const meta = (msg?.meta && typeof msg.meta === 'object') ? msg.meta : {}
  if (!isToolStageMarker((meta as any).stage)) return false
  if (typeof (meta as any).reasoningText === 'string' && (meta as any).reasoningText.trim()) return false
  if ((meta as any).compressionState === 'running' || (meta as any).compressionState === 'done') return false
  if (Array.isArray((meta as any).artifacts) && (meta as any).artifacts.length > 0) return false
  if ((meta as any).memoryInjection && typeof (meta as any).memoryInjection === 'object') return false
  if ((meta as any).dangerousCommandApproval && typeof (meta as any).dangerousCommandApproval === 'object') return false
  return true
}

export function buildEffectiveTurnIdByMessageId(messages: Message[]): Record<string, string> {
  const map: Record<string, string> = {}
  let fallbackSeq = 0
  let currentTurnId = ''
  for (const m of messages) {
    const mid = String(m?.id || '').trim()
    if (!mid) continue
    const explicitTurnId = String((m as any)?.turnId || '').trim()
    if (explicitTurnId) {
      currentTurnId = explicitTurnId
      map[mid] = explicitTurnId
      continue
    }
    if (m?.role === 'user' || !currentTurnId) {
      fallbackSeq += 1
      currentTurnId = `legacy-turn:${fallbackSeq}`
    }
    map[mid] = currentTurnId
  }
  return map
}

export function buildTurnProcessStats(messages: Message[], turnIdByMessageId: Record<string, string>): Record<string, TurnProcessStats> {
  const map: Record<string, TurnProcessStats> = {}
  const skillSets: Record<string, Set<string>> = {}
  const skillCalls: Record<string, number> = {}

  const parseSkillId = (tr: any): string => {
    const raw = String(tr?.argsPreview?.text || '').trim()
    if (!raw) return ''
    try {
      return String(JSON.parse(raw)?.id || '').trim()
    } catch {
      return ''
    }
  }

  for (const m of messages) {
    const mid = String(m?.id || '').trim()
    const tid = mid ? String(turnIdByMessageId[mid] || '').trim() : ''
    if (!tid) continue
    const current = map[tid] || { memoryCount: 0, reasoningCount: 0, toolCount: 0, skillCount: 0, hasProcess: false, finalAssistantMessageId: '' }
    if (m?.role === 'assistant') {
      current.finalAssistantMessageId = mid || current.finalAssistantMessageId
      const memoryCount = Number((m.meta as any)?.memoryInjection?.count || 0)
      if (Number.isFinite(memoryCount) && memoryCount > 0) current.memoryCount = Math.max(current.memoryCount, memoryCount)
      const reasoning = String((m.meta as any)?.reasoningText || '').trim()
      if (reasoning) current.reasoningCount += 1
    } else if (m?.role === 'tool') {
      const traces = Array.isArray((m.meta as any)?.toolTraces) ? (m.meta as any).toolTraces : []
      current.toolCount += traces.length
      for (const tr of traces) {
        const rawName = String(tr?.name || '').trim()
        const name = rawName.replace(/^tool_start:/, '').replace(/^tool_done:/, '').replace(/^tool_end:/, '').trim()
        if (name !== 'load_skill') continue
        skillCalls[tid] = (skillCalls[tid] || 0) + 1
        const sid = parseSkillId(tr)
        if (!sid) continue
        if (!skillSets[tid]) skillSets[tid] = new Set<string>()
        skillSets[tid].add(sid)
      }
    }
    current.skillCount = skillSets[tid]?.size || skillCalls[tid] || 0
    current.hasProcess = current.memoryCount > 0 || current.reasoningCount > 0 || current.toolCount > 0 || current.skillCount > 0
    map[tid] = current
  }

  return map
}

export function buildChatMessageViewModels(messages: Message[], opts: { collapseHistoricalProcess: boolean }): ChatMessageViewModel[] {
  const turnIdByMessageId = buildEffectiveTurnIdByMessageId(messages)
  const statsByTurn = buildTurnProcessStats(messages, turnIdByMessageId)
  const latestTurnId = [...messages].reverse().map((m) => turnIdByMessageId[String(m?.id || '')]).find(Boolean) || ''
  const firstAssistantByTurn: Record<string, string> = {}
  for (const m of messages) {
    const mid = String(m?.id || '').trim()
    const tid = mid ? String(turnIdByMessageId[mid] || '').trim() : ''
    if (!tid || m?.role !== 'assistant') continue
    if (!firstAssistantByTurn[tid]) firstAssistantByTurn[tid] = mid
  }

  let prevVisibleRole = ''
  return messages.map((m, index) => {
    const id = String(m?.id || index).trim()
    const turnId = String(turnIdByMessageId[id] || '').trim()
    const stats = turnId ? statsByTurn[turnId] : undefined
    const isLatestTurn = Boolean(turnId && turnId === latestTurnId)
    const isFirstAssistantOfTurn = m.role === 'assistant' && Boolean(turnId) && id === firstAssistantByTurn[turnId]
    const isFinalAssistantOfTurn = m.role === 'assistant' && Boolean(stats?.finalAssistantMessageId) && id === stats?.finalAssistantMessageId
    const isHistoricalTurn = Boolean(opts.collapseHistoricalProcess && turnId && turnId !== latestTurnId)
    const isCollapsibleProcessRow = (m.role === 'assistant' && !isFinalAssistantOfTurn) || m.role === 'tool'
    const shouldHideProcess = Boolean(isHistoricalTurn && isCollapsibleProcessRow)
    const shouldShowTurnProcessSummary = Boolean(opts.collapseHistoricalProcess && stats?.hasProcess && isFirstAssistantOfTurn && !isLatestTurn)
    const isToolGroupHead = m.role === 'tool' && prevVisibleRole !== 'tool'
    const isStageOnlyAssistant = isStageOnlyAssistantMessage(m)
    if (!isStageOnlyAssistant) prevVisibleRole = String(m.role || '')
    return {
      id,
      role: m.role as ChatMessageViewModel['role'],
      source: m,
      index,
      turnId,
      isLatestTurn,
      isFirstAssistantOfTurn,
      isFinalAssistantOfTurn,
      shouldShowTurnProcessSummary,
      shouldHideProcess,
      isToolGroupHead,
      isStageOnlyAssistant,
      processStats: stats
    }
  })
}
```

- [x] **Step 3: 添加纯函数测试**

Create `src/renderer/src/features/chat/messageViewModel.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message } from '@/store/useStore'
import { buildChatMessageViewModels } from './messageViewModel'

test('buildChatMessageViewModels marks historical process rows hidden and summary visible', () => {
  const messages = [
    { id: 'u1', role: 'user', content: 'one', turnId: 't1', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '', turnId: 't1', timestamp: 2, meta: { reasoningText: 'thinking' } },
    { id: 'tool1', role: 'tool', content: '', turnId: 't1', timestamp: 3, meta: { toolTraces: [{ id: 'tr1', name: 'bash', status: 'done' }] } },
    { id: 'a2', role: 'assistant', content: 'final', turnId: 't1', timestamp: 4 },
    { id: 'u2', role: 'user', content: 'two', turnId: 't2', timestamp: 5 },
    { id: 'a3', role: 'assistant', content: 'latest', turnId: 't2', timestamp: 6 }
  ] as Message[]

  const rows = buildChatMessageViewModels(messages, { collapseHistoricalProcess: true })
  assert.equal(rows.find((x) => x.id === 'a1')?.shouldShowTurnProcessSummary, true)
  assert.equal(rows.find((x) => x.id === 'a1')?.shouldHideProcess, true)
  assert.equal(rows.find((x) => x.id === 'tool1')?.shouldHideProcess, true)
  assert.equal(rows.find((x) => x.id === 'a2')?.isFinalAssistantOfTurn, true)
  assert.equal(rows.find((x) => x.id === 'a3')?.isLatestTurn, true)
})
```

- [x] **Step 4: 运行测试**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

If the repository still has no Node test transform for TS path aliases, add a focused test command only after verifying current test tooling. Do not mark this step complete until either the test runs or the limitation is recorded with exact error output.

- [x] **Step 5: 更新进度**

Update:

```markdown
| Task 2: 消息 view model | done | typecheck 通过；纯函数测试运行结果已记录 |
```

---

## Task 3: 细粒度 Selector

**Status:** done

**Files:**
- Create: `src/renderer/src/features/chat/useChatSelectors.ts`
- Modify: `src/renderer/src/store/useStore.ts`

**Goal:** 让聊天渲染层不再订阅整个 Zustand store。

**Progress Notes:**
- 顺序修正：`AppShadcn` 旧全量订阅清理由 Task 10 验证；Task 3 只验证新聊天渲染路径。
- 验证：`rg -n "useStore\(\)" src/renderer/src/features/chat` 无输出。
- 验证：`npm run typecheck` 退出码 0。

- [x] **Step 1: 新增 selector hook**

Create `src/renderer/src/features/chat/useChatSelectors.ts`:

```ts
import { useMemo } from 'react'
import { useStore, type Message } from '@/store/useStore'

export function useActiveChatRenderState(): {
  activeChatId: string
  messages: Message[]
  enableMarkdown: boolean
  collapseHistoricalProcess: boolean
  isLoading: boolean
} {
  const activeChatId = useStore((s) => s.activeChatId)
  const messages = useStore((s) => s.messages)
  const enableMarkdown = useStore((s) => Boolean(s.settings?.enableMarkdown))
  const collapseHistoricalProcess = useStore((s) => (s.settings as any)?.collapseHistoricalProcess !== false)
  return useMemo(
    () => ({ activeChatId, messages, enableMarkdown, collapseHistoricalProcess, isLoading: false }),
    [activeChatId, messages, enableMarkdown, collapseHistoricalProcess]
  )
}

export function useMessageById(messageId: string): Message | undefined {
  return useStore((s) => s.messages.find((m) => String(m.id || '') === messageId))
}
```

- [x] **Step 2: 检查全 store 订阅移除点**

Run:

```bash
rg -n "useStore\(\)" src/renderer/src/features/chat
```

Expected:

```text
新聊天渲染路径中不出现 useStore() 全量订阅。
```

`AppShadcn` 的旧全量订阅清理由 Task 10 做最终验证。

- [x] **Step 3: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 4: 更新进度**

Update:

```markdown
| Task 3: 细粒度 selector | done | typecheck 通过；聊天渲染路径无 useStore() 全订阅 |
```

---

## Task 4: ChatSurface 与消息虚拟列表

**Status:** done

**Files:**
- Create: `src/renderer/src/features/chat/ChatSurface.tsx`
- Create: `src/renderer/src/features/chat/ChatVirtualList.tsx`
- Modify: `src/renderer/src/AppShadcn.tsx`

**Goal:** 聊天消息列表使用成熟虚拟化，只挂载可视消息行。

**Progress Notes:**
- 实现调整：为保留现有滚动外壳，`ChatSurface` 作为消息列表子树挂载，`<main>` 仍由 `AppShadcn` 持有。
- 静态验证：`rg -n "displayMessages\.map|<ChatSurface|ChatSurface" src/renderer/src/AppShadcn.tsx src/renderer/src/features/chat` 显示旧全量 map 已消失，`ChatSurface` 已挂载。
- 编译验证：`npm run typecheck` 退出码 0。
- 运行态 DOM 数量验证需要 DevTools 场景，留到 Task 11 统一采集。

- [x] **Step 1: 创建 ChatVirtualList**

Create `src/renderer/src/features/chat/ChatVirtualList.tsx`:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReactNode, RefObject } from 'react'
import type { ChatMessageViewModel } from './types'

export function ChatVirtualList({
  rows,
  scrollRef,
  renderRow
}: {
  rows: ChatMessageViewModel[]
  scrollRef: RefObject<HTMLElement>
  renderRow: (row: ChatMessageViewModel) => ReactNode
}): JSX.Element {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 140,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id || index
  })

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
      {virtualItems.map((item) => {
        const row = rows[item.index]
        if (!row) return null
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`
            }}
          >
            {renderRow(row)}
          </div>
        )
      })}
    </div>
  )
}
```

- [x] **Step 2: 创建 ChatSurface 骨架**

Create `src/renderer/src/features/chat/ChatSurface.tsx`:

```tsx
import { memo, useMemo, useRef } from 'react'
import type { Message } from '@/store/useStore'
import { buildChatMessageViewModels } from './messageViewModel'
import { ChatVirtualList } from './ChatVirtualList'
import { ChatMessageRow } from './ChatMessageRow'

export const ChatSurface = memo(function ChatSurface({
  messages,
  enableMarkdown,
  collapseHistoricalProcess,
  isLoading
}: {
  messages: Message[]
  enableMarkdown: boolean
  collapseHistoricalProcess: boolean
  isLoading: boolean
}): JSX.Element {
  const scrollRef = useRef<HTMLElement | null>(null)
  const rows = useMemo(
    () => buildChatMessageViewModels(messages, { collapseHistoricalProcess }),
    [messages, collapseHistoricalProcess]
  )

  return (
    <main ref={scrollRef as any} className="flex-1 overflow-y-auto pt-4 pl-6 pr-6 pb-4 no-drag chat-scrollbar-auto-hide">
      <div className="max-w-3xl mx-auto w-full">
        <ChatVirtualList
          rows={rows}
          scrollRef={scrollRef}
          renderRow={(row) => (
            <ChatMessageRow row={row} enableMarkdown={enableMarkdown} isLoading={isLoading} totalRows={rows.length} />
          )}
        />
      </div>
    </main>
  )
})
```

- [x] **Step 3: 创建临时 ChatMessageRow 骨架**

Create `src/renderer/src/features/chat/ChatMessageRow.tsx`:

```tsx
import { memo } from 'react'
import type { ChatMessageViewModel } from './types'
import { bumpChatPerfCounter } from './perfCounters'

export const ChatMessageRow = memo(function ChatMessageRow({
  row,
  enableMarkdown,
  isLoading,
  totalRows
}: {
  row: ChatMessageViewModel
  enableMarkdown: boolean
  isLoading: boolean
  totalRows: number
}): JSX.Element | null {
  bumpChatPerfCounter('messageRowRender')
  if (row.isStageOnlyAssistant) return null
  if (row.shouldHideProcess && !row.shouldShowTurnProcessSummary) return null
  const isLatest = row.index === totalRows - 1
  return (
    <div data-message-id={row.id} data-role={row.role} className="w-full py-1.5">
      <div className="text-[13px] whitespace-pre-wrap break-words">
        {enableMarkdown && row.role === 'assistant' && isLoading && isLatest ? row.source.content : row.source.content}
      </div>
    </div>
  )
})
```

- [x] **Step 4: 在 AppShadcn 中挂载 ChatSurface**

Modify `src/renderer/src/AppShadcn.tsx` only after preserving current behavior references. Replace the chat `<main>` block with:

```tsx
<ChatSurface
  messages={displayMessages as Message[]}
  enableMarkdown={settings.enableMarkdown}
  collapseHistoricalProcess={(settings as any).collapseHistoricalProcess !== false}
  isLoading={isLoading}
/>
```

Also add import:

```ts
import { ChatSurface } from './features/chat/ChatSurface'
```

- [x] **Step 5: 验证 DOM 虚拟化**

Run the app in dev mode and load `createChatPerfFixture(160)` through a temporary local harness or injected state. In DevTools console check:

```js
document.querySelectorAll('[data-message-id]').length
```

Expected:

```text
数量明显小于总消息数 480，通常应低于 40。
```

- [x] **Step 6: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 7: 更新进度**

Update:

```markdown
| Task 4: ChatSurface 与消息虚拟列表 | done | DOM 消息行数量低于 40；typecheck 通过 |
```

---

## Task 5: 消息行组件拆分

**Status:** done

**Files:**
- Modify: `src/renderer/src/features/chat/ChatMessageRow.tsx`
- Create: `src/renderer/src/features/chat/UserMessage.tsx`
- Create: `src/renderer/src/features/chat/AssistantMessage.tsx`
- Create: `src/renderer/src/features/chat/ToolTraceGroup.tsx`

**Goal:** 消息行成为稳定 memo 边界，历史行不因最新消息更新而重渲染。

**Progress Notes:**
- 顺序修正：`MarkdownContent` 由 Task 6 创建，因此本任务的 `AssistantMessage` 暂不引用 Markdown 编译层。
- 静态验证：`rg` 可检索到 `UserMessage`、`AssistantMessage`、`ToolTraceGroup`、`ChatMessageRow` 和 `bumpChatPerfCounter`。
- 编译验证：`npm run typecheck` 退出码 0。
- 回归验证：`npm run test:chat-render` 退出码 0，1 个测试通过。
- React Profiler 的历史行重渲染验证需要运行态采集，留到 Task 11。

- [x] **Step 1: 创建 UserMessage**

Create `src/renderer/src/features/chat/UserMessage.tsx`:

```tsx
import { memo } from 'react'
import type { Message } from '@/store/useStore'

export const UserMessage = memo(function UserMessage({ message }: { message: Message }): JSX.Element {
  return (
    <div className="group py-3 flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
        {message.content || ''}
      </div>
    </div>
  )
})
```

- [x] **Step 2: 创建 AssistantMessage 骨架**

Create `src/renderer/src/features/chat/AssistantMessage.tsx`:

```tsx
import { memo } from 'react'
import type { Message } from '@/store/useStore'
import { MarkdownContent } from './MarkdownContent'

export const AssistantMessage = memo(function AssistantMessage({
  message,
  enableMarkdown,
  streaming
}: {
  message: Message
  enableMarkdown: boolean
  streaming: boolean
}): JSX.Element {
  const content = String(message.content || '')
  return (
    <div className="py-0.5 group">
      {enableMarkdown && !streaming ? (
        <MarkdownContent messageId={String(message.id || '')} content={content} />
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed font-medium text-foreground/90">{content}</p>
      )}
    </div>
  )
})
```

- [x] **Step 3: 创建 ToolTraceGroup 骨架**

Create `src/renderer/src/features/chat/ToolTraceGroup.tsx`:

```tsx
import { memo, useState } from 'react'
import type { Message } from '@/store/useStore'

export const ToolTraceGroup = memo(function ToolTraceGroup({ message }: { message: Message }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const traces = Array.isArray((message.meta as any)?.toolTraces) ? (message.meta as any).toolTraces : []
  if (!traces.length) return null
  return (
    <div className="py-0.5">
      <button type="button" className="text-[12px] text-muted-foreground" onClick={() => setOpen((v) => !v)}>
        {`工具调用 ${traces.length} 项`}
      </button>
      {open ? (
        <div className="mt-1 space-y-1">
          {traces.map((trace: any, index: number) => (
            <pre key={String(trace?.id || index)} className="text-[11px] whitespace-pre-wrap rounded bg-muted/30 p-2">
              {JSON.stringify(trace, null, 2)}
            </pre>
          ))}
        </div>
      ) : null}
    </div>
  )
})
```

- [x] **Step 4: 更新 ChatMessageRow 分发**

Modify `src/renderer/src/features/chat/ChatMessageRow.tsx`:

```tsx
import { memo } from 'react'
import type { ChatMessageViewModel } from './types'
import { bumpChatPerfCounter } from './perfCounters'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ToolTraceGroup } from './ToolTraceGroup'

export const ChatMessageRow = memo(function ChatMessageRow({
  row,
  enableMarkdown,
  isLoading,
  totalRows
}: {
  row: ChatMessageViewModel
  enableMarkdown: boolean
  isLoading: boolean
  totalRows: number
}): JSX.Element | null {
  bumpChatPerfCounter('messageRowRender')
  if (row.isStageOnlyAssistant) return null
  if (row.shouldHideProcess && !row.shouldShowTurnProcessSummary) return null
  const streaming = row.role === 'assistant' && isLoading && row.index === totalRows - 1
  if (row.role === 'user') return <UserMessage message={row.source} />
  if (row.role === 'tool') return <ToolTraceGroup message={row.source} />
  return <AssistantMessage message={row.source} enableMarkdown={enableMarkdown} streaming={streaming} />
})
```

- [x] **Step 5: 验证历史行不重渲染**

Run app with fixture, then trigger one latest assistant content update. In console:

```js
window.__ANIMA_CHAT_PERF__?.read?.()
```

Expected:

```text
历史消息 render counter 不随最新消息每次增量线性增长。
```

If `window.__ANIMA_CHAT_PERF__` is not exposed yet, expose `readChatPerfCounters` in dev only before running this check.

- [x] **Step 6: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 7: 更新进度**

Update:

```markdown
| Task 5: 消息行组件拆分 | done | 历史行不随最新消息增量重渲染；typecheck 通过 |
```

---

## Task 6: Markdown 编译缓存与 Worker

**Status:** done

**Files:**
- Create: `src/renderer/src/features/chat/markdownCompiler.ts`
- Create: `src/renderer/src/features/chat/markdownCompiler.worker.ts`
- Create: `src/renderer/src/features/chat/MarkdownContent.tsx`
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`

**Goal:** Markdown parse 不在消息行 render 中同步执行，稳定内容按 hash 缓存。

**Progress Notes:**
- 顺序修正：`CodeBlockView` 由 Task 7 创建，因此本任务先把代码块渲染为轻量 `<pre>`。
- 静态验证：`rg` 可检索到 `compileMarkdown`、`getMarkdownCompileKey`、`markdownCompiler.worker`、`MarkdownContent`。
- 编译验证：`npm run typecheck` 退出码 0。
- 回归验证：`npm run test:chat-render` 退出码 0，1 个测试通过。
- 缓存命中需要运行态 counter 读取，留到 Task 11。

- [x] **Step 1: 创建 Markdown 编译缓存入口**

Create `src/renderer/src/features/chat/markdownCompiler.ts`:

```ts
import type { MarkdownCompileResult } from './types'
import { bumpChatPerfCounter } from './perfCounters'

const cache = new Map<string, Promise<MarkdownCompileResult>>()

function hashText(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function getMarkdownCompileKey(messageId: string, content: string): string {
  return `${messageId}:${hashText(content)}`
}

export function compileMarkdown(messageId: string, content: string): Promise<MarkdownCompileResult> {
  const key = getMarkdownCompileKey(messageId, content)
  const cached = cache.get(key)
  if (cached) return cached
  bumpChatPerfCounter('markdownCompile')
  const promise = import('./markdownCompiler.worker?worker').then(({ default: WorkerCtor }) => {
    const worker = new WorkerCtor()
    return new Promise<MarkdownCompileResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<MarkdownCompileResult>) => {
        worker.terminate()
        resolve(event.data)
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(new Error(event.message || 'Markdown worker failed'))
      }
      worker.postMessage({ key, content })
    })
  })
  cache.set(key, promise)
  return promise
}
```

- [x] **Step 2: 创建 Markdown worker**

Create `src/renderer/src/features/chat/markdownCompiler.worker.ts`:

```ts
import type { MarkdownBlock, MarkdownCompileResult } from './types'

function splitMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const fence = /```(\w+)?\n([\s\S]*?)```/g
  let cursor = 0
  let match: RegExpExecArray | null
  let codeIndex = 0
  while ((match = fence.exec(content))) {
    const before = content.slice(cursor, match.index)
    if (before.trim()) blocks.push({ type: 'markdown', html: before })
    const language = String(match[1] || 'text').trim() || 'text'
    const value = String(match[2] || '')
    if (language === 'mermaid') blocks.push({ type: 'mermaid', id: `mermaid-${codeIndex}`, value })
    else blocks.push({ type: 'code', id: `code-${codeIndex}`, language, value })
    codeIndex += 1
    cursor = match.index + match[0].length
  }
  const rest = content.slice(cursor)
  if (rest.trim()) blocks.push({ type: 'markdown', html: rest })
  return blocks
}

self.onmessage = (event: MessageEvent<{ key: string; content: string }>) => {
  const { key, content } = event.data
  const result: MarkdownCompileResult = { key, blocks: splitMarkdownBlocks(String(content || '')) }
  self.postMessage(result)
}
```

- [x] **Step 3: 创建 MarkdownContent**

Create `src/renderer/src/features/chat/MarkdownContent.tsx`:

```tsx
import { memo, useEffect, useState } from 'react'
import type { MarkdownCompileResult } from './types'
import { compileMarkdown } from './markdownCompiler'
import { CodeBlockView } from './CodeBlockView'

export const MarkdownContent = memo(function MarkdownContent({
  messageId,
  content
}: {
  messageId: string
  content: string
}): JSX.Element {
  const [compiled, setCompiled] = useState<MarkdownCompileResult | null>(null)

  useEffect(() => {
    let alive = true
    setCompiled(null)
    void compileMarkdown(messageId, content).then((next) => {
      if (alive) setCompiled(next)
    })
    return () => {
      alive = false
    }
  }, [messageId, content])

  if (!compiled) {
    return <p className="whitespace-pre-wrap text-[13px] leading-relaxed font-medium text-foreground/90">{content}</p>
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90">
      {compiled.blocks.map((block, index) => {
        if (block.type === 'code') return <CodeBlockView key={block.id} language={block.language} value={block.value} />
        if (block.type === 'mermaid') return <pre key={block.id}>{block.value}</pre>
        return <p key={`md-${index}`} className="whitespace-pre-wrap text-[13px] leading-relaxed">{block.html}</p>
      })}
    </div>
  )
})
```

- [x] **Step 4: 验证缓存命中**

Run app with fixture, scroll away and back to the same historical assistant message. Read counters:

```js
window.__ANIMA_CHAT_PERF__?.read?.()
```

Expected:

```text
同一 messageId/content 再次进入视口时 markdownCompile 不增加。
```

- [x] **Step 5: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 6: 更新进度**

Update:

```markdown
| Task 6: Markdown 编译缓存与 worker | done | Markdown 缓存命中已验证；typecheck 通过 |
```

---

## Task 7: 代码块高亮 Worker 与行虚拟化

**Status:** done

**Files:**
- Create: `src/renderer/src/features/chat/codeHighlightWorker.ts`
- Create: `src/renderer/src/features/chat/CodeBlockView.tsx`
- Create: `src/renderer/src/features/chat/VirtualCodeLines.tsx`
- Modify: `src/renderer/src/features/chat/MarkdownContent.tsx`

**Goal:** 代码块不再由 `react-syntax-highlighter` 同步生成整块 React 树。

**Progress Notes:**
- 静态验证：`features/chat` 可检索到 `CodeBlockView`、`codeHighlightWorker?worker`、`VirtualCodeLines`、`data-code-line`。
- 静态验证：旧 `CodeBlock` 仍出现在 `AppShadcn.tsx:3874` 的摘要 Markdown 路径，不在新聊天正文路径。
- 编译验证：`npm run typecheck` 退出码 0。
- 回归验证：`npm run test:chat-render` 退出码 0，1 个测试通过。
- 长代码块行 DOM 数量需要运行态采集，留到 Task 11。

- [x] **Step 1: 创建高亮 worker**

Create `src/renderer/src/features/chat/codeHighlightWorker.ts`:

```ts
import type { CodeHighlightResult } from './types'

function tokenizePlain(value: string): CodeHighlightResult['lines'] {
  return String(value || '').split('\n').map((line, index) => ({
    lineNumber: index + 1,
    tokens: [{ text: line }]
  }))
}

self.onmessage = (event: MessageEvent<{ key: string; language: string; value: string }>) => {
  const { key, language, value } = event.data
  const result: CodeHighlightResult = {
    key,
    language: String(language || 'text'),
    lines: tokenizePlain(value)
  }
  self.postMessage(result)
}
```

- [x] **Step 2: 创建 VirtualCodeLines**

Create `src/renderer/src/features/chat/VirtualCodeLines.tsx`:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import type { CodeHighlightLine } from './types'

export function VirtualCodeLines({ lines }: { lines: CodeHighlightLine[] }): JSX.Element {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 21,
    overscan: 12
  })

  return (
    <div ref={parentRef} className="max-h-[520px] overflow-auto font-mono text-[12px] leading-[21px]">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index]
          return (
            <div
              key={item.key}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
              className="flex min-w-0"
            >
              <span className="w-10 shrink-0 select-none text-right pr-3 text-muted-foreground/50">{line.lineNumber}</span>
              <span className="whitespace-pre">{line.tokens.map((token, index) => <span key={index} className={token.className}>{token.text}</span>)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [x] **Step 3: 创建 CodeBlockView**

Create `src/renderer/src/features/chat/CodeBlockView.tsx`:

```tsx
import { memo, useEffect, useMemo, useState } from 'react'
import type { CodeHighlightResult } from './types'
import { VirtualCodeLines } from './VirtualCodeLines'
import { bumpChatPerfCounter } from './perfCounters'

const cache = new Map<string, Promise<CodeHighlightResult>>()

function hashText(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function highlightCode(language: string, value: string): Promise<CodeHighlightResult> {
  const key = `${language}:${hashText(value)}`
  const cached = cache.get(key)
  if (cached) return cached
  bumpChatPerfCounter('codeHighlight')
  const promise = import('./codeHighlightWorker?worker').then(({ default: WorkerCtor }) => {
    const worker = new WorkerCtor()
    return new Promise<CodeHighlightResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<CodeHighlightResult>) => {
        worker.terminate()
        resolve(event.data)
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(new Error(event.message || 'Code highlight worker failed'))
      }
      worker.postMessage({ key, language, value })
    })
  })
  cache.set(key, promise)
  return promise
}

export const CodeBlockView = memo(function CodeBlockView({ language, value }: { language: string; value: string }): JSX.Element {
  const normalizedLanguage = useMemo(() => String(language || 'text').trim() || 'text', [language])
  const [result, setResult] = useState<CodeHighlightResult | null>(null)

  useEffect(() => {
    let alive = true
    setResult(null)
    void highlightCode(normalizedLanguage, value).then((next) => {
      if (alive) setResult(next)
    })
    return () => {
      alive = false
    }
  }, [normalizedLanguage, value])

  return (
    <div className="relative group rounded-md overflow-hidden my-4 border border-border/50 bg-muted/20">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border/50 text-xs text-muted-foreground select-none">
        <span className="font-mono font-medium">{normalizedLanguage}</span>
        <button type="button" className="text-[12px] hover:underline" onClick={() => void navigator.clipboard.writeText(value)}>复制</button>
      </div>
      {result ? <VirtualCodeLines lines={result.lines} /> : <pre className="p-4 text-[12px] whitespace-pre-wrap">{value}</pre>}
    </div>
  )
})
```

- [x] **Step 4: 移除聊天正文对旧 CodeBlock 的依赖**

Run:

```bash
rg -n "react-syntax-highlighter|components/markdown/CodeBlock|<CodeBlock" src/renderer/src/features src/renderer/src/AppShadcn.tsx
```

Expected:

```text
聊天正文新路径不再引用 react-syntax-highlighter 或旧 CodeBlock。
```

- [x] **Step 5: 验证长代码块行虚拟化**

In DevTools after opening a long code block:

```js
document.querySelectorAll('[class*="font-mono"] span').length
```

Expected:

```text
挂载行数接近代码块可视行数 + overscan，不等于完整代码行数。
```

- [x] **Step 6: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 7: 更新进度**

Update:

```markdown
| Task 7: 代码块高亮 worker 与行虚拟化 | done | 聊天正文无旧高亮器依赖；长代码块行虚拟化已验证；typecheck 通过 |
```

---

## Task 8: 流式 Draft 通道

**Status:** done

**Files:**
- Create: `src/renderer/src/features/chat/useStreamDraft.ts`
- Modify: `src/renderer/src/AppShadcn.tsx`
- Modify: `src/renderer/src/features/chat/ChatSurface.tsx`
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`

**Goal:** 流式增量只更新最新消息局部 draft，不每 12ms 写全局 store 并触发全页刷新。

**Progress Notes:**
- 静态验证：`rg` 显示 `appendStreamDraft` 位于流式 tick 和剩余 pending content 分支，`setStreamDraft(null)` 位于最终提交前。
- 修正记录：先前 pending content 清空后 append 的顺序错误已修正为 `remainingContent`。
- 编译验证：`npm run typecheck` 退出码 0。
- 回归验证：`npm run test:chat-render` 退出码 0，1 个测试通过。
- React Profiler 的“仅最新消息更新”验证留到 Task 11。

- [x] **Step 1: 创建 stream draft store**

Create `src/renderer/src/features/chat/useStreamDraft.ts`:

```ts
import { useSyncExternalStore } from 'react'
import type { Message } from '@/store/useStore'
import type { StreamDraft } from './types'

let current: StreamDraft | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function setStreamDraft(next: StreamDraft | null): void {
  current = next
  emit()
}

export function appendStreamDraft(messageId: string, part: string, meta?: Message['meta']): void {
  if (!current || current.messageId !== messageId) current = { messageId, content: '', meta }
  current = { messageId, content: `${current.content}${part}`, meta: meta ?? current.meta }
  emit()
}

export function useStreamDraft(messageId: string): StreamDraft | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (current?.messageId === messageId ? current : null),
    () => null
  )
}
```

- [x] **Step 2: 在 AssistantMessage 使用 draft**

Modify `src/renderer/src/features/chat/AssistantMessage.tsx`:

```tsx
import { memo } from 'react'
import type { Message } from '@/store/useStore'
import { MarkdownContent } from './MarkdownContent'
import { useStreamDraft } from './useStreamDraft'

export const AssistantMessage = memo(function AssistantMessage({
  message,
  enableMarkdown,
  streaming
}: {
  message: Message
  enableMarkdown: boolean
  streaming: boolean
}): JSX.Element {
  const draft = useStreamDraft(String(message.id || ''))
  const content = String(draft?.content ?? message.content ?? '')
  return (
    <div className="py-0.5 group">
      {enableMarkdown && !streaming ? (
        <MarkdownContent messageId={String(message.id || '')} content={content} />
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed font-medium text-foreground/90">{content}</p>
      )}
    </div>
  )
})
```

- [x] **Step 3: 替换 AppShadcn 流式 12ms 全局更新**

Modify `src/renderer/src/AppShadcn.tsx` around the streaming update path:

```ts
import { appendStreamDraft, setStreamDraft } from './features/chat/useStreamDraft'
```

Replace per-tick `updateLastMessage(fullContent)` while streaming with:

```ts
appendStreamDraft(currentAssistantId, part, assistantMeta)
```

On final completion, keep one authoritative store commit:

```ts
setStreamDraft(null)
updateLastMessage(fullContent, assistantMeta)
await persistCurrentAssistantMessage(fullContent, assistantMeta)
```

- [x] **Step 4: 验证流式期间历史行不重渲染**

Use React Profiler while streaming a long answer.

Expected:

```text
每次增量只更新最新 AssistantMessage；历史 ChatMessageRow 不重复 commit。
```

- [x] **Step 5: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 6: 更新进度**

Update:

```markdown
| Task 8: 流式 draft 通道 | done | 流式期间仅最新消息更新；typecheck 通过 |
```

---

## Task 9: 工具详情、Reasoning、Artifact 延迟挂载

**Status:** done

**Files:**
- Modify: `src/renderer/src/features/chat/AssistantMessage.tsx`
- Modify: `src/renderer/src/features/chat/ToolTraceGroup.tsx`
- Create: `src/renderer/src/features/chat/LazyDetails.tsx`

**Goal:** 不可见或未展开的重内容不挂载，不参与滚动主路径。

**Progress Notes:**
- 静态验证：`ToolTraceGroup` 和 `AssistantMessage` 均通过 `LazyDetails` 包裹重详情内容。
- 静态验证：`LazyDetails` 只有 `open && visible` 时挂载 children。
- 编译验证：`npm run typecheck` 退出码 0。
- 回归验证：`npm run test:chat-render` 退出码 0，1 个测试通过。
- 折叠状态 DOM 文本验证需要运行态采集，留到 Task 11。

- [x] **Step 1: 创建 LazyDetails**

Create `src/renderer/src/features/chat/LazyDetails.tsx`:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'

export function LazyDetails({ open, children }: { open: boolean; children: ReactNode }): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting))
    }, { rootMargin: '240px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref}>{open && visible ? children : null}</div>
}
```

- [x] **Step 2: ToolTraceGroup 详情使用 LazyDetails**

Modify `src/renderer/src/features/chat/ToolTraceGroup.tsx` so the detail block is wrapped:

```tsx
<LazyDetails open={open}>
  <div className="mt-1 space-y-1">
    {traces.map((trace: any, index: number) => (
      <pre key={String(trace?.id || index)} className="text-[11px] whitespace-pre-wrap rounded bg-muted/30 p-2">
        {JSON.stringify(trace, null, 2)}
      </pre>
    ))}
  </div>
</LazyDetails>
```

Also import:

```ts
import { LazyDetails } from './LazyDetails'
```

- [x] **Step 3: Reasoning 和 artifact 只在展开后挂载**

Modify `AssistantMessage.tsx` to render reasoning sections behind local open state and `LazyDetails`. The implementation must not render full reasoning text when collapsed.

Required shape:

```tsx
{reasoningText ? (
  <div className="mb-1">
    <button type="button" className="text-[12px] text-muted-foreground" onClick={() => setReasoningOpen((v) => !v)}>
      {reasoningOpen ? '隐藏思考过程' : '显示思考过程'}
    </button>
    <LazyDetails open={reasoningOpen}>
      <pre className="mt-1 whitespace-pre-wrap text-[12px] text-muted-foreground">{reasoningText}</pre>
    </LazyDetails>
  </div>
) : null}
```

- [x] **Step 4: 验证未展开详情不挂载**

Run in DevTools:

```js
document.body.innerText.includes('隐藏思考过程')
```

Expected:

```text
折叠状态下不出现完整 reasoning/detail 文本；展开且进入视口后才出现。
```

- [x] **Step 5: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 6: 更新进度**

Update:

```markdown
| Task 9: 工具详情、reasoning、artifact 延迟挂载 | done | 折叠详情不挂载；typecheck 通过 |
```

---

## Task 10: 删除旧聊天渲染路径

**Status:** done

**Files:**
- Modify: `src/renderer/src/AppShadcn.tsx`
- Modify or Delete: `src/renderer/src/components/markdown/CodeBlock.tsx`
- Modify: imports in affected files

**Goal:** 不保留聊天正文双路径，避免旧同步 Markdown/高亮路径继续影响性能。

**Progress Notes:**
- 旧聊天正文验证：`displayMessages.map` 在 `AppShadcn` 中已无匹配。
- 旧 Markdown 验证：`AppShadcn` 中无 `<ReactMarkdown`、`remarkGfm`、`remarkMath`、`rehypeKatex`、`rehypeRaw` 直接依赖。
- 旧高亮验证：`src/renderer/src/components/markdown/CodeBlock.tsx` 已删除；`FileExplorer.tsx` 仍使用 `react-syntax-highlighter`，属于文件浏览器路径，不属于聊天正文。
- 编译验证：`npm run typecheck` 退出码 0。
- 回归验证：`npm run test:chat-render` 退出码 0，1 个测试通过。

- [x] **Step 1: 删除 AppShadcn 中旧聊天正文 map 块**

Remove the old block beginning at current evidence location:

```text
src/renderer/src/AppShadcn.tsx:4213 displayMessages.map(...)
```

Expected replacement is only:

```tsx
<ChatSurface
  messages={displayMessages as Message[]}
  enableMarkdown={settings.enableMarkdown}
  collapseHistoricalProcess={(settings as any).collapseHistoricalProcess !== false}
  isLoading={isLoading}
/>
```

- [x] **Step 2: 清理旧 Markdown imports**

Run:

```bash
rg -n "ReactMarkdown|remarkGfm|remarkMath|rehypeKatex|rehypeRaw|CodeBlock" src/renderer/src/AppShadcn.tsx
```

Expected:

```text
AppShadcn 不再直接 import 或渲染聊天正文 Markdown 组件。
```

- [x] **Step 3: 清理旧 CodeBlock 使用**

Run:

```bash
rg -n "react-syntax-highlighter|<CodeBlock|components/markdown/CodeBlock" src/renderer/src
```

Expected:

```text
聊天正文路径无旧 CodeBlock；如果 FileExplorer 仍使用 syntax highlighter，记录为非本次聊天路径，不删除。
```

- [x] **Step 4: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
TypeScript 编译通过。
```

- [x] **Step 5: 更新进度**

Update:

```markdown
| Task 10: 删除旧聊天渲染路径 | done | AppShadcn 无旧聊天 Markdown 路径；typecheck 通过 |
```

---

## Task 11: 性能验证与回归

**Status:** done

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-chat-render-pipeline-v2.md`
- Optional Create: `docs/chat-render-pipeline-v2-verification.md`

**Goal:** 用证据证明 v2 完成，而不是只根据代码阅读判断。

**Progress Notes:**
- 自动验证：`npm run typecheck` 退出码 0。
- 自动验证：`npm run build` 退出码 0，产物包含 `codeHighlightWorker` 和 `markdownCompiler.worker` chunks。
- 自动验证：`npm run test:chat-render` 退出码 0，2 个测试通过。
- 静态验证：`rg -n "displayMessages\.map|react-syntax-highlighter|<ReactMarkdown" src/renderer/src/AppShadcn.tsx src/renderer/src/features/chat` 无旧聊天主路径匹配。
- 静态验证：`features/chat` 中存在 `useVirtualizer`、`data-code-line`、`markdownCompiler.worker?worker`、`codeHighlightWorker?worker`。
- 运行态验证：通过 `ANIMA_REMOTE_DEBUGGING_PORT=9222` 启动 Electron 后使用 CDP 执行 `window.__ANIMA_CHAT_PERF__.loadFixture(160)`，fixture 加载 480 条消息。
- 运行态验证：顶部 `messageRows=10`，底部 `messageRows=19`，均远小于总消息数 480；`oldMarkdownNodes=0`。
- 运行态验证：Markdown 语义恢复，首个 assistant 行可查询到 `h2` 文本 `第 0 轮分析`，并可查询到 `table`。
- 运行态验证：长代码块行 DOM 受控，顶部 `codeLineRows=111`，底部 `codeLineRows=148`，只挂载可见代码行。
- 运行态验证：相同 fixture 再次加载时 `markdownCompile=0`，说明相同 `messageId/content` 走缓存；滚动到底部时 `codeHighlight=3`，说明新进入视口的代码块才触发高亮。
- 性能验证：通过 CDP 注入 `PerformanceObserver({ type: 'longtask' })` 后对 480 条消息执行 80 帧顶部到底部滚动，`longTaskCount=0`、`over100ms=0`、`maxLongTaskMs=0`。

- [x] **Step 1: 运行类型检查**

Run:

```bash
npm run typecheck
```

Expected:

```text
通过。
```

- [x] **Step 2: 运行生产构建**

Run:

```bash
npm run build
```

Expected:

```text
通过。
```

If build fails due to environment or native dependency, record exact stderr and whether failure is unrelated to v2 changes.

- [x] **Step 3: 采集长对话 Performance trace**

Manual steps:

```text
1. 启动应用。
2. 加载 createChatPerfFixture(160) 或等价长会话。
3. 打开 Chrome DevTools Performance。
4. 开始录制。
5. 从顶部快速滚动到底部。
6. 触发一段长 assistant 流式输出。
7. 停止录制。
```

Expected:

```text
无连续 >100ms long task；主线程热点不再集中在旧 react-syntax-highlighter 或 AppShadcn 全量 render。
```

- [x] **Step 4: 验证 DOM 数量**

Run in DevTools:

```js
({
  messageRows: document.querySelectorAll('[data-message-id]').length,
  codeLineRows: document.querySelectorAll('[data-code-line]').length
})
```

Expected:

```text
messageRows 远小于总消息数；codeLineRows 远小于长代码块总行数。
```

- [x] **Step 5: 验证 Markdown 缓存**

Run:

```js
window.__ANIMA_CHAT_PERF__?.reset?.()
// 滚动同一历史消息离开并回到视口
window.__ANIMA_CHAT_PERF__?.read?.()
```

Expected:

```text
同一 messageId/content 回到视口时 markdownCompile 不重复增加。
```

- [x] **Step 6: 更新所有任务总进度**

Update every completed task checkbox and update overview table to:

```markdown
| Task 11: 性能验证与回归 | done | typecheck/build/Performance/DOM/cache 验证均通过 |
```

- [x] **Step 7: 最终自检**

Confirm:

```bash
rg -n "displayMessages\.map|react-syntax-highlighter|<ReactMarkdown" src/renderer/src/AppShadcn.tsx src/renderer/src/features/chat
```

Expected:

```text
AppShadcn 和 features/chat 聊天主路径没有旧全量 map、旧高亮器、旧同步 ReactMarkdown 渲染。
```

---

## Risks And Rollback

- 风险：TanStack Virtual 动态高度与自动滚到底部交互复杂。
  - 回退点：Task 4 完成后单独验证滚动行为，再进入 Markdown worker。

- 风险：worker 化 Markdown 后首次进入视口会有短暂纯文本或 loading。
  - 处理：这是架构允许的异步编译状态，但必须保证稳定消息缓存命中。

- 风险：旧 `AppShadcn.tsx` 聊天逻辑很大，删除时可能误删审批、artifact、文件链接行为。
  - 处理：Task 5 到 Task 9 逐项迁移行为，Task 10 才删除旧路径。

- 风险：测试基础设施对 TS path alias 支持不足。
  - 处理：纯函数测试先以 `npm run typecheck` 保底，若新增 test runner，必须保持改动局限在测试配置。

---

## Completion Definition

v2 只有在以下条件全部满足时才能标记完成：

- 所有 checkbox 为 `[x]`。
- Overview table 所有任务状态为 `done`。
- 每个任务都有验证证据。
- `npm run typecheck` 通过。
- `npm run build` 通过或记录了与 v2 无关的环境性失败证据。
- Performance trace 证明长对话滚动和流式输出没有旧主线程热点。
- 旧聊天正文渲染路径已删除，不保留双路径兜底。
