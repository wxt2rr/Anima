import React, { useEffect, useMemo, useState } from 'react';
import { Folder, GitBranch, TerminalSquare, Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileExplorer } from './FileExplorer';
import { GitPanel } from './GitPanel';
import { TerminalPanel } from './TerminalPanel';
import { BrowserPreview } from './BrowserPreview';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

export const RightSidebar: React.FC<{ width?: number; onResizeStart?: () => void }> = ({ width = 600, onResizeStart }) => {
  const rightSidebarOpen = useStore((s) => s.ui.rightSidebarOpen)
  const activeRightPanel = useStore((s) => s.ui.activeRightPanel)
  const previewUrl = useStore((s) => s.ui.previewUrl)
  const setRightSidebarOpen = useStore((s) => s.setRightSidebarOpen)
  const setActiveRightPanel = useStore((s) => s.setActiveRightPanel)
  const setPreviewUrl = useStore((s) => s.setPreviewUrl)

  useEffect(() => {
    const previewApi = window.anima?.preview
    if (!previewApi?.onServerDetected) return
    const off = previewApi.onServerDetected(({ url }) => {
      const next = String(url || '').trim()
      if (!next) return
      setPreviewUrl(next)
      setActiveRightPanel('preview')
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [setActiveRightPanel, setPreviewUrl])

  // Default to 'files' if open but no panel selected
  const currentPanel = activeRightPanel || 'files'
  const [mountedPanels, setMountedPanels] = useState<Record<string, boolean>>({})
  const [expandedReady, setExpandedReady] = useState(false)
  const debugEnabled = typeof import.meta !== 'undefined' && Boolean((import.meta as any).env?.DEV)

  if (debugEnabled) {
    console.debug('[RightSidebar][render]', {
      rightSidebarOpen,
      activeRightPanel,
      currentPanel: activeRightPanel || 'files',
      mountedPanels,
      expandedReady
    })
  }

  useEffect(() => {
    if (!rightSidebarOpen) {
      setExpandedReady(false)
      return
    }
    if (debugEnabled) {
      console.debug('[RightSidebar][effect:expandedReady]', {
        rightSidebarOpen,
        currentPanel
      })
    }
    setExpandedReady(false)
    const t = window.setTimeout(() => setExpandedReady(true), 160)
    return () => window.clearTimeout(t)
  }, [rightSidebarOpen, currentPanel])

  useEffect(() => {
    if (!rightSidebarOpen) return
    if (debugEnabled) {
      console.debug('[RightSidebar][effect:mountPanel]', {
        currentPanel,
        mounted: Boolean(mountedPanels[currentPanel])
      })
    }
    setMountedPanels((prev) => (prev[currentPanel] ? prev : { ...prev, [currentPanel]: true }))
  }, [currentPanel, rightSidebarOpen])

  const tabs = [
    { id: 'files', label: 'Files', icon: Folder },
    { id: 'git', label: 'Commit', icon: GitBranch },
    { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
    { id: 'preview', label: 'Preview', icon: Globe },
  ] as const;

  const collapsedWidth = 0
  const expandedWidth = Math.max(300, Math.min(1200, Number(width) || 600))
  const sidebarWidth = rightSidebarOpen ? expandedWidth : collapsedWidth
  const sidebarStyle = useMemo(() => {
    return {
      width: `${sidebarWidth}px`
    } as React.CSSProperties
  }, [sidebarWidth])

  return (
    <div
      className={cn(
        "h-full z-20 shrink-0 no-drag relative overflow-hidden",
        "bg-white transition-[width] duration-200 ease-out"
      )}
      style={sidebarStyle}
    >
      <div className="relative w-full h-full">
        <div
          className={cn(
            "absolute inset-0 flex flex-col bg-white",
            "transition-opacity duration-200 ease-out",
            "pointer-events-auto",
            rightSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          {rightSidebarOpen && (
            <div
              className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-50 group"
              onMouseDown={(e) => {
                if (!onResizeStart) return
                e.preventDefault()
                onResizeStart()
              }}
            />
          )}

          <div className="flex-1 min-w-0 rounded-r-xl border border-border overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 shrink-0 select-none bg-white border-b border-border">
              <div className="flex items-center p-1 bg-white rounded-xl no-drag">
                {tabs.map(tab => {
                  const isActive = currentPanel === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveRightPanel(tab.id)}
                      className={cn(
                        "relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors z-10 no-drag",
                        isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeTab"
                        className="absolute inset-0 bg-white rounded-lg border border-border pointer-events-none"
                          initial={false}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                      )}
                      <tab.icon className="w-3.5 h-3.5 relative z-10" />
                      <span className="relative z-10">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 no-drag rounded-full" 
                onClick={() => setRightSidebarOpen(false)}
              >
                 <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative min-w-0 bg-white" style={{ contain: 'layout paint' }}>
              {tabs.map((tab) => {
                const isActive = currentPanel === tab.id
                const shouldMount = Boolean(mountedPanels[tab.id])
                const show = isActive
                if (!shouldMount && isActive) {
                  return (
                    <div key={tab.id} className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
                      Loading…
                    </div>
                  )
                }
                return (
                  <div key={tab.id} className={cn("h-full w-full", show ? "block" : "hidden")}>
                    {tab.id === 'files' ? (
                      <FileExplorer active={show && rightSidebarOpen} />
                    ) : tab.id === 'git' ? (
                      <GitPanel active={show && rightSidebarOpen} />
                    ) : tab.id === 'terminal' ? (
                      <TerminalPanel active={show && rightSidebarOpen} />
                    ) : tab.id === 'preview' ? (
                      <BrowserPreview initialUrl={previewUrl} active={show && rightSidebarOpen} />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
