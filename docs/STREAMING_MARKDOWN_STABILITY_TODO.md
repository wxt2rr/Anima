# 流式 Markdown 稳定渲染 TODO

## 目标
- 流式返回期间保持 Markdown 渲染稳定，不再在 Markdown / 纯文本之间来回切换。
- 不破坏当前性能优化路径（worker + cache + 虚拟列表）。

## 执行清单
- [x] 1. 根因确认  
  验证：确认当前 `AssistantMessage` 在 streaming 时强制走纯文本分支，且 `MarkdownContent` 在内容变化时会回退到未编译态。
- [x] 2. 流式期间改为统一走 Markdown 渲染  
  验证：`AssistantMessage` 不再用 `!streaming` 决定是否渲染 `MarkdownContent`。
- [x] 3. Markdown 编译结果改为“粘性不回退”  
  验证：内容变化时，如果新结果未返回，继续展示上一次已编译结果，不回退纯文本。
- [x] 4. 流式编译节流 + 乱序保护  
  验证：流式期间按节流窗口触发 worker 编译，且只接收最新一轮编译结果。
- [x] 5. 回归验证  
  验证：`npm run test:chat-render` 通过，且未改动 worker/cache 主干模块接口。

## 当前进度
- 已完成：1/2/3/4/5
- 进行中：无
