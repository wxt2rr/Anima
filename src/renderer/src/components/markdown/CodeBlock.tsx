import React, { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy, Play, Eye, Code as CodeIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Artifacts } from './Artifacts'

interface CodeBlockProps {
  language: string
  value: string
  className?: string
  [key: string]: any
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, value, className, ...props }) => {
  const [copied, setCopied] = useState(false)
  const [isPreview, setIsPreview] = useState(false)
  
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Detect if the code is runnable (e.g., shell scripts)
  const isRunnable = ['bash', 'sh', 'shell', 'zsh', 'python'].includes(language.toLowerCase())
  
  // Detect if the code is previewable (html, svg)
  const isPreviewable = ['html', 'svg'].includes(language.toLowerCase())

  const handleRun = () => {
    // TODO: Implement run logic via IPC
    console.log('Run code:', value)
  }

  return (
    <div className={cn("relative group rounded-md overflow-hidden my-4 border border-border/50", className)}>
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b border-border/50 text-xs text-muted-foreground select-none">
        <span className="font-mono font-medium">{language || 'text'}</span>
        <div className="flex items-center gap-2">
          {isPreviewable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-background/50"
              onClick={() => setIsPreview(!isPreview)}
              title={isPreview ? "Show Code" : "Preview"}
            >
              {isPreview ? <CodeIcon className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          )}
          {isRunnable && !isPreview && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-background/50"
              onClick={handleRun}
              title="Run code"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-background/50"
            onClick={handleCopy}
            title="Copy code"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      <div className="relative">
        {isPreview ? (
          <Artifacts content={value} title={`${language.toUpperCase()} Preview`} className="border-0 my-0" />
        ) : (
          <SyntaxHighlighter
            language={language}
            style={oneLight}
            customStyle={{
              margin: 0,
              padding: '1rem',
              fontSize: '0.875rem',
              lineHeight: '1.5',
            }}
            wrapLines={true}
            wrapLongLines={true}
            {...props}
          >
            {value}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  )
}
