import { memo, useEffect, useMemo, useState, type RefObject } from 'react'
import type { Message } from '@/store/useStore'
import { buildChatMessageViewModels } from './messageViewModel'
import { ChatVirtualList } from './ChatVirtualList'
import { ChatMessageRow } from './ChatMessageRow'
import { buildUserNavigationItems, type ChatUserNavItem } from './chatNavigation'
import { compileMarkdown } from './markdownCompiler'

export const ChatSurface = memo(function ChatSurface({
  messages,
  enableMarkdown,
  collapseHistoricalProcess,
  isLoading,
  scrollRef,
  bottomSentinelRef,
  onOpenLinkTarget,
  backendBaseUrl,
  workspaceDir,
  copiedMessageId,
  highlightedMessageId,
  scrollToMessageId,
  onCopyMessage,
  onPatchDangerousApproval,
  onSubmitDangerousApproval,
  onScrolledToMessage,
  onUserNavItemsChange
}: {
  messages: Message[]
  enableMarkdown: boolean
  collapseHistoricalProcess: boolean
  isLoading: boolean
  scrollRef: RefObject<HTMLElement>
  bottomSentinelRef: RefObject<HTMLDivElement>
  onOpenLinkTarget?: (target: string) => void
  backendBaseUrl?: string
  workspaceDir?: string
  copiedMessageId?: string
  highlightedMessageId?: string
  scrollToMessageId?: string
  onCopyMessage?: (messageId: string, text: string) => void
  onPatchDangerousApproval?: (messageId: string, patch: Record<string, unknown>) => void
  onSubmitDangerousApproval?: (message: Message) => void
  onScrolledToMessage?: (messageId: string) => void
  onUserNavItemsChange?: (items: ChatUserNavItem[]) => void
}): JSX.Element {
  const [openTurns, setOpenTurns] = useState<Record<string, boolean>>({})
  const [openToolGroups, setOpenToolGroups] = useState<Record<string, boolean>>({})
  const openTurnIds = useMemo(
    () => new Set<string>(Object.entries(openTurns).filter(([, open]) => open).map(([turnId]) => turnId)),
    [openTurns]
  )
  const rows = useMemo(
    () => buildChatMessageViewModels(messages, { collapseHistoricalProcess, openTurnIds }),
    [messages, collapseHistoricalProcess, openTurnIds]
  )
  const userNavItems = useMemo(() => buildUserNavigationItems(rows), [rows])

  useEffect(() => {
    onUserNavItemsChange?.(userNavItems)
  }, [onUserNavItemsChange, userNavItems])

  useEffect(() => {
    if (!enableMarkdown) return
    const queue = new Map<string, { id: string; content: string }>()
    for (const row of rows) {
      if (row.role === 'assistant') {
        const content = String(row.source.content || '').trim()
        if (content) queue.set(String(row.source.id || row.id), { id: String(row.source.id || row.id), content })
      }
      if (row.role === 'process') {
        for (const entry of row.processBodyEntries || []) {
          if (entry.role !== 'assistant') continue
          const content = String(entry.message.content || '').trim()
          if (!content) continue
          queue.set(String(entry.message.id || entry.id), { id: String(entry.message.id || entry.id), content })
        }
      }
    }
    queue.forEach(({ id, content }) => {
      // 历史消息在滚入视口前预热 Markdown worker，减少首次进入视口时的高度突变。
      void compileMarkdown(id, content).catch(() => {})
    })
  }, [enableMarkdown, rows])

  return (
    <div className="flex flex-col gap-1.5 pb-2 max-w-3xl mx-auto w-full">
      <ChatVirtualList
        rows={rows}
        scrollRef={scrollRef}
        scrollToMessageId={scrollToMessageId}
        onScrolledToMessage={onScrolledToMessage}
        renderRow={(row) => (
          <ChatMessageRow
            row={row}
            enableMarkdown={enableMarkdown}
            isLoading={isLoading}
            totalRows={rows.length}
            onOpenLinkTarget={onOpenLinkTarget}
            backendBaseUrl={backendBaseUrl}
            workspaceDir={workspaceDir}
            copiedMessageId={copiedMessageId}
            highlightedMessageId={highlightedMessageId}
            onCopyMessage={onCopyMessage}
            onPatchDangerousApproval={onPatchDangerousApproval}
            onSubmitDangerousApproval={onSubmitDangerousApproval}
            onToggleTurn={(turnId) => setOpenTurns((state) => ({ ...state, [turnId]: !state[turnId] }))}
            toolGroupOpenById={openToolGroups}
            onToggleToolGroup={(groupId) => setOpenToolGroups((state) => ({ ...state, [groupId]: !state[groupId] }))}
          />
        )}
      />
      <div ref={bottomSentinelRef} aria-hidden="true" className="h-px w-full" />
    </div>
  )
})
