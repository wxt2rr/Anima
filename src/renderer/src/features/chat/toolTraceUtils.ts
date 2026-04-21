import type { ToolTrace } from '@/store/useStore'
import type { ToolDiff } from '@/store/useStore'

export type ToolTraceCategory = 'explored' | 'edited' | 'ran' | 'context'
export type ToolTraceActionKind = 'execute' | 'search' | 'browse' | 'read' | 'edit'

export function normalizeToolTraceName(raw: unknown): string {
  const text = String(raw || '').trim()
  const normalized = text
    .replace(/^tool_start:/, '')
    .replace(/^tool_done:/, '')
    .replace(/^tool_end:/, '')
    .trim()
  return normalized === 'multi_tool_use.parallel' ? 'multi_tool_use_parallel' : normalized
}

export function toolTraceSignature(trace: ToolTrace): string {
  const normalizeSigText = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim()
  const name = normalizeToolTraceName(trace?.name)
  const argsText = String(trace?.argsPreview?.text || '').trim()
  if (name === 'bash') {
    try {
      const parsed = JSON.parse(argsText)
      const cmd = normalizeSigText((parsed as any)?.command)
      return `${name}:${cmd || normalizeSigText(argsText)}`
    } catch {
      return `${name}:${normalizeSigText(argsText)}`
    }
  }
  return `${name}:${normalizeSigText(argsText)}`
}

export function dedupeToolTracesForDisplay(traces: ToolTrace[]): ToolTrace[] {
  if (!Array.isArray(traces) || !traces.length) return []
  const completedSignatures = new Set<string>()
  for (const trace of traces) {
    if (String(trace?.status || '') === 'running') continue
    const sig = toolTraceSignature(trace)
    if (sig) completedSignatures.add(sig)
  }
  const next: ToolTrace[] = []
  for (const trace of traces) {
    if (!trace || typeof trace !== 'object') continue
    const isRunning = String(trace.status || '') === 'running'
    const sig = toolTraceSignature(trace)
    if (isRunning && sig && completedSignatures.has(sig)) continue
    next.push(trace)
  }
  return next
}

export function getToolTraceCategory(trace: ToolTrace): ToolTraceCategory {
  const name = normalizeToolTraceName(trace?.name).toLowerCase()
  if (!name) return 'ran'
  if (name === 'load_skill') return 'context'
  if (
    name === 'read_file' ||
    name === 'list_dir' ||
    name === 'glob_files' ||
    name === 'rg_search' ||
    name === 'websearch' ||
    name === 'webfetch'
  ) {
    return 'explored'
  }
  if (
    name === 'apply_patch' ||
    name === 'write_file' ||
    name === 'create_file' ||
    name === 'delete_file' ||
    name === 'move_file' ||
    name === 'rename_file' ||
    name === 'insert_edit_into_file'
  ) {
    return 'edited'
  }
  return 'ran'
}

export function summarizeToolTraceCategories(traces: ToolTrace[]): Record<ToolTraceCategory, number> {
  const summary: Record<ToolTraceCategory, number> = { explored: 0, edited: 0, ran: 0, context: 0 }
  for (const trace of traces) {
    summary[getToolTraceCategory(trace)] += 1
  }
  return summary
}

export function formatToolTraceSummary(summary: Record<ToolTraceCategory, number>): string {
  const parts: string[] = []
  if (summary.explored > 0) parts.push(`Explored ${summary.explored}`)
  if (summary.edited > 0) parts.push(`Edited ${summary.edited}`)
  if (summary.ran > 0) parts.push(`Ran ${summary.ran}`)
  if (summary.context > 0) parts.push(`Context ${summary.context}`)
  return parts.join(' · ')
}

export function resolveToolTraceActionKind(trace: ToolTrace): ToolTraceActionKind {
  const name = normalizeToolTraceName(trace?.name).toLowerCase()
  if (!name) return 'execute'
  if (name === 'websearch' || name === 'rg_search' || name === 'glob_files') return 'search'
  if (name === 'webfetch') return 'browse'
  if (name === 'read_file' || name === 'list_dir') return 'read'
  if (
    name === 'apply_patch' ||
    name === 'write_file' ||
    name === 'create_file' ||
    name === 'delete_file' ||
    name === 'move_file' ||
    name === 'rename_file' ||
    name === 'insert_edit_into_file'
  ) {
    return 'edit'
  }
  return 'execute'
}

export function summarizeDiffLineChanges(diffs: ToolDiff[]): { files: number; added: number; removed: number } {
  const valid = Array.isArray(diffs) ? diffs.filter((diff) => diff && typeof diff.path === 'string' && diff.path.trim()) : []
  if (!valid.length) return { files: 0, added: 0, removed: 0 }
  let added = 0
  let removed = 0
  for (const diff of valid) {
    const oldLines = String(diff.oldContent || '').split('\n')
    const newLines = String(diff.newContent || '').split('\n')
    const oldFreq = new Map<string, number>()
    const newFreq = new Map<string, number>()
    for (const line of oldLines) oldFreq.set(line, (oldFreq.get(line) || 0) + 1)
    for (const line of newLines) newFreq.set(line, (newFreq.get(line) || 0) + 1)
    for (const [line, count] of newFreq.entries()) {
      const prev = oldFreq.get(line) || 0
      if (count > prev) added += (count - prev)
    }
    for (const [line, count] of oldFreq.entries()) {
      const next = newFreq.get(line) || 0
      if (count > next) removed += (count - next)
    }
  }
  return { files: valid.length, added, removed }
}
