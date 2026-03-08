import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type VirtualListApi = {
  getOffsetTopById: (id: string) => number | null
  getTotalHeight: () => number
  scrollToId: (id: string, opts?: ScrollToOptions) => void
  getVisibleRange: () => { start: number; end: number }
}

export function VirtualizedList<T>({
  items,
  getKey,
  scrollRef,
  renderItem,
  estimateHeight = 120,
  overscan = 6,
  onApi
}: {
  items: T[]
  getKey: (item: T) => string
  scrollRef: React.RefObject<HTMLElement>
  renderItem: (item: T, ctx: { index: number; active: boolean }) => React.ReactNode
  estimateHeight?: number
  overscan?: number
  onApi?: (api: VirtualListApi) => void
}): JSX.Element {
  const heightsRef = useRef<Map<string, number>>(new Map())
  const offsetByIdRef = useRef<Map<string, number>>(new Map())
  const totalHeightRef = useRef(0)
  const visibleRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const scrollTopRef = useRef(0)
  const viewportHeightRef = useRef(0)

  const apiRef = useRef<VirtualListApi | null>(null)
  if (!apiRef.current) {
    apiRef.current = {
      getOffsetTopById: (id: string) => offsetByIdRef.current.get(id) ?? null,
      getTotalHeight: () => totalHeightRef.current,
      getVisibleRange: () => visibleRangeRef.current,
      scrollToId: (id: string, opts?: ScrollToOptions) => {
        const el = scrollRef.current
        if (!el) return
        const top = offsetByIdRef.current.get(id)
        if (top == null) return
        el.scrollTo({ top, behavior: opts?.behavior ?? 'smooth' })
      }
    }
  }

  useEffect(() => {
    if (onApi && apiRef.current) onApi(apiRef.current)
  }, [onApi])

  const [measureVersion, setMeasureVersion] = useState(0)
  const [windowState, setWindowState] = useState<{
    startVisible: number
    endVisible: number
    startRender: number
    endRender: number
    topPad: number
    bottomPad: number
  }>({ startVisible: 0, endVisible: 0, startRender: 0, endRender: -1, topPad: 0, bottomPad: 0 })

  const layout = useMemo(() => {
    void measureVersion
    const offsets = new Array<number>(items.length)
    const keys = new Array<string>(items.length)
    let total = 0
    offsetByIdRef.current = new Map()
    for (let i = 0; i < items.length; i++) {
      const key = String(getKey(items[i]) || `${i}`)
      keys[i] = key
      offsets[i] = total
      offsetByIdRef.current.set(key, total)
      total += heightsRef.current.get(key) ?? estimateHeight
    }
    totalHeightRef.current = total
    return { offsets, keys, total }
  }, [items, getKey, estimateHeight, measureVersion])

  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const computeWindow = useCallback(
    (scrollTop: number, viewportHeight: number) => {
      const curLayout = layoutRef.current
      const n = curLayout.offsets.length
      if (!n) {
        return { startVisible: 0, endVisible: 0, startRender: 0, endRender: -1, topPad: 0, bottomPad: 0 }
      }

      const findIndexAt = (pos: number) => {
        const { offsets } = curLayout
        if (pos <= 0) return 0
        const lastKey = curLayout.keys[n - 1]
        const lastTop = offsets[n - 1]
        const lastH = heightsRef.current.get(lastKey) ?? estimateHeight
        if (pos >= lastTop + lastH) return n - 1

        let lo = 0
        let hi = n - 1
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2)
          const top = offsets[mid]
          if (top <= pos) lo = mid + 1
          else hi = mid
        }
        return Math.max(0, lo - 1)
      }

      const startVisible = findIndexAt(scrollTop)
      const endVisible = findIndexAt(scrollTop + Math.max(0, viewportHeight))
      const startRender = Math.max(0, startVisible - overscan)
      const endRender = Math.min(n - 1, endVisible + overscan)

      const topPad = curLayout.offsets[startRender] || 0
      const endKey = curLayout.keys[endRender] || ''
      const endTop = curLayout.offsets[endRender] || 0
      const endH = heightsRef.current.get(endKey) ?? estimateHeight
      const bottomPad = Math.max(0, curLayout.total - (endTop + endH))
      return { startVisible, endVisible, startRender, endRender, topPad, bottomPad }
    },
    [estimateHeight, overscan]
  )

  const windowRef = useRef(windowState)
  const updateWindow = useCallback(
    (scrollTop: number, viewportHeight: number) => {
      const next = computeWindow(scrollTop, viewportHeight)
      const prev = windowRef.current
      const same =
        prev.startVisible === next.startVisible &&
        prev.endVisible === next.endVisible &&
        prev.startRender === next.startRender &&
        prev.endRender === next.endRender &&
        Math.abs(prev.topPad - next.topPad) < 1 &&
        Math.abs(prev.bottomPad - next.bottomPad) < 1
      visibleRangeRef.current = { start: next.startVisible, end: next.endVisible }
      if (same) return
      windowRef.current = next
      setWindowState(next)
    },
    [computeWindow]
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let raf: number | null = null
    const schedule = () => {
      if (raf != null) return
      raf = window.requestAnimationFrame(() => {
        raf = null
        scrollTopRef.current = el.scrollTop
        viewportHeightRef.current = el.clientHeight
        updateWindow(scrollTopRef.current, viewportHeightRef.current)
      })
    }

    schedule()
    el.addEventListener('scroll', schedule, { passive: true })

    const ro = new ResizeObserver(() => {
      viewportHeightRef.current = el.clientHeight
      updateWindow(scrollTopRef.current, viewportHeightRef.current)
    })
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', schedule as any)
      if (raf != null) window.cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [scrollRef, updateWindow])

  useEffect(() => {
    updateWindow(scrollTopRef.current, viewportHeightRef.current)
  }, [layout, updateWindow])

  const onHeight = useCallback((key: string, height: number) => {
    const prev = heightsRef.current.get(key)
    if (prev != null && Math.abs(prev - height) < 1) return
    heightsRef.current.set(key, height)
    setMeasureVersion((v) => v + 1)
  }, [])

  return (
    <div className="w-full">
      {windowState.topPad > 0 ? <div style={{ height: windowState.topPad }} /> : null}
      {(windowState.endRender >= windowState.startRender ? items.slice(windowState.startRender, windowState.endRender + 1) : []).map((item, i) => {
        const index = windowState.startRender + i
        const key = layout.keys[index]
        const active = index >= windowState.startVisible && index <= windowState.endVisible
        return (
          <MeasuredRow key={key} id={key} onHeight={onHeight}>
            {renderItem(item, { index, active })}
          </MeasuredRow>
        )
      })}
      {windowState.bottomPad > 0 ? <div style={{ height: windowState.bottomPad }} /> : null}
    </div>
  )
}

function MeasuredRow({
  id,
  onHeight,
  children
}: {
  id: string
  onHeight: (id: string, height: number) => void
  children: React.ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const emit = () => onHeight(id, el.getBoundingClientRect().height)
    emit()

    const ro = new ResizeObserver(() => emit())
    ro.observe(el)

    return () => ro.disconnect()
  }, [id, onHeight])

  return <div ref={ref}>{children}</div>
}
