#!/usr/bin/env python3
"""Text to SVG Infographic generator.

Deterministic baseline renderer for an agentic Text-to-SVG skill.
It extracts a simple outline from raw text, picks a visual layout, and renders an editable SVG.

No external dependencies required.
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

FONT = "Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif"

THEMES: Dict[str, Dict[str, str]] = {
    "blue": {"primary": "#3B82F6", "secondary": "#06B6D4", "accent": "#8B5CF6", "green": "#22C55E", "orange": "#F59E0B", "pink": "#EC4899"},
    "cyan": {"primary": "#06B6D4", "secondary": "#22C55E", "accent": "#6366F1", "green": "#10B981", "orange": "#F97316", "pink": "#E879F9"},
    "violet": {"primary": "#7C3AED", "secondary": "#06B6D4", "accent": "#F97316", "green": "#22C55E", "orange": "#F59E0B", "pink": "#EC4899"},
    "green": {"primary": "#10B981", "secondary": "#3B82F6", "accent": "#F59E0B", "green": "#22C55E", "orange": "#F97316", "pink": "#EC4899"},
    "orange": {"primary": "#F97316", "secondary": "#3B82F6", "accent": "#22C55E", "green": "#10B981", "orange": "#F59E0B", "pink": "#EC4899"},
}

LAYOUTS = {"auto", "timeline", "process", "fishbone", "pyramid", "matrix", "pillars", "radial", "cycle", "stair", "kpi"}


def is_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def split_sentences(text: str) -> List[str]:
    text = re.sub(r"\s+", " ", text.strip())
    parts = re.split(r"(?<=[。！？!?；;])\s*|\n+", text)
    parts = [p.strip(" ，,。.;；") for p in parts if p.strip(" ，,。.;；")]
    if len(parts) <= 1:
        parts = [p.strip() for p in re.split(r"[，,、]", text) if p.strip()]
    return parts[:12]


def compact(s: str, max_len: int) -> str:
    s = re.sub(r"\s+", " ", s.strip())
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def infer_title(text: str) -> str:
    first = split_sentences(text)[0] if split_sentences(text) else text.strip()
    if "：" in first:
        return compact(first.split("：", 1)[0], 18)
    if ":" in first:
        return compact(first.split(":", 1)[0], 42)
    return compact(first, 18 if is_cjk(text) else 42)


def keyword_score(text: str, words: List[str]) -> int:
    lower = text.lower()
    return sum(lower.count(w.lower()) for w in words)


def infer_layout(text: str, explicit: str = "auto") -> str:
    if explicit != "auto":
        return explicit
    scores = {
        "timeline": keyword_score(text, ["阶段", "时间", "里程碑", "版本", "roadmap", "timeline", "milestone", "phase", "step 1", "step 2"]),
        "process": keyword_score(text, ["流程", "步骤", "输入", "输出", "pipeline", "workflow", "process", "first", "then", "finally"]),
        "fishbone": keyword_score(text, ["原因", "根因", "影响因素", "导致", "问题", "故障", "cause", "root cause", "why", "issue"]),
        "pyramid": keyword_score(text, ["层", "基础", "架构", "成熟度", "依赖", "stack", "layer", "foundation", "architecture"]),
        "matrix": keyword_score(text, ["对比", "维度", "矩阵", "分类", "优先级", "compare", "versus", "matrix", "quadrant"]),
        "radial": keyword_score(text, ["围绕", "核心", "能力", "模块", "中心", "hub", "spoke", "capability"]),
        "cycle": keyword_score(text, ["循环", "反馈", "迭代", "闭环", "增长飞轮", "cycle", "loop", "feedback", "flywheel"]),
        "stair": keyword_score(text, ["提升", "增长", "放大", "进阶", "逐步", "提高", "growth", "increase", "improve", "scale"]),
        "kpi": len(re.findall(r"\d+\s*%|\b\d+(?:\.\d+)?\b", text)),
    }
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        sentences = split_sentences(text)
        return "pillars" if len(sentences) <= 6 else "process"
    return best


def extract_sections(text: str, layout: str) -> List[Dict[str, str]]:
    sentences = split_sentences(text)
    if not sentences:
        sentences = [text.strip()]

    # Try split after title colon.
    if len(sentences) == 1 and ("：" in sentences[0] or ":" in sentences[0]):
        raw = re.split(r"[：:]", sentences[0], 1)[1]
        sentences = [p.strip() for p in re.split(r"[；;。,.，、]", raw) if p.strip()]

    n = 4
    if layout in {"timeline", "process", "pillars", "cycle", "stair"}:
        n = min(max(len(sentences), 3), 5)
    elif layout == "fishbone":
        n = 6
    elif layout == "matrix":
        n = 4
    elif layout == "kpi":
        n = min(max(len(re.findall(r"\d+\s*%|\b\d+(?:\.\d+)?\b", text)), 3), 4)

    fallback_titles_cn = ["核心前提", "关键机制", "执行路径", "结果表现", "持续优化", "外部因素"]
    fallback_titles_en = ["Foundation", "Mechanism", "Execution", "Outcome", "Optimization", "Context"]
    fallback_titles = fallback_titles_cn if is_cjk(text) else fallback_titles_en

    sections: List[Dict[str, str]] = []
    for i in range(n):
        body = sentences[i] if i < len(sentences) else fallback_titles[i % len(fallback_titles)]
        # Title heuristic: part before comma or first short noun phrase.
        if "，" in body:
            title = body.split("，", 1)[0]
            desc = body.split("，", 1)[1]
        elif "," in body:
            title = body.split(",", 1)[0]
            desc = body.split(",", 1)[1]
        else:
            title = body
            desc = body
        sections.append({
            "title": compact(title, 10 if is_cjk(text) else 22),
            "body": compact(desc, 34 if is_cjk(text) else 70),
        })
    return sections


def build_outline(text: str, layout: str = "auto", title: str | None = None, subtitle: str | None = None) -> Dict:
    chosen = infer_layout(text, layout)
    inferred_title = title or infer_title(text)
    sentences = split_sentences(text)
    inferred_subtitle = subtitle or compact(sentences[1] if len(sentences) > 1 else text, 32 if is_cjk(text) else 90)
    sections = extract_sections(text, chosen)
    return {
        "title": inferred_title,
        "subtitle": inferred_subtitle,
        "layout": chosen,
        "sections": sections,
        "source_length": len(text),
    }


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def wrap_tspans(text: str, x: int, y: int, max_chars: int, line_height: int = 18, cls: str = "body") -> str:
    text = text.strip()
    chunks: List[str] = []
    if is_cjk(text):
        while text:
            chunks.append(text[:max_chars])
            text = text[max_chars:]
    else:
        words = text.split()
        line = ""
        for w in words:
            if len((line + " " + w).strip()) > max_chars and line:
                chunks.append(line)
                line = w
            else:
                line = (line + " " + w).strip()
        if line:
            chunks.append(line)
    chunks = chunks[:3]
    spans = []
    for i, c in enumerate(chunks):
        dy = 0 if i == 0 else line_height
        spans.append(f'<tspan x="{x}" dy="{dy}">{esc(c)}</tspan>')
    return f'<text class="{cls}" x="{x}" y="{y}">' + "".join(spans) + "</text>"


def svg_header(width: int, height: int, theme: Dict[str, str]) -> str:
    return f'''<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#0F172A" flood-opacity="0.12"/>
    </filter>
    <linearGradient id="primaryGrad" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="{theme['primary']}"/>
      <stop offset="1" stop-color="{theme['secondary']}"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="{theme['accent']}"/>
      <stop offset="1" stop-color="{theme['orange']}"/>
    </linearGradient>
    <marker id="arrowHead" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
      <path d="M2 2 L10 6 L2 10 Z" fill="{theme['primary']}"/>
    </marker>
    <style>
      .font {{ font-family: {FONT}; }}
      .title {{ font-family: {FONT}; font-size: 30px; font-weight: 800; fill: #0F172A; }}
      .subtitle {{ font-family: {FONT}; font-size: 15px; fill: #475569; }}
      .section-title {{ font-family: {FONT}; font-size: 17px; font-weight: 700; fill: #0F172A; }}
      .body {{ font-family: {FONT}; font-size: 13px; fill: #475569; }}
      .small {{ font-family: {FONT}; font-size: 12px; fill: #64748B; }}
    </style>
  </defs>
  <rect width="{width}" height="{height}" rx="28" fill="#F8FAFC"/>
'''


def title_block(outline: Dict, width: int) -> str:
    return f'''  <g id="title-block">
    <text id="title" class="title" x="{width//2}" y="58" text-anchor="middle">{esc(outline['title'])}</text>
    <text id="subtitle" class="subtitle" x="{width//2}" y="86" text-anchor="middle">{esc(outline['subtitle'])}</text>
  </g>
'''


def render_pillars(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:5]
    n = len(sections)
    gap = 22
    card_w = int((width - 100 - gap * (n - 1)) / n)
    y = 175
    colors = [theme['primary'], theme['secondary'], theme['green'], theme['orange'], theme['accent']]
    body = ['  <g id="pillar-cards" filter="url(#shadow)">']
    for i, s in enumerate(sections):
        x = 50 + i * (card_w + gap)
        h = 230
        body.append(f'''
    <g id="section-{i+1}" class="font">
      <rect x="{x}" y="{y}" width="{card_w}" height="{h}" rx="22" fill="#FFFFFF" stroke="#E2E8F0"/>
      <circle cx="{x+card_w//2}" cy="{y+56}" r="30" fill="{colors[i % len(colors)]}" opacity="0.14"/>
      <circle cx="{x+card_w//2}" cy="{y+56}" r="18" fill="{colors[i % len(colors)]}"/>
      <text class="section-title" x="{x+card_w//2}" y="{y+115}" text-anchor="middle">{esc(s['title'])}</text>
      {wrap_tspans(s['body'], x+22, y+148, max(8, card_w//12), 18, 'body')}
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_process(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:5]
    n = len(sections)
    start_x, end_x, y = 90, width - 90, 285
    step_gap = (end_x - start_x) / max(n - 1, 1)
    body = [f'  <g id="process-flow"><line x1="{start_x}" y1="{y}" x2="{end_x}" y2="{y}" stroke="{theme["primary"]}" stroke-width="4" stroke-linecap="round" marker-end="url(#arrowHead)"/>']
    for i, s in enumerate(sections):
        x = int(start_x + i * step_gap)
        cy = y
        body.append(f'''
    <g id="step-{i+1}" filter="url(#shadow)">
      <circle cx="{x}" cy="{cy}" r="34" fill="#FFFFFF" stroke="{theme['primary']}" stroke-width="3"/>
      <text class="section-title" x="{x}" y="{cy+6}" text-anchor="middle">{i+1}</text>
      <rect x="{x-78}" y="{cy+58}" width="156" height="96" rx="18" fill="#FFFFFF" stroke="#E2E8F0"/>
      <text class="section-title" x="{x}" y="{cy+88}" text-anchor="middle">{esc(s['title'])}</text>
      {wrap_tspans(s['body'], x-60, cy+113, 13, 17, 'body')}
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_timeline(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:5]
    return render_process(outline, width, height, theme).replace('process-flow', 'timeline').replace('step-', 'milestone-')


def render_stair(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:4]
    body = ['  <g id="stair-growth" filter="url(#shadow)">']
    base_y = 430
    colors = [theme['secondary'], theme['primary'], theme['green'], theme['accent']]
    for i, s in enumerate(sections):
        x = 95 + i * 180
        h = 90 + i * 45
        y = base_y - h
        body.append(f'''
    <g id="stage-{i+1}">
      <rect x="{x}" y="{y}" width="130" height="{h}" rx="18" fill="{colors[i % len(colors)]}" opacity="0.9"/>
      <text class="section-title" x="{x+65}" y="{y-28}" text-anchor="middle">{esc(s['title'])}</text>
      <text class="small" x="{x+65}" y="{y-9}" text-anchor="middle">{esc(compact(s['body'], 18))}</text>
    </g>''')
    body.append(f'    <path d="M155 370 C300 330 455 255 720 150" stroke="{theme["accent"]}" stroke-width="8" stroke-linecap="round" fill="none" marker-end="url(#arrowHead)"/>')
    body.append('  </g>')
    return "\n".join(body)


def render_radial(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:6]
    cx, cy = width // 2, 295
    positions = [(cx, 145), (cx+250, 230), (cx+210, 395), (cx, 455), (cx-210, 395), (cx-250, 230)]
    body = [f'  <g id="hub-spoke"><circle cx="{cx}" cy="{cy}" r="78" fill="url(#primaryGrad)" filter="url(#shadow)"/><text class="section-title" x="{cx}" y="{cy-5}" text-anchor="middle" fill="#fff">{esc(outline["title"][:10])}</text><text class="small" x="{cx}" y="{cy+22}" text-anchor="middle" fill="#fff">Core</text>']
    for i, s in enumerate(sections):
        x, y = positions[i]
        body.append(f'''
    <g id="capability-{i+1}">
      <line x1="{cx}" y1="{cy}" x2="{x}" y2="{y}" stroke="{theme['primary']}" stroke-width="2" opacity="0.35"/>
      <rect x="{x-88}" y="{y-42}" width="176" height="84" rx="18" fill="#FFFFFF" stroke="#E2E8F0" filter="url(#shadow)"/>
      <text class="section-title" x="{x}" y="{y-8}" text-anchor="middle">{esc(s['title'])}</text>
      <text class="small" x="{x}" y="{y+17}" text-anchor="middle">{esc(compact(s['body'], 18))}</text>
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_cycle(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:4]
    points = [(250, 190), (620, 190), (620, 390), (250, 390)]
    body = [f'  <g id="cycle-loop"><path d="M285 190 H585 C630 190 650 225 650 260 V330 C650 370 620 390 585 390 H285 C240 390 220 360 220 325 V250 C220 215 250 190 285 190" stroke="url(#primaryGrad)" stroke-width="8" fill="none" stroke-linecap="round" marker-end="url(#arrowHead)"/>']
    for i, s in enumerate(sections):
        x, y = points[i]
        body.append(f'''
    <g id="loop-step-{i+1}" filter="url(#shadow)">
      <rect x="{x-90}" y="{y-46}" width="180" height="92" rx="20" fill="#FFFFFF" stroke="#E2E8F0"/>
      <text class="section-title" x="{x}" y="{y-10}" text-anchor="middle">{esc(s['title'])}</text>
      <text class="small" x="{x}" y="{y+17}" text-anchor="middle">{esc(compact(s['body'], 20))}</text>
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_matrix(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:4]
    x0, y0, w, h = 170, 150, 560, 330
    body = [f'''  <g id="matrix" filter="url(#shadow)">
    <rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="24" fill="#FFFFFF" stroke="#E2E8F0"/>
    <line x1="{x0+w/2}" y1="{y0}" x2="{x0+w/2}" y2="{y0+h}" stroke="#E2E8F0" stroke-width="2"/>
    <line x1="{x0}" y1="{y0+h/2}" x2="{x0+w}" y2="{y0+h/2}" stroke="#E2E8F0" stroke-width="2"/>
''']
    locs = [(x0+140, y0+82), (x0+420, y0+82), (x0+140, y0+247), (x0+420, y0+247)]
    colors = [theme['primary'], theme['secondary'], theme['green'], theme['accent']]
    for i, s in enumerate(sections):
        x, y = locs[i]
        body.append(f'''
    <g id="quadrant-{i+1}">
      <circle cx="{x}" cy="{y-28}" r="16" fill="{colors[i]}" opacity="0.9"/>
      <text class="section-title" x="{x}" y="{y+10}" text-anchor="middle">{esc(s['title'])}</text>
      <text class="small" x="{x}" y="{y+35}" text-anchor="middle">{esc(compact(s['body'], 24))}</text>
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_fishbone(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:6]
    body = [f'''  <g id="fishbone">
    <line x1="110" y1="300" x2="700" y2="300" stroke="{theme['primary']}" stroke-width="5" stroke-linecap="round" marker-end="url(#arrowHead)"/>
    <path d="M700 250 L830 300 L700 350 Z" fill="#DBEAFE" stroke="{theme['primary']}" stroke-width="3" filter="url(#shadow)"/>
    <text class="section-title" x="755" y="293" text-anchor="middle">{esc(outline['title'][:10])}</text>
    <text class="small" x="755" y="318" text-anchor="middle">核心问题</text>
''']
    anchors = [(220,300,150,180), (390,300,320,180), (560,300,490,180), (220,300,150,420), (390,300,320,420), (560,300,490,420)]
    for i, s in enumerate(sections):
        x1,y1,x2,y2 = anchors[i]
        body.append(f'''
    <g id="cause-{i+1}">
      <line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{theme['primary']}" stroke-width="3" stroke-linecap="round"/>
      <rect x="{x2-70}" y="{y2-38}" width="140" height="76" rx="16" fill="#FFFFFF" stroke="#E2E8F0" filter="url(#shadow)"/>
      <text class="section-title" x="{x2}" y="{y2-8}" text-anchor="middle">{esc(s['title'])}</text>
      <text class="small" x="{x2}" y="{y2+17}" text-anchor="middle">{esc(compact(s['body'], 16))}</text>
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_pyramid(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:4]
    colors = [theme['accent'], theme['primary'], theme['secondary'], theme['green']]
    body = ['  <g id="pyramid" filter="url(#shadow)">']
    base_x, base_y = width//2, 455
    levels = [(120, 92), (220, 92), (320, 92), (420, 92)]
    for i, s in enumerate(sections[::-1]):
        w, h = levels[i]
        y = base_y - (i+1)*h
        x = base_x - w//2
        body.append(f'''
    <g id="layer-{len(sections)-i}">
      <path d="M{x} {y+h} L{x+40} {y} H{x+w-40} L{x+w} {y+h} Z" fill="{colors[i]}" opacity="0.9"/>
      <text class="section-title" x="{base_x}" y="{y+38}" text-anchor="middle" fill="#fff">{esc(s['title'])}</text>
      <text class="small" x="{base_x}" y="{y+62}" text-anchor="middle" fill="#fff">{esc(compact(s['body'], 24))}</text>
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_kpi(outline: Dict, width: int, height: int, theme: Dict[str, str]) -> str:
    sections = outline["sections"][:4]
    body = ['  <g id="kpi-bars" filter="url(#shadow)">']
    colors = [theme['secondary'], theme['primary'], theme['green'], theme['accent']]
    for i, s in enumerate(sections):
        x = 105 + i * 195
        val_match = re.search(r"\d+\s*%|\b\d+(?:\.\d+)?\b", s['body'] + ' ' + s['title'])
        label = val_match.group(0) if val_match else f"{(i+2)*20}%"
        h = 120 + i * 35
        y = 410 - h
        body.append(f'''
    <g id="kpi-{i+1}">
      <text class="title" x="{x+55}" y="{y-22}" text-anchor="middle" fill="{colors[i]}">{esc(label)}</text>
      <rect x="{x}" y="{y}" width="110" height="{h}" rx="20" fill="{colors[i]}" opacity="0.85"/>
      <rect x="{x+26}" y="{y}" width="28" height="{h}" fill="#FFFFFF" opacity="0.16"/>
      <text class="section-title" x="{x+55}" y="445" text-anchor="middle">{esc(s['title'])}</text>
      <text class="small" x="{x+55}" y="468" text-anchor="middle">{esc(compact(s['body'], 20))}</text>
    </g>''')
    body.append('  </g>')
    return "\n".join(body)


def render_svg(outline: Dict, width: int, height: int, theme_name: str) -> str:
    theme = THEMES[theme_name]
    layout = outline["layout"]
    renderers = {
        "pillars": render_pillars,
        "process": render_process,
        "timeline": render_timeline,
        "stair": render_stair,
        "radial": render_radial,
        "cycle": render_cycle,
        "matrix": render_matrix,
        "fishbone": render_fishbone,
        "pyramid": render_pyramid,
        "kpi": render_kpi,
    }
    renderer = renderers.get(layout, render_pillars)
    return svg_header(width, height, theme) + title_block(outline, width) + renderer(outline, width, height, theme) + "\n</svg>\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate editable SVG infographic from text.")
    parser.add_argument("input", help="Input text file")
    parser.add_argument("--out", default="output", help="Output directory")
    parser.add_argument("--mode", choices=["outline", "svg", "both"], default="both")
    parser.add_argument("--layout", choices=sorted(LAYOUTS), default="auto")
    parser.add_argument("--theme", choices=sorted(THEMES.keys()), default="blue")
    parser.add_argument("--width", type=int, default=900)
    parser.add_argument("--height", type=int, default=540)
    parser.add_argument("--title", default=None)
    parser.add_argument("--subtitle", default=None)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input)
    text = input_path.read_text(encoding="utf-8")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    outline = build_outline(text, args.layout, args.title, args.subtitle)

    if args.mode in {"outline", "both"}:
        (out_dir / "outline.json").write_text(json.dumps(outline, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.mode in {"svg", "both"}:
        svg = render_svg(outline, args.width, args.height, args.theme)
        (out_dir / "output.svg").write_text(svg, encoding="utf-8")

    if args.preview:
        preview = Path(__file__).resolve().parents[1] / "templates" / "preview_template.html"
        if preview.exists():
            (out_dir / "preview.html").write_text(preview.read_text(encoding="utf-8"), encoding="utf-8")

    print(f"Done. Wrote files to: {out_dir}")
    print(f"Selected layout: {outline['layout']}")


if __name__ == "__main__":
    main()
