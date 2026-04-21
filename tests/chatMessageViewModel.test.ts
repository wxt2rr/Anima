import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message } from '../src/renderer/src/store/useStore'
import { buildChatMessageViewModels } from '../src/renderer/src/features/chat/messageViewModel'

test('buildChatMessageViewModels marks historical process rows hidden and summary visible', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'one', turnId: 't1', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '', turnId: 't1', timestamp: 2, meta: { reasoningText: 'thinking' } },
    { id: 'tool1', role: 'tool', content: '', turnId: 't1', timestamp: 3, meta: { toolTraces: [{ id: 'tr1', name: 'bash', status: 'succeeded' }] } },
    { id: 'a2', role: 'assistant', content: 'final', turnId: 't1', timestamp: 4 },
    { id: 'u2', role: 'user', content: 'two', turnId: 't2', timestamp: 5 },
    { id: 'a3', role: 'assistant', content: 'latest', turnId: 't2', timestamp: 6 }
  ]

  const rows: any[] = buildChatMessageViewModels(messages, { collapseHistoricalProcess: true, openTurnIds: new Set<string>() })
  const byId = (id: string) => rows.find((row) => row.id === id)
  assert.equal(byId('a1')?.shouldShowTurnProcessSummary, true)
  assert.equal(byId('a1')?.shouldHideProcess, true)
  assert.equal(byId('tool1'), undefined)
  assert.equal(byId('t1:process-body')?.role, 'process')
  assert.equal(byId('t1:process-body')?.isTurnExpanded, false)
  assert.deepEqual(
    byId('t1:process-body')?.processBodyEntries?.map((entry: any) => entry.role),
    ['assistant', 'tool']
  )
  assert.equal(byId('a2')?.isFinalAssistantOfTurn, true)
  assert.equal(byId('a3')?.isLatestTurn, true)
})

test('buildChatMessageViewModels keeps historical process visible when turn is expanded', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'one', turnId: 't1', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '', turnId: 't1', timestamp: 2, meta: { reasoningText: 'thinking' } },
    { id: 'tool1', role: 'tool', content: '', turnId: 't1', timestamp: 3, meta: { toolTraces: [{ id: 'tr1', name: 'bash', status: 'succeeded' }] } },
    { id: 'a2', role: 'assistant', content: 'final', turnId: 't1', timestamp: 4 },
    { id: 'u2', role: 'user', content: 'two', turnId: 't2', timestamp: 5 },
    { id: 'a3', role: 'assistant', content: 'latest', turnId: 't2', timestamp: 6 }
  ]

  const rows: any[] = buildChatMessageViewModels(messages, { collapseHistoricalProcess: true, openTurnIds: new Set<string>(['t1']) })
  const byId = (id: string) => rows.find((row) => row.id === id)
  assert.equal(byId('a1')?.shouldHideProcess, true)
  assert.equal(byId('tool1'), undefined)
  assert.equal(byId('a1')?.isTurnExpanded, true)
  assert.equal(byId('t1:process-body')?.isTurnExpanded, true)
  assert.deepEqual(
    byId('t1:process-body')?.processBodyEntries?.map((entry: any) => entry.role),
    ['assistant', 'tool']
  )
})
