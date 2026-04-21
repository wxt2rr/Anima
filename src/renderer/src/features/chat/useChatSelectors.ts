import { useMemo } from 'react'
import { useStore, type Message } from '@/store/useStore'

export function useActiveChatRenderState(): {
  activeChatId: string
  messages: Message[]
  enableMarkdown: boolean
  collapseHistoricalProcess: boolean
  isLoading: boolean
} {
  const activeChatId = useStore((s) => s.activeChatId)
  const messages = useStore((s) => s.messages)
  const enableMarkdown = useStore((s) => Boolean(s.settings?.enableMarkdown))
  const collapseHistoricalProcess = useStore((s) => (s.settings as any)?.collapseHistoricalProcess !== false)
  return useMemo(
    () => ({ activeChatId, messages, enableMarkdown, collapseHistoricalProcess, isLoading: false }),
    [activeChatId, messages, enableMarkdown, collapseHistoricalProcess]
  )
}

export function useMessageById(messageId: string): Message | undefined {
  return useStore((s) => s.messages.find((m) => String(m.id || '') === messageId))
}
