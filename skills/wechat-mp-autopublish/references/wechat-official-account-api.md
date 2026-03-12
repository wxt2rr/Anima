# 微信公众号发布链路接口参考

本文件用于 `wechat-mp-autopublish` 技能在执行步骤 3/4/5 时快速查阅。

## 1. 接口链路

1. 获取 `access_token`（建议 stable token）
2. 上传正文图片，获取微信托管 URL
3. 上传封面图，获取 `thumb_media_id`
4. 新建草稿，获取草稿 `media_id`
5. 可选：提交发布，获取 `publish_id`

## 2. 关键接口

### 2.1 获取 stable access token

- Method: `POST`
- URL: `https://api.weixin.qq.com/cgi-bin/stable_token`
- Body:

```json
{
  "grant_type": "client_credential",
  "appid": "APPID",
  "secret": "APPSECRET",
  "force_refresh": false
}
```

### 2.2 上传图文内图片（正文图片）

- Method: `POST multipart/form-data`
- URL: `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=ACCESS_TOKEN`
- Form field: `media=@file`
- 返回核心字段：`url`

### 2.3 上传封面图（永久素材）

- Method: `POST multipart/form-data`
- URL: `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=ACCESS_TOKEN&type=image`
- Form field: `media=@file`
- 返回核心字段：`media_id`

### 2.4 创建草稿

- Method: `POST`
- URL: `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=ACCESS_TOKEN`
- Body（单图文示例）:

```json
{
  "articles": [
    {
      "title": "标题",
      "author": "作者",
      "digest": "摘要",
      "content": "<h1>html正文</h1>",
      "content_source_url": "",
      "thumb_media_id": "THUMB_MEDIA_ID",
      "need_open_comment": 0,
      "only_fans_can_comment": 0
    }
  ]
}
```

### 2.5 提交发布

- Method: `POST`
- URL: `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=ACCESS_TOKEN`
- Body:

```json
{
  "media_id": "DRAFT_MEDIA_ID"
}
```

## 3. 正文格式要求（实现重点）

- 草稿接口 `content` 使用 HTML。
- 正文中的图片 URL 必须来自“图文内图片上传接口”，外链图片会被过滤。
- 建议发布前做一次 HTML 清洗：去脚本、去内联事件、统一段落与标题结构。

## 4. 实现建议

- Token 策略：
  - 默认优先复用缓存 token。
  - 出现 token 失效类错误时，强制刷新后重试一次。
- 图片策略：
  - 正文图统一先上传 `uploadimg`，再替换 URL。
  - 封面图单独走 `add_material` 获取 `thumb_media_id`。
- 发布策略：
  - 默认“创建草稿并返回草稿ID”，由用户确认后再提交发布。

## 5. 常见错误

- `40164 invalid ip ... not in whitelist`：服务器 IP 未加入公众号后台白名单。
- 频率限制错误：token 获取过于频繁，需缓存并复用。
- 素材上传失败：文件类型/大小不符合要求或 multipart 字段错误。

## 6. 资料来源

以下为实现时使用的官方文档入口与参考页：

- 新建草稿（官方）：<https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html>
- 发布（官方）：<https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html>
- 临时素材（官方）：<https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/New_temporary_materials.html>
- 永久素材（官方）：<https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/Adding_Permanent_Assets.html>
- 稳定版 token（官方文档入口）：<https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getStableAccessToken.html>
- 参考实现文章（含官方链接与参数示例）：<https://cnzain.cn/blogs/zain/wechatarticle>
