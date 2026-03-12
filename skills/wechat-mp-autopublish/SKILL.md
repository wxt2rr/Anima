---
name: wechat-mp-autopublish
description: 用于公众号发布场景，提供微信接口包装命令（上传素材、创建草稿、提交发布）。
---

# wechat-mp-autopublish

当用户要求“把已生成内容发布到公众号”时使用。

## 执行原则

- 本 skill 只负责微信接口调用，不负责选题检索、写作、配图、排版决策。
- 检索、写作、配图、Markdown 转 HTML 由运行时 Anima 自己执行。
- 用户未明确要求“发布”时，只创建草稿，不提交发布。
- 默认使用 `scripts/wechat_mp_api.py` 子命令，不直接手写 HTTP 请求。

## 前置校验（先执行）

必须先检查环境变量：

```bash
if [ -z "${WECHAT_APPID:-}" ] || [ -z "${WECHAT_APPSECRET:-}" ]; then
  echo "缺少 WECHAT_APPID 或 WECHAT_APPSECRET"
  exit 1
fi
echo "WECHAT_APPID/WECHAT_APPSECRET 已配置"
```

## 运行时分工（必须遵守）

1. 使用 `WebSearch/WebFetch` 对用户提供的内容做资料检索。  
2. 生成文章 Markdown。  
3. 调用 `generate_image` 生成封面和正文图。  
4. 执行以下命令把 Markdown 转为公众号 HTML：`npx marked -i "/absolute/path/article.md" -o "/absolute/path/article.wechat.html" --gfm --breaks`。  
5. 本 skill 负责微信接口阶段：上传正文图、上传封面、创建草稿、按需发布。  

## Markdown 转 HTML 命令模板

```bash
npx marked \
  -i "/absolute/path/article.md" \
  -o "/absolute/path/article.wechat.html" \
  --gfm \
  --breaks
```

## 微信接口命令模板

说明：以下命令由 Anima 按需串联执行；不是“一键全自动脚本”。

### 1) 获取 token（可选，通常可省略）

```bash
python3 skills/wechat-mp-autopublish/scripts/wechat_mp_api.py token
```

### 2) 上传正文图片（返回微信 URL）

```bash
python3 skills/wechat-mp-autopublish/scripts/wechat_mp_api.py upload-inline-image \
  --file "/absolute/path/body-image.png"
```

### 3) 上传封面图（返回 `media_id`，作为 `thumb_media_id`）

```bash
python3 skills/wechat-mp-autopublish/scripts/wechat_mp_api.py upload-cover \
  --file "/absolute/path/cover.png"
```

### 4) 创建草稿（默认终点）

```bash
python3 skills/wechat-mp-autopublish/scripts/wechat_mp_api.py create-draft \
  --title "文章标题" \
  --author "作者名" \
  --digest "摘要" \
  --content-file "/absolute/path/article.wechat.html" \
  --thumb-media-id "上一步返回的media_id"
```

### 5) 提交发布（仅用户明确要求时）

```bash
python3 skills/wechat-mp-autopublish/scripts/wechat_mp_api.py submit-publish \
  --media-id "草稿media_id"
```

## 结果验收

至少确认：

- `create-draft` 返回包含 `media_id`
- 未明确要求发布时，不执行 `submit-publish`
- 执行发布时，`submit-publish` 返回包含 `publish_id`
