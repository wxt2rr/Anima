import { PatchDiff } from '@pierre/diffs/react'
import { createTwoFilesPatch } from 'diff'
import { useMemo } from 'react'

interface DiffViewProps {
  oldContent: string
  newContent: string
  fileName: string
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

  return (
    <div className="my-2 space-y-1">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between px-1">
        <span>{fileName}</span>
      </div>
      <div className="rounded-md border border-border bg-background overflow-hidden">
        <div className="max-h-[400px] overflow-y-auto text-xs">
          <PatchDiff
            patch={patch}
            options={{
              theme: 'pierre-light',
              themeType: 'light',
              diffStyle: 'split',
              diffIndicators: 'classic',
              disableFileHeader: true,
              disableBackground: false,
            }}
          />
        </div>
      </div>
    </div>
  )
}
