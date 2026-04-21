import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileMarkdownBlocks } from '../src/renderer/src/features/chat/markdownCompilerCore'

test('compileMarkdownBlocks renders markdown semantics into html blocks and keeps fenced code separate', () => {
  const blocks = compileMarkdownBlocks([
    '# Title',
    '',
    'Intro with **bold**, `code`, and [link](https://example.com).',
    '',
    '- first',
    '- second',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| A | 1 |',
    '',
    '```ts',
    'const answer = 42',
    '```'
  ].join('\n'))

  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'markdown')
  assert.match(blocks[0].html, /<h1>Title<\/h1>/)
  assert.match(blocks[0].html, /<strong>bold<\/strong>/)
  assert.match(blocks[0].html, /<code>code<\/code>/)
  assert.match(blocks[0].html, /<a href="https:\/\/example\.com"/)
  assert.match(blocks[0].html, /<ul>[\s\S]*<li>first<\/li>[\s\S]*<li>second<\/li>[\s\S]*<\/ul>/)
  assert.match(blocks[0].html, /<table>[\s\S]*<th>Name<\/th>[\s\S]*<td>1<\/td>[\s\S]*<\/table>/)
  assert.deepEqual(blocks[1], { type: 'code', id: 'code-0', language: 'ts', value: 'const answer = 42\n' })
})

test('compileMarkdownBlocks preserves v2 parity markers for images, tasks, deletion and file code', () => {
  const blocks = compileMarkdownBlocks([
    '![Alt](sandbox:/file.png)',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    'This is ~~gone~~ and `src/App.tsx`.',
    '',
    'Visit https://example.com/path.',
    '',
    '$$c = \\pm\\sqrt{a^2+b^2}$$'
  ].join('\n'))

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'markdown')
  assert.match(blocks[0].html, /<img[^>]+data-chat-image-src="sandbox:\/file\.png"/)
  assert.match(blocks[0].html, /<input[^>]+type="checkbox"[^>]+checked/)
  assert.match(blocks[0].html, /<input[^>]+type="checkbox"[^>]+disabled/)
  assert.match(blocks[0].html, /<del>gone<\/del>/)
  assert.match(blocks[0].html, /<code[^>]+data-chat-link-target="src\/App\.tsx"/)
  assert.match(blocks[0].html, /<a[^>]+data-chat-link-target="https:\/\/example\.com\/path"/)
  assert.match(blocks[0].html, /katex/)
})
