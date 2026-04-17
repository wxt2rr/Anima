import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { buildKey, isWithin, mapAcpUpdateToUiEvent, resolvePathInWorkspace, toLines } from '../src/main/services/acpCore'

test('isWithin: child path inside workspace', () => {
  assert.equal(isWithin('/a/b', '/a/b'), true)
  assert.equal(isWithin('/a/b', '/a/b/c'), true)
  assert.equal(isWithin('/a/b', '/a/b/c/d'), true)
  assert.equal(isWithin('/a/b', '/a/x'), false)
})

test('isWithin: symlink escape to outside workspace is blocked for existing target', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-core-'))
  try {
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    fs.mkdirSync(workspace)
    fs.mkdirSync(outside)
    const outsideFile = path.join(outside, 'secret.txt')
    fs.writeFileSync(outsideFile, 'secret', 'utf8')
    fs.symlinkSync(outside, path.join(workspace, 'link-out'))

    assert.equal(isWithin(workspace, path.join(workspace, 'link-out', 'secret.txt')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('isWithin: symlink escape to outside workspace is blocked for non-existing target', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-core-'))
  try {
    const workspace = path.join(root, 'workspace')
    const outside = path.join(root, 'outside')
    fs.mkdirSync(workspace)
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(workspace, 'link-out'))

    assert.equal(isWithin(workspace, path.join(workspace, 'link-out', 'new-dir', 'new-file.txt')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
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

test('mapAcpUpdateToUiEvent: done/completed tool statuses should not stay running', () => {
  const doneEvt = mapAcpUpdateToUiEvent({
    type: 'tool_call_update',
    trace: { id: 't_done', name: 'load_skill', status: 'done' }
  })
  assert.ok(doneEvt && doneEvt.type === 'trace')
  if (!doneEvt || doneEvt.type !== 'trace') return
  assert.equal(doneEvt.trace.status, 'succeeded')

  const completedEvt = mapAcpUpdateToUiEvent({
    type: 'tool_call_update',
    trace: { id: 't_completed', name: 'load_skill', status: 'completed' }
  })
  assert.ok(completedEvt && completedEvt.type === 'trace')
  if (!completedEvt || completedEvt.type !== 'trace') return
  assert.equal(completedEvt.trace.status, 'succeeded')
})

test('buildKey: stable key format', () => {
  const key = buildKey('/w', 'thread', 'agent')
  assert.equal(typeof key, 'string')
  assert.equal(key.includes(':thread:agent'), true)
})
