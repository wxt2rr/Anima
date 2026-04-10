import { createTwoFilesPatch } from 'diff'
import { useMemo } from 'react'

interface DiffViewProps {
  oldContent: string
  newContent: string
  fileName: string
}

type DiffLine = {
  key: string
  kind: 'header' | 'hunk' | 'add' | 'remove' | 'context'
  text: string
}

export function DiffView({ oldContent, newContent, fileName }: DiffViewProps) {
  const patch = useMemo(() => {
    let nameForDiff = fileName
    if (!nameForDiff.includes('.')) {
      if (oldContent.includes('# ') || newContent.includes('# ') || oldContent.includes('- ')) {
        nameForDiff += '.md'
      } else {
        nameForDiff += '.txt'
      }
    }
    return createTwoFilesPatch(nameForDiff, nameForDiff, oldContent, newContent)
  }, [oldContent, newContent, fileName])

  const lines = useMemo<DiffLine[]>(() => {
    return patch
      .split('\n')
      .filter((line, index, arr) => !(index === arr.length - 1 && line === ''))
      .map((line, index) => {
        if (
          line.startsWith('Index:') ||
          line.startsWith('===') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ')
        ) {
          return { key: `header-${index}`, kind: 'header', text: line }
        }
        if (line.startsWith('@@')) {
          return { key: `hunk-${index}`, kind: 'hunk', text: line }
        }
        if (line.startsWith('+')) {
          return { key: `add-${index}`, kind: 'add', text: line }
        }
        if (line.startsWith('-')) {
          return { key: `remove-${index}`, kind: 'remove', text: line }
        }
        return { key: `context-${index}`, kind: 'context', text: line || ' ' }
      })
  }, [patch])

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-background">
      <div className="border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="truncate text-[12px] font-medium text-foreground">{fileName}</div>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <pre className="m-0 p-0 font-mono text-[12px] leading-5">
          {lines.map((line) => (
            <div
              key={line.key}
              className={
                line.kind === 'add'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : line.kind === 'remove'
                    ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                    : line.kind === 'hunk'
                      ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                      : line.kind === 'header'
                        ? 'bg-muted/30 text-muted-foreground'
                        : 'text-foreground/80'
              }
            >
              <code className="block whitespace-pre-wrap break-all px-3 py-0.5">{line.text}</code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
