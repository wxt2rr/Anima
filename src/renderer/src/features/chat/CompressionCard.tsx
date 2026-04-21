import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { CHAT_BODY_TEXT_CLASS, CHAT_DISCLOSURE_BUTTON_CLASS, CHAT_FONT_FAMILY, CHAT_SUMMARY_TEXT_CLASS } from './chatPresentation'
import { LazyDetails } from './LazyDetails'

export const CompressionCard = memo(function CompressionCard({
  state,
  content
}: {
  state: 'running' | 'done'
  content: string
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(state === 'done')
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const showBody = !collapsed && Boolean(String(content || '').trim())

  useEffect(() => {
    setCollapsed(state === 'done')
  }, [state])

  useEffect(() => {
    if (!showBody) return
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content, showBody])

  const title = state === 'running' ? '正在压缩上下文' : '上下文压缩完成'
  const canToggle = state === 'done'

  return (
    <div className="w-full">
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-background/60 backdrop-blur-sm overflow-hidden">
        <button
          type="button"
          className={`${CHAT_DISCLOSURE_BUTTON_CLASS} px-3 ${canToggle ? 'cursor-pointer' : 'cursor-default'}`}
          onClick={() => {
            if (!canToggle) return
            setCollapsed((value) => !value)
          }}
        >
          <div className={`${CHAT_SUMMARY_TEXT_CLASS} ${state === 'running' ? 'anima-flow-text' : 'text-foreground/80'}`}>{title}</div>
          {canToggle ? (
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-200 ${collapsed ? '-rotate-90' : 'rotate-0'}`} />
          ) : (
            <div className="h-4 w-4 shrink-0" />
          )}
        </button>
        <LazyDetails open={showBody}>
          <div className="border-t border-border/50">
            <div ref={viewportRef} className="h-[150px] overflow-y-auto px-3 py-2 custom-scrollbar">
              <div className={`whitespace-pre-wrap ${CHAT_BODY_TEXT_CLASS}`} style={{ fontFamily: CHAT_FONT_FAMILY }}>{content}</div>
            </div>
          </div>
        </LazyDetails>
      </div>
    </div>
  )
})
