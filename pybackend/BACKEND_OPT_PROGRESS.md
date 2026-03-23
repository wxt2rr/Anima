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
