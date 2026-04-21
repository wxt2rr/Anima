import type { CodeHighlightResult } from './types'

function tokenizePlain(value: string): CodeHighlightResult['lines'] {
  return String(value || '').split('\n').map((line, index) => ({
    lineNumber: index + 1,
    tokens: [{ text: line }]
  }))
}

self.onmessage = (event: MessageEvent<{ key: string; language: string; value: string }>) => {
  const { key, language, value } = event.data
  const result: CodeHighlightResult = {
    key,
    language: String(language || 'text'),
    lines: tokenizePlain(value)
  }
  self.postMessage(result)
}
