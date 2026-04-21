import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import type { CodeHighlightLine } from './types'

export function VirtualCodeLines({ lines }: { lines: CodeHighlightLine[] }): JSX.Element {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 21,
    overscan: 12
  })

  return (
    <div ref={parentRef} className="max-h-[520px] overflow-auto font-mono text-[12px] leading-[21px]">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index]
          return (
            <div
              key={item.key}
              data-code-line={line.lineNumber}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
              className="flex min-w-0"
            >
              <span className="w-10 shrink-0 select-none text-right pr-3 text-muted-foreground/50">{line.lineNumber}</span>
              <span className="whitespace-pre">{line.tokens.map((token, index) => <span key={index} className={token.className}>{token.text}</span>)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
