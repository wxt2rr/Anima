# Slash Commands V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在聊天 composer 中支持内建 Slash Commands，并支持从项目目录 `.anima/commands/*.md` 自动发现项目级自定义命令。

**Architecture:** 保持现有聊天发送链路不变，只在 `ChatComposer` 上叠加 slash 解析、候选菜单和执行分发。将易变逻辑拆到独立纯函数模块，项目命令文件扫描通过现有 `window.anima.fs` 完成。

**Tech Stack:** React 18、TypeScript、Electron preload IPC、现有 Zustand store、Node `--test`

---

### Task 1: 核心命令逻辑

**Files:**
- Create: `src/renderer/src/lib/slashCommands.ts`
- Create: `tests/slashCommands.test.ts`
- Create: `tsconfig.slash-tests.json`

- [ ] 解析输入中的 slash 命令名和参数
- [ ] 解析 `.anima/commands/*.md` 为项目命令
- [ ] 实现模板变量替换（`{{args}}`、`{{workspace}}`）
- [ ] 用 Node 测试覆盖纯函数行为

### Task 2: 项目命令加载

**Files:**
- Modify: `src/renderer/src/AppShadcn.tsx`

- [ ] 根据当前 workspace 扫描 `.anima/commands`
- [ ] 将项目命令和内建命令合并为统一列表
- [ ] 处理目录不存在、文件读取失败、非 `.md` 文件等空态

### Task 3: Composer Slash 菜单

**Files:**
- Modify: `src/renderer/src/AppShadcn.tsx`
- Modify: `src/renderer/src/components/InputAnimation.tsx`（如确有必要）

- [ ] 在 `ChatComposer` 中追踪 slash 输入态
- [ ] 渲染候选菜单
- [ ] 支持方向键、回车、Tab、Esc
- [ ] 命令执行后填充 prompt、直接发送或执行本地动作

### Task 4: 回归验证

**Files:**
- 无新增功能文件

- [ ] 运行纯函数测试
- [ ] 运行 `npm run typecheck`
- [ ] 手动检查普通消息发送未受影响
