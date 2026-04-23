import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message, ToolTrace } from '../src/renderer/src/store/useStore'
import type { ChatMessageViewModel, ChatProcessBodyEntry } from '../src/renderer/src/features/chat/types'
import {
  estimateChatRowSize,
  shouldAdjustScrollForSizeChange,
  shouldDeferChatRowMeasurement
} from '../src/renderer/src/features/chat/chatVirtualListModel'

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides
  }
}

function makeRow(overrides: Partial<ChatMessageViewModel>): ChatMessageViewModel {
  const source = overrides.source || makeMessage({ id: 'm1', role: 'assistant', content: '' })
  return {
    id: String(source.id || 'm1'),
    role: overrides.role || 'assistant',
    source,
    index: 0,
    turnId: 't1',
    isLatestTurn: false,
    isFirstAssistantOfTurn: false,
    isFinalAssistantOfTurn: false,
    shouldShowTurnProcessSummary: false,
    shouldHideProcess: false,
    isToolGroupHead: false,
    isStageOnlyAssistant: false,
    isTurnExpanded: false,
    ...overrides
  }
}

function makeToolTrace(name: string): ToolTrace {
  return { id: `${name}-1`, name, status: 'succeeded' }
}

test('estimateChatRowSize gives long assistant rows much larger estimates than short user rows', () => {
  const shortUser = makeRow({
    role: 'user',
    source: makeMessage({ id: 'u1', role: 'user', content: '你好' })
  })
  const longAssistant = makeRow({
    role: 'assistant',
    source: makeMessage({
      id: 'a1',
      role: 'assistant',
      content: [
        '这是一个很长的回答。',
        '',
        '- 第一条',
        '- 第二条',
        '',
        '```ts',
        'const answer = 42',
        '```',
        '',
        '再补一段很长很长的正文，用来放大估高差异。'.repeat(24)
      ].join('\n')
    })
  })

  assert.ok(estimateChatRowSize(longAssistant) > estimateChatRowSize(shortUser) * 3)
})

test('estimateChatRowSize expands process rows based on contained assistant and tool entries', () => {
  const processEntries: ChatProcessBodyEntry[] = [
    {
      id: 'a1',
      role: 'assistant',
      message: makeMessage({
        id: 'a1',
        role: 'assistant',
        content: '过程说明'.repeat(60)
      })
    },
    {
      id: 'tool-1',
      role: 'tool',
      toolGroup: {
        messageIds: ['tool-msg-1'],
        traces: [makeToolTrace('WebSearch'), makeToolTrace('WebFetch')]
      }
    }
  ]

  const processRow = makeRow({
    id: 't1:process-body',
    role: 'process',
    processBodyEntries: processEntries,
    source: makeMessage({ id: 'ghost', role: 'assistant', content: '' })
  })

  assert.ok(estimateChatRowSize(processRow) >= 320)
})

test('shouldAdjustScrollForSizeChange blocks auto adjustment while user is actively scrolling upward', () => {
  assert.equal(
    shouldAdjustScrollForSizeChange({
      nowMs: 1200,
      suppressUntilMs: 0,
      lastBackwardScrollAtMs: 1125
    }),
    false
  )
  assert.equal(
    shouldAdjustScrollForSizeChange({
      nowMs: 1200,
      suppressUntilMs: 0,
      lastBackwardScrollAtMs: 700
    }),
    true
  )
  assert.equal(
    shouldAdjustScrollForSizeChange({
      nowMs: 1200,
      suppressUntilMs: 1300,
      lastBackwardScrollAtMs: 0
    }),
    false
  )
})

test('shouldDeferChatRowMeasurement keeps resize measurements paused during upward scroll stabilization window', () => {
  assert.equal(
    shouldDeferChatRowMeasurement({
      nowMs: 1250,
      lastBackwardScrollAtMs: 1100
    }),
    true
  )
  assert.equal(
    shouldDeferChatRowMeasurement({
      nowMs: 1700,
      lastBackwardScrollAtMs: 1100
    }),
    false
  )
})
