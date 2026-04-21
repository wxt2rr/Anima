import type { MarkdownCompileResult } from './types'
import { bumpChatPerfCounter } from './perfCounters'

const cache = new Map<string, Promise<MarkdownCompileResult>>()

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

export function compileMarkdown(messageId: string, content: string): Promise<MarkdownCompileResult> {
  const key = getMarkdownCompileKey(messageId, content)
  const cached = cache.get(key)
  if (cached) return cached
  bumpChatPerfCounter('markdownCompile')
  const promise = import('./markdownCompiler.worker?worker').then(({ default: WorkerCtor }) => {
    const worker = new WorkerCtor()
    return new Promise<MarkdownCompileResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<MarkdownCompileResult>) => {
        worker.terminate()
        resolve(event.data)
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(new Error(event.message || 'Markdown worker failed'))
      }
      worker.postMessage({ key, content })
    })
  })
  cache.set(key, promise)
  return promise
}
