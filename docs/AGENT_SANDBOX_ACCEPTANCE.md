# Agent 沙箱开发验收基线

## 1. 目标

本次沙箱改造仅针对 agent 工具执行链路，目标是提升越界防护与可验证性。

## 2. 范围

### 2.1 In Scope

- ACP 会话工具调用链路（Electron Main）
  - `src/main/services/acpService.ts`
  - `src/main/services/acpCore.ts`
- Python builtin tools 执行链路
  - `pybackend/anima_backend_shared/tools.py`
  - `pybackend/anima_backend_core/tools/executor.py`

### 2.2 Out of Scope

- UI 交互终端 `src/main/services/terminalService.ts`
- 非 agent 发起的本地终端行为

## 3. 成功标准

1. `workspace_whitelist` 模式下，文件读写/目录读取/命令 `cwd` 越界必须失败。
2. 对存在符号链接的路径，不能通过链接跳出工作区。
3. `full_access` 模式下保留现有能力，不引入额外阻断。
4. 所有“已完成”结论必须附带可复现测试证据。

## 4. 验证标准

1. TS 侧：`npm run test:acp` 通过。
2. Python 侧：相关沙箱用例通过（后续按任务阶段补充）。
3. 至少包含 1 个符号链接越界测试，且在修复前失败、修复后通过。

## 5. 回滚标准

若任一条件成立，必须触发回滚或降级：

1. 正常工作区内操作被大量误拦截。
2. `full_access` 行为被破坏。
3. 引入跨平台不可恢复错误（阻断主流程）。

回滚策略：仅回退本次沙箱相关改动，不扩散到无关模块。
