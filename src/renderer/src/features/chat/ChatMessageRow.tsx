import { memo } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Message } from '@/store/useStore'
import { useStore } from '@/store/useStore'
import { resolveAppLang } from '@/i18n'
import { APP_SHADCN_DICTIONARIES } from '@/i18n/legacyDictionaries'
import type { ChatMessageViewModel } from './types'
import { bumpChatPerfCounter } from './perfCounters'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ToolTraceGroup } from './ToolTraceGroup'
import { ProcessTurnBody } from './ProcessTurnBody'
import { CHAT_DISCLOSURE_BUTTON_CLASS, CHAT_SUMMARY_TEXT_CLASS } from './chatPresentation'

function summarizeProcess(row: ChatMessageViewModel, lang: string): string {
  const stats = row.processStats
  const dict = APP_SHADCN_DICTIONARIES[0] as any
  const foldProcessSummary = (dict[lang] || dict.en)?.foldProcessSummary
  if (!stats) return typeof foldProcessSummary === 'function' ? foldProcessSummary(0, 0, 0, 0) : 'Injected memories 0, thought 0 times, tools 0 calls, skills 0'
  return typeof foldProcessSummary === 'function'
    ? foldProcessSummary(stats.memoryCount, stats.reasoningCount, stats.toolCount, stats.skillCount)
    : `Injected memories ${stats.memoryCount}, thought ${stats.reasoningCount} times, tools ${stats.toolCount} calls, skills ${stats.skillCount}`
}

export const ChatMessageRow = memo(function ChatMessageRow({
  row,
  enableMarkdown,
  isLoading,
  totalRows,
  onOpenLinkTarget,
  backendBaseUrl,
  workspaceDir,
  copiedMessageId,
  highlightedMessageId,
  onCopyMessage,
  onPatchDangerousApproval,
  onSubmitDangerousApproval,
  onToggleTurn,
  toolGroupOpenById,
  onToggleToolGroup
}: {
  row: ChatMessageViewModel
  enableMarkdown: boolean
  isLoading: boolean
  totalRows: number
  onOpenLinkTarget?: (target: string) => void
  backendBaseUrl?: string
  workspaceDir?: string
  copiedMessageId?: string
  highlightedMessageId?: string
  onCopyMessage?: (messageId: string, text: string) => void
  onPatchDangerousApproval?: (messageId: string, patch: Record<string, unknown>) => void
  onSubmitDangerousApproval?: (message: Message) => void
  onToggleTurn?: (turnId: string) => void
  toolGroupOpenById?: Record<string, boolean>
  onToggleToolGroup?: (groupId: string) => void
}): JSX.Element | null {
  bumpChatPerfCounter('messageRowRender')
  const lang = resolveAppLang(useStore((s) => s.settings?.language))
  if (row.isStageOnlyAssistant) return null
  if (row.shouldHideProcess && !row.shouldShowTurnProcessSummary) return null
  const streaming = row.role === 'assistant' && isLoading && row.index === totalRows - 1
  const copied = copiedMessageId === String(row.source.id || '')
  const highlighted = highlightedMessageId === String(row.source.id || '')
  const summary = row.shouldShowTurnProcessSummary ? (
    <div className="py-1">
      <button
        type="button"
        className={CHAT_DISCLOSURE_BUTTON_CLASS}
        onClick={() => {
          if (!row.turnId) return
          onToggleTurn?.(row.turnId)
        }}
        aria-expanded={row.isTurnExpanded}
      >
        <span className={`${CHAT_SUMMARY_TEXT_CLASS} truncate shrink-0`}>{summarizeProcess(row, lang)}</span>
        <span className="h-4 w-4 shrink-0 text-muted-foreground/70 flex items-center justify-center">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${row.isTurnExpanded ? 'rotate-0' : '-rotate-90'}`} />
        </span>
      </button>
    </div>
  ) : null

  if (row.role === 'user') {
    return (
      <>
        {summary}
        <UserMessage
          message={row.source}
          copied={copied}
          highlighted={highlighted}
          onCopyMessage={onCopyMessage}
          onOpenLinkTarget={onOpenLinkTarget}
          backendBaseUrl={backendBaseUrl}
          workspaceDir={workspaceDir}
        />
      </>
    )
  }
  if (row.role === 'process') {
    if (!row.processBodyEntries?.length) return null
    return (
      <ProcessTurnBody
        open={row.isTurnExpanded}
        entries={row.processBodyEntries}
        enableMarkdown={enableMarkdown}
        onOpenLinkTarget={onOpenLinkTarget}
        backendBaseUrl={backendBaseUrl}
        workspaceDir={workspaceDir}
        onPatchDangerousApproval={onPatchDangerousApproval}
        onSubmitDangerousApproval={onSubmitDangerousApproval}
        toolGroupOpenById={toolGroupOpenById}
        onToggleToolGroup={onToggleToolGroup}
        dangerousApprovals={row.processStats?.dangerousApprovals || []}
      />
    )
  }
  if (row.role === 'tool') {
    if (row.shouldHideProcess || !row.isToolGroupHead || !row.toolGroup?.traces?.length) return null
    const hasRunningTrace = row.toolGroup.traces.some((trace) => trace.status === 'running')
    const open = typeof toolGroupOpenById?.[row.id] === 'boolean'
      ? Boolean(toolGroupOpenById?.[row.id])
      : Boolean((row.isLatestTurn && isLoading) || hasRunningTrace)
    return (
      <ToolTraceGroup
        groupId={row.id}
        traces={row.toolGroup.traces}
        open={open}
        enableMarkdown={enableMarkdown}
        onOpenLinkTarget={onOpenLinkTarget}
        backendBaseUrl={backendBaseUrl}
        workspaceDir={workspaceDir}
        onToggleOpen={() => onToggleToolGroup?.(row.id)}
        dangerousApprovals={row.processStats?.dangerousApprovals || []}
      />
    )
  }
  return (
    <>
      {summary}
      {row.shouldHideProcess ? null : (
        <AssistantMessage
          message={row.source}
          enableMarkdown={enableMarkdown}
          streaming={streaming}
          collapseCodeBlocksByDefault={!row.isLatestTurn || !row.isFinalAssistantOfTurn}
          onOpenLinkTarget={onOpenLinkTarget}
          backendBaseUrl={backendBaseUrl}
          workspaceDir={workspaceDir}
          copied={copied}
          showCopyAction={row.isFinalAssistantOfTurn}
          onCopyMessage={onCopyMessage}
          onPatchDangerousApproval={onPatchDangerousApproval}
          onSubmitDangerousApproval={onSubmitDangerousApproval}
        />
      )}
    </>
  )
})
