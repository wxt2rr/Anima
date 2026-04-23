import type { MarkdownCompileResult } from './types'
import { bumpChatPerfCounter } from './perfCounters'
import {
  getMarkdownCompileKey,
  readMarkdownCompileCachePromise,
  readMarkdownCompileCacheResult,
  writeMarkdownCompileCachePromise,
  writeMarkdownCompileCacheResult
} from './markdownCompileCache'

export function compileMarkdown(messageId: string, content: string): Promise<MarkdownCompileResult> {
  const cachedResult = readMarkdownCompileCacheResult(messageId, content)
  if (cachedResult) return Promise.resolve(cachedResult)
  const key = getMarkdownCompileKey(messageId, content)
  const cachedPromise = readMarkdownCompileCachePromise(messageId, content)
  if (cachedPromise) return cachedPromise
  bumpChatPerfCounter('markdownCompile')
  const promise = import('./markdownCompiler.worker?worker').then(({ default: WorkerCtor }) => {
    const worker = new WorkerCtor()
    return new Promise<MarkdownCompileResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<MarkdownCompileResult>) => {
        worker.terminate()
        writeMarkdownCompileCacheResult(messageId, content, event.data)
        resolve(event.data)
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(new Error(event.message || 'Markdown worker failed'))
      }
      worker.postMessage({ key, content })
    })
  })
  writeMarkdownCompileCachePromise(messageId, content, promise)
  return promise
}
