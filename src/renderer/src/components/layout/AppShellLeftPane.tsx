import { type ReactNode, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'

type AppShellLeftPaneProps = {
  children: ReactNode
  width?: number | null
  collapsed?: boolean
  className?: string
  bleedPx?: number
  showResizeHandle?: boolean
  resizeInteractive?: boolean
  onResizeStart?: (e: MouseEvent<HTMLDivElement>) => void
}

export function AppShellLeftPane({
  children,
  width = null,
  collapsed = false,
  className,
  bleedPx = 0,
  showResizeHandle = true,
  resizeInteractive = false,
  onResizeStart
}: AppShellLeftPaneProps) {
  const paneWidth = collapsed ? 0 : (typeof width === 'number' ? width : 'var(--app-left-pane-width)')
  const showBleed = !collapsed && bleedPx > 0
  return (
    <div className={cn('relative h-full shrink-0 flex overflow-hidden transition-[width] duration-300 ease-in-out', className)} style={{ width: paneWidth }}>
      {showBleed ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 bottom-0 rounded-l-[20px] bg-[var(--app-left-pane-bg)]"
          style={{ width: `calc(100% + ${bleedPx}px)` }}
        />
      ) : null}
      <div
        className={cn(
          'relative z-10 flex h-full w-full flex-col no-drag overflow-hidden transition-all duration-300 ease-in-out border-r border-border/80 bg-[var(--app-left-pane-bg)]',
          collapsed ? 'opacity-0 p-0 m-0 border-0' : ''
        )}
      >
        {children}
      </div>
      {showResizeHandle ? (
        <div
          className={cn(
            'absolute right-0 top-0 bottom-0 w-[var(--app-left-pane-divider-width)] translate-x-full z-50 transition-colors',
            resizeInteractive
              ? 'cursor-col-resize hover:bg-primary/20 active:bg-primary/40'
              : 'pointer-events-none bg-border/40'
          )}
          onMouseDown={resizeInteractive ? onResizeStart : undefined}
        />
      ) : null}
    </div>
  )
}
