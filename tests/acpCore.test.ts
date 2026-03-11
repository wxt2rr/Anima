import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildKey, isWithin, mapAcpUpdateToUiEvent, resolvePathInWorkspace, toLines } from '../src/main/services/acpCore'

test('isWithin: child path inside workspace', () => {
  assert.equal(isWithin('/a/b', '/a/b'), true)
  assert.equal(isWithin('/a/b', '/a/b/c'), true)
  assert.equal(isWithin('/a/b', '/a/b/c/d'), true)
  assert.equal(isWithin('/a/b', '/a/x'), false)
})

test('resolvePathInWorkspace: relative joins, absolute preserved', () => {
  assert.equal(resolvePathInWorkspace('/w', 'file.txt'), '/w/file.txt')
  assert.equal(resolvePathInWorkspace('/w', './x/../y.txt'), '/w/y.txt')
  assert.equal(resolvePathInWorkspace('/w', '/abs/z.txt'), '/abs/z.txt')
})

test('toLines: splits by newline and keeps rest', () => {
  const r1 = toLines('a\nb\nc')
  assert.deepEqual(r1.lines, ['a', 'b'])
  assert.equal(r1.rest, 'c')

  const r2 = toLines('a\r\n\r\nb\r\n')
  assert.deepEqual(r2.lines, ['a', 'b'])
  assert.equal(r2.rest, '')
})

test('mapAcpUpdateToUiEvent: trace normalization and previews', () => {
  const evt = mapAcpUpdateToUiEvent({
    type: 'tool_call',
    runId: 'r1',
    trace: {
      id: 't1',
      name: 'fs/readFile',
      status: 'running',
      args: { path: 'a.txt' }
    }
  })
  assert.ok(evt && evt.type === 'trace')
  if (!evt || evt.type !== 'trace') return
  assert.equal(evt.runId, 'r1')
  assert.equal(evt.trace.id, 't1')
  assert.equal(evt.trace.name, 'fs/readFile')
  assert.equal(evt.trace.status, 'running')
  assert.equal(evt.trace.argsPreview.text.includes('a.txt'), true)
})

test('buildKey: stable key format', () => {
  const key = buildKey('/w', 'thread', 'agent')
  assert.equal(typeof key, 'string')
  assert.equal(key.includes(':thread:agent'), true)
})

