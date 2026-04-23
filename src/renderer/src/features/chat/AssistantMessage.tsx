import { memo, useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import type { MemoryInjectionSummary, Message } from '@/store/useStore'
import { MarkdownContent } from './MarkdownContent'
import { useStreamDraft } from './useStreamDraft'
import { LazyDetails } from './LazyDetails'
import { ArtifactStrip } from './ArtifactStrip'
import { CompressionCard } from './CompressionCard'
import { MemoryInjectionPanel } from './MemoryInjectionPanel'
import { DangerousApprovalCard } from './DangerousApprovalCard'
import {
  CHAT_AUX_TEXT_CLASS,
  CHAT_ASSISTANT_BODY_TEXT_CLASS,
  CHAT_DISCLOSURE_BUTTON_CLASS,
  CHAT_FONT_FAMILY
} from './chatPresentation'

function renderStage(stage: unknown): string {
  const text = String(stage || '').trim()
  if (!text) return ''
  if (text === 'verify' || text === 'model' || text === 'tool' || text === 'model_call' || text === 'tool_call') return ''
  if (text.startsWith('tool_start:') || text.startsWith('tool_done:') || text.startsWith('tool_end:')) return ''
  return text
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  enableMarkdown,
  streaming,
  collapseCodeBlocksByDefault,
  onOpenLinkTarget,
  backendBaseUrl,
  workspaceDir,
  copied,
  showCopyAction,
  onCopyMessage,
  onPatchDangerousApproval,
  onSubmitDangerousApproval
}: {
  message: Message
  enableMarkdown: boolean
  streaming: boolean
  collapseCodeBlocksByDefault?: boolean
  onOpenLinkTarget?: (target: string) => void
  backendBaseUrl?: string
  workspaceDir?: string
  copied?: boolean
  showCopyAction?: boolean
  onCopyMessage?: (messageId: string, text: string) => void
  onPatchDangerousApproval?: (messageId: string, patch: Record<string, unknown>) => void
  onSubmitDangerousApproval?: (message: Message) => void
}): JSX.Element {
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const draft = useStreamDraft(String(message.id || ''))
  const content = String(draft?.content ?? message.content ?? '')
  const reasoningText = String((message.meta as any)?.reasoningText || '').trim()
  const stageText = renderStage((message.meta as any)?.stage)
  const artifacts = Array.isArray((message.meta as any)?.artifacts) ? ((message.meta as any).artifacts as any[]) : []
  const compressionState = (message.meta as any)?.compressionState as 'running' | 'done' | undefined
  const memoryInjection = ((message.meta as any)?.memoryInjection || null) as MemoryInjectionSummary | null
  const dangerousApproval = ((message.meta as any)?.dangerousCommandApproval || null) as any

  return (
    <div className="group space-y-2 py-1.5" style={{ fontFamily: CHAT_FONT_FAMILY }}>
      {dangerousApproval ? (
        <DangerousApprovalCard
          approval={dangerousApproval}
          onSelect={(option) => onPatchDangerousApproval?.(String(message.id || ''), { selectedOption: option })}
          onSubmit={() => onSubmitDangerousApproval?.(message)}
        />
      ) : null}
      {memoryInjection ? <MemoryInjectionPanel summary={memoryInjection} /> : null}
      {reasoningText ? (
        <div>
          <button
            type="button"
            className={CHAT_DISCLOSURE_BUTTON_CLASS}
            onClick={() => setReasoningOpen((value) => !value)}
            aria-expanded={reasoningOpen}
          >
            <span className="text-[12px] font-medium leading-[20px] text-muted-foreground">思考过程</span>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${reasoningOpen ? 'rotate-0' : '-rotate-90'}`} />
            </span>
          </button>
          <LazyDetails open={reasoningOpen}>
            <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/10 px-3 py-2 text-[12px] leading-[20px] text-muted-foreground">{reasoningText}</pre>
          </LazyDetails>
        </div>
      ) : null}
      {compressionState ? <CompressionCard state={compressionState} content={content} /> : null}
      {compressionState ? null : enableMarkdown ? (
        <MarkdownContent
          messageId={String(message.id || '')}
          content={content}
          streaming={streaming}
          collapseCodeBlocksByDefault={collapseCodeBlocksByDefault}
          bodyClassName={CHAT_ASSISTANT_BODY_TEXT_CLASS}
          onOpenLinkTarget={onOpenLinkTarget}
          backendBaseUrl={backendBaseUrl}
          workspaceDir={workspaceDir}
        />
      ) : (
        <p className={`whitespace-pre-wrap ${CHAT_ASSISTANT_BODY_TEXT_CLASS}`}>{content}</p>
      )}
      {stageText ? <div className={CHAT_AUX_TEXT_CLASS}>{stageText}</div> : null}
      {artifacts.length > 0 ? (
        <div>
          <ArtifactStrip
            items={artifacts}
            size="md"
            backendBaseUrl={backendBaseUrl}
            workspaceDir={workspaceDir}
            onOpenLinkTarget={onOpenLinkTarget}
          />
        </div>
      ) : null}
      {showCopyAction && content.trim() ? (
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-[opacity,color,background-color] duration-150 ${copied ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={() => onCopyMessage?.(String(message.id || ''), content)}
          title={copied ? 'Copied' : 'Copy'}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      ) : null}
    </div>
  )
})
