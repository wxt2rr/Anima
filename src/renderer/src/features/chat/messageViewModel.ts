import type { Message, ToolTrace } from '@/store/useStore'
import type { ChatMessageViewModel, ChatProcessBodyEntry, TurnProcessStats } from './types'
import { dedupeToolTracesForDisplay } from './toolTraceUtils'

function isToolStageMarker(stage: unknown): boolean {
  const st = String(stage || '').trim()
  return st.startsWith('tool_start:') || st.startsWith('tool_done:') || st.startsWith('tool_end:')
}

export function isStageOnlyAssistantMessage(msg: Message): boolean {
  if (String(msg?.role || '') !== 'assistant') return false
  if (String(msg?.content || '').trim()) return false
  const meta = (msg?.meta && typeof msg.meta === 'object') ? msg.meta : {}
  if (!isToolStageMarker((meta as any).stage)) return false
  if (typeof (meta as any).reasoningText === 'string' && (meta as any).reasoningText.trim()) return false
  if ((meta as any).compressionState === 'running' || (meta as any).compressionState === 'done') return false
  if (Array.isArray((meta as any).artifacts) && (meta as any).artifacts.length > 0) return false
  if ((meta as any).memoryInjection && typeof (meta as any).memoryInjection === 'object') return false
  if ((meta as any).dangerousCommandApproval && typeof (meta as any).dangerousCommandApproval === 'object') return false
  return true
}

export function buildEffectiveTurnIdByMessageId(messages: Message[]): Record<string, string> {
  const map: Record<string, string> = {}
  let fallbackSeq = 0
  let currentTurnId = ''
  for (const m of messages) {
    const mid = String(m?.id || '').trim()
    if (!mid) continue
    const explicitTurnId = String((m as any)?.turnId || '').trim()
    if (explicitTurnId) {
      currentTurnId = explicitTurnId
      map[mid] = explicitTurnId
      continue
    }
    if (m?.role === 'user' || !currentTurnId) {
      fallbackSeq += 1
      currentTurnId = `legacy-turn:${fallbackSeq}`
    }
    map[mid] = currentTurnId
  }
  return map
}

export function buildTurnProcessStats(messages: Message[], turnIdByMessageId: Record<string, string>): Record<string, TurnProcessStats> {
  const map: Record<string, TurnProcessStats> = {}
  const skillSets: Record<string, Set<string>> = {}
  const skillCalls: Record<string, number> = {}
  const dangerousApprovalsByTurn: Record<string, Array<{ command: string; status: 'approved_once' | 'approved_thread' | 'rejected' }>> = {}
  const lastToolIndexByTurn: Record<string, number> = {}

  const parseSkillId = (trace: any): string => {
    const raw = String(trace?.argsPreview?.text || '').trim()
    if (!raw) return ''
    try {
      return String(JSON.parse(raw)?.id || '').trim()
    } catch {
      return ''
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const messageId = String(message?.id || '').trim()
    const turnId = messageId ? String(turnIdByMessageId[messageId] || '').trim() : ''
    if (!turnId) continue
    const current = map[turnId] || { memoryCount: 0, reasoningCount: 0, toolCount: 0, skillCount: 0, hasProcess: false, finalAssistantMessageId: '' }
    if (message?.role === 'assistant') {
      const command = String((message.meta as any)?.dangerousCommandApproval?.command || '').replace(/\s+/g, ' ').trim()
      const approvalStatus = String((message.meta as any)?.dangerousCommandApproval?.status || '').trim()
      if (command && (approvalStatus === 'approved_once' || approvalStatus === 'approved_thread' || approvalStatus === 'rejected')) {
        if (!Array.isArray(dangerousApprovalsByTurn[turnId])) dangerousApprovalsByTurn[turnId] = []
        dangerousApprovalsByTurn[turnId].push({ command, status: approvalStatus as any })
      }
      const memoryCount = Number((message.meta as any)?.memoryInjection?.count || 0)
      if (Number.isFinite(memoryCount) && memoryCount > 0) current.memoryCount = Math.max(current.memoryCount, memoryCount)
      const reasoning = String((message.meta as any)?.reasoningText || '').trim()
      if (reasoning) current.reasoningCount += 1
    } else if (message?.role === 'tool') {
      const traces = Array.isArray((message.meta as any)?.toolTraces) ? (message.meta as any).toolTraces : []
      current.toolCount += traces.length
      lastToolIndexByTurn[turnId] = Math.max(lastToolIndexByTurn[turnId] ?? -1, index)
      for (const trace of traces) {
        const rawName = String(trace?.name || '').trim()
        const name = rawName.replace(/^tool_start:/, '').replace(/^tool_done:/, '').replace(/^tool_end:/, '').trim()
        if (name !== 'load_skill') continue
        skillCalls[turnId] = (skillCalls[turnId] || 0) + 1
        const skillId = parseSkillId(trace)
        if (!skillId) continue
        if (!skillSets[turnId]) skillSets[turnId] = new Set<string>()
        skillSets[turnId].add(skillId)
      }
    }
    current.skillCount = skillSets[turnId]?.size || skillCalls[turnId] || 0
    current.hasProcess = current.memoryCount > 0 || current.reasoningCount > 0 || current.toolCount > 0 || current.skillCount > 0
    map[turnId] = current
  }

  const finalAssistantIndexByTurn: Record<string, { index: number; messageId: string }> = {}
  messages.forEach((message, index) => {
    if (message?.role !== 'assistant') return
    const messageId = String(message?.id || '').trim()
    const turnId = messageId ? String(turnIdByMessageId[messageId] || '').trim() : ''
    if (!turnId) return
    const lastToolIndex = lastToolIndexByTurn[turnId] ?? -1
    if (index <= lastToolIndex) return
    const prev = finalAssistantIndexByTurn[turnId]
    if (!prev || index > prev.index) finalAssistantIndexByTurn[turnId] = { index, messageId }
  })
  Object.entries(map).forEach(([turnId, stats]) => {
    stats.finalAssistantMessageId = finalAssistantIndexByTurn[turnId]?.messageId || ''
    stats.dangerousApprovals = dangerousApprovalsByTurn[turnId] || []
  })

  return map
}

export function buildChatMessageViewModels(
  messages: Message[],
  opts: { collapseHistoricalProcess: boolean; openTurnIds?: Set<string> }
): ChatMessageViewModel[] {
  const turnIdByMessageId = buildEffectiveTurnIdByMessageId(messages)
  const statsByTurn = buildTurnProcessStats(messages, turnIdByMessageId)
  const latestTurnId = [...messages].reverse().map((message) => turnIdByMessageId[String(message?.id || '')]).find(Boolean) || ''
  const firstAssistantByTurn: Record<string, string> = {}
  for (const message of messages) {
    const messageId = String(message?.id || '').trim()
    const turnId = messageId ? String(turnIdByMessageId[messageId] || '').trim() : ''
    if (!turnId || message?.role !== 'assistant') continue
    if (!firstAssistantByTurn[turnId]) firstAssistantByTurn[turnId] = messageId
  }

  const openTurnIds = opts.openTurnIds || new Set<string>()
  const getToolTraces = (message: Message): ToolTrace[] => (
    Array.isArray((message.meta as any)?.toolTraces) ? ((message.meta as any).toolTraces as ToolTrace[]) : []
  )
  const collectToolGroup = (startIndex: number): { messageIds: string[]; traces: ToolTrace[]; endIndex: number } => {
    const messageIds: string[] = []
    const traces: ToolTrace[] = []
    let endIndex = startIndex
    for (let cursor = startIndex; cursor < messages.length; cursor += 1) {
      const current = messages[cursor]
      if (!current) continue
      if (isStageOnlyAssistantMessage(current)) continue
      if (current.role !== 'tool') break
      messageIds.push(String(current.id || cursor).trim())
      traces.push(...getToolTraces(current))
      endIndex = cursor
    }
    return { messageIds, traces: dedupeToolTracesForDisplay(traces), endIndex }
  }
  const collectHistoricalProcessBody = (turnId: string, startIndex: number, finalAssistantMessageId: string): { entries: ChatProcessBodyEntry[]; nextIndex: number } => {
    const entries: ChatProcessBodyEntry[] = []
    let cursor = startIndex
    while (cursor < messages.length) {
      const current = messages[cursor]
      if (!current) {
        cursor += 1
        continue
      }
      const currentId = String(current.id || cursor).trim()
      const currentTurnId = String(turnIdByMessageId[currentId] || '').trim()
      if (currentTurnId !== turnId) break
      if (isStageOnlyAssistantMessage(current)) {
        cursor += 1
        continue
      }
      if (current.role === 'assistant') {
        if (currentId === finalAssistantMessageId) break
        entries.push({ id: currentId, role: 'assistant', message: current })
        cursor += 1
        continue
      }
      if (current.role === 'tool') {
        const group = collectToolGroup(cursor)
        if (group.traces.length) {
          entries.push({
            id: `${turnId}:process-tool:${cursor}`,
            role: 'tool',
            toolGroup: { messageIds: group.messageIds, traces: group.traces }
          })
        }
        cursor = group.endIndex + 1
        continue
      }
      cursor += 1
    }
    return { entries, nextIndex: cursor }
  }

  const rows: ChatMessageViewModel[] = []
  let prevVisibleRole = ''
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const id = String(message?.id || index).trim()
    const turnId = String(turnIdByMessageId[id] || '').trim()
    const stats = turnId ? statsByTurn[turnId] : undefined
    const isLatestTurn = Boolean(turnId && turnId === latestTurnId)
    const isFirstAssistantOfTurn = message.role === 'assistant' && Boolean(turnId) && id === firstAssistantByTurn[turnId]
    const isFinalAssistantOfTurn = message.role === 'assistant' && Boolean(stats?.finalAssistantMessageId) && id === stats?.finalAssistantMessageId
    const isHistoricalTurn = Boolean(opts.collapseHistoricalProcess && turnId && turnId !== latestTurnId)
    const isTurnExpanded = Boolean(turnId && openTurnIds.has(turnId))
    const isCollapsibleProcessRow = (message.role === 'assistant' && !isFinalAssistantOfTurn) || message.role === 'tool'
    const shouldHideProcess = Boolean(isHistoricalTurn && !isTurnExpanded && isCollapsibleProcessRow)
    const shouldShowTurnProcessSummary = Boolean(opts.collapseHistoricalProcess && stats?.hasProcess && isFirstAssistantOfTurn && !isLatestTurn)
    const isToolGroupHead = message.role === 'tool' && prevVisibleRole !== 'tool'
    const toolGroup = (message.role === 'tool' && isToolGroupHead) ? collectToolGroup(index) : undefined
    const isStageOnlyAssistant = isStageOnlyAssistantMessage(message)
    if (!isStageOnlyAssistant) prevVisibleRole = String(message.role || '')

    if (isHistoricalTurn && shouldShowTurnProcessSummary) {
      rows.push({
        id,
        role: message.role as ChatMessageViewModel['role'],
        source: message,
        index,
        turnId,
        isLatestTurn,
        isFirstAssistantOfTurn,
        isFinalAssistantOfTurn,
        shouldShowTurnProcessSummary: true,
        shouldHideProcess: true,
        isToolGroupHead: false,
        toolGroup: undefined,
        processBodyEntries: undefined,
        isStageOnlyAssistant,
        isTurnExpanded,
        processStats: stats
      })
      const processBody = collectHistoricalProcessBody(turnId, index, stats?.finalAssistantMessageId || '')
      rows.push({
        id: `${turnId}:process-body`,
        role: 'process',
        source: message,
        index,
        turnId,
        isLatestTurn,
        isFirstAssistantOfTurn: false,
        isFinalAssistantOfTurn: false,
        shouldShowTurnProcessSummary: false,
        shouldHideProcess: false,
        isToolGroupHead: false,
        toolGroup: undefined,
        processBodyEntries: processBody.entries,
        isStageOnlyAssistant: false,
        isTurnExpanded,
        processStats: stats
      })
      index = Math.max(index, processBody.nextIndex - 1)
      continue
    }

    rows.push({
      id,
      role: message.role as ChatMessageViewModel['role'],
      source: message,
      index,
      turnId,
      isLatestTurn,
      isFirstAssistantOfTurn,
      isFinalAssistantOfTurn,
      shouldShowTurnProcessSummary,
      shouldHideProcess,
      isToolGroupHead,
      toolGroup: toolGroup ? { messageIds: toolGroup.messageIds, traces: toolGroup.traces } : undefined,
      processBodyEntries: undefined,
      isStageOnlyAssistant,
      isTurnExpanded,
      processStats: stats
    })
  }
  return rows
}
