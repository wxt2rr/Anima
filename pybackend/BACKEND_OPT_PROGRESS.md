# 后端优化执行进度

## 目标
在不改变外部接口行为的前提下，降低后端复杂度、减少隐式副作用、消除明显技术债。

## 任务清单（按执行顺序）
- [x] 1. 路由分发去 if/elif 巨链，改为路由表驱动
- [x] 2. `load_settings` 去除 provider 迁移副作用，迁移逻辑改为显式执行
- [x] 3. `runs.py` 与 `runs_stream.py` 提取公共逻辑，减少重复实现
- [x] 4. 修复 `read_text_file` 的文件句柄泄漏告警（ResourceWarning）
- [x] 5. 清理空壳模块（`store`/`schemas`）
- [x] 6. 回归验证并记录结果

## 验收标准
1. `python3 -m unittest -q test_backend_core.py test_anima_cli.py` 通过
2. `/api/runs`、`/settings`、`/api/chats/*`、`/voice/*` 路由行为保持不变
3. 无新增失败测试

## 进度日志
- 2026-03-23：创建执行清单，开始实施。
- 2026-03-23：完成任务 1，`anima_backend_core/api/__init__.py` 改为路由表 + 动态路由匹配，去除 200+ 行条件分发链。
- 2026-03-23：完成任务 2，`anima_backend_shared/settings.py` 新增 `migrate_settings()`，`load_settings()` 不再执行 codex provider 迁移写入；`server.py` 启动时显式执行迁移。
- 2026-03-23：完成任务 3，新增 `anima_backend_core/api/runs_common.py`，抽取 `estimate/extract/find` 公共逻辑，`runs.py` 与 `runs_stream.py` 复用同一实现。
- 2026-03-23：完成任务 4，`anima_backend_shared/util.py` 的 `read_text_file()` 改为 `with p.open(\"rb\")`，避免文件句柄未关闭。
- 2026-03-23：完成任务 5，删除空壳模块 `anima_backend_core/store/__init__.py` 与 `anima_backend_core/schemas/__init__.py`。
- 2026-03-23：完成任务 6，执行 `python3 -m unittest -q test_backend_core.py test_anima_cli.py`，64 项测试通过（OK）。
- 2026-03-23：增量优化：新增 `anima_backend_core/api/runs_compression.py`，将 `runs.py` 与 `runs_stream.py` 的压缩/摘要与 thinking-level 逻辑收敛到同一模块，降低重复实现。
- 2026-03-23：增量优化：`server.py` 启动阶段异常不再静默吞掉，改为输出错误与堆栈，便于排障。
- 2026-03-23：增量优化：`api/__init__.py` 清理未使用类型导入，减少风格噪音。
- 2026-03-23：增量回归：执行 `python3 -m unittest -q test_backend_core.py test_anima_cli.py`，64 项测试通过（OK）。
- 2026-03-23：开发修改：新增 `anima_backend_core/api/runs_request.py`，统一 `useThreadMessages` 消息归并逻辑与运行参数解析（temperature/maxTokens/jsonConfig）。
- 2026-03-23：开发修改：`runs_stream.py` 的流式与非流式入口改为复用 `runs_request.py`，减少重复分支。
- 2026-03-23：开发修改：`runs_compression.py` 增加可注入 seam（`get_chat_meta_fn`/`merge_chat_meta_fn`），保持模块化后测试可 patch。
- 2026-03-23：开发修改：`runs.py` 的 resume 路径改为复用统一运行参数解析，减少重复代码。
- 2026-03-23：开发修改回归：先跑压缩相关 2 条测试通过，再跑全量 `python3 -m unittest -q test_backend_core.py test_anima_cli.py`，64 项通过（OK）。
- 2026-03-23：开发修改：主进程新增 CLI 首启安装逻辑，自动写入 `~/.anima/bin/anima` 并尝试补 PATH 到 shell rc（`src/main/index.ts`）。
- 2026-03-23：开发修改回归：执行 `npm run -s typecheck` 通过。
- 2026-03-23：UI 重构：设置页壳层改为与主页同一设计 token（`bg-background/bg-card/border-border`），移除硬编码白底和伪原生装饰，统一为系统化视觉层级（`SettingsDialog.tsx`）。
- 2026-03-23：UI 重构：设置页 Providers 列表与动作条去 `bg-white`，改为 token 驱动背景，减少“像另一个软件”的视觉割裂（`SettingsDialog.tsx`）。
- 2026-03-23：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-23：UI 重构：设置页成功态/状态点去硬编码绿灰（`green/gray`），统一为主题化语义样式（`emerald + muted`），并将技能空态容器改为 `bg-card`（`SettingsDialog.tsx`）。
- 2026-03-23：UI 回归：再次执行 `npm run -s typecheck` 通过。
- 2026-03-24：UI 结构统一：设置壳层按信息密度分流，仅 `providers` 使用宽布局；其余 tab 统一为“标题区 + 单列滚动内容区 + 固定底栏”，避免机械三列并保持主页一致视觉节奏（`SettingsDialog.tsx`）。
- 2026-03-24：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-24：功能开发：`Coder` 设置页升级为高密度双栏结构（中列表 + 右详情），支持多 coder 配置（新增/复制/删除/切换），并将活跃项同步回 `settings.coder` 以兼容现有后端委托链路（`SettingsDialog.tsx`）。
- 2026-03-24：数据层改造：`useStore` 新增 `coderProfiles` / `activeCoderProfileId` 规范化与回填，确保老配置自动迁移且保持向后兼容（`useStore.ts`）。
- 2026-03-24：默认配置补齐：后端默认设置加入 `coderProfiles` 与 `activeCoderProfileId`，保证新安装首启结构一致（`anima_backend_shared/defaults.py`）。
- 2026-03-24：回归验证：`npm run -s typecheck` 通过；`python3 -m unittest -q pybackend/test_backend_core.py pybackend/test_anima_cli.py` 64 项通过（OK）。
- 2026-03-24：UI 对齐：设置页左侧栏背景改为与主页一致（`#EBE9EA`），左右内容容器改为仅外侧圆角（左栏 `rounded-l` / 右栏 `rounded-r`），并移除中缝双边框导致的视觉缝隙（`SettingsDialog.tsx`）。
- 2026-03-24：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-24：UI 对齐修正：设置独立窗口改为“单一外层圆角容器 + 内部分栏”，消除左右分块拼接导致的顶部/底部圆角不一致问题，圆角策略与主页一致（`SettingsDialog.tsx`）。
- 2026-03-24：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-24：UI 对齐再修正：设置独立窗口改为主页同款“左栏 + 右主区”兄弟结构，右主区使用 `rounded-l-xl`，在与左栏交接处保留上下圆角切口（`SettingsDialog.tsx`）。
- 2026-03-24：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-24：UI 细节修正：设置独立窗口底部栏增加 `rounded-bl-xl`，使右侧主区左下角圆角与左上角半径一致（`SettingsDialog.tsx`）。
- 2026-03-24：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-24：UI 一致性修正：设置右侧统一标题栏对所有 tab 显示，包含 `providers` 与 `coder`，避免仅这两页缺失标题栏（`SettingsDialog.tsx`）。
- 2026-03-24：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-24：线稿方案落地确认：设置页保持现有左导航单列；右侧统一“标题栏+内容区+底栏”；`providers/coder` 使用双栏高密度模板，其它 tab 保持单列表单模板（`SettingsDialog.tsx`）。
- 2026-03-24：同页设置开发：设置入口与快捷键入口改为当前窗口 hash 路由（`#/settings`），不再默认走新开设置窗口；新增 `hashchange` 监听保证路由切换即时渲染（`AppShadcn.tsx`）。
- 2026-03-24：同页设置完善：`SettingsWindow` 新增“返回应用”按钮，底部关闭动作改为返回主页面（清空 hash），形成同页闭环（`SettingsDialog.tsx`）。
- 2026-03-24：回归验证：执行 `npm run -s typecheck` 通过。
- 2026-03-24：UI 交互修正：同页设置“返回应用”按钮左侧增加安全内边距（`pl-[84px]`），避开 mac 红绿灯区域遮挡（`SettingsDialog.tsx`）。
- 2026-03-24：UI 回归：执行 `npm run -s typecheck` 通过。
- 2026-03-24：架构重构：新增共享左栏壳组件 `AppShellLeftPane`，统一左栏宽度、背景、分隔条、收起行为（`src/renderer/src/components/layout/AppShellLeftPane.tsx`）。
- 2026-03-24：Token 收敛：新增 `--app-left-pane-*` 设计 token（宽度、背景、头部高度、水平内边距、安全区、分隔条宽度），主页与设置页共同使用（`src/renderer/src/assets/index.css`）。
- 2026-03-24：主页接入：`ChatHistoryPanel` 切换到共享左栏壳，分隔条机制改为同款组件内分隔条，保留拖拽可调宽；`AppShadcn` 将当前左栏宽度写入 `--app-left-pane-width` 作为单一来源（`AppShadcn.tsx`、`ChatHistoryPanel.tsx`）。
- 2026-03-24：设置页接入：`SettingsDialog/SettingsWindow` 左栏改为共享壳组件并改用同一 token（头部高度、内边距、安全区）以消除切换割裂感（`SettingsDialog.tsx`）。
- 2026-03-24：回归验证：执行 `npm run -s typecheck` 通过。
- 2026-03-24：左栏壳层收敛：将主页 `AppShadcn` 的左侧背景补丁层下沉到共享组件 `AppShellLeftPane`（`bleedPx`），移除页面级重复实现，主页与设置页共用同一补边机制（`AppShadcn.tsx`、`AppShellLeftPane.tsx`）。
- 2026-03-24：一致性增强：主页与同页设置左栏统一启用 `bleedPx=12`，切换时交界形态一致（`ChatHistoryPanel.tsx`、`SettingsDialog.tsx`）。
- 2026-03-24：回归验证：执行 `npm run -s typecheck` 通过。
- 2026-03-24：状态收敛：新增 `useLeftPaneLayout` hook，统一左栏宽度与左侧拖拽状态管理（初始值/最小值/最大值/拖拽偏移）；`AppShadcn` 改为复用该 hook，去除页面内散落的左栏尺寸逻辑（`src/renderer/src/hooks/useLeftPaneLayout.ts`、`AppShadcn.tsx`）。
- 2026-03-24：回归验证：执行 `npm run -s typecheck` 通过。
- 2026-03-24：链路清理：移除旧设置窗口打开 IPC（`anima:window:openSettings`）及 preload 暴露，确保设置仅通过同页 hash 路由进入（`src/main/index.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`）。
- 2026-03-24：类型收敛：删除渲染层环境声明中的遗留 `window.openSettings`，避免旧能力误用（`src/renderer/src/env.d.ts`）。
- 2026-03-24：壳层 token 收敛：新增 `--app-shell-content-bg` / `--app-shell-content-radius`，主页与设置右侧内容区共用，移除硬编码 `bg-white/rounded-l-xl` 差异（`src/renderer/src/assets/index.css`、`AppShadcn.tsx`、`SettingsDialog.tsx`）。
- 2026-03-24：交互一致性：设置页“返回应用”按钮接入左栏头部按钮 token（尺寸/圆角/水平内边距），与主页头部交互控件统一（`SettingsDialog.tsx`）。
- 2026-03-24：质量保障：新增设置壳层 UI 回归基线文档，固化同页设置关键验收点（`docs/ui-settings-shell-regression.md`）。
