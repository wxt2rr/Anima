#!/usr/bin/env python3
"""
Image to SVG helper.

Creates:
- exact.svg: pixel-perfect visual SVG with embedded raster image
- editable.svg: approximate editable vector SVG using color-region tracing
- preview.html: browser preview

This is intentionally conservative: exact visual fidelity and editable vector fidelity
are separate outputs.
"""

from __future__ import annotations

import argparse
import base64
import html
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Missing dependency: opencv-python. Install with: pip install opencv-python") from exc


Color = Tuple[int, int, int]


@dataclass
class TraceOptions:
    colors: int = 10
    min_area: int = 40
    simplify: float = 1.5
    blur: int = 0
    background_tolerance: int = 8


def detect_mime(image_path: Path) -> str:
    suffix = image_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    return "image/png"


def make_embedded_svg(image_path: Path, output_path: Path) -> None:
    with Image.open(image_path) as img:
        width, height = img.size

    mime = detect_mime(image_path)
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    svg = f'''<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">
  <image id="embedded-source" href="data:{mime};base64,{encoded}" x="0" y="0" width="{width}" height="{height}"/>
</svg>
'''
    output_path.write_text(svg, encoding="utf-8")


def rgb_to_hex(color: Color) -> str:
    return "#%02x%02x%02x" % color


def escape_attr(value: str) -> str:
    return html.escape(value, quote=True)


def load_rgb(image_path: Path) -> np.ndarray:
    image = Image.open(image_path).convert("RGB")
    return np.array(image)


def quantize_image(rgb: np.ndarray, k: int, blur: int = 0) -> Tuple[np.ndarray, List[Color]]:
    work = rgb.copy()
    if blur and blur > 0:
        kernel = blur if blur % 2 == 1 else blur + 1
        work = cv2.GaussianBlur(work, (kernel, kernel), 0)

    pixels = work.reshape((-1, 3)).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.2)
    _compactness, labels, centers = cv2.kmeans(
        pixels,
        k,
        None,
        criteria,
        3,
        cv2.KMEANS_PP_CENTERS,
    )
    centers_u8 = np.clip(centers, 0, 255).astype(np.uint8)
    labels_2d = labels.reshape(work.shape[:2])
    palette: List[Color] = [tuple(map(int, c)) for c in centers_u8]
    return labels_2d, palette


def contour_to_path(contour: np.ndarray) -> str:
    pts = contour.reshape(-1, 2)
    if len(pts) < 3:
        return ""
    parts = [f"M{pts[0][0]} {pts[0][1]}"]
    for x, y in pts[1:]:
        parts.append(f"L{x} {y}")
    parts.append("Z")
    return " ".join(parts)


def sort_palette_by_area(labels: np.ndarray, palette: List[Color]) -> List[int]:
    areas = [(idx, int(np.sum(labels == idx))) for idx in range(len(palette))]
    # Draw larger areas first, smaller details later.
    areas.sort(key=lambda item: item[1], reverse=True)
    return [idx for idx, _area in areas]


def infer_background_color(rgb: np.ndarray) -> Color:
    # Most common-ish color from image corners.
    h, w = rgb.shape[:2]
    patches = np.concatenate(
        [
            rgb[: max(1, h // 20), : max(1, w // 20)].reshape(-1, 3),
            rgb[: max(1, h // 20), -max(1, w // 20) :].reshape(-1, 3),
            rgb[-max(1, h // 20) :, : max(1, w // 20)].reshape(-1, 3),
            rgb[-max(1, h // 20) :, -max(1, w // 20) :].reshape(-1, 3),
        ],
        axis=0,
    )
    return tuple(map(int, np.median(patches, axis=0)))  # robust enough for flat backgrounds


def make_trace_svg(image_path: Path, output_path: Path, options: TraceOptions) -> None:
    rgb = load_rgb(image_path)
    height, width = rgb.shape[:2]
    labels, palette = quantize_image(rgb, options.colors, options.blur)
    background = infer_background_color(rgb)

    elements: List[str] = []
    elements.append(f'<rect id="background" width="{width}" height="{height}" fill="{rgb_to_hex(background)}"/>')

    kernel = np.ones((2, 2), np.uint8)
    color_order = sort_palette_by_area(labels, palette)

    for layer_num, color_idx in enumerate(color_order):
        color = palette[color_idx]
        if np.linalg.norm(np.array(color) - np.array(background)) <= options.background_tolerance:
            continue

        mask = (labels == color_idx).astype(np.uint8) * 255
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)
        fill = rgb_to_hex(color)

        for contour_num, contour in enumerate(contours):
            area = cv2.contourArea(contour)
            if area < options.min_area:
                continue
            epsilon = options.simplify
            approx = cv2.approxPolyDP(contour, epsilon, True)
            path_d = contour_to_path(approx)
            if not path_d:
                continue
            elements.append(
                f'<path id="trace-layer-{layer_num}-shape-{contour_num}" d="{escape_attr(path_d)}" fill="{fill}"/>'
            )

    svg = f'''<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">
  <title>Editable traced SVG approximation</title>
  <desc>Generated by image_to_svg.py. This is an editable approximation, not a pixel-perfect vector reconstruction.</desc>
  <g id="traced-regions">
    {'\n    '.join(elements)}
  </g>
</svg>
'''
    output_path.write_text(svg, encoding="utf-8")


def copy_source(image_path: Path, out_dir: Path) -> Path:
    # preview template expects source.png; convert if needed
    target = out_dir / "source.png"
    Image.open(image_path).convert("RGBA").save(target)
    return target


def make_preview(out_dir: Path) -> None:
    template_path = Path(__file__).resolve().parents[1] / "templates" / "preview_template.html"
    if template_path.exists():
        shutil.copyfile(template_path, out_dir / "preview.html")
    else:
        (out_dir / "preview.html").write_text(
            "<html><body><h1>Preview</h1><img src='source.png'><object data='exact.svg'></object><object data='editable.svg'></object></body></html>",
            encoding="utf-8",
        )


def write_readme(out_dir: Path, mode: str) -> None:
    (out_dir / "README.md").write_text(
        f"""# Image to SVG Output

Generated mode: `{mode}`

## Files

- `source.png` — normalized copy of the original input image.
- `exact.svg` — pixel-perfect visual SVG using embedded raster image, if generated.
- `editable.svg` — editable traced SVG approximation, if generated.
- `preview.html` — side-by-side preview, if generated.

## Editing Text

The automatic trace mode converts visible regions to paths. It cannot reliably recover text as editable `<text>`.
For clean editable diagrams, manually replace traced text regions with SVG `<text>` elements.

Example:

```svg
<text x="100" y="80" font-size="18" fill="#111827" font-family="Arial, sans-serif">Your text</text>
```

## Important

A raster image cannot be automatically converted into a pixel-perfect and fully editable SVG because original vector data, fonts, layers, gradients, and shadows are not present in the image.
""",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate exact and/or editable SVG from an image.")
    parser.add_argument("image", type=Path, help="Input image path")
    parser.add_argument("--out", type=Path, default=Path("svg_output"), help="Output directory")
    parser.add_argument("--mode", choices=["embed", "trace", "both"], default="both")
    parser.add_argument("--colors", type=int, default=10, help="Number of colors for trace mode")
    parser.add_argument("--min-area", type=int, default=40, help="Minimum contour area to keep")
    parser.add_argument("--simplify", type=float, default=1.5, help="Contour simplification epsilon")
    parser.add_argument("--blur", type=int, default=0, help="Optional Gaussian blur kernel size before quantization")
    parser.add_argument("--preview", action="store_true", help="Create preview.html")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    image_path: Path = args.image
    if not image_path.exists():
        raise SystemExit(f"Input image not found: {image_path}")

    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    copy_source(image_path, out_dir)

    if args.mode in {"embed", "both"}:
        make_embedded_svg(image_path, out_dir / "exact.svg")

    if args.mode in {"trace", "both"}:
        opts = TraceOptions(
            colors=args.colors,
            min_area=args.min_area,
            simplify=args.simplify,
            blur=args.blur,
        )
        make_trace_svg(image_path, out_dir / "editable.svg", opts)

    if args.preview or args.mode == "both":
        make_preview(out_dir)

    write_readme(out_dir, args.mode)
    print(f"Wrote SVG output to: {out_dir}")


if __name__ == "__main__":
    main()
