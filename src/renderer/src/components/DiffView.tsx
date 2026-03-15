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
    <div className="my-2">
      <div className="rounded-md border border-border bg-background overflow-hidden">
        <div className="max-h-[420px] overflow-y-auto">
          <PatchDiff
            patch={patch}
            style={{
              ['--diffs-font-size' as any]: '12px',
              ['--diffs-line-height' as any]: '20px',
              ['--diffs-font-family' as any]: 'JetBrains Mono, SF Mono, Monaco, Consolas, Ubuntu Mono, Liberation Mono, Courier New, monospace',
              ['--diffs-header-font-family' as any]: 'JetBrains Mono, SF Mono, Monaco, Consolas, Ubuntu Mono, Liberation Mono, Courier New, monospace',
            }}
            options={{
              theme: 'pierre-light',
              themeType: 'light',
              diffStyle: 'split',
              diffIndicators: 'classic',
              disableFileHeader: false,
              disableBackground: false,
            }}
          />
        </div>
      </div>
    </div>
  )
}
