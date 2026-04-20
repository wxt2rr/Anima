---
name: text-to-svg-skill
description: Use this skill when the user provides a piece of copy, notes, product text, report content, or a rough idea and asks to automatically create an SVG visual, infographic, diagram, slide-like card, framework chart, process graphic, comparison chart, roadmap, or visual summary.The skill extracts structure from text, chooses an appropriate visual pattern, and outputs a complete standalone editable SVG.
---



## Core Goal

Given text, automatically produce:

1. A concise title
2. A subtitle or one-line summary
3. A structured outline
4. Key points grouped into sections
5. The most expressive visual layout / diagram type
6. A standalone SVG with editable text and semantic element IDs

## Important Principle

Do not simply dump text into boxes. The SVG should communicate the structure visually.

The agent should infer the best diagram type from the content:

- sequential text → timeline, roadmap, process flow, stair-step, journey map
- cause/effect text → fishbone, root-cause tree, problem-solution diagram
- comparison text → comparison cards, matrix, before-after, pros-cons
- hierarchy text → pyramid, tree, layered architecture, org chart
- growth or progress text → upward arrows, wave-step chart, ladder, flywheel
- cyclical text → cycle diagram, loop, flywheel, feedback loop
- strategy/framework text → quadrant, 2x2 matrix, hub-and-spoke, pillar cards
- metrics/percentages → bar chart, radial progress, KPI cards, column arrows
- risks/issues → risk matrix, warning cards, bottleneck diagram
- product/feature text → feature cards, architecture overview, modular grid
- educational explanation → concept map, annotated diagram, layered cards

## Modes

### `outline` mode
Only extract title, subtitle, outline, sections, and recommended visual layout.

### `svg` mode
Generate the complete SVG directly.

### `both` mode
Generate a JSON outline plus SVG.

## Workflow

1. Read the user text carefully.
2. Identify:
   - audience
   - topic
   - desired tone
   - key message
   - number of major sections
   - whether the content is sequential, comparative, hierarchical, cyclical, causal, metric-based, or conceptual
3. Create a compact outline.
4. Select the best visual layout.
5. Convert content into concise display text.
6. Generate SVG.
7. Keep text editable with `<text>` and `<tspan>`.
8. Use semantic IDs for major groups.
9. Use gradients, shadows, rounded cards, arrows, and spacing to improve presentation.
10. Preserve readability: never overcrowd the canvas.

## Output Requirements

The SVG must:

- Be standalone
- Include `width`, `height`, and `viewBox`
- Use `<defs>` for filters, gradients, markers
- Use `<text>` for editable text
- Use `<tspan>` for multiline text
- Use semantic IDs, e.g. `title`, `section-1`, `main-arrow`, `timeline-step-2`
- Prefer clean geometry over noisy decoration
- Avoid raw raster images unless explicitly requested
- Use safe default fonts:
  `Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif`

## Text Compression Rules

SVG is not a document. Compress text for visual display:

- Title: 4-14 Chinese characters or 3-8 English words when possible
- Subtitle: 1 sentence
- Section title: 2-8 words
- Section body: 1-3 short lines
- Avoid long paragraphs inside SVG

If the input text is long, summarize before rendering.

## Layout Selection Heuristics

### Timeline / Roadmap
Use when text contains stages, dates, sequence, steps, version evolution, milestones.

### Process Flow
Use when text contains actions, operations, pipeline, workflow, input/output.

### Fishbone
Use when text discusses root causes, influencing factors, failure reasons.

### Pyramid / Layered Architecture
Use when text describes foundations, levels, maturity, stack, dependencies.

### Matrix / Quadrant
Use when text compares two dimensions or classifies options.

### Pillar Cards
Use when text lists 3-6 major supports, principles, benefits, features.

### Radial / Hub-and-Spoke
Use when one central concept has multiple surrounding capabilities.

### Flywheel / Cycle
Use when text describes repeatable loops, feedback, compounding, iteration.

### Stair-Step / Growth Arrow
Use when text describes improvement, progress, maturity, performance growth.

### KPI Cards / Bars
Use when text contains numbers, percentages, metrics, benchmark values.

## Default Visual Style

- Canvas: 900x540 or 960x600
- Background: white or very light slate
- Primary color: blue / cyan / violet
- Secondary colors: green, orange, pink, slate
- Cards: rounded corners, subtle shadows
- Lines: 2-4px, rounded caps
- Text: dark slate, high contrast
- Use whitespace generously

## Quality Checks

Before finalizing SVG, check:

- Does the chosen layout match the content structure?
- Is the key message obvious in 3 seconds?
- Is the text editable?
- Are text blocks short enough?
- Does the SVG render without external dependencies?
- Are IDs meaningful?
- Are there no clipped labels?
- Are all viewBox coordinates consistent?

## When to Ask Follow-up Questions

Usually do not ask; make a reasonable default.

Ask only when:

- The user requires a brand style but did not provide colors
- The text is too ambiguous to identify the core topic
- The user asks for a specific size, platform, or brand compliance and necessary data is missing

## Response Pattern

If generating directly in chat, return:

1. A brief note naming the selected visual layout
2. The complete SVG code block

If creating files, return links to:

- outline.json
- output.svg
- preview.html

## Limitations

This skill creates editable SVG from text. It does not guarantee brand-perfect design without brand assets. Long text must be summarized to remain readable.
