import { ChevronDown } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { flushSync } from 'react-dom'
import type { CodeHighlightResult } from './types'
import { VirtualCodeLines } from './VirtualCodeLines'
import { bumpChatPerfCounter } from './perfCounters'
import { CHAT_FREEZE_SCROLL_ADJUST_EVENT } from './chatUiEvents'

const cache = new Map<string, Promise<CodeHighlightResult>>()

function hashText(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function highlightCode(language: string, value: string): Promise<CodeHighlightResult> {
  const key = `${language}:${hashText(value)}`
  const cached = cache.get(key)
  if (cached) return cached
  bumpChatPerfCounter('codeHighlight')
  const promise = import('./codeHighlightWorker?worker').then(({ default: WorkerCtor }) => {
    const worker = new WorkerCtor()
    return new Promise<CodeHighlightResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<CodeHighlightResult>) => {
        worker.terminate()
        resolve(event.data)
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(new Error(event.message || 'Code highlight worker failed'))
      }
      worker.postMessage({ key, language, value })
    })
  })
  cache.set(key, promise)
  return promise
}

function freezeChatScrollAdjust(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHAT_FREEZE_SCROLL_ADJUST_EVENT))
}

function findScrollContainer(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement || null
  while (current) {
    const style = window.getComputedStyle(current)
    if (/(auto|scroll)/.test(style.overflowY || '') && current.scrollHeight > current.clientHeight) return current
    current = current.parentElement
  }
  return null
}

export const CodeBlockView = memo(function CodeBlockView({
  language,
  value,
  defaultCollapsed
}: {
  language: string
  value: string
  defaultCollapsed?: boolean
}): JSX.Element {
  const normalizedLanguage = useMemo(() => String(language || 'text').trim() || 'text', [language])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const anchorTopRef = useRef<number | null>(null)
  const anchorScrollElRef = useRef<HTMLElement | null>(null)
  const anchorHoldUntilRef = useRef(0)
  const anchorRafRef = useRef<number | null>(null)
  const [result, setResult] = useState<CodeHighlightResult | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed))
  const reduceMotion = useReducedMotion()
  const isPreviewable = normalizedLanguage === 'html' || normalizedLanguage === 'svg'
  const lineCount = useMemo(() => Math.max(1, value.split('\n').length), [value])
  const useInternalScroll = !collapsed && !previewOpen && lineCount > 18
  const svgPreviewUrl = useMemo(() => {
    if (normalizedLanguage !== 'svg') return ''
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`
  }, [normalizedLanguage, value])

  useEffect(() => {
    setCollapsed(Boolean(defaultCollapsed))
  }, [defaultCollapsed, language, value])

  useEffect(() => {
    if (collapsed) return
    let alive = true
    setResult(null)
    void highlightCode(normalizedLanguage, value).then((next) => {
      if (alive) setResult(next)
    })
    return () => {
      alive = false
    }
  }, [collapsed, normalizedLanguage, value])

  const armViewportAnchor = useCallback((holdMs = 960): void => {
    freezeChatScrollAdjust()
    const root = rootRef.current
    const scrollEl = findScrollContainer(root)
    if (!root || !scrollEl) {
      anchorTopRef.current = null
      anchorScrollElRef.current = null
      anchorHoldUntilRef.current = 0
      return
    }
    anchorTopRef.current = root.getBoundingClientRect().top
    anchorScrollElRef.current = scrollEl
    anchorHoldUntilRef.current = performance.now() + Math.max(180, holdMs)
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    const scrollEl = anchorScrollElRef.current
    const anchorTop = anchorTopRef.current
    if (!root || !scrollEl || anchorTop == null) return
    if (anchorRafRef.current != null) window.cancelAnimationFrame(anchorRafRef.current)
    const tick = () => {
      const nextRoot = rootRef.current
      const nextScrollEl = anchorScrollElRef.current
      const nextAnchorTop = anchorTopRef.current
      if (!nextRoot || !nextScrollEl || nextAnchorTop == null) {
        anchorRafRef.current = null
        return
      }
      const delta = nextRoot.getBoundingClientRect().top - nextAnchorTop
      if (Math.abs(delta) > 0.5) nextScrollEl.scrollTop += delta
      if (performance.now() >= anchorHoldUntilRef.current) {
        anchorTopRef.current = null
        anchorScrollElRef.current = null
        anchorHoldUntilRef.current = 0
        anchorRafRef.current = null
        return
      }
      anchorRafRef.current = window.requestAnimationFrame(tick)
    }
    anchorRafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (anchorRafRef.current != null) {
        window.cancelAnimationFrame(anchorRafRef.current)
        anchorRafRef.current = null
      }
    }
  }, [collapsed, previewOpen, result])

  return (
    <div ref={rootRef} className="relative group rounded-md overflow-hidden my-4 border border-border/50 bg-muted/20">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border/50 text-xs text-muted-foreground select-none">
        <button type="button" className="min-w-0 flex items-center gap-2 text-left hover:text-foreground" onClick={() => {
          armViewportAnchor()
          flushSync(() => {
            setCollapsed((value) => !value)
          })
        }}>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`} />
          <span className="font-mono font-medium">{normalizedLanguage}</span>
          <span className="text-[11px] text-muted-foreground/80">{lineCount} 行</span>
        </button>
        <div className="flex items-center gap-3">
          {!collapsed && isPreviewable ? (
            <button type="button" className="text-[12px] hover:underline" onClick={() => {
              armViewportAnchor(640)
              flushSync(() => {
                setPreviewOpen((value) => !value)
              })
            }}>
              {previewOpen ? '查看代码' : '预览'}
            </button>
          ) : null}
          {!collapsed ? <button type="button" className="text-[12px] hover:underline" onClick={() => void navigator.clipboard.writeText(value)}>复制</button> : null}
        </div>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {collapsed ? null : (
          <motion.div
            key={previewOpen && isPreviewable ? 'preview' : 'code'}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, height: 'auto' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
            transition={reduceMotion ? { duration: 0.12 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {previewOpen && isPreviewable ? (
              normalizedLanguage === 'svg' ? (
                <div className="p-4 bg-white flex justify-center overflow-auto">
                  <img src={svgPreviewUrl} alt="svg preview" className="max-w-full h-auto" />
                </div>
              ) : (
                <iframe title="html preview" srcDoc={value} className="w-full h-[320px] bg-white" sandbox="allow-same-origin" />
              )
            ) : (
              <div className={useInternalScroll ? 'max-h-[420px] overflow-auto' : ''}>
                {result ? <VirtualCodeLines lines={result.lines} /> : <pre className="p-4 text-[12px] whitespace-pre-wrap">{value}</pre>}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
