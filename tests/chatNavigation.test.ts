import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message } from '../src/renderer/src/store/useStore'
import { buildChatMessageViewModels } from '../src/renderer/src/features/chat/messageViewModel'
import { buildUserNavigationItems } from '../src/renderer/src/features/chat/chatNavigation'

test('buildUserNavigationItems maps visible user turns into stable navigation markers', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'short', turnId: 't1', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: 'reply', turnId: 't1', timestamp: 2 },
    { id: 'u2', role: 'user', content: 'this is a much longer message', turnId: 't2', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: 'reply', turnId: 't2', timestamp: 4 }
  ]
  const rows = buildChatMessageViewModels(messages, { collapseHistoricalProcess: false, openTurnIds: new Set<string>() })
  const items = buildUserNavigationItems(rows)
  assert.equal(items.length, 2)
  assert.equal(items[0]?.id, 'u1')
  assert.equal(items[0]?.topRatio, 0)
  assert.equal(items[1]?.id, 'u2')
  assert.equal(items[1]?.topRatio, 2 / 3)
  assert.ok((items[1]?.widthPx || 0) > (items[0]?.widthPx || 0))
})
