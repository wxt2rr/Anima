# Agent Prompt Template: Text to SVG

You are generating an editable SVG infographic from user-provided text.

## Steps

1. Extract a compact outline:
   - title
   - subtitle
   - 3-6 key sections
   - section titles
   - one short description per section
2. Choose the most expressive layout:
   - timeline / process / fishbone / pyramid / matrix / pillars / radial / cycle / stair / kpi
3. Generate a standalone SVG.
4. Keep all text editable with `<text>` and `<tspan>`.
5. Use semantic IDs.
6. Do not overcrowd. Summarize aggressively.

## Output Format

Return:

```json
{
  "title": "...",
  "subtitle": "...",
  "layout": "...",
  "sections": [
    {"title": "...", "body": "..."}
  ]
}
```

Then return complete SVG code.
