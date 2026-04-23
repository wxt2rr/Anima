import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MarkdownCompileResult } from '../src/renderer/src/features/chat/types'
import {
  clearMarkdownCompileCache,
  readMarkdownCompileCacheResult,
  writeMarkdownCompileCacheResult
} from '../src/renderer/src/features/chat/markdownCompileCache'

function makeResult(key: string): MarkdownCompileResult {
  return { key, blocks: [{ type: 'markdown', html: `<p>${key}</p>` }] }
}

test('markdown compile cache returns resolved results synchronously for the same message and content', () => {
  clearMarkdownCompileCache()
  const result = makeResult('same')
  writeMarkdownCompileCacheResult('m1', 'hello', result)

  assert.equal(readMarkdownCompileCacheResult('m1', 'hello'), result)
})

test('markdown compile cache isolates entries by message id and content hash', () => {
  clearMarkdownCompileCache()
  const result = makeResult('first')
  writeMarkdownCompileCacheResult('m1', 'hello', result)

  assert.equal(readMarkdownCompileCacheResult('m1', 'world'), null)
  assert.equal(readMarkdownCompileCacheResult('m2', 'hello'), null)
})
