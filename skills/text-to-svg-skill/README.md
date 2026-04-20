# Text to SVG Infographic Skill

This package helps an agent turn raw copy into a structured editable SVG infographic.

It can:

- extract title, subtitle, outline, and sections from text
- choose an appropriate visual layout
- generate an editable SVG
- generate a preview HTML file

## Quick Start

```bash
python scripts/text_to_svg.py examples/sample_cn.txt --out output --mode both --preview
```

Generated files:

```text
output/
  outline.json
  output.svg
  preview.html
```

## Modes

```bash
# outline only
python scripts/text_to_svg.py input.txt --out output --mode outline

# SVG only
python scripts/text_to_svg.py input.txt --out output --mode svg

# outline + SVG
python scripts/text_to_svg.py input.txt --out output --mode both --preview
```

## Optional Arguments

```bash
--layout auto|timeline|process|fishbone|pyramid|matrix|pillars|radial|cycle|stair|kpi
--theme blue|cyan|violet|green|orange
--width 960
--height 600
--title "Custom Title"
--subtitle "Custom Subtitle"
```

## Notes

This script provides a deterministic baseline. In an agent workflow, use `SKILL.md` to guide the model's reasoning, then use this script as a renderer or fallback generator.
