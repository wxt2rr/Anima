# WebSearch 接入当前部署的 SearXNG 方案

## 1. 目标

把 Anima 的 `WebSearch` 工具接入当前已经部署好的 SearXNG 服务，并保留现有 DuckDuckGo 作为默认搜索源和失败兜底。

本方案覆盖：

- 工具设置中的 WebSearch 配置项设计
- Python 后端 `WebSearch` 执行链路改造
- 前端设置页接线方式
- 与当前远程 SearXNG 实例的对接参数
- 回退策略与验证方案

不覆盖：

- SearXNG 服务器重新部署
- 域名、HTTPS、鉴权网关
- 多搜索源聚合排序策略的深度改造

## 2. 当前已确认的环境

当前远程 SearXNG 已部署并可访问：

- 地址：`http://182.92.149.8:8888`
- 部署方式：Docker 容器 `searxng`
- 本机探测：`http://127.0.0.1:8888/` 返回 `200`

已确认的服务器侧文件位置：

- 配置文件：`/opt/searxng/config/settings.yml`

说明：当前实例可用，但不是配置文件中列出的所有搜索源都稳定可用，因此 Anima 侧接入时必须保留 DuckDuckGo 兜底。

## 3. 现状梳理

### 3.1 后端默认设置已有预留字段

文件：[`/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/defaults.py`](/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/defaults.py)

当前默认设置里已经存在 `toolSettings.webSearch` 相关字段的预留，说明项目里已经考虑过 SearXNG 接入方向，但还没有真正打通执行逻辑。

### 3.2 WebSearch 当前仍写死走 DuckDuckGo

文件：[`/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/tools.py`](/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/tools.py)

`WebSearch` 当前实现还是直接抓 DuckDuckGo HTML 结果，没有读取 `toolSettings.webSearch` 的配置。

### 3.3 前端工具设置还未完整暴露 webSearch 配置

文件：[`/Users/wangxt/myspace/Anima/src/renderer/src/store/useStore.ts`](/Users/wangxt/myspace/Anima/src/renderer/src/store/useStore.ts)

当前 `toolSettings` 的前端类型没有完整接入 `webSearch` 的 provider 配置，因此设置页无法直接控制 WebSearch 走哪个搜索源。

### 3.4 聊天展示层无需结构性改造

文件：[`/Users/wangxt/myspace/Anima/src/renderer/src/features/chat/ToolTraceGroup.tsx`](/Users/wangxt/myspace/Anima/src/renderer/src/features/chat/ToolTraceGroup.tsx)

前端当前按 `{ query, results }` 的结构展示 WebSearch 结果，所以后端只要维持这一返回结构，展示层基本不用改。

## 4. 最终接入目标

在工具设置中增加 `WebSearch` 的搜索源配置：

- 默认搜索源：`duckduckgo`
- 可选搜索源：`searxng`
- 选择 `searxng` 时，需要填写连接地址 `searxngBaseUrl`

运行时行为：

1. 默认走 DuckDuckGo
2. 当用户在设置中选择 SearXNG 且填写了可访问地址时，优先走 SearXNG
3. SearXNG 请求失败、返回异常或返回空结果时，自动回退 DuckDuckGo
4. 对上层调用方继续返回统一结构：`{ query, results }`

## 5. 推荐配置结构

建议把 WebSearch 配置统一收敛成下面这个结构：

```json
{
  "toolSettings": {
    "webSearch": {
      "provider": "duckduckgo",
      "searxngBaseUrl": ""
    }
  }
}
```

字段说明：

- `provider`
  - 可选值：`duckduckgo | searxng`
  - 默认值：`duckduckgo`
- `searxngBaseUrl`
  - 当 `provider=searxng` 时生效
  - 当前部署实例应填写：`http://182.92.149.8:8888`

## 6. 为什么不用 `searxngEnabled`

如果只是保留 `searxngEnabled: true/false`，那它本质上只是一个开关，不是真正的“搜索源选择器”。

而当前需求是：

- 默认 DuckDuckGo
- 可切换 SearXNG

所以更适合抽象成：

- `provider`

这样后面如果还要扩展别的搜索源，例如 Brave Search、Tavily、SerpAPI，也可以直接平滑扩展，而不是继续堆一串 `xxxEnabled` 字段。

## 7. 与旧配置的兼容策略

考虑到默认设置里已经出现过 `searxngEnabled` 痕迹，建议后端读取配置时保留兼容逻辑。

兼容优先级：

1. 如果 `provider` 存在，则优先使用 `provider`
2. 如果 `provider` 不存在，但 `searxngEnabled == true`
   - 则视为 `provider = "searxng"`
3. 其他情况默认：`provider = "duckduckgo"`

本阶段不建议做强制迁移脚本，先通过读取兼容解决即可，风险更小。

## 8. 后端接入方案

### 8.1 主要改动文件

- [`/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/defaults.py`](/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/defaults.py)
- [`/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/tools.py`](/Users/wangxt/myspace/Anima/pybackend/anima_backend_shared/tools.py)

### 8.2 默认设置修改

在 `defaults.py` 中将 WebSearch 默认值整理为：

```python
"webSearch": {
    "provider": "duckduckgo",
    "searxngBaseUrl": ""
}
```

### 8.3 WebSearch 执行流程

在 `tools.py` 的 `WebSearch` 分支中改成下面这套逻辑：

1. 读取设置 `toolSettings.webSearch`
2. 解析 `provider`
3. 当 `provider == "searxng"` 时：
   - 校验 `searxngBaseUrl`
   - 请求 SearXNG JSON API
   - 解析结果并映射为统一结构
   - 如果失败，则自动回退 DuckDuckGo
4. 当 `provider == "duckduckgo"` 时：
   - 直接走现有 DuckDuckGo 逻辑

### 8.4 建议拆分的小函数

为了避免把 `WebSearch` 分支写得过于臃肿，建议在 `tools.py` 内抽出几个 helper：

- `_resolve_websearch_settings()`
- `_search_with_searxng()`
- `_search_with_duckduckgo()`
- `_map_searxng_results()`

这样后面如果还要继续加 provider，不会把主分支逻辑堆烂。

### 8.5 SearXNG 请求格式

建议调用方式：

```http
GET {baseUrl}/search?q={query}&format=json
```

建议附带参数：

- `language`
- `pageno=1`

示例：

```http
http://182.92.149.8:8888/search?q=apple&format=json&language=zh-CN&pageno=1
```

### 8.6 返回结构统一

不管搜索源来自 DuckDuckGo 还是 SearXNG，最终都统一映射成：

```json
{
  "query": "apple",
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "..."
    }
  ]
}
```

这样可以保证：

- 聊天页展示逻辑无需改动
- Tool trace 的消费方式不变
- 上层调用代码不需要感知 provider 差异

## 9. 前端接入方案

### 9.1 主要改动文件

- [`/Users/wangxt/myspace/Anima/src/renderer/src/store/useStore.ts`](/Users/wangxt/myspace/Anima/src/renderer/src/store/useStore.ts)
- [`/Users/wangxt/myspace/Anima/src/renderer/src/components/SettingsDialog.tsx`](/Users/wangxt/myspace/Anima/src/renderer/src/components/SettingsDialog.tsx)

### 9.2 store 类型扩展

在 `toolSettings` 里增加：

```ts
webSearch?: {
  provider?: 'duckduckgo' | 'searxng'
  searxngBaseUrl?: string
}
```

### 9.3 设置页交互设计

在工具设置区域新增一个 `WebSearch` 配置块，包含：

- 搜索源选择器
  - `DuckDuckGo`
  - `SearXNG`
- 当选择 `SearXNG` 时显示输入框：
  - `SearXNG Base URL`

建议行为：

- 默认值显示 `DuckDuckGo`
- 当切回 `DuckDuckGo` 时，隐藏 URL 输入框
- `searxngBaseUrl` 可保留之前填写的值，不强制清空

当前部署实例可直接填：

```text
http://182.92.149.8:8888
```

## 10. 回退策略

这是本次接入里最重要的一条。

即使用户选择了 `SearXNG`，也不能把它当成唯一可用搜索源，因为当前远程实例上的搜索引擎可用性并不完全稳定。

### 10.1 应触发回退的情况

- `provider=searxng` 但 `searxngBaseUrl` 为空
- `searxngBaseUrl` 非法
- 请求超时
- HTTP 返回非 200
- JSON 解析失败
- SearXNG 返回结果为空

### 10.2 回退行为

- 不把 SearXNG 异常直接抛给用户
- 自动回退走现有 DuckDuckGo 逻辑
- 最终仍返回统一格式结果

### 10.3 这样做的意义

- 避免用户一旦切换到 SearXNG 就被远程服务稳定性绑死
- 兼顾当前自建搜索实例和原有可用性
- 保证 WebSearch 工具整体体验不退化

## 11. 当前实例的推荐接入值

如果本机运行的 Anima 后端可以访问公网地址，那么当前这台远程服务器的推荐配置是：

```json
{
  "toolSettings": {
    "webSearch": {
      "provider": "searxng",
      "searxngBaseUrl": "http://182.92.149.8:8888"
    }
  }
}
```

说明：

- 当前实例没有配置 HTTPS
- 当前实例直接通过 `8888` 端口暴露 HTTP 服务
- 如果后续加了域名和反向代理，建议再把这里替换成正式域名地址

## 12. 推荐开发顺序

### 第一步：后端先打通

先完成：

- `defaults.py` 默认配置整理
- `tools.py` 支持 provider 分发
- SearXNG 失败自动回退 DDG

做到这一步后，即使前端设置页还没补，手动改配置也可以先验证链路。

### 第二步：前端补设置项

再完成：

- `useStore.ts` 类型扩展
- `SettingsDialog.tsx` 增加 WebSearch 配置块

### 第三步：补测试

至少补后端测试，覆盖：

- `provider=duckduckgo` 正常结果
- `provider=searxng` 正常结果
- `provider=searxng` 异常时自动回退

## 13. 测试建议

### 13.1 后端测试

建议增加以下测试点：

1. 默认未配置时走 DuckDuckGo
2. `provider=searxng` 且地址可用时返回 SearXNG 结果
3. `provider=searxng` 但请求报错时回退 DuckDuckGo
4. `provider=searxng` 返回空结果时回退 DuckDuckGo
5. 旧配置 `searxngEnabled=true` 时兼容走 searxng

### 13.2 前端测试

建议验证：

1. 工具设置中可以看到 WebSearch 配置项
2. 切换 provider 时，SearXNG 地址输入框按条件显示
3. 保存后重新打开设置，值仍然存在

## 14. 风险点

### 14.1 当前 SearXNG 不是所有引擎都稳定可用

这意味着：

- “接入成功” 不等于 “所有搜索源都稳定”
- 所以本次集成应该围绕“统一搜索接口 + 可回退”来设计，而不是假设 SearXNG 永远可靠

### 14.2 远程公网 HTTP 访问存在稳定性和安全性限制

当前实例是：

- 公网 IP
- 8888 端口
- HTTP 明文

在开发验证阶段够用，但如果后续长期使用，建议再补：

- 域名
- HTTPS
- 访问控制或网关限制

## 15. 结论

当前最合适的接入方式是：

- 在工具设置里把 WebSearch 做成“搜索源选择器”
- 默认使用 DuckDuckGo
- 支持切换到当前部署的 SearXNG：`http://182.92.149.8:8888`
- 后端优先走 SearXNG，失败自动回退 DuckDuckGo
- 对外继续维持统一结果结构，尽量不动上层调用和展示逻辑

这样改动小，兼容性最好，也最符合当前这台 SearXNG 实例“可用但不完全稳定”的实际情况。