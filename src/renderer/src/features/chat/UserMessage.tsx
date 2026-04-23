import { memo } from 'react'
import { Check, Copy } from 'lucide-react'
import type { Message } from '@/store/useStore'
import { resolveChatAssetUrl } from './chatLinks'
import { CHAT_BODY_TEXT_CLASS, CHAT_FONT_FAMILY } from './chatPresentation'

export const UserMessage = memo(function UserMessage({
  message,
  copied,
  highlighted,
  onCopyMessage,
  onOpenLinkTarget,
  backendBaseUrl,
  workspaceDir
}: {
  message: Message
  copied?: boolean
  highlighted?: boolean
  onCopyMessage?: (messageId: string, text: string) => void
  onOpenLinkTarget?: (target: string) => void
  backendBaseUrl?: string
  workspaceDir?: string
}): JSX.Element {
  const meta = (message.meta && typeof message.meta === 'object') ? message.meta : {}
  const attachments = Array.isArray((meta as any).userAttachments) ? (meta as any).userAttachments : []
  const attachmentWorkspaceDir = String((meta as any).userAttachmentsWorkspaceDir || workspaceDir || '').trim()
  const imagePaths = attachments
    .map((item: any) => String(item?.path || '').trim())
    .filter(Boolean)
    .filter((path: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path.split('/').pop()?.toLowerCase() || path.toLowerCase()))

  return (
    <div className="group flex justify-end py-1.5">
      <div className="flex flex-col items-end gap-1.5">
        <div
          className={`w-fit max-w-[520px] rounded-2xl border border-border/60 bg-black/5 px-4 py-2.5 whitespace-pre-wrap break-words transition-shadow dark:bg-white/10 ${CHAT_BODY_TEXT_CLASS} ${highlighted ? 'ring-2 ring-primary/35 shadow-sm' : ''}`}
          style={{ fontFamily: CHAT_FONT_FAMILY }}
        >
          {message.content || ''}
        </div>
        {imagePaths.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2 max-w-[520px]">
            {imagePaths.map((path: string, index: number) => (
              <button key={`${path}:${index}`} type="button" onClick={() => onOpenLinkTarget?.(path)}>
                <img
                  src={resolveChatAssetUrl(path, String(backendBaseUrl || ''), attachmentWorkspaceDir, 'attachments')}
                  alt={path.split('/').pop() || 'image'}
                  className="h-20 w-20 rounded-2xl border border-border/60 object-cover bg-muted/10"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-[opacity,color,background-color] duration-150 ${copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={() => onCopyMessage?.(String(message.id || ''), String(message.content || ''))}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
})
