import { memo, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ToolTrace } from '@/store/useStore'
import { useStore } from '@/store/useStore'
import { resolveAppLang } from '@/i18n'
import { APP_RUNTIME_STRINGS, APP_SHADCN_DICTIONARIES } from '@/i18n/legacyDictionaries'
import { LazyDetails } from './LazyDetails'
import { ArtifactStrip } from './ArtifactStrip'
import { ToolDiffList } from './ToolDiffList'
import { MarkdownContent } from './MarkdownContent'
import { isFileLikeTarget } from './chatLinks'
import {
  CHAT_AUX_TEXT_CLASS,
  CHAT_DISCLOSURE_BUTTON_CLASS,
  CHAT_FONT_FAMILY,
  CHAT_META_TEXT_CLASS
} from './chatPresentation'
import {
  formatToolTraceSummary,
  getToolTraceCategory,
  normalizeToolTraceName,
  resolveToolTraceActionKind,
  summarizeDiffLineChanges,
  summarizeToolTraceCategories
} from './toolTraceUtils'

function summarizeTraceStatus(trace: ToolTrace, runtimeText: any): string {
  const action = resolveToolTraceActionKind(trace)
  const statusText = runtimeText?.trace?.statusText?.[action]
  if (trace.status === 'running') return String(statusText?.running || runtimeText?.trace?.running || '运行中')
  if (trace.status === 'failed') return String(statusText?.failed || runtimeText?.trace?.failed || '失败')
  return String(statusText?.done || runtimeText?.trace?.succeeded || '成功')
}

function replaceVars(template: string, vars: Record<string, string | number>): string {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => String(vars[key] ?? ''))
}

function stripCodeFences(raw: string): string {
  const trimmed = String(raw || '').trim()
  const m = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/)
  return (m && m[1] ? m[1] : trimmed).trim()
}

function sanitizePotentialJson(raw: string): string {
  return stripCodeFences(raw).replace(/\\`/g, '`').replace(/`/g, '').trim()
}

function extractJsonSubstring(raw: string): string | null {
  const text = String(raw || '')
  let start = -1
  const stack: Array<'{' | '['> = []
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (start === -1) {
      if (ch === '{' || ch === '[') {
        start = i
        stack.push(ch)
      }
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }
    if (ch === '}' || ch === ']') {
      const last = stack[stack.length - 1]
      const ok = (ch === '}' && last === '{') || (ch === ']' && last === '[')
      if (!ok) continue
      stack.pop()
      if (stack.length === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseMaybeJson(text: string): any {
  if (!text) return null
  const tryParse = (raw: string) => {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  const cleaned = sanitizePotentialJson(text)
  const first = tryParse(cleaned)
  if (first != null) {
    if (typeof first === 'string') {
      const nested = tryParse(sanitizePotentialJson(first))
      return nested != null ? nested : first
    }
    return first
  }
  const extracted = extractJsonSubstring(cleaned)
  if (!extracted) return null
  const recovered = tryParse(extracted)
  if (recovered == null) return null
  if (typeof recovered === 'string') {
    const nested = tryParse(sanitizePotentialJson(recovered))
    return nested != null ? nested : recovered
  }
  return recovered
}

function normalizeValue(val: unknown): string {
  return String(val ?? '').replace(/\\`/g, '`').replace(/`/g, '').trim()
}

function plainTextFromUnknown(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return sanitizePotentialJson(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function toCircledIndex(index: number): string {
  const circled = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']
  return circled[index] || `${index + 1}.`
}

function getToolResultText(traceNameRaw: string, resultObj: any, resultItems: any[] | null, rawResultText: string, runtimeText: any): string {
  if (traceNameRaw === 'WebSearch' && Array.isArray(resultItems)) {
    return resultItems
      .map((r: any, idx: number) => {
        const title = String(r?.title || r?.url || runtimeText?.trace?.linkFallback || 'Link').trim()
        const url = String(r?.url || '').trim()
        const snippet = String(r?.snippet || '').trim()
        const marker = toCircledIndex(idx)
        if (url && snippet) return `${marker} [${title}](${url}) — ${snippet}`
        if (url) return `${marker} [${title}](${url})`
        if (snippet) return `${marker} ${title} — ${snippet}`
        return `${marker} ${title}`
      })
      .filter(Boolean)
      .join('\n\n')
  }
  if (traceNameRaw === 'WebFetch' && resultObj) {
    const lines: string[] = []
    const url = String(resultObj.finalUrl || resultObj.url || '').trim()
    if (url) lines.push(url)
    const statusParts: string[] = []
    if (resultObj.status) statusParts.push(`HTTP ${resultObj.status}`)
    if (resultObj.contentType) statusParts.push(String(resultObj.contentType))
    if (resultObj.truncated) statusParts.push(String(runtimeText?.trace?.truncated || 'Truncated'))
    if (statusParts.length) lines.push(statusParts.join(' · '))
    const preview = plainTextFromUnknown(resultObj?.preview || resultObj?.text || resultObj?.content)
    if (preview) lines.push(preview)
    return lines.join('\n')
  }
  if (Array.isArray(resultObj?.entries)) {
    return resultObj.entries
      .map((entry: any) => {
        const name = String(entry?.name || '').trim()
        if (!name) return ''
        return entry?.type === 'dir' ? `${name}/` : name
      })
      .filter(Boolean)
      .join('\n')
  }
  if (Array.isArray(resultObj?.matches)) {
    return resultObj.matches
      .map((m: any) => {
        const path = String(m?.path || '').trim()
        const line = Number.isFinite(Number(m?.line)) ? Number(m?.line) : null
        const text = String(m?.text || '').trim()
        if (!path && !text) return ''
        if (path && line != null) return `${path}:${line} ${text}`
        if (path) return `${path} ${text}`.trim()
        return text
      })
      .filter(Boolean)
      .join('\n')
  }
  if (resultObj && typeof resultObj === 'object') {
    const previewText = plainTextFromUnknown(resultObj?._preview?.text)
    if (previewText) return previewText
    if (typeof resultObj?._preview?.total === 'number') return `${resultObj._preview.total}`
    const text = plainTextFromUnknown(resultObj?.text || resultObj?.content || resultObj?.message || resultObj?.error)
    if (text) return text
  }
  if (typeof resultObj === 'string') return sanitizePotentialJson(resultObj)
  return sanitizePotentialJson(rawResultText)
}

function findEntity(trace: ToolTrace): string {
  const candidates = [
    String(trace.argsPreview?.text || '').trim(),
    String(trace.resultPreview?.text || '').trim(),
    Array.isArray(trace.diffs) && trace.diffs[0]?.path ? String(trace.diffs[0].path) : ''
  ].filter(Boolean)
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text)
      const values = [parsed?.path, parsed?.file, parsed?.target, parsed?.cwd].map((value) => String(value || '').trim()).filter(Boolean)
      const match = values.find((value) => isFileLikeTarget(value))
      if (match) return match
    } catch {
      if (isFileLikeTarget(text)) return text
      const regexMatch = text.match(/(?:file:\/\/|\.?\.?\/|~\/|\/)[^\s"']+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf)/)
      if (regexMatch?.[0]) return regexMatch[0]
    }
  }
  return ''
}

export const ToolTraceGroup = memo(function ToolTraceGroup({
  groupId,
  traces,
  open,
  enableMarkdown,
  onOpenLinkTarget,
  backendBaseUrl,
  workspaceDir,
  onToggleOpen,
  dangerousApprovals
}: {
  groupId: string
  traces: ToolTrace[]
  open: boolean
  enableMarkdown: boolean
  onOpenLinkTarget?: (target: string) => void
  backendBaseUrl?: string
  workspaceDir?: string
  onToggleOpen?: () => void
  dangerousApprovals?: Array<{ command: string; status: 'approved_once' | 'approved_thread' | 'rejected' }>
}): JSX.Element | null {
  const lang = resolveAppLang(useStore((s) => s.settings?.language))
  const runtimeText = APP_RUNTIME_STRINGS[lang] || APP_RUNTIME_STRINGS.en
  const [detailOpenById, setDetailOpenById] = useState<Record<string, boolean>>({})
  const summaryCounts = useMemo(() => summarizeToolTraceCategories(traces), [traces])
  const summaryText = useMemo(() => {
    const summary = formatToolTraceSummary(summaryCounts)
    return summary || `Ran ${traces.length}`
  }, [summaryCounts, traces.length])
  const summarySegments = useMemo(() => {
    const parts: Array<{ label: string; count: number }> = []
    if (summaryCounts.explored > 0) parts.push({ label: 'Explored', count: summaryCounts.explored })
    if (summaryCounts.edited > 0) parts.push({ label: 'Edited', count: summaryCounts.edited })
    if (summaryCounts.ran > 0) parts.push({ label: 'Ran', count: summaryCounts.ran })
    if (summaryCounts.context > 0) parts.push({ label: 'Context', count: summaryCounts.context })
    if (!parts.length) parts.push({ label: 'Ran', count: traces.length })
    return parts
  }, [summaryCounts, traces.length])
  const traceViews = useMemo(() => {
    const langCode = lang === 'zh' ? 'zh' : lang === 'ja' ? 'ja' : 'en'
    const normalizeCommand = (raw: unknown) => String(raw || '').replace(/\s+/g, ' ').trim()
    return traces.map((trace) => {
      const traceNameRaw = normalizeToolTraceName(trace.name) || 'tool'
      const traceName = String((runtimeText as any)?.builtinTools?.[traceNameRaw as keyof typeof runtimeText.builtinTools] || traceNameRaw)
      const isEditTrace = getToolTraceCategory(trace) === 'edited'
      const argsObjRaw = parseMaybeJson(trace.argsPreview?.text || '')
      const argsObj = argsObjRaw && typeof argsObjRaw === 'object' ? argsObjRaw : {}
      const resultObj: any = parseMaybeJson(trace.resultPreview?.text || '')
      const resultItems = Array.isArray(resultObj)
        ? resultObj
        : Array.isArray(resultObj?.results)
          ? resultObj.results
          : Array.isArray(resultObj?.items)
            ? resultObj.items
            : null
      let entity = traceNameRaw
      let resultSummary = ''
      if (traceNameRaw === 'bash') {
        entity = normalizeValue((argsObj as any).command)
      } else if (traceNameRaw === 'rg_search' || traceNameRaw === 'glob_files') {
        entity = normalizeValue((argsObj as any).pattern)
        if ((argsObj as any).path) entity += ` in ${normalizeValue((argsObj as any).path)}`
      } else if (traceNameRaw === 'list_dir') {
        entity = normalizeValue((argsObj as any).path)
      } else if (traceNameRaw === 'read_file' || traceNameRaw === 'apply_patch') {
        entity = normalizeValue((argsObj as any).path)
      } else if (traceNameRaw === 'WebSearch') {
        entity = normalizeValue((argsObj as any).query)
        const count = Array.isArray(resultItems) ? resultItems.length : Number((resultObj as any)?._preview?.total)
        if (Number.isFinite(count) && count > 0) {
          resultSummary = replaceVars(String(runtimeText?.trace?.searchResultSummary || ''), { count })
        }
      } else if (traceNameRaw === 'WebFetch') {
        entity = normalizeValue((argsObj as any).url)
      } else if (traceNameRaw === 'load_skill') {
        entity = normalizeValue((argsObj as any).id) || String(runtimeText?.loadSkillDone || 'Loaded skill')
      } else {
        entity = normalizeValue(entity)
      }
      const canOpenEntityInFiles = (traceNameRaw === 'read_file' || traceNameRaw === 'apply_patch') && Boolean(entity)
      const bashCommandNormalized = traceNameRaw === 'bash' ? normalizeCommand((argsObj as any).command) : ''
      const matchedApproval = traceNameRaw === 'bash'
        ? (dangerousApprovals || []).find((item) => normalizeCommand(item.command) === bashCommandNormalized)
        : undefined
      const rejectedByUserHint =
        String((trace as any)?.resultPreview?.text || '').toLowerCase().includes('user rejected dangerous command approval') ||
        String((trace as any)?.error?.message || '').toLowerCase().includes('user rejected dangerous command approval')
      const isRejectedByUser = traceNameRaw === 'bash' && (rejectedByUserHint || matchedApproval?.status === 'rejected')
      const notExecutedText = String(runtimeText?.notExecuted || (langCode === 'zh' ? '未执行' : langCode === 'ja' ? '未実行' : 'Not executed'))
      const runningStatusText = isRejectedByUser ? notExecutedText : summarizeTraceStatus(trace, runtimeText)
      const displayEntity = (() => {
        const text = String(entity || '').trim()
        if (traceNameRaw !== 'bash') return text
        const max = 80
        return text.length <= max ? text : `${text.slice(0, max - 3)}...`
      })()
      const durationText = typeof trace.durationMs === 'number' ? `${trace.durationMs}ms` : ''
      const headlineMain = [displayEntity, resultSummary].filter(Boolean).join('   ').trim()
      const headlineText = [runningStatusText, headlineMain, durationText].filter(Boolean).join(' ').trim()
      const detailText = getToolResultText(traceNameRaw, resultObj, resultItems, trace.resultPreview?.text || '', runtimeText)
      return {
        id: String(trace.id || ''),
        traceName,
        isEditTrace,
        headlineText,
        displayEntity,
        canOpenEntityInFiles,
        resultSummary,
        runningStatusText,
        durationText,
        detailText,
        approvalStatus: matchedApproval?.status || ''
      }
    })
  }, [traces, runtimeText, lang, dangerousApprovals])

  if (!traces.length) return null

  const toolTokenClass = 'inline-flex min-w-0 max-w-full items-center rounded-full border border-transparent bg-black/[0.02] px-2 py-0.5 text-[12px] leading-[18px] text-muted-foreground/[0.505]'
  const durationTokenClass = 'inline-flex shrink-0 items-center rounded-full border border-transparent bg-black/[0.02] px-2 py-0.5 text-[11px] leading-[16px] tabular-nums text-muted-foreground/[0.505]'

  return (
    <div className="py-1" style={{ fontFamily: CHAT_FONT_FAMILY }}>
      <button
        type="button"
        className={CHAT_DISCLOSURE_BUTTON_CLASS}
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <span className="shrink-0 text-[12px] leading-[20px] font-normal text-foreground/68 transition-colors group-hover:text-foreground/78">
          {summarySegments.map((segment, index) => (
            <span key={`${segment.label}:${segment.count}`}>
              {index > 0 ? <span className="text-muted-foreground/34"> · </span> : null}
              <span className="text-muted-foreground/[0.505] group-hover:text-muted-foreground">{segment.label}</span>{' '}
              <span className="text-muted-foreground/[0.505] group-hover:text-muted-foreground">{segment.count}</span>
            </span>
          ))}
        </span>
        <span className="h-4 w-4 shrink-0 text-muted-foreground/70 flex items-center justify-center">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`} />
        </span>
      </button>
      <LazyDetails open={open}>
        <div className="mt-1.5 space-y-1.5">
          {traces.map((trace, index) => {
            const traceId = String(trace.id || `${groupId}:${index}`)
            const traceView = traceViews[index]
            const detailOpen = Boolean(detailOpenById[traceId])
            const entity = findEntity(trace)
            const artifacts = Array.isArray(trace.artifacts) ? trace.artifacts : []
            const diffs = Array.isArray(trace.diffs) ? trace.diffs : []
            const isEditTrace = Boolean(traceView?.isEditTrace)
            const hasDetail = isEditTrace
              ? Boolean(diffs.length || trace.error?.message)
              : Boolean(traceView?.detailText || trace.resultPreview?.text || artifacts.length || diffs.length || trace.error?.message)
            const diffSummary = diffs.length > 0 ? summarizeDiffLineChanges(diffs) : null
            const firstDiffPath = String(diffs[0]?.path || '').trim()
            const editFileTarget = String(firstDiffPath || traceView?.displayEntity || entity || '').trim()
            const editFileLabel = String((runtimeText as any)?.editedFiles || (lang === 'zh' ? '已编辑的文件' : lang === 'ja' ? '編集済みファイル' : 'Edited file'))
            const approvalBadge = traceView?.approvalStatus === 'approved_once' ? (
              <span className="shrink-0 inline-flex items-center whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] leading-none font-medium text-emerald-700">
                {String((APP_SHADCN_DICTIONARIES[0] as any)?.[lang]?.dangerousApprovalStatusApprovedOnce || '已允许')}
              </span>
            ) : traceView?.approvalStatus === 'approved_thread' ? (
              <span className="shrink-0 inline-flex items-center whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] leading-none font-medium text-emerald-700">
                {String((APP_SHADCN_DICTIONARIES[0] as any)?.[lang]?.dangerousApprovalStatusApprovedThread || '本次对话已允许')}
              </span>
            ) : traceView?.approvalStatus === 'rejected' ? (
              <span className="shrink-0 inline-flex items-center whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] leading-none font-medium text-red-700">
                {String((APP_SHADCN_DICTIONARIES[0] as any)?.[lang]?.dangerousApprovalStatusRejected || '已拒绝')}
              </span>
            ) : null
            return (
              <div key={traceId} className="py-0.5">
                <button
                  type="button"
                  className="group flex w-full items-start gap-2 text-left"
                  onClick={() => {
                    if (!hasDetail) return
                    setDetailOpenById((state) => ({ ...state, [traceId]: !state[traceId] }))
                  }}
                >
                  {!isEditTrace ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      <span className={`shrink-0 text-[12px] leading-[20px] font-medium transition-colors group-hover:text-muted-foreground ${trace.status === 'running' ? 'anima-flow-text text-muted-foreground/[0.505]' : 'text-muted-foreground/[0.505]'}`}>
                        {traceView?.runningStatusText || summarizeTraceStatus(trace, runtimeText)}
                      </span>
                      {approvalBadge}
                      {traceView?.displayEntity ? (
                        <span
                          className={`${toolTokenClass} min-w-0 max-w-[min(46%,24rem)] truncate group-hover:bg-black/[0.03] group-hover:text-muted-foreground`}
                          title={traceView.displayEntity}
                        >
                          {traceView.displayEntity}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      <span className={`shrink-0 text-[12px] leading-[20px] font-medium text-muted-foreground/[0.505] ${trace.status === 'running' ? 'anima-flow-text' : ''}`}>
                        {editFileLabel}
                      </span>
                      {approvalBadge}
                      {editFileTarget ? (
                        <button
                          type="button"
                          className="inline-block min-w-0 max-w-[min(44%,26rem)] truncate text-[12px] font-mono text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpenLinkTarget?.(editFileTarget)
                          }}
                          title={editFileTarget}
                        >
                          {editFileTarget}
                        </button>
                      ) : null}
                      {diffSummary ? (
                        <>
                          <span className="shrink-0 text-[11px] leading-[16px] text-emerald-600 dark:text-emerald-400">{`+${diffSummary.added}`}</span>
                          <span className="shrink-0 text-[11px] leading-[16px] text-red-600 dark:text-red-400">{`-${diffSummary.removed}`}</span>
                        </>
                      ) : null}
                    </div>
                  )}
                  {!isEditTrace && traceView?.resultSummary ? (
                    <span
                      className={`${toolTokenClass} shrink-0 max-w-[8.5rem] truncate group-hover:bg-black/[0.03] group-hover:text-muted-foreground`}
                      title={traceView.resultSummary}
                    >
                      {traceView.resultSummary}
                    </span>
                  ) : null}
                  {!isEditTrace && traceView?.durationText ? (
                    <span className={`${durationTokenClass} group-hover:bg-black/[0.03] group-hover:text-muted-foreground`}>
                      {traceView.durationText}
                    </span>
                  ) : null}
                  {isEditTrace ? (
                    <span className={durationTokenClass}>
                      {typeof trace.durationMs === 'number' ? `${trace.durationMs}ms` : ''}
                    </span>
                  ) : null}
                </button>
                <LazyDetails open={detailOpen && hasDetail}>
                  <div className="mt-1.5 space-y-1.5">
                    {!isEditTrace && traceView?.detailText ? (
                      <div className="space-y-1">
                        {enableMarkdown ? (
                          <MarkdownContent
                            messageId={`${traceId}:result-detail`}
                            content={traceView.detailText}
                            compact
                            onOpenLinkTarget={onOpenLinkTarget}
                            backendBaseUrl={backendBaseUrl}
                            workspaceDir={workspaceDir}
                          />
                        ) : (
                          <div className={`${CHAT_AUX_TEXT_CLASS} whitespace-pre-wrap break-words`}>{traceView.detailText}</div>
                        )}
                      </div>
                    ) : null}
                    {!isEditTrace && artifacts.length > 0 ? (
                      <div className="space-y-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">产物</div>
                        <ArtifactStrip
                          items={artifacts}
                          size="sm"
                          backendBaseUrl={backendBaseUrl}
                          workspaceDir={workspaceDir}
                          onOpenLinkTarget={onOpenLinkTarget}
                        />
                      </div>
                    ) : null}
                    {diffs.length > 0 ? <ToolDiffList diffs={diffs} /> : null}
                    {trace.status === 'failed' && trace.error?.message ? (
                      <div className="space-y-1">
                        <div className="text-[10px] font-medium text-red-500 uppercase tracking-wider">{lang === 'zh' ? '错误' : lang === 'ja' ? 'エラー' : 'Error'}</div>
                        <div className="text-[10px] text-red-600 dark:text-red-400 whitespace-pre-wrap break-words bg-red-500/10 rounded p-2">
                          {trace.error.message}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </LazyDetails>
              </div>
            )
          })}
        </div>
      </LazyDetails>
    </div>
  )
})
