#!/usr/bin/env python3
"""
Starter template for manual rebuild mode.

Use this when the image is a chart, diagram, slide, or infographic and you want
clean editable SVG rather than noisy traced paths.
"""

from pathlib import Path


def write_template(output: str = "manual_rebuild.svg", width: int = 900, height: int = 600) -> None:
    svg = f'''<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#0F172A" flood-opacity="0.12"/>
    </filter>
    <linearGradient id="primary-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22D3EE"/>
      <stop offset="1" stop-color="#2563EB"/>
    </linearGradient>
  </defs>

  <rect id="background" width="{width}" height="{height}" fill="#FFFFFF"/>

  <!-- Replace these starter elements with semantic SVG layers. -->
  <g id="main-graphic" filter="url(#soft-shadow)">
    <path id="main-shape" d="M120 360 C220 220 360 220 460 330 C560 440 690 320 780 220" stroke="url(#primary-gradient)" stroke-width="44" stroke-linecap="round"/>
  </g>

  <g id="labels" font-family="Arial, 'Microsoft YaHei', sans-serif" fill="#111827">
    <text id="title" x="{width / 2}" y="64" text-anchor="middle" font-size="28" font-weight="700">Editable SVG Title</text>
    <text id="label-1" x="120" y="160" font-size="18" font-weight="700">Label 1</text>
    <text id="label-2" x="420" y="150" font-size="18" font-weight="700">Label 2</text>
  </g>
</svg>
'''
    Path(output).write_text(svg, encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    write_template()
