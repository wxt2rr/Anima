import type { Message, ToolTrace } from '@/store/useStore'

export type ChatRenderRole = 'user' | 'assistant' | 'tool' | 'process'

export type ChatProcessBodyEntry =
  | { id: string; role: 'assistant'; message: Message }
  | { id: string; role: 'tool'; toolGroup: { messageIds: string[]; traces: ToolTrace[] } }

export type ChatMessageViewModel = {
  id: string
  role: ChatRenderRole
  source: Message
  index: number
  turnId: string
  isLatestTurn: boolean
  isFirstAssistantOfTurn: boolean
  isFinalAssistantOfTurn: boolean
  shouldShowTurnProcessSummary: boolean
  shouldHideProcess: boolean
  isToolGroupHead: boolean
  toolGroup?: {
    messageIds: string[]
    traces: ToolTrace[]
  }
  processBodyEntries?: ChatProcessBodyEntry[]
  isStageOnlyAssistant: boolean
  isTurnExpanded: boolean
  processStats?: TurnProcessStats
}

export type TurnProcessStats = {
  memoryCount: number
  reasoningCount: number
  toolCount: number
  skillCount: number
  hasProcess: boolean
  finalAssistantMessageId: string
  dangerousApprovals?: Array<{ command: string; status: 'approved_once' | 'approved_thread' | 'rejected' }>
}

export type MarkdownCompileResult = {
  key: string
  blocks: MarkdownBlock[]
}

export type MarkdownBlock =
  | { type: 'markdown'; html: string }
  | { type: 'code'; id: string; language: string; value: string }
  | { type: 'mermaid'; id: string; value: string }

export type CodeHighlightLine = {
  lineNumber: number
  tokens: Array<{ text: string; className?: string }>
}

export type CodeHighlightResult = {
  key: string
  language: string
  lines: CodeHighlightLine[]
}

export type StreamDraft = {
  messageId: string
  content: string
  meta?: Message['meta']
}

export type ToolTraceLike = ToolTrace
