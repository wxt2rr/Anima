import type { ToolTrace } from '@/store/useStore'
import type { ChatMessageViewModel, ChatProcessBodyEntry } from './types'

export type ChatScrollDirection = 'forward' | 'backward' | 'idle'

function countMatches(input: string, pattern: RegExp): number {
  const matches = input.match(pattern)
  return matches ? matches.length : 0
}

function estimateUserRowSize(content: string): number {
  const lines = Math.max(1, content.split('\n').length)
  const chars = Math.max(1, content.length)
  return Math.min(220, 68 + Math.ceil(chars / 18) * 10 + Math.max(0, lines - 1) * 8)
}

function estimateAssistantContentSize(content: string): number {
  const normalized = String(content || '')
  const lines = Math.max(1, normalized.split('\n').length)
  const chars = normalized.length
  const codeBlocks = Math.floor(countMatches(normalized, /```/g) / 2)
  const bullets = countMatches(normalized, /^(?:[-*]|\d+\.)\s+/gm)
  const images = countMatches(normalized, /!\[[^\]]*\]\([^)]+\)/g)
  const tables = countMatches(normalized, /^\|.+\|$/gm)
  const blockQuotes = countMatches(normalized, /^>\s+/gm)
  return Math.min(
    1600,
    84 +
      Math.ceil(chars / 34) * 12 +
      Math.max(0, lines - 1) * 7 +
      bullets * 10 +
      codeBlocks * 180 +
      images * 160 +
      tables * 90 +
      blockQuotes * 24
  )
}

function estimateToolTraceSize(traces: ToolTrace[]): number {
  const traceWeight = traces.reduce((sum, trace) => {
    const argsLen = String(trace.argsPreview?.text || '').length
    const resultLen = String(trace.resultPreview?.text || '').length
    const diffCount = Array.isArray(trace.diffs) ? trace.diffs.length : 0
    return sum + 42 + Math.ceil((argsLen + resultLen) / 80) * 8 + diffCount * 26
  }, 0)
  return Math.min(720, 56 + traceWeight)
}

function estimateProcessEntrySize(entry: ChatProcessBodyEntry): number {
  if (entry.role === 'assistant') return estimateAssistantContentSize(String(entry.message.content || ''))
  return estimateToolTraceSize(entry.toolGroup.traces)
}

export function estimateChatRowSize(row: ChatMessageViewModel): number {
  if (row.role === 'user') return estimateUserRowSize(String(row.source.content || ''))
  if (row.role === 'assistant') return estimateAssistantContentSize(String(row.source.content || ''))
  if (row.role === 'tool') return estimateToolTraceSize(row.toolGroup?.traces || [])
  if (row.role === 'process') {
    const entries = row.processBodyEntries || []
    if (!entries.length) return 0
    return Math.min(2200, 12 + entries.reduce((sum, entry) => sum + estimateProcessEntrySize(entry) + 10, 0))
  }
  return 140
}

export function detectChatScrollDirection(previousTop: number, nextTop: number): ChatScrollDirection {
  if (nextTop < previousTop - 1) return 'backward'
  if (nextTop > previousTop + 1) return 'forward'
  return 'idle'
}

export function shouldAdjustScrollForSizeChange({
  nowMs,
  suppressUntilMs,
  lastBackwardScrollAtMs,
  userScrollHoldMs = 420
}: {
  nowMs: number
  suppressUntilMs: number
  lastBackwardScrollAtMs: number
  userScrollHoldMs?: number
}): boolean {
  if (nowMs < suppressUntilMs) return false
  if (shouldDeferChatRowMeasurement({ nowMs, lastBackwardScrollAtMs, userScrollHoldMs })) return false
  return true
}

export function shouldDeferChatRowMeasurement({
  nowMs,
  lastBackwardScrollAtMs,
  userScrollHoldMs = 420
}: {
  nowMs: number
  lastBackwardScrollAtMs: number
  userScrollHoldMs?: number
}): boolean {
  return lastBackwardScrollAtMs > 0 && nowMs - lastBackwardScrollAtMs < userScrollHoldMs
}
