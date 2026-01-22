import React, { useState } from 'react'
import parse from 'html-react-parser'
import { Maximize2, Minimize2, Code } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface ArtifactsProps {
  content: string
  title?: string
  className?: string
}

export const Artifacts: React.FC<ArtifactsProps> = ({ content, title = 'Preview', className }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className={cn("my-4 border border-border rounded-md overflow-hidden bg-background", className)}>
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-8 w-8 p-0"
        >
          {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </Button>
      </div>
      
      <div className={cn("p-4 bg-white dark:bg-zinc-950 transition-all duration-200", isExpanded ? "h-auto" : "h-64 overflow-hidden relative")}>
        {!isExpanded && (
           <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
        <div className="prose dark:prose-invert max-w-none">
          {parse(content)}
        </div>
      </div>
    </div>
  )
}
