import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyChatLinkTarget, linkifyQuotedFileNames, normalizeChatLinkTarget } from '../src/renderer/src/features/chat/chatLinks'

test('classifyChatLinkTarget separates preview links from local files', () => {
  assert.deepEqual(classifyChatLinkTarget('https://example.com'), { kind: 'preview', target: 'https://example.com' })
  assert.deepEqual(classifyChatLinkTarget('/tmp/a.md'), { kind: 'file', target: '/tmp/a.md' })
  assert.deepEqual(classifyChatLinkTarget('src/App.tsx'), { kind: 'file', target: 'src/App.tsx' })
  assert.deepEqual(classifyChatLinkTarget('localhost:5173'), { kind: 'preview', target: 'http://localhost:5173' })
})

test('normalizeChatLinkTarget trims wrappers and trailing punctuation', () => {
  assert.equal(normalizeChatLinkTarget('`src/App.tsx`,'), 'src/App.tsx')
  assert.equal(normalizeChatLinkTarget('<https://example.com>.'), 'https://example.com')
})

test('linkifyQuotedFileNames turns quoted file tokens into markdown links', () => {
  assert.equal(linkifyQuotedFileNames('open `src/App.tsx`'), 'open [src/App.tsx](src/App.tsx)')
  assert.equal(linkifyQuotedFileNames('see "docs/readme.md"'), 'see [docs/readme.md](docs/readme.md)')
})
