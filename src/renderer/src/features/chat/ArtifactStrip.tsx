import { memo } from 'react'
import type { Artifact } from '@/store/useStore'
import { resolveChatAssetUrl } from './chatLinks'

export const ArtifactStrip = memo(function ArtifactStrip({
  items,
  size = 'md',
  backendBaseUrl,
  workspaceDir,
  onOpenLinkTarget
}: {
  items: Artifact[]
  size?: 'sm' | 'md'
  backendBaseUrl?: string
  workspaceDir?: string
  onOpenLinkTarget?: (target: string) => void
}): JSX.Element | null {
  const arts = Array.isArray(items) ? items.filter((item) => item && typeof item.path === 'string' && item.path.trim()) : []
  if (!arts.length) return null
  const imgH = size === 'sm' ? 'h-16' : 'h-24'
  const chip = size === 'sm' ? 'text-[11px] px-2 py-1' : 'text-[12px] px-2.5 py-1.5'
  const gap = size === 'sm' ? 'gap-1.5' : 'gap-2'

  return (
    <div className={`flex flex-wrap ${gap}`}>
      {arts.map((item, index) => {
        const path = String(item.path || '').trim()
        const name = String(item.title || '').trim() || path.split('/').pop() || 'artifact'
        const mime = String(item.mime || '').toLowerCase()
        const isImage = item.kind === 'image' || mime.startsWith('image/')
        const isVideo = item.kind === 'video' || mime.startsWith('video/')
        const src = resolveChatAssetUrl(path, String(backendBaseUrl || ''), String(workspaceDir || ''), 'artifacts')
        if (isImage) {
          return (
            <button
              key={`${path}:${index}`}
              type="button"
              className="rounded-md border border-border/60 bg-muted/10 hover:bg-muted/30 transition-colors overflow-hidden"
              onClick={() => onOpenLinkTarget?.(path)}
              title={path}
            >
              <img src={src} alt={name} className={`${imgH} w-auto max-w-[320px] object-contain`} loading="lazy" />
            </button>
          )
        }
        if (isVideo) {
          return (
            <div key={`${path}:${index}`} className="rounded-md border border-border/60 bg-muted/10 overflow-hidden" title={path}>
              <div className="flex items-center justify-end px-2 py-1 border-b border-border/40 bg-muted/10">
                <button
                  type="button"
                  className={`rounded border border-border/60 bg-background/40 hover:bg-background/60 transition-colors font-mono ${chip}`}
                  onClick={() => onOpenLinkTarget?.(path)}
                >
                  Open
                </button>
              </div>
              <video src={src} className={`${imgH} w-auto max-w-[320px] bg-black`} controls preload="metadata" />
            </div>
          )
        }
        return (
          <button
            key={`${path}:${index}`}
            type="button"
            className={`rounded-md border border-border/60 bg-muted/10 hover:bg-muted/30 transition-colors font-mono ${chip}`}
            onClick={() => onOpenLinkTarget?.(path)}
            title={path}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
})
