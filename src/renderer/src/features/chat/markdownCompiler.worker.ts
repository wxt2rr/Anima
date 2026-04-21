import type { MarkdownCompileResult } from './types'
import { compileMarkdownBlocks } from './markdownCompilerCore'

self.onmessage = (event: MessageEvent<{ key: string; content: string }>) => {
  const { key, content } = event.data
  const result: MarkdownCompileResult = { key, blocks: compileMarkdownBlocks(String(content || '')) }
  self.postMessage(result)
}
