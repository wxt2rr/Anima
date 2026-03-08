import React, { useEffect, useMemo, useState } from 'react';
import { Folder, GitBranch, TerminalSquare, Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
    const off = window.anima.preview.onServerDetected(({ url }) => {
      const next = String(url || '').trim()
      if (!next) return
      setPreviewUrl(next)
      setActiveRightPanel('preview')
    })
    return () => off()
  }, [setActiveRightPanel, setPreviewUrl])

  // Default to 'files' if open but no panel selected
  const currentPanel = activeRightPanel || 'files'
  const [mountedPanels, setMountedPanels] = useState<Record<string, boolean>>({})
  const [expandedReady, setExpandedReady] = useState(false)

  useEffect(() => {
    if (!rightSidebarOpen) {
      setExpandedReady(false)
      return
    }
    setExpandedReady(false)
    const t = window.setTimeout(() => setExpandedReady(true), 160)
    return () => window.clearTimeout(t)
  }, [rightSidebarOpen, currentPanel])

  useEffect(() => {
    if (!rightSidebarOpen) return
    setMountedPanels((prev) => (prev[currentPanel] ? prev : { ...prev, [currentPanel]: true }))
  }, [currentPanel, rightSidebarOpen])

  const tabs = [
    { id: 'files', label: 'Files', icon: Folder },
    { id: 'git', label: 'Commit', icon: GitBranch },
    { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
    { id: 'preview', label: 'Preview', icon: Globe },
  ] as const;

  const expandedWidth = Math.max(300, Math.min(1200, Number(width) || 600))
  const expandedTransformClosed = `translateX(${expandedWidth}px)`
  const expandedStyle = useMemo(() => {
    return {
      width: `${expandedWidth}px`,
      transform: rightSidebarOpen ? 'translateX(0px)' : expandedTransformClosed
    } as React.CSSProperties
  }, [expandedTransformClosed, expandedWidth, rightSidebarOpen])

  return (
    <div
      className={cn(
        "h-full z-20 shrink-0 no-drag relative",
        "w-[60px] bg-transparent"
      )}
    >
      <div className="relative w-full h-full">
        
        {/* Collapsed Content (Ghost Mode) */}
        <div 
          className={cn(
            "absolute inset-0 flex flex-col items-center pt-12 transition-all duration-300",
            rightSidebarOpen ? "opacity-0 pointer-events-none scale-95" : "opacity-100 scale-100"
          )}
        >
          <div className="flex flex-col gap-3">
            {tabs.map(tab => (
              <TooltipProvider key={tab.id}>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-primary hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-all"
                      onClick={() => setActiveRightPanel(tab.id)}
                    >
                      <tab.icon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs font-medium">{tab.label}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>

        {/* Expanded Content (Panel) */}
        <div 
          className={cn(
            "absolute top-0 bottom-0 right-0 flex flex-col bg-background",
            "transition-transform duration-200 ease-out will-change-transform",
            "rounded-[12px] overflow-hidden",
            "border border-border shadow-none",
            "pointer-events-auto",
            rightSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          style={expandedStyle}
        >
          {rightSidebarOpen && (
            <div
              className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-50 hover:bg-primary/15 active:bg-primary/25"
              onMouseDown={(e) => {
                if (!onResizeStart) return
                e.preventDefault()
                onResizeStart()
              }}
            />
          )}

          {/* Header / Tabs - Elegant Segmented Control Style */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 draggable">
            <div className="flex items-center p-1 bg-muted/30 rounded-xl no-drag">
              {tabs.map(tab => {
                const isActive = currentPanel === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveRightPanel(tab.id)}
                    className={cn(
                      "relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors z-10",
                      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 bg-background shadow-sm rounded-lg border border-black/5 dark:border-white/5"
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
          <div className="flex-1 overflow-hidden relative mt-2" style={{ contain: 'layout paint' }}>
            {tabs.map((tab) => {
              const isActive = currentPanel === tab.id
              const shouldMount = Boolean(mountedPanels[tab.id]) && (expandedReady || !isActive)
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
  );
};
