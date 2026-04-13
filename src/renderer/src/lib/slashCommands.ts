import path from 'node:path'

export type SlashCommandSource = 'builtin' | 'project'
export type SlashCommandKind = 'action' | 'prompt'

export type SlashCommandEntry = {
  id: string
  name: string
  title: string
  description: string
  source: SlashCommandSource
  kind: SlashCommandKind
  template?: string
  filePath?: string
  aliases?: string[]
}

export type ParsedSlashInput = {
  raw: string
  name: string
  args: string
  query: string
  shouldSuggest: boolean
  isCommand: true
}

export function normalizeSlashCommandName(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function parseSlashInput(raw: string): ParsedSlashInput | null {
  const input = String(raw || '')
  if (!input.startsWith('/')) return null
  if (/\r|\n/.test(input)) return null
  const body = input.slice(1)
  const match = body.match(/^([^\s]*)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  const name = normalizeSlashCommandName(match[1] || '')
  if (!name) {
    return {
      raw: input,
      name: '',
      args: '',
      query: '',
      shouldSuggest: true,
      isCommand: true
    }
  }
  const args = String(match[2] || '').trim()
  return {
    raw: input,
    name,
    args,
    query: name,
    shouldSuggest: !args,
    isCommand: true
  }
}

function compactMarkdownLine(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^>\s*/, '')
    .trim()
}

export function parseProjectSlashCommandFile(filePath: string, content: string): SlashCommandEntry | null {
  const base = path.basename(String(filePath || '').trim())
  const name = normalizeSlashCommandName(base)
  if (!name) return null

  const text = String(content || '').replace(/^\uFEFF/, '').trim()
  if (!text) return null

  const lines = text.split(/\r?\n/)
  let template = text
  let description = ''

  const firstNonEmptyIndex = lines.findIndex((line) => compactMarkdownLine(line))
  if (firstNonEmptyIndex >= 0) {
    const firstLine = compactMarkdownLine(lines[firstNonEmptyIndex])
    if (String(lines[firstNonEmptyIndex] || '').trim().startsWith('#')) {
      const remaining = lines.slice(firstNonEmptyIndex + 1)
      template = remaining.join('\n').trim()
      const descLine = remaining.find((line) => compactMarkdownLine(line))
      description = compactMarkdownLine(descLine || '')
    } else {
      description = firstLine
    }
  }

  if (!template) return null

  return {
    id: `project:${name}`,
    name,
    title: `/${name}`,
    description: description || `Run /${name}`,
    source: 'project',
    kind: 'prompt',
    template,
    filePath: String(filePath || '').trim()
  }
}

export function renderSlashCommandTemplate(
  template: string,
  vars: { args?: string; workspace?: string }
): string {
  const values: Record<string, string> = {
    args: String(vars.args || '').trim(),
    workspace: String(vars.workspace || '').trim()
  }
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, keyRaw) => {
    const key = String(keyRaw || '').trim()
    if (!(key in values)) return full
    return values[key]
  })
}

function scoreSlashCommand(entry: SlashCommandEntry, query: string): number {
  const q = normalizeSlashCommandName(query)
  if (!q) return 0
  const haystacks = [entry.name, ...(entry.aliases || [])].map((item) => normalizeSlashCommandName(item))
  if (haystacks.some((item) => item === q)) return 0
  if (haystacks.some((item) => item.startsWith(q))) return 1
  if (haystacks.some((item) => item.includes(q))) return 2
  if (String(entry.description || '').toLowerCase().includes(q)) return 3
  return Number.POSITIVE_INFINITY
}

export function filterSlashCommands(commands: SlashCommandEntry[], rawQuery: string): SlashCommandEntry[] {
  const query = normalizeSlashCommandName(rawQuery)
  if (!query) return [...commands].sort((a, b) => a.name.localeCompare(b.name))
  return [...commands]
    .map((entry) => ({ entry, score: scoreSlashCommand(entry, query) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      return a.entry.name.localeCompare(b.entry.name)
    })
    .map((item) => item.entry)
}
