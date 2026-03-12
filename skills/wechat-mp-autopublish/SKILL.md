---
name: wechat-mp-autopublish
description: 当需要全自动完成公众号选题资料检索、Markdown写作、配图生成、素材上传、草稿创建与发布时使用（搜索与生图均走本地 Anima 工具链）。
---

# wechat-mp-autopublish

当用户要求“全自动生成并发布公众号文章”时使用本技能。

## 前置条件

必须配置：

- `WECHAT_APPID`
- `WECHAT_APPSECRET`

必须满足：

- 本地 Anima backend 已启动（默认 `http://127.0.0.1:17333`）
- Anima 内已配置可用模型与工具能力（脚本会通过 `/api/runs` 调用 `WebSearch/WebFetch/generate_image`）

可选：

- `ANIMA_BACKEND_BASE_URL`（默认 `http://127.0.0.1:17333`）

## 一键全自动

```bash
python3 skills/wechat-mp-autopublish/scripts/auto_wechat_publish.py \
  --topic "你的主题" \
  --author "作者名"
```

直接发布（默认仅创建草稿）：

```bash
python3 skills/wechat-mp-autopublish/scripts/auto_wechat_publish.py \
  --topic "你的主题" \
  --author "作者名" \
  --publish
```

## 自动化流程

1. 调用本地 `/api/runs` + `WebSearch/WebFetch` 完成资料检索
2. 生成文章 Markdown
3. 调用本地 `/api/runs` + `generate_image` 生成封面和正文图
4. 将 Markdown 转为公众号 HTML
5. 上传正文图片并替换微信 URL
6. 上传封面图获取 `thumb_media_id`
7. 创建草稿，按需提交发布

## 输出结果

每次运行在 `skills/wechat-mp-autopublish/output/<timestamp-topic>/` 生成：

- `references.json`
- `article.md`
- `article.html`
- `article.wechat.html`
- `images/`
- `result.json`

## 脚本文件

- 总控：`skills/wechat-mp-autopublish/scripts/auto_wechat_publish.py`
- 微信接口：`skills/wechat-mp-autopublish/scripts/wechat_mp_api.py`

## 参考文档

- `skills/wechat-mp-autopublish/references/wechat-official-account-api.md`
