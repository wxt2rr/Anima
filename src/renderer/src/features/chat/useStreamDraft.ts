import { useSyncExternalStore } from 'react'
import type { Message } from '@/store/useStore'
import type { StreamDraft } from './types'

let current: StreamDraft | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function setStreamDraft(next: StreamDraft | null): void {
  current = next
  emit()
}

export function appendStreamDraft(messageId: string, part: string, meta?: Message['meta']): void {
  if (!current || current.messageId !== messageId) current = { messageId, content: '', meta }
  current = { messageId, content: `${current.content}${part}`, meta: meta ?? current.meta }
  emit()
}

export function useStreamDraft(messageId: string): StreamDraft | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (current?.messageId === messageId ? current : null),
    () => null
  )
}
