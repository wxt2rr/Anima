# Emil Design Engineering 全量优化 TODO

> 范围：`src/renderer/src`
> 原则：高频交互优先、最小必要修改、每项可验证。

## P0（高优先级，先做）

- [x] P0-1 统一 Tooltip Provider 策略（首次延迟 + 相邻即时）
  - 目标：在 `components/ui/tooltip.tsx` 提供默认 `delayDuration` 与 `skipDelayDuration`。
  - 验证：全局不改调用方也可继承默认行为；现有显式 `delayDuration` 不受影响。

- [x] P0-2 重写 TooltipContent 动效为属性级过渡
  - 目标：移除 `animate-in/out` 模板类，改为 `opacity/transform` 过渡，时长 125-200ms。
  - 验证：`tooltip.tsx` 不再包含 `animate-in/animate-out`。

- [x] P0-3 重写 PopoverContent 动效并接入 origin-aware transform-origin
  - 目标：`components/ui/popover.tsx` 使用 `--radix-popover-content-transform-origin`。
  - 验证：代码包含 `origin-[var(--radix-popover-content-transform-origin)]`。

- [x] P0-4 重写 SelectContent 动效并接入 origin-aware transform-origin
  - 目标：`components/ui/select.tsx` 使用 `--radix-select-content-transform-origin`。
  - 验证：代码包含 `origin-[var(--radix-select-content-transform-origin)]`。

- [x] P0-5 清理高频区域 `transition-all`
  - 目标：聊天高频交互中将 `transition-all` 改为属性级过渡。
  - 范围：`AppShadcn.tsx`、`ChatHistoryPanel.tsx`、`AssistantMessage.tsx`、`UserMessage.tsx`。
  - 验证：上述文件不再出现 `transition-all`。

## P1（中优先级，统一手感）

- [x] P1-1 统一左侧栏开合时长与曲线
  - 目标：`AppShellLeftPane.tsx` 从 `duration-300 ease-in-out` 调整为更快的 `ease-out` 短时长。
  - 验证：侧栏宽度与容器过渡参数一致且不含 `ease-in-out`。

- [x] P1-2 将下载/导入进度条从 `width` 动画切换为 `transform: scaleX`
  - 目标：`UpdateDialog.tsx`、`SettingsDialog.tsx` 两处进度条改为 transform 动画。
  - 验证：DOM 使用 `scaleX(...)`，容器带 `origin-left`。

- [x] P1-3 收敛 Dialog 进入/退出动画维度
  - 目标：`components/ui/dialog.tsx` 去除多余 slide 叠加，仅保留 fade + 轻 scale。
  - 验证：`dialog.tsx` 不再包含 `slide-in-*` / `slide-out-*`。

## P2（低优先级，治理一致性）

- [x] P2-1 替换明显“可预测简单动效”的 Framer Motion 点位为 CSS（首批）
  - 目标：将 `AppShadcn.tsx` 初始化页小圆点脉冲改为 CSS keyframes。
  - 验证：该小圆点不再使用 `motion.span` 循环动画。

- [x] P2-2 清理非高频但明显不必要的 `transition-all`（首批）
  - 目标：`Artifacts.tsx`、`UpdateDialog.tsx`、`SettingsDialog.tsx` 内可替换点位收敛为属性级。
  - 验证：这些点位不再使用 `transition-all`。

## 执行日志

- [x] 开始开发
- [x] 完成 P0
- [x] 完成 P1
- [x] 完成 P2
- [x] 完成验证（typecheck + 相关测试）
