import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

type UseLeftPaneLayoutOptions = {
  initialWidth?: number
  minWidth?: number
  maxWidth?: number
  dragOffsetPx?: number
  storageKey?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function useLeftPaneLayout(options?: UseLeftPaneLayoutOptions) {
  const initialWidth = Number(options?.initialWidth || 288)
  const minWidth = Number(options?.minWidth || 200)
  const maxWidth = Number(options?.maxWidth || 800)
  const dragOffsetPx = Number(options?.dragOffsetPx || 8)
  const storageKey = String(options?.storageKey || 'anima:layout:leftPaneWidth')
  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof window === 'undefined') return initialWidth
    try {
      const raw = window.localStorage.getItem(storageKey)
      const parsed = Number(raw || initialWidth)
      if (!Number.isFinite(parsed)) return initialWidth
      return clamp(parsed, minWidth, maxWidth)
    } catch {
      return initialWidth
    }
  })
  const [isResizingLeft, setIsResizingLeft] = useState(false)

  const startResizingLeft = useCallback(() => {
    setIsResizingLeft(true)
  }, [])

  const updateLeftWidthFromClientX = useCallback((clientX: number) => {
    setLeftWidth(clamp(clientX - dragOffsetPx, minWidth, maxWidth))
  }, [dragOffsetPx, minWidth, maxWidth])

  const stopResizingLeft = useCallback(() => {
    setIsResizingLeft(false)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(storageKey, String(Math.round(leftWidth)))
    } catch {
      // ignore persistence failures
    }
  }, [leftWidth, storageKey])

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty('--app-left-pane-width', `${leftWidth}px`)
  }, [leftWidth])

  return {
    leftWidth,
    isResizingLeft,
    startResizingLeft,
    stopResizingLeft,
    updateLeftWidthFromClientX
  }
}
