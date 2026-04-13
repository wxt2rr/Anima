# Automation Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the automation settings tab so it behaves like a settings page: global Cron settings first, task list second, task editing on demand.

**Architecture:** Keep the implementation inside `SettingsDialog.tsx` to minimize scope. Replace the always-visible two-column workbench with a top-level Cron settings card, a compact task list, and a modal editor reused for create/edit flows.

**Tech Stack:** React, TypeScript, Zustand, Tailwind, Radix Dialog/Shadcn UI

---

### Task 1: Restructure the tab layout

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Verify: `npm run typecheck`

- [ ] **Step 1: Replace the large hero/workbench shell with stacked settings sections**

Remove the current `rounded-[28px]` shell that combines the hero, sidebar, and inline editor. Replace it with:

```tsx
<div className="p-6 space-y-6">
  <Card className="p-5 space-y-4">...</Card>
  <Card className="p-5 space-y-4">...</Card>
</div>
```

- [ ] **Step 2: Keep global Cron controls in the first card**

Render only:

```tsx
<Switch checked={Boolean(cron.enabled)} ... />
<Input type="number" value={Number(cron.pollIntervalMs || 500)} ... />
<Switch checked={Boolean(cron.allowAgentManage)} ... />
```

and update the label/hint text to use “检查间隔（毫秒）”.

- [ ] **Step 3: Turn the task area into a compact overview list**

Each task card shows:

```tsx
job name
enabled badge
last status badge
next run
schedule summary
context summary
```

No inline editor should remain in the main page.

- [ ] **Step 4: Run verification**

Run: `npm run typecheck`

Expected: `tsc -p tsconfig.json --noEmit` exits successfully.

### Task 2: Move job editing into a modal flow

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Verify: `npm run typecheck`

- [ ] **Step 1: Add modal open/close state**

Introduce:

```tsx
const [editorOpen, setEditorOpen] = useState(false)
```

and use it for both “新建任务” and task-card click.

- [ ] **Step 2: Reuse existing draft state inside a dialog**

Wrap the existing task form sections in:

```tsx
<Dialog open={editorOpen} onOpenChange={setEditorOpen}>
  <DialogContent className="sm:max-w-4xl">...</DialogContent>
</Dialog>
```

Keep the existing save/delete/run logic, but surface the actions only in the dialog footer/header.

- [ ] **Step 3: Preserve behavior for create/edit flows**

`createNewJob()` should reset the draft and open the dialog. Selecting an existing job should populate the draft and open the dialog.

- [ ] **Step 4: Run verification**

Run: `npm run typecheck`

Expected: `tsc -p tsconfig.json --noEmit` exits successfully.

### Task 3: Add readable summaries and finish the copy pass

**Files:**
- Modify: `src/renderer/src/components/SettingsDialog.tsx`
- Verify: `npm run typecheck`

- [ ] **Step 1: Add small summary helpers**

Add helpers for:

```tsx
formatScheduleSummary(job)
formatContextSummary(job)
```

so the list can expose high-frequency information without expanding the editor.

- [ ] **Step 2: Update the Cron copy**

Change the copy from:

```tsx
pollInterval: '轮询间隔（毫秒）'
pollIntervalHint: '后端检查到期任务的轮询间隔，建议 500-2000 毫秒。'
```

to wording equivalent to:

```tsx
pollInterval: '检查间隔（毫秒）'
pollIntervalHint: 'Cron 服务每隔多久检查一次是否有到期任务。默认 500 毫秒。'
```

- [ ] **Step 3: Run final verification**

Run: `npm run typecheck`

Expected: `tsc -p tsconfig.json --noEmit` exits successfully.
