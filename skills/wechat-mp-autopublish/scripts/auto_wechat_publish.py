#!/usr/bin/env python3
import argparse
import datetime as dt
import html
import json
import os
import pathlib
import re
import sys
import urllib.request
import uuid
from typing import Any, Dict, List, Optional, Tuple

from wechat_mp_api import ApiError, create_draft, get_stable_token, submit_publish, upload_cover, upload_inline_image

DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:17333"


def fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    sys.exit(1)


def read_json_response(resp: Any) -> Dict[str, Any]:
    raw = resp.read().decode("utf-8", errors="replace")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(f"invalid json response: {raw}")


def post_backend_runs(base_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{base_url}/api/runs", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=240) as resp:
        data = read_json_response(resp)
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise ApiError(f"/api/runs failed: {json.dumps(data, ensure_ascii=False)}")
    return data


def extract_json_block(text: str) -> Dict[str, Any]:
    s = str(text or "").strip()
    if not s:
        raise ApiError("empty model content")
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        raise ApiError(f"model output is not json: {s}")
    try:
        obj = json.loads(m.group(0))
    except Exception as e:
        raise ApiError(f"parse json failed: {s}") from e
    if not isinstance(obj, dict):
        raise ApiError("json root must be object")
    return obj


def markdown_to_html(md: str) -> str:
    try:
        import markdown as mdlib  # type: ignore

        return mdlib.markdown(md, extensions=["extra", "tables", "fenced_code", "sane_lists"])
    except Exception:
        lines = md.splitlines()
        html_parts: List[str] = []
        in_ul = False
        in_code = False
        code_buf: List[str] = []
        for line in lines:
            if line.startswith("```"):
                if not in_code:
                    in_code = True
                    code_buf = []
                else:
                    in_code = False
                    html_parts.append("<pre><code>" + html.escape("\n".join(code_buf)) + "</code></pre>")
                continue
            if in_code:
                code_buf.append(line)
                continue

            hm = re.match(r"^(#{1,6})\s+(.*)$", line)
            if hm:
                if in_ul:
                    html_parts.append("</ul>")
                    in_ul = False
                lv = len(hm.group(1))
                html_parts.append(f"<h{lv}>{html.escape(hm.group(2).strip())}</h{lv}>")
                continue

            im = re.match(r"^!\[(.*?)\]\((.*?)\)$", line.strip())
            if im:
                if in_ul:
                    html_parts.append("</ul>")
                    in_ul = False
                alt = html.escape(im.group(1).strip())
                src = html.escape(im.group(2).strip(), quote=True)
                html_parts.append(f'<p><img src="{src}" alt="{alt}" /></p>')
                continue

            lm = re.match(r"^[-*+]\s+(.*)$", line)
            if lm:
                if not in_ul:
                    html_parts.append("<ul>")
                    in_ul = True
                html_parts.append("<li>" + html.escape(lm.group(1).strip()) + "</li>")
                continue

            if in_ul:
                html_parts.append("</ul>")
                in_ul = False

            if line.strip():
                html_parts.append("<p>" + html.escape(line.strip()) + "</p>")

        if in_ul:
            html_parts.append("</ul>")
        return "\n".join(html_parts)


def replace_img_src_with_wechat_urls(html_text: str, html_file_dir: pathlib.Path, token: str) -> Tuple[str, List[Dict[str, str]]]:
    replaced: List[Dict[str, str]] = []

    def repl(m: re.Match) -> str:
        src = m.group(1)
        s = src.strip()
        if not s or re.match(r"^https?://", s):
            return m.group(0)
        fp = pathlib.Path(s)
        if not fp.is_absolute():
            fp = (html_file_dir / fp).resolve()
        data = upload_inline_image(token, str(fp))
        wx_url = str(data.get("url") or "").strip()
        if not wx_url:
            raise ApiError(f"upload inline image failed for {fp}")
        replaced.append({"local": str(fp), "wechat": wx_url})
        return m.group(0).replace(src, wx_url)

    out = re.sub(r'<img\s+[^>]*src="([^"]+)"[^>]*>', repl, html_text, flags=re.IGNORECASE)
    return out, replaced


def slugify(s: str) -> str:
    x = re.sub(r"\s+", "-", s.strip().lower())
    x = re.sub(r"[^a-z0-9\-\u4e00-\u9fff]", "", x)
    return x[:48] or "article"


def build_research_and_markdown(base_url: str, topic: str, workspace_dir: pathlib.Path) -> Dict[str, Any]:
    prompt = (
        "你需要调用 WebSearch 和 WebFetch 工具完成研究。"
        "请输出严格 JSON（不要 markdown 代码块），字段为："
        "title,digest,markdown,sources,cover_prompt,body_image_prompts。"
        "其中 sources 为数组，每项含 title,url,summary。"
        "markdown 要是可发布中文长文，结构：导语、3-5个小节、结论与行动建议。"
        f"主题：{topic}。"
    )
    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "composer": {
            "workspaceDir": str(workspace_dir),
            "toolMode": "all",
            "enabledToolIds": ["WebSearch", "WebFetch"],
        },
        "temperature": 0.4,
        "maxTokens": 4000,
        "runId": str(uuid.uuid4()),
        "threadId": f"wechat-research-{uuid.uuid4().hex[:8]}",
        "useThreadMessages": False,
    }
    data = post_backend_runs(base_url, payload)
    content = str(data.get("content") or "")
    obj = extract_json_block(content)

    title = str(obj.get("title") or "").strip()
    digest = str(obj.get("digest") or "").strip()
    markdown = str(obj.get("markdown") or "").strip()
    cover_prompt = str(obj.get("cover_prompt") or "").strip()
    body_prompts = obj.get("body_image_prompts")
    sources = obj.get("sources")

    if not title or not digest or not markdown:
        raise ApiError(f"research output missing fields: {json.dumps(obj, ensure_ascii=False)}")

    if not isinstance(body_prompts, list):
        body_prompts = []
    if not isinstance(sources, list):
        sources = []

    return {
        "title": title,
        "digest": digest,
        "markdown": markdown,
        "cover_prompt": cover_prompt or f"{topic}，公众号封面，现代简洁，信息感",
        "body_image_prompts": [str(x).strip() for x in body_prompts if str(x).strip()][:3],
        "sources": sources,
        "traces": data.get("traces") or [],
    }


def run_generate_images(base_url: str, workspace_dir: pathlib.Path, cover_prompt: str, body_prompts: List[str]) -> Dict[str, Any]:
    prompts = body_prompts[:] if body_prompts else ["信息图风格，简洁，中文互联网语境，公众号正文插图"]
    tool_lines = [
        "请严格调用 generate_image 工具来生成图片，不要只输出文字。",
        "按下面路径生成文件：",
        f"1) 封面图 path=images/cover.png prompt={cover_prompt}",
    ]
    for i, p in enumerate(prompts, start=1):
        tool_lines.append(f"{i+1}) 正文图 path=images/body-{i}.png prompt={p}")
    tool_lines.append("执行完成后，返回一个JSON对象，字段：cover,body。")
    prompt = "\n".join(tool_lines)

    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "composer": {
            "workspaceDir": str(workspace_dir),
            "toolMode": "all",
            "enabledToolIds": ["generate_image", "read_file", "list_dir"],
        },
        "temperature": 0.2,
        "maxTokens": 1200,
        "runId": str(uuid.uuid4()),
        "threadId": f"wechat-image-{uuid.uuid4().hex[:8]}",
        "useThreadMessages": False,
    }
    data = post_backend_runs(base_url, payload)

    artifacts = data.get("artifacts") if isinstance(data.get("artifacts"), list) else []
    image_paths: List[str] = []
    for a in artifacts:
        if not isinstance(a, dict):
            continue
        if str(a.get("kind") or "") != "image":
            continue
        p = str(a.get("path") or "").strip()
        if p:
            image_paths.append(p)

    if not image_paths:
        raise ApiError("generate_image returned no artifacts")

    cover_rel = ""
    body_rel: List[str] = []
    for p in image_paths:
        if p.endswith("images/cover.png"):
            cover_rel = p
        elif re.search(r"images/body-\d+\.png$", p):
            body_rel.append(p)

    if not cover_rel:
        cover_rel = "images/cover.png"
    body_rel = sorted(set(body_rel))
    if not body_rel:
        body_rel = [p for p in image_paths if p != cover_rel]

    cover_abs = workspace_dir / cover_rel
    if not cover_abs.is_file():
        raise ApiError(f"cover image missing: {cover_abs}")
    for p in body_rel:
        if not (workspace_dir / p).is_file():
            raise ApiError(f"body image missing: {workspace_dir / p}")

    return {"cover": cover_rel, "body": body_rel, "artifacts": artifacts}


def run_pipeline(args: argparse.Namespace) -> Dict[str, Any]:
    appid = os.getenv("WECHAT_APPID", "").strip()
    appsecret = os.getenv("WECHAT_APPSECRET", "").strip()
    if not appid or not appsecret:
        raise ApiError("missing WECHAT_APPID/WECHAT_APPSECRET")

    backend_url = str(args.backend_base_url or DEFAULT_BACKEND_BASE_URL).rstrip("/")

    out_root = pathlib.Path(args.output_dir).resolve()
    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = out_root / f"{ts}-{slugify(args.topic)}"
    run_dir.mkdir(parents=True, exist_ok=True)

    research = build_research_and_markdown(backend_url, args.topic, run_dir)
    references_path = run_dir / "references.json"
    references_path.write_text(json.dumps(research.get("sources") or [], ensure_ascii=False, indent=2), encoding="utf-8")

    images = run_generate_images(
        backend_url,
        run_dir,
        str(research.get("cover_prompt") or ""),
        [str(x) for x in (research.get("body_image_prompts") or []) if str(x).strip()],
    )

    markdown_text = str(research.get("markdown") or "").rstrip()
    body_md = "\n\n" + "\n\n".join([f"![配图{i}]({p})" for i, p in enumerate(images["body"], start=1)])
    markdown_text = markdown_text + body_md + "\n"

    md_path = run_dir / "article.md"
    md_path.write_text(markdown_text, encoding="utf-8")

    html_text = markdown_to_html(markdown_text)
    html_path = run_dir / "article.html"
    html_path.write_text(html_text, encoding="utf-8")

    token_data = get_stable_token(appid, appsecret, force_refresh=False)
    token = str(token_data.get("access_token") or "").strip()
    if not token:
        raise ApiError("empty access_token")

    html_wechat, replaced = replace_img_src_with_wechat_urls(html_text, run_dir, token)
    wechat_html_path = run_dir / "article.wechat.html"
    wechat_html_path.write_text(html_wechat, encoding="utf-8")

    cover_rel = str(images["cover"])
    cover_abs = run_dir / cover_rel
    cover_upload = upload_cover(token, str(cover_abs))
    thumb_media_id = str(cover_upload.get("media_id") or "").strip()
    if not thumb_media_id:
        raise ApiError("thumb_media_id missing")

    draft = create_draft(
        token,
        {
            "title": str(research.get("title") or "").strip() or args.topic,
            "author": args.author,
            "digest": str(research.get("digest") or "").strip(),
            "content": html_wechat,
            "thumb_media_id": thumb_media_id,
            "content_source_url": args.content_source_url,
            "need_open_comment": int(args.need_open_comment),
            "only_fans_can_comment": int(args.only_fans_can_comment),
        },
    )
    draft_media_id = str(draft.get("media_id") or "").strip()
    if not draft_media_id:
        raise ApiError("draft media_id missing")

    publish = None
    if args.publish:
        publish = submit_publish(token, draft_media_id)

    result = {
        "ok": True,
        "topic": args.topic,
        "backend_base_url": backend_url,
        "run_dir": str(run_dir),
        "paths": {
            "references_json": str(references_path),
            "markdown": str(md_path),
            "html": str(html_path),
            "wechat_html": str(wechat_html_path),
            "cover": str(cover_abs),
        },
        "wechat": {
            "thumb_media_id": thumb_media_id,
            "draft_media_id": draft_media_id,
            "publish": publish,
        },
        "image_replace": replaced,
    }
    (run_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> None:
    p = argparse.ArgumentParser(description="Fully automated WeChat MP pipeline via local Anima tools")
    p.add_argument("--topic", required=True)
    p.add_argument("--author", default="")
    p.add_argument("--content-source-url", default="")
    p.add_argument("--need-open-comment", type=int, choices=[0, 1], default=0)
    p.add_argument("--only-fans-can-comment", type=int, choices=[0, 1], default=0)
    p.add_argument("--publish", action="store_true")
    p.add_argument("--backend-base-url", default=os.getenv("ANIMA_BACKEND_BASE_URL", DEFAULT_BACKEND_BASE_URL))
    p.add_argument("--output-dir", default="./skills/wechat-mp-autopublish/output")
    args = p.parse_args()

    try:
        out = run_pipeline(args)
        print(json.dumps(out, ensure_ascii=False, indent=2))
    except Exception as e:
        fail(str(e))


if __name__ == "__main__":
    main()
