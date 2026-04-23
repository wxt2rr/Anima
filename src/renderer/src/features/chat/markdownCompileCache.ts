import type { MarkdownCompileResult } from './types'

const pendingCache = new Map<string, Promise<MarkdownCompileResult>>()
const resolvedCache = new Map<string, MarkdownCompileResult>()

function hashText(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function getMarkdownCompileKey(messageId: string, content: string): string {
  return `${messageId}:${hashText(content)}`
}

export function readMarkdownCompileCacheResult(messageId: string, content: string): MarkdownCompileResult | null {
  return resolvedCache.get(getMarkdownCompileKey(messageId, content)) || null
}

export function readMarkdownCompileCachePromise(messageId: string, content: string): Promise<MarkdownCompileResult> | null {
  return pendingCache.get(getMarkdownCompileKey(messageId, content)) || null
}

export function writeMarkdownCompileCachePromise(messageId: string, content: string, promise: Promise<MarkdownCompileResult>): void {
  pendingCache.set(getMarkdownCompileKey(messageId, content), promise)
}

export function writeMarkdownCompileCacheResult(messageId: string, content: string, result: MarkdownCompileResult): void {
  const key = getMarkdownCompileKey(messageId, content)
  resolvedCache.set(key, result)
  pendingCache.delete(key)
}

export function clearMarkdownCompileCache(): void {
  pendingCache.clear()
  resolvedCache.clear()
}
