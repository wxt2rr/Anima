# Markdown 编译器占位符泄漏根修 TODO

## 目标
- 彻底移除 `__ANIMA_CHAT_HTML_x__` 占位符回填链路，避免文件名/链接文本泄漏占位符。
- 保持现有 Markdown 渲染能力与交互能力（文件链接点击、图片、任务列表、KaTeX）。
- 不破坏现有性能优化路径（worker 编译与缓存）。

## 执行清单
- [x] 1. 根因定位与方案确定  
  验证：确认占位符只在 `markdownCompilerCore.ts` 生成，且为单次回填导致嵌套泄漏。
- [x] 2. 实现根修（移除占位符机制，改为 inline token 解析渲染）  
  验证：`renderInline` 不再包含 `stash/restore` 与 `__ANIMA_CHAT_HTML_`。
- [x] 3. 补充回归测试（嵌套 inline 场景）  
  验证：新增用例覆盖 ``[`README.md`](README.md)`` 与 `__ANIMA_CHAT_HTML_0__` 文本场景，断言输出不含占位符 token。
- [x] 4. 执行测试并记录结果  
  验证：已运行 `npm run test:chat-render`，15/15 通过。
- [x] 5. 回归检查性能与行为兼容  
  验证：`markdownCompiler.ts`、`markdownCompiler.worker.ts`、`markdownCompileCache.ts` 未改动；仅替换 `markdownCompilerCore.ts` 的 inline 编译内部实现。

## 当前进度
- 已完成：1/2/3/4/5
- 进行中：无
