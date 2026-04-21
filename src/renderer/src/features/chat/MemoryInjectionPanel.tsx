import { memo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MemoryInjectionSummary } from '@/store/useStore'
import { LazyDetails } from './LazyDetails'
import { CHAT_AUX_TEXT_CLASS, CHAT_DISCLOSURE_BUTTON_CLASS, CHAT_META_TEXT_CLASS, CHAT_SUMMARY_TEXT_CLASS } from './chatPresentation'

export const MemoryInjectionPanel = memo(function MemoryInjectionPanel({ summary }: { summary: MemoryInjectionSummary }): JSX.Element | null {
  const count = Math.max(0, Number(summary?.count || 0))
  const items = Array.isArray(summary?.items) ? summary.items : []
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <div className="overflow-hidden">
      <button
        type="button"
        className={CHAT_DISCLOSURE_BUTTON_CLASS}
        onClick={() => {
          if (!items.length) return
          setOpen((value) => !value)
        }}
        aria-expanded={items.length ? open : false}
      >
        <span className={CHAT_SUMMARY_TEXT_CLASS}>注入记忆 {count} 条</span>
        {items.length > 0 ? (
          <span className="h-4 w-4 shrink-0 text-muted-foreground/70 flex items-center justify-center">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`} />
          </span>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <span className={`ml-auto ${CHAT_META_TEXT_CLASS}`}>
          {typeof summary?.durationMs === 'number' ? `${summary.durationMs}ms` : ''}
        </span>
      </button>
      <LazyDetails open={open && items.length > 0}>
        <div className="mt-1.5 space-y-1.5">
          {items.map((item, index) => {
            const type = String(item?.type || 'semantic').trim()
            const content = String(item?.content || '').trim()
            if (!content) return null
            return (
              <div key={`${String(item?.id || '')}:${index}`} className="flex items-start gap-2">
                <span className="mt-[6px] h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                <span className={`${CHAT_AUX_TEXT_CLASS} text-foreground/85 break-words`}>
                  <span className="inline-block text-muted-foreground mr-1">[{type}]</span>
                  {content}
                </span>
              </div>
            )
          })}
        </div>
      </LazyDetails>
    </div>
  )
})
