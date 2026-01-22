import React, { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { nanoid } from 'nanoid'
import { cn } from '../../lib/utils'

interface MermaidBlockProps {
  chart: string
  className?: string
}

// Initialize mermaid config
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark', // or 'default', 'forest', 'neutral'
  securityLevel: 'loose',
})

export const MermaidBlock: React.FC<MermaidBlockProps> = ({ chart, className }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    const renderChart = async () => {
      if (!containerRef.current) return
      
      const id = `mermaid-${nanoid()}`
      try {
        const { svg } = await mermaid.render(id, chart)
        setSvg(svg)
        setError(null)
      } catch (err) {
        console.error('Mermaid render error:', err)
        setError('Failed to render diagram')
      }
    }

    renderChart()
  }, [chart])

  return (
    <div className={cn("my-4 p-4 bg-white/5 rounded-md overflow-x-auto flex justify-center", className)} ref={containerRef}>
      {error ? (
        <div className="text-destructive text-sm p-2 border border-destructive/50 rounded bg-destructive/10">
          {error}
          <pre className="mt-2 text-xs opacity-70 whitespace-pre-wrap">{chart}</pre>
        </div>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  )
}
