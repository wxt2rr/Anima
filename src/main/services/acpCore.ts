import path from 'path'

export type AcpAgentKind = 'mock' | 'native_acp' | 'adapter' | 'acpx_bridge'

export type AcpAgentConfig = {
  id: string
  name?: string
  kind?: AcpAgentKind
  command?: string
  args?: string[]
  env?: Record<string, string>
  framing?: 'auto' | 'jsonl' | 'content_length'
}

export type AcpUiEvent =
  | { type: 'delta'; content: string; step?: number; runId?: string }
  | { type: 'reasoning_delta'; content: string; step?: number; runId?: string }
  | { type: 'trace'; trace: any; runId?: string }
  | { type: 'stage'; stage: string; step?: number; runId?: string }
  | { type: 'done'; usage?: any; reasoning?: string; traces?: any[]; artifacts?: any[]; rateLimit?: any; runId?: string }
  | { type: 'error'; error: string; runId?: string }

export type JsonRpcRequest = { jsonrpc: '2.0'; id: number | string; method: string; params?: any }
export type JsonRpcResponse = { jsonrpc: '2.0'; id: number | string; result?: any; error?: { code: number; message: string; data?: any } }
export type JsonRpcNotification = { jsonrpc: '2.0'; method: string; params?: any }
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

export type SessionKey = string

export function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function isObject(v: any): v is Record<string, any> {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v))
}

export function toLines(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split(/\r?\n/)
  if (parts.length <= 1) return { lines: [], rest: buf }
  const rest = parts.pop() ?? ''
  const lines = parts.map((s) => s.trim()).filter(Boolean)
  return { lines, rest }
}

export function normAbs(p: string): string {
  return path.resolve(String(p || '').trim())
}

export function isWithin(parentDir: string, childPath: string): boolean {
  const parent = normAbs(parentDir)
  const child = normAbs(childPath)
  if (parent === child) return true
  const rel = path.relative(parent, child)
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

export function resolvePathInWorkspace(workspaceDir: string, inputPath: string): string {
  const raw = String(inputPath || '').trim()
  if (!raw) return ''
  if (path.isAbsolute(raw)) return normAbs(raw)
  return normAbs(path.join(workspaceDir, raw))
}

export function buildKey(workspaceDir: string, threadId: string, agentId: string): SessionKey {
  return `${normAbs(workspaceDir)}:${String(threadId || '').trim()}:${String(agentId || '').trim()}`
}

function readTextContent(input: any): string {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) return input.map((item) => readTextContent(item)).filter(Boolean).join('')
  if (!isObject(input)) return ''
  if (typeof input.text === 'string') return input.text
  if (typeof input.content === 'string') return input.content
  if (Array.isArray(input.content)) return input.content.map((item) => readTextContent(item)).filter(Boolean).join('')
  return ''
}

export function mapAcpUpdateToUiEvent(update: any): AcpUiEvent | null {
  if (!isObject(update)) return null
  const t = String(update.type || '').trim()
  const runId = typeof update.runId === 'string' ? update.runId : undefined
  if (!t) return null

  if (t === 'agent_message_chunk' || t === 'assistant_message_chunk' || t === 'assistant_delta') {
    const content = readTextContent(update.content)
    return content ? { type: 'delta', content, step: update.step, runId } : null
  }
  if (t === 'agent_thought_chunk' || t === 'thinking_chunk' || t === 'reasoning_delta') {
    const content = readTextContent(update.content)
    return content ? { type: 'reasoning_delta', content, step: update.step, runId } : null
  }
  if (t === 'tool_call' || t === 'tool_call_update' || t === 'diff' || t === 'tool') {
    const raw = update.trace ?? update
    if (!isObject(raw)) return null
    const id = String(raw.id || raw.traceId || raw.toolCallId || raw.callId || '').trim() || randomId('tr')
    const name = String(raw.name || raw.toolName || raw.tool || raw.method || t).trim() || 'tool'
    const statusRaw = String(raw.status || raw.state || '').trim().toLowerCase()
    const status =
      statusRaw === 'succeeded' ||
      statusRaw === 'success' ||
      statusRaw === 'done' ||
      statusRaw === 'completed' ||
      statusRaw === 'complete' ||
      statusRaw === 'finished'
        ? 'succeeded'
        : statusRaw === 'failed' ||
            statusRaw === 'error' ||
            statusRaw === 'cancelled' ||
            statusRaw === 'canceled' ||
            statusRaw === 'aborted'
          ? 'failed'
          : 'running'
    const startedAt = typeof raw.startedAt === 'number' ? raw.startedAt : typeof raw.startTime === 'number' ? raw.startTime : undefined
    const endedAt = typeof raw.endedAt === 'number' ? raw.endedAt : typeof raw.endTime === 'number' ? raw.endTime : undefined
    const durationMs =
      typeof raw.durationMs === 'number'
        ? raw.durationMs
        : startedAt != null && endedAt != null
          ? Math.max(0, Number(endedAt) - Number(startedAt))
          : undefined
    const args = raw.args ?? raw.arguments ?? raw.input ?? undefined
    const result = raw.result ?? raw.output ?? undefined
    const argsText = args == null ? '' : typeof args === 'string' ? args : JSON.stringify(args)
    const resultText = result == null ? '' : typeof result === 'string' ? result : JSON.stringify(result)
    const trace: any = {
      id,
      toolCallId: raw.toolCallId ? String(raw.toolCallId) : undefined,
      name,
      status,
      startedAt,
      endedAt,
      durationMs
    }
    if (argsText) trace.argsPreview = { text: argsText.slice(0, 2000), truncated: argsText.length > 2000 }
    if (resultText) trace.resultPreview = { text: resultText.slice(0, 2000), truncated: resultText.length > 2000 }
    if (isObject(raw.error)) trace.error = raw.error
    if (Array.isArray(raw.artifacts)) trace.artifacts = raw.artifacts
    if (Array.isArray(raw.diffs)) trace.diffs = raw.diffs
    return { type: 'trace', trace, runId }
  }
  if (t === 'stage') {
    const stage = String(update.stage || '')
    return stage ? { type: 'stage', stage, step: update.step, runId } : null
  }
  if (t === 'done' || t === 'run_done' || t === 'session_done') {
    return {
      type: 'done',
      usage: update.usage,
      reasoning: typeof update.reasoning === 'string' ? update.reasoning : undefined,
      traces: Array.isArray(update.traces) ? update.traces : undefined,
      artifacts: Array.isArray(update.artifacts) ? update.artifacts : undefined,
      rateLimit: isObject(update.rateLimit) ? update.rateLimit : undefined,
      runId
    }
  }
  if (t === 'error') {
    const err = String(update.error || update.message || 'Unknown error')
    return { type: 'error', error: err, runId }
  }
  return null
}
