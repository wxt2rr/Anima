import katex from 'katex'
import type { MarkdownBlock } from './types'
import { isFileLikeTarget, normalizeChatLinkTarget } from './chatLinks'

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHref(input: string): string {
  const href = String(input || '').trim()
  if (!href) return ''
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)
  if (hasScheme && !/^(https?:|mailto:|file:)/i.test(href)) return ''
  return escapeHtml(href)
}

function renderMathHtml(input: string): string {
  const text = String(input || '').trim()
  if (!text) return ''
  try {
    return katex.renderToString(text, { throwOnError: false, displayMode: true })
  } catch {
    return `<pre>${escapeHtml(text)}</pre>`
  }
}

function renderInline(input: string): string {
  const placeholders: string[] = []
  const stash = (value: string): string => {
    const key = `__ANIMA_CHAT_HTML_${placeholders.length}__`
    placeholders.push(value)
    return key
  }
  const restore = (value: string): string => value.replace(/__ANIMA_CHAT_HTML_(\d+)__/g, (_m, index) => placeholders[Number(index)] || '')
  let html = escapeHtml(input)

  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const normalized = normalizeChatLinkTarget(code)
    if (isFileLikeTarget(normalized)) {
      const safeTarget = escapeHtml(normalized)
      return stash(`<code class="anima-chat-inline-file" data-chat-link-target="${safeTarget}">${safeTarget}</code>`)
    }
    return stash(`<code>${escapeHtml(code)}</code>`)
  })

  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    const safeAlt = escapeHtml(alt)
    const safeSrc = escapeHtml(normalizeChatLinkTarget(src))
    if (!safeSrc) return safeAlt
    return stash(`<img class="anima-chat-inline-image" alt="${safeAlt}" data-chat-image-src="${safeSrc}">`)
  })

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const safe = safeHref(href)
    if (!safe) return escapeHtml(label)
    return stash(`<a href="${safe}" class="anima-chat-link" data-chat-link-target="${safe}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
  })

  html = html.replace(/\bhttps?:\/\/[^\s<)]+/g, (url) => {
    const normalized = normalizeChatLinkTarget(url)
    const safe = safeHref(normalized)
    if (!safe) return url
    return stash(`<a href="${safe}" class="anima-chat-link" data-chat-link-target="${safe}" target="_blank" rel="noreferrer">${safe}</a>`)
  })

  html = html.replace(/\$([^$\n]+)\$/g, (_m, expr) => {
    try {
      return stash(katex.renderToString(String(expr || '').trim(), { throwOnError: false, displayMode: false }))
    } catch {
      return `$${expr}$`
    }
  })
  html = html.replace(/\*\*([^*]+)\*\*/g, (_m, text) => `<strong>${text}</strong>`)
  html = html.replace(/~~([^~]+)~~/g, (_m, text) => `<del>${text}</del>`)
  return restore(html)
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function splitTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function renderMarkdownHtml(markdown: string): string {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      i += 1
      continue
    }

    if (/^\$\$/.test(line)) {
      const mathLines: string[] = []
      let first = line.replace(/^\$\$/, '')
      if (first.endsWith('$$') && first.trim()) {
        out.push(renderMathHtml(first.replace(/\$\$$/, '')))
        i += 1
        continue
      }
      if (first.trim()) mathLines.push(first)
      i += 1
      while (i < lines.length) {
        const current = lines[i]
        if (current.endsWith('$$')) {
          mathLines.push(current.replace(/\$\$$/, ''))
          i += 1
          break
        }
        mathLines.push(current)
        i += 1
      }
      out.push(renderMathHtml(mathLines.join('\n')))
      continue
    }

    if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
      const headers = splitTableCells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableCells(lines[i]))
        i += 1
      }
      out.push([
        '<table>',
        '<thead><tr>',
        ...headers.map((cell) => `<th>${renderInline(cell)}</th>`),
        '</tr></thead>',
        '<tbody>',
        ...rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`),
        '</tbody>',
        '</table>'
      ].join(''))
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i += 1
      }
      out.push(`<ul>${items.map((item) => {
        const task = /^\[( |x|X)\]\s+(.+)$/.exec(item)
        if (!task) return `<li>${renderInline(item)}</li>`
        const checked = task[1].toLowerCase() === 'x'
        return `<li><label class="anima-chat-task"><input type="checkbox" disabled${checked ? ' checked' : ''}> <span>${renderInline(task[2])}</span></label></li>`
      }).join('')}</ul>`)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i += 1
      }
      out.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`)
      continue
    }

    const paragraph: string[] = [line.trim()]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(i + 1 < lines.length && lines[i].includes('|') && isTableSeparator(lines[i + 1]))
    ) {
      paragraph.push(lines[i].trim())
      i += 1
    }
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  }

  return out.join('\n')
}

export function compileMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const fence = /```(\w+)?\n([\s\S]*?)```/g
  let cursor = 0
  let match: RegExpExecArray | null
  let codeIndex = 0

  while ((match = fence.exec(content))) {
    const before = content.slice(cursor, match.index)
    const html = renderMarkdownHtml(before)
    if (html) blocks.push({ type: 'markdown', html })
    const language = String(match[1] || 'text').trim() || 'text'
    const value = String(match[2] || '')
    if (language === 'mermaid') blocks.push({ type: 'mermaid', id: `mermaid-${codeIndex}`, value })
    else blocks.push({ type: 'code', id: `code-${codeIndex}`, language, value })
    codeIndex += 1
    cursor = match.index + match[0].length
  }

  const restHtml = renderMarkdownHtml(content.slice(cursor))
  if (restHtml) blocks.push({ type: 'markdown', html: restHtml })
  return blocks
}
