import { memo } from 'react'
import type { ToolDiff } from '@/store/useStore'
import { DiffView } from '@/components/DiffView'

export const ToolDiffList = memo(function ToolDiffList({
  diffs
}: {
  diffs: ToolDiff[]
}): JSX.Element | null {
  const items = Array.isArray(diffs) ? diffs.filter((diff) => diff && typeof diff.path === 'string' && diff.path.trim()) : []
  if (!items.length) return null
  return (
    <div className="space-y-2">
      {items.map((diff, index) => (
        <DiffView key={`${diff.path}:${index}`} oldContent={diff.oldContent} newContent={diff.newContent} fileName={diff.path} />
      ))}
    </div>
  )
})
