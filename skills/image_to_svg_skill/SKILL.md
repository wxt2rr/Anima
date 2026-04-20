# Image to SVG Recreation Skill

Use this skill when the user provides an image and asks to recreate it as SVG, convert an image to SVG, redraw an image in SVG, or make an editable SVG from a screenshot/reference image.

## Core Principle

A raster image does not contain the original vector paths, fonts, layer names, gradients, shadows, or exact Bézier control points. Therefore:

- Pixel-perfect visual reproduction is possible by embedding the original image inside SVG.
- Fully editable vector reconstruction is an approximation unless the original vector/design file is available.
- For best user experience, generate both:
  - `exact.svg`: visually identical SVG using embedded raster image.
  - `editable.svg`: editable approximation using paths, shapes, gradients, and editable text where practical.

## Supported Modes

### 1. embed

Use this when the user asks for:

- 完全一样
- 像素级一致
- 1:1 复刻
- 不要变形
- 保持原图完全一致

This mode embeds the image as a base64 `<image>` inside SVG.

Pros:
- Pixel-perfect visual output.
- Reliable for any image.

Cons:
- Not truly editable as vector paths.
- Text and shapes cannot be individually edited.

### 2. trace

Use this when the user asks for:

- 可编辑 SVG
- 自动矢量化
- 转路径
- 图标 / logo / 简单插画转 SVG

This mode performs color quantization, segmentation, contour extraction, and path generation.

Pros:
- Produces editable paths.
- Good for flat graphics, icons, logos, simple illustrations.

Cons:
- Gradients and shadows may become many fragmented regions.
- Text recognition is approximate.
- Complex images will not be pixel-perfect.

### 3. rebuild

Use this when the image is a:

- chart
- slide
- infographic
- flow diagram
- dashboard
- business illustration
- PPT-style graphic

This mode uses visual understanding and manual SVG construction. Build clean shapes, semantic IDs, gradients, shadows, and editable text.

Pros:
- Clean and maintainable SVG.
- Best for diagrams and business graphics.
- Text can stay editable.

Cons:
- Requires judgment and iteration.
- Not automatically pixel-perfect.

## Default Behavior

Unless the user explicitly requests only one mode, create a package containing:

1. `exact.svg` — embedded raster, visually identical.
2. `editable.svg` — vector approximation.
3. `preview.html` — side-by-side preview.
4. `README.md` — explanation and edit instructions.

## Workflow

1. Inspect the image dimensions.
2. Determine the best mode:
   - Need visual exactness: `embed`.
   - Need editable paths for simple graphic: `trace`.
   - Need clean diagram/infographic recreation: `rebuild`.
3. Always preserve aspect ratio.
4. Use `<text>` for editable text whenever possible.
5. Use semantic element IDs:
   - `background`
   - `main-shape`
   - `label-left`
   - `label-center`
   - `arrow-head`
   - `legend-item-1`
6. Use `<defs>` for gradients, shadows, masks, markers, and reusable symbols.
7. Avoid uncontrolled huge path data unless trace mode is explicitly chosen.
8. If exact visual matching is required and editable vector output is also requested, explain that exactness comes from `exact.svg`, while editability comes from `editable.svg`.

## Recommended Tooling

The included helper script supports:

- embedded exact SVG generation
- simple color-region tracing
- preview HTML generation
- optional diff image generation if CairoSVG is available

Recommended Python packages:

- pillow
- opencv-python
- numpy
- scikit-image
- svgwrite
- cairosvg optional

## Command Examples

Generate both exact and editable SVG:

```bash
python scripts/image_to_svg.py input.png --out output --mode both
```

Generate only pixel-perfect embedded SVG:

```bash
python scripts/image_to_svg.py input.png --out output --mode embed
```

Generate only traced editable SVG:

```bash
python scripts/image_to_svg.py input.png --out output --mode trace --colors 10
```

Generate HTML preview:

```bash
python scripts/image_to_svg.py input.png --out output --mode both --preview
```

## Response Pattern

When returning results to the user, say clearly:

- `exact.svg` is visually identical because it embeds the original image.
- `editable.svg` is an editable approximation generated from color regions and contours.
- For pixel-perfect editable SVG, the original design/vector file is required.

## Limitations to Mention When Relevant

- Raster-to-vector reconstruction cannot recover original fonts, layers, gradients, shadows, or Bézier control points exactly.
- OCR may miss or misread text.
- Complex shadows and gradients may be simplified.
- Highly detailed images may create large SVG files.

## Quality Checklist

Before finalizing:

- SVG opens in browser.
- `viewBox` matches original image dimensions.
- `exact.svg` visually matches the input.
- `editable.svg` has reasonable file size.
- Major shapes have semantic IDs when manually rebuilt.
- Text is editable where it was manually rebuilt.
- Preview file references the generated SVGs correctly.
