import { memo } from 'react'
import type { Message } from '@/store/useStore'
import type { ChatProcessBodyEntry } from './types'
import { LazyDetails } from './LazyDetails'
import { AssistantMessage } from './AssistantMessage'
import { ToolTraceGroup } from './ToolTraceGroup'

export const ProcessTurnBody = memo(function ProcessTurnBody({
  open,
  entries,
  enableMarkdown,
  onOpenLinkTarget,
  backendBaseUrl,
  workspaceDir,
  onPatchDangerousApproval,
  onSubmitDangerousApproval,
  toolGroupOpenById,
  onToggleToolGroup,
  dangerousApprovals
}: {
  open: boolean
  entries: ChatProcessBodyEntry[]
  enableMarkdown: boolean
  onOpenLinkTarget?: (target: string) => void
  backendBaseUrl?: string
  workspaceDir?: string
  onPatchDangerousApproval?: (messageId: string, patch: Record<string, unknown>) => void
  onSubmitDangerousApproval?: (message: Message) => void
  toolGroupOpenById?: Record<string, boolean>
  onToggleToolGroup?: (groupId: string) => void
  dangerousApprovals?: Array<{ command: string; status: 'approved_once' | 'approved_thread' | 'rejected' }>
}): JSX.Element | null {
  if (!entries.length) return null

  return (
    <LazyDetails open={open}>
      <div className="space-y-1.5 pb-1">
        {entries.map((entry) => {
          if (entry.role === 'assistant') {
            return (
              <AssistantMessage
                key={entry.id}
                message={entry.message}
                enableMarkdown={enableMarkdown}
                streaming={false}
                collapseCodeBlocksByDefault
                onOpenLinkTarget={onOpenLinkTarget}
                backendBaseUrl={backendBaseUrl}
                workspaceDir={workspaceDir}
                showCopyAction={false}
                onPatchDangerousApproval={onPatchDangerousApproval}
                onSubmitDangerousApproval={onSubmitDangerousApproval}
              />
            )
          }

          const groupId = entry.id
          const hasRunningTrace = entry.toolGroup.traces.some((trace) => trace.status === 'running')
          const openState = typeof toolGroupOpenById?.[groupId] === 'boolean'
            ? Boolean(toolGroupOpenById?.[groupId])
            : hasRunningTrace

          return (
            <ToolTraceGroup
              key={groupId}
              groupId={groupId}
              traces={entry.toolGroup.traces}
              open={openState}
              enableMarkdown={enableMarkdown}
              onOpenLinkTarget={onOpenLinkTarget}
              backendBaseUrl={backendBaseUrl}
              workspaceDir={workspaceDir}
              onToggleOpen={() => onToggleToolGroup?.(groupId)}
              dangerousApprovals={dangerousApprovals || []}
            />
          )
        })}
      </div>
    </LazyDetails>
  )
})
