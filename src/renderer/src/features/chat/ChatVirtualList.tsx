import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import type { ChatMessageViewModel } from './types'
import { CHAT_FREEZE_SCROLL_ADJUST_EVENT } from './chatUiEvents'

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

export function ChatVirtualList({
  rows,
  scrollRef,
  renderRow,
  scrollToMessageId,
  onScrolledToMessage
}: {
  rows: ChatMessageViewModel[]
  scrollRef: RefObject<HTMLElement>
  renderRow: (row: ChatMessageViewModel) => ReactNode
  scrollToMessageId?: string
  onScrolledToMessage?: (messageId: string) => void
}): JSX.Element {
  const suppressScrollAdjustUntilRef = useRef(0)
  const virtualizer = useVirtualizer(({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 140,
    overscan: 8,
    getItemKey: (index: number) => rows[index]?.id || index,
    shouldAdjustScrollPositionOnItemSizeChange: () => nowMs() >= suppressScrollAdjustUntilRef.current
  } as any))
  const rowIndexById = useMemo(
    () => new Map<string, number>(rows.map((row, index) => [row.id, index])),
    [rows]
  )

  useEffect(() => {
    const handleFreeze = () => {
      suppressScrollAdjustUntilRef.current = nowMs() + 1600
    }
    window.addEventListener(CHAT_FREEZE_SCROLL_ADJUST_EVENT, handleFreeze)
    return () => {
      window.removeEventListener(CHAT_FREEZE_SCROLL_ADJUST_EVENT, handleFreeze)
    }
  }, [suppressScrollAdjustUntilRef])

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const messageId = String(scrollToMessageId || '').trim()
    if (!messageId) return
    const rowIndex = rowIndexById.get(messageId)
    if (rowIndex == null) return
    virtualizer.scrollToIndex(rowIndex, { align: 'start' })
    onScrolledToMessage?.(messageId)
  }, [onScrolledToMessage, rowIndexById, scrollToMessageId, virtualizer])

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
      {virtualItems.map((item) => {
        const row = rows[item.index]
        if (!row) return null
        return (
          <div
            key={item.key}
            data-index={item.index}
            data-message-id={row.id}
            data-role={row.role}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`
            }}
          >
            {renderRow(row)}
          </div>
        )
      })}
    </div>
  )
}
