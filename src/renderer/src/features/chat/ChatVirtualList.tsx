import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import type { ChatMessageViewModel } from './types'
import { CHAT_FREEZE_SCROLL_ADJUST_EVENT } from './chatUiEvents'
import {
  detectChatScrollDirection,
  estimateChatRowSize,
  shouldDeferChatRowMeasurement,
  shouldAdjustScrollForSizeChange
} from './chatVirtualListModel'

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
  const lastBackwardScrollAtRef = useRef(0)
  const lastObservedScrollTopRef = useRef(0)
  const pendingMeasureFlushTimerRef = useRef<number | null>(null)
  const measuredNodesRef = useRef(new Map<string, HTMLElement>())
  const virtualizer = useVirtualizer(({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index: number) => estimateChatRowSize(rows[index] as ChatMessageViewModel),
    overscan: 8,
    getItemKey: (index: number) => rows[index]?.id || index,
    shouldAdjustScrollPositionOnItemSizeChange: () => shouldAdjustScrollForSizeChange({
      nowMs: nowMs(),
      suppressUntilMs: suppressScrollAdjustUntilRef.current,
      lastBackwardScrollAtMs: lastBackwardScrollAtRef.current
    })
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

  const flushMeasuredNodes = useCallback(() => {
    pendingMeasureFlushTimerRef.current = null
    measuredNodesRef.current.forEach((node, rowId) => {
      if (!node.isConnected) {
        measuredNodesRef.current.delete(rowId)
        return
      }
      virtualizer.measureElement(node)
    })
  }, [virtualizer])

  const scheduleMeasureFlush = useCallback((delayMs = 440) => {
    if (pendingMeasureFlushTimerRef.current != null) window.clearTimeout(pendingMeasureFlushTimerRef.current)
    pendingMeasureFlushTimerRef.current = window.setTimeout(() => {
      flushMeasuredNodes()
    }, delayMs)
  }, [flushMeasuredNodes])

  useEffect(() => {
    let scrollEl: HTMLElement | null = null
    let rafId: number | null = null
    const handleScroll = () => {
      if (!scrollEl) return
      const nextTop = scrollEl.scrollTop
      const direction = detectChatScrollDirection(lastObservedScrollTopRef.current, nextTop)
      lastObservedScrollTopRef.current = nextTop
      if (direction === 'backward') {
        lastBackwardScrollAtRef.current = nowMs()
        scheduleMeasureFlush()
        return
      }
      if (direction === 'forward') scheduleMeasureFlush(220)
    }

    const attach = () => {
      if (scrollEl) return
      const current = scrollRef.current
      if (!current) {
        rafId = window.requestAnimationFrame(attach)
        return
      }
      scrollEl = current
      lastObservedScrollTopRef.current = scrollEl.scrollTop
      scrollEl.addEventListener('scroll', handleScroll, { passive: true })
    }

    attach()
    return () => {
      if (pendingMeasureFlushTimerRef.current != null) window.clearTimeout(pendingMeasureFlushTimerRef.current)
      if (rafId != null) window.cancelAnimationFrame(rafId)
      if (scrollEl) scrollEl.removeEventListener('scroll', handleScroll)
    }
  }, [scheduleMeasureFlush, scrollRef, rows.length])

  const registerMeasuredNode = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const rowId = String(node.dataset.messageId || '').trim()
    if (!rowId) return
    measuredNodesRef.current.set(rowId, node)
    if (shouldDeferChatRowMeasurement({ nowMs: nowMs(), lastBackwardScrollAtMs: lastBackwardScrollAtRef.current })) return
    virtualizer.measureElement(node)
  }, [virtualizer])

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
            ref={registerMeasuredNode}
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
