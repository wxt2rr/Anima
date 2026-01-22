import React, { useEffect } from 'react';
import { Folder, GitBranch, TerminalSquare, Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FileExplorer } from './FileExplorer';
import { GitPanel } from './GitPanel';
import { TerminalPanel } from './TerminalPanel';
import { BrowserPreview } from './BrowserPreview';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export const RightSidebar: React.FC<{ width?: number }> = ({ width = 600 }) => {
  const { 
    ui: { rightSidebarOpen, activeRightPanel, previewUrl }, 
    setRightSidebarOpen, 
    setActiveRightPanel,
    setPreviewUrl
  } = useStore();

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
  const currentPanel = activeRightPanel || 'files';

  const renderContent = () => {
    switch (currentPanel) {
      case 'files': return <FileExplorer />;
      case 'git': return <GitPanel />;
      case 'terminal': return <TerminalPanel />;
      case 'preview': return <BrowserPreview initialUrl={previewUrl} />;
      default: return null;
    }
  };

  const tabs = [
    { id: 'files', label: 'Files', icon: Folder },
    { id: 'git', label: 'Commit', icon: GitBranch },
    { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
    { id: 'preview', label: 'Preview', icon: Globe },
  ] as const;

  return (
    <div
      style={{ width: rightSidebarOpen ? width : 60 }}
      className={cn(
        "h-full z-20 shrink-0 transition-[width] duration-300 ease-in-out will-change-[width]",
        "rounded-[12px] overflow-hidden no-drag",
        // When collapsed: clean, no heavy border (or subtle), slightly wider for elegance
        // When expanded: standard border
        rightSidebarOpen 
          ? "border border-border shadow-none bg-background" 
          : "border-0 bg-transparent" 
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
            "absolute inset-y-0 right-0 w-full flex flex-col transition-all duration-300 bg-background",
            rightSidebarOpen 
              ? "opacity-100 translate-x-0" 
              : "opacity-0 translate-x-4 pointer-events-none"
          )}
        >
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
          <div className="flex-1 overflow-hidden relative mt-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPanel}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="h-full w-full"
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};
