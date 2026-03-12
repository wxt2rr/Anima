#!/usr/bin/env python3
import argparse
import json
import mimetypes
import os
import sys
import uuid
import urllib.parse
import urllib.request

API_BASE = "https://api.weixin.qq.com"


class ApiError(RuntimeError):
    pass


def read_json_response(resp):
    raw = resp.read().decode("utf-8", errors="replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise ApiError(f"invalid json response: {raw}") from e


def http_post_json(url, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return read_json_response(resp)


def http_post_multipart(url, field_name, file_path):
    if not os.path.isfile(file_path):
        raise ApiError(f"file not found: {file_path}")

    filename = os.path.basename(file_path)
    mime, _ = mimetypes.guess_type(filename)
    mime = mime or "application/octet-stream"
    boundary = f"----CodexBoundary{uuid.uuid4().hex}"

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    pre = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"{field_name}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n"
    ).encode("utf-8")
    post = f"\r\n--{boundary}--\r\n".encode("utf-8")
    body = pre + file_bytes + post

    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    req.add_header("Content-Length", str(len(body)))
    with urllib.request.urlopen(req, timeout=60) as resp:
        return read_json_response(resp)


def ensure_ok(data):
    if isinstance(data, dict) and data.get("errcode") not in (None, 0):
        raise ApiError(json.dumps(data, ensure_ascii=False))
    return data


def get_stable_token(appid, appsecret, force_refresh=False):
    url = f"{API_BASE}/cgi-bin/stable_token"
    payload = {
        "grant_type": "client_credential",
        "appid": appid,
        "secret": appsecret,
        "force_refresh": bool(force_refresh),
    }
    data = ensure_ok(http_post_json(url, payload))
    token = data.get("access_token")
    if not token:
        raise ApiError(f"access_token missing: {json.dumps(data, ensure_ascii=False)}")
    return data


def upload_inline_image(access_token, file_path):
    q = urllib.parse.urlencode({"access_token": access_token})
    url = f"{API_BASE}/cgi-bin/media/uploadimg?{q}"
    data = ensure_ok(http_post_multipart(url, "media", file_path))
    if not data.get("url"):
        raise ApiError(f"uploadimg url missing: {json.dumps(data, ensure_ascii=False)}")
    return data


def upload_cover(access_token, file_path):
    q = urllib.parse.urlencode({"access_token": access_token, "type": "image"})
    url = f"{API_BASE}/cgi-bin/material/add_material?{q}"
    data = ensure_ok(http_post_multipart(url, "media", file_path))
    if not data.get("media_id"):
        raise ApiError(f"media_id missing: {json.dumps(data, ensure_ascii=False)}")
    return data


def create_draft(access_token, article):
    q = urllib.parse.urlencode({"access_token": access_token})
    url = f"{API_BASE}/cgi-bin/draft/add?{q}"
    payload = {"articles": [article]}
    data = ensure_ok(http_post_json(url, payload))
    if not data.get("media_id"):
        raise ApiError(f"draft media_id missing: {json.dumps(data, ensure_ascii=False)}")
    return data


def submit_publish(access_token, media_id):
    q = urllib.parse.urlencode({"access_token": access_token})
    url = f"{API_BASE}/cgi-bin/freepublish/submit?{q}"
    payload = {"media_id": media_id}
    data = ensure_ok(http_post_json(url, payload))
    if not data.get("publish_id"):
        raise ApiError(f"publish_id missing: {json.dumps(data, ensure_ascii=False)}")
    return data


def read_text_file(path):
    if not os.path.isfile(path):
        raise ApiError(f"file not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def article_from_args(args):
    content = read_text_file(args.content_file)
    article = {
        "title": args.title,
        "author": args.author,
        "digest": args.digest,
        "content": content,
        "thumb_media_id": args.thumb_media_id,
        "content_source_url": args.content_source_url or "",
        "need_open_comment": int(args.need_open_comment),
        "only_fans_can_comment": int(args.only_fans_can_comment),
    }
    return article


def resolve_access_token(args):
    if getattr(args, "access_token", None):
        return args.access_token
    appid = os.getenv("WECHAT_APPID", "").strip()
    appsecret = os.getenv("WECHAT_APPSECRET", "").strip()
    if not appid or not appsecret:
        raise ApiError("missing access_token and WECHAT_APPID/WECHAT_APPSECRET")
    return get_stable_token(appid, appsecret, force_refresh=False)["access_token"]


def print_json(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="WeChat Official Account publish helper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_token = sub.add_parser("token")
    p_token.add_argument("--appid", default=os.getenv("WECHAT_APPID", ""))
    p_token.add_argument("--appsecret", default=os.getenv("WECHAT_APPSECRET", ""))
    p_token.add_argument("--force-refresh", action="store_true")

    p_inline = sub.add_parser("upload-inline-image")
    p_inline.add_argument("--access-token", default="")
    p_inline.add_argument("--file", required=True)

    p_cover = sub.add_parser("upload-cover")
    p_cover.add_argument("--access-token", default="")
    p_cover.add_argument("--file", required=True)

    p_draft = sub.add_parser("create-draft")
    p_draft.add_argument("--access-token", default="")
    p_draft.add_argument("--title", required=True)
    p_draft.add_argument("--author", default="")
    p_draft.add_argument("--digest", default="")
    p_draft.add_argument("--content-file", required=True)
    p_draft.add_argument("--thumb-media-id", required=True)
    p_draft.add_argument("--content-source-url", default="")
    p_draft.add_argument("--need-open-comment", type=int, choices=[0, 1], default=0)
    p_draft.add_argument("--only-fans-can-comment", type=int, choices=[0, 1], default=0)

    p_publish = sub.add_parser("submit-publish")
    p_publish.add_argument("--access-token", default="")
    p_publish.add_argument("--media-id", required=True)

    args = parser.parse_args()

    try:
        if args.cmd == "token":
            if not args.appid.strip() or not args.appsecret.strip():
                raise ApiError("missing appid/appsecret")
            result = get_stable_token(args.appid.strip(), args.appsecret.strip(), args.force_refresh)
            print_json(result)
            return

        if args.cmd == "upload-inline-image":
            token = resolve_access_token(args)
            print_json(upload_inline_image(token, args.file))
            return

        if args.cmd == "upload-cover":
            token = resolve_access_token(args)
            print_json(upload_cover(token, args.file))
            return

        if args.cmd == "create-draft":
            token = resolve_access_token(args)
            article = article_from_args(args)
            print_json(create_draft(token, article))
            return

        if args.cmd == "submit-publish":
            token = resolve_access_token(args)
            print_json(submit_publish(token, args.media_id))
            return

        raise ApiError(f"unknown cmd: {args.cmd}")

    except ApiError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
