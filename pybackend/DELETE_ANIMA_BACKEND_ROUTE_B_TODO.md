# 路线 B：彻底删除 `pybackend/anima_backend` Todo List

规则：每次开始开发前先对照本清单；每个 Todo 完成后立刻更新本文件进度（勾选 + 记录完成日期/PR 或 commit 可选）。

更新时间：2026-02-04

---

## 状态说明

- [ ] 未开始
- [~] 进行中
- [x] 已完成

---

## 目标

将 `anima_backend` 当前承担的“共享模块 + 启动入口/handler 壳”能力迁出，最终删除整个 `pybackend/anima_backend/` 目录，且 Electron + Python 后端功能与对外接口保持兼容。

---

## P0：准备与基线

- [x] 记录当前可用验收基线（启动 + 关键接口 + 测试）
  - 完成日期：2026-02-04
  - 说明：Python 回归测试 `python -m unittest -q test_langgraph_backend.py`（14 tests，OK）；当前运行时会出现 `ResourceWarning: subprocess ... is still running`

- [x] 盘点 `anima_backend_lg` 对 `anima_backend.*` 的依赖点
  - 完成日期：2026-02-04
  - 说明：主要依赖模块：`http/settings/voice/chat/database/providers/tools/util/constants`；涉及文件：`api/__init__.py`、`api/{chats,db,runs,runs_stream,settings_tools,voice}.py`、`llm/adapter.py`、`runtime/{graph,sanitize}.py`、`tools/executor.py`

---

## P1：建立共享层新包（替代 `anima_backend` 的共享模块）

- [x] 确定共享包命名与导出策略（import 路径稳定）
  - 完成日期：2026-02-04
  - 说明：共享包命名为 `anima_backend_shared`，后续逐步替换 `anima_backend_lg` 对 `anima_backend.*` 的 imports

- [x] 迁移 HTTP 基础能力到共享包
  - 完成日期：2026-02-04
  - 说明：新增 `anima_backend_shared/http.py` 并将 `anima_backend_lg` 的 HTTP imports 切到共享包

- [x] 迁移 util/constants 到共享包
  - 完成日期：2026-02-04
  - 说明：新增 `anima_backend_shared/{util.py,constants.py}`，并将 `anima_backend_lg` 对应 imports 切到共享包

- [x] 迁移 settings/skills/tools/providers 到共享包
  - 完成日期：2026-02-04
  - 说明：新增 `anima_backend_shared/{settings.py,tools.py,providers.py}`；并将 `anima_backend_lg` 中对 `settings/tools/providers` 的 imports 切到共享包（测试中对应 patch 路径也同步切换）

- [x] 迁移 database（含导入导出与 runs 表/初始化）到共享包
  - 完成日期：2026-02-04
  - 说明：新增 `anima_backend_shared/database.py` 并将 `anima_backend_lg` 与测试对 `database` 的 imports 切到共享包；保持 DB 路径规则与数据结构兼容（含 LangGraph runs 表/初始化）

- [x] 迁移 chat/voice 相关通用逻辑到共享包
  - 完成日期：2026-02-04
  - 说明：新增 `anima_backend_shared/{chat.py,voice.py}`；并将 `anima_backend_lg` 对 `chat/voice` 的 imports 切到共享包

---

## P2：切换 LangGraph 后端与测试到共享包

- [x] 替换 `anima_backend_lg` 全部 `from anima_backend...` imports
  - 完成日期：2026-02-04
  - 说明：全部指向 `anima_backend_shared`；保证对外 API 行为不变

- [x] 替换 `test_langgraph_backend.py` 等测试对旧包的 imports
  - 完成日期：2026-02-04
  - 说明：测试只依赖共享包 + `anima_backend_lg`

- [ ] 处理 `compare_backends.py` 的去留
  - 完成日期：
  - 说明：若继续保留对照脚本，需改为不依赖 `anima_backend`（或将脚本标记为废弃并移除）

---

## P3：迁移启动入口与 Handler（不再经过 `anima_backend/server.py`）

- [x] 在非 `anima_backend` 包内提供新的 Python server 入口
  - 完成日期：2026-02-04
  - 说明：将 `ThreadingHTTPServer + Handler` 直接放入 `pybackend/server.py`，handler 使用 `anima_backend_lg.api.dispatch` 并保留 `/health`

- [x] 更新 `pybackend/server.py` 指向新的入口（Electron 启动链路）
  - 完成日期：2026-02-04
  - 说明：`pybackend/server.py` 不再 import 旧包，直接启动新 Handler

---

## P4：删除旧包与全量验收

- [x] 删除 `pybackend/anima_backend/` 目录
  - 完成日期：2026-02-04
  - 说明：已删除目录，并完成 Python 回归测试

- [x] 本地运行 Python 回归测试并通过
  - 完成日期：2026-02-04
  - 说明：`python -m unittest -q test_langgraph_backend.py`（14 tests，OK）

- [ ] Electron 启动验证（开发态 + 打包态至少其一）
  - 完成日期：
  - 说明：确认后端可启动、前端能正常请求、stream/SSE 路径无回归

---

## P5：验收门槛（必须同时满足）

- [x] 代码库内不存在对 `anima_backend` 包的 import/引用
  - 完成日期：2026-02-04
  - 说明：包含 Python 源码与测试（不含文档中的文字提及）

- [ ] 所有对外 HTTP 接口与响应 schema 保持兼容
  - 完成日期：
  - 说明：以 `test_langgraph_backend.py` 与 Electron 调用链覆盖为准

- [ ] Python 后端启动链路不依赖 `anima_backend` 目录
  - 完成日期：
  - 说明：Electron 仍启动 `pybackend/server.py`，但 server.py 不再 import `anima_backend.*`
