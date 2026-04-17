import { Fragment, useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type DragEvent, type ClipboardEvent } from 'react'
import { ArrowUp, Square, Paperclip, PanelLeftOpen, MessageCircle, Wrench, Sparkles, X, ChevronDown, Mic, Folder, Brain, Shield, Check, GitBranch, Copy, Settings, TerminalSquare, Globe } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { CodeBlock } from './components/markdown/CodeBlock'
import { MermaidBlock } from './components/markdown/MermaidBlock'
import 'katex/dist/katex.min.css'
import { DiffView } from './components/DiffView'
import { createTwoFilesPatch } from 'diff'
import { resolveBackendBaseUrl, useStore, type Message, type ToolTrace, type ProviderModel, type Artifact, type MemoryInjectionSummary } from './store/useStore'
import { THEMES } from './lib/themes'
import { SettingsDialog, SettingsWindow } from './components/SettingsDialog'
import { ChatHistoryPanel } from './components/ChatHistoryPanel'
import { InputAnimation } from './components/InputAnimation'
import { UpdateDialog } from './components/UpdateDialog'
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RightSidebar } from './components/sidebar/RightSidebar'
import { useUpdateStore } from './store/useUpdateStore'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { SHORTCUTS, isMacLike, matchShortcut, normalizeBinding, type ShortcutId } from '@/lib/shortcuts'
import { useLeftPaneLayout } from './hooks/useLeftPaneLayout'
import { i18nText, resolveAppLang } from './i18n'
import { APP_RUNTIME_STRINGS } from './i18n/legacyDictionaries'
import { APP_SHADCN_DICTIONARIES } from './i18n/legacyDictionaries'
import {
  filterSlashCommands,
  parseProjectSlashCommandFile,
  parseSlashInput,
  renderSlashCommandTemplate,
  type SlashCommandEntry
} from './lib/slashCommands'
import animaLogo from '../../../images/logo.png'
import loadingGif from '../../../images/loding.gif'

type BackendUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

type BackendRateLimit = {
  remainingTokens?: number
  limitTokens?: number
  resetMs?: number
}

type SkillEntry = {
  id: string
  name?: string
  description?: string
  dir?: string
  file?: string
  content?: string
  meta?: any
  isValid?: boolean
  errors?: string[]
  updatedAt?: number
}

type BundledSlashCommandEntry = {
  id?: string
  name?: string
  title?: string
  description?: string
  template?: string
  file?: string
}

type DangerousCommandApprovalPayload = {
  code: string
  command: string
  matchedPattern?: string
  runId?: string
  approvalId?: string
}

type TabCompleteResult = {
  mode: 'complete' | 'translate' | 'spell_suggest'
  text: string
  candidates?: string[]
}

const DANGEROUS_COMMAND_APPROVAL_PREFIX = 'ANIMA_DANGEROUS_COMMAND_APPROVAL:'

function parseDangerousCommandApproval(input: unknown): DangerousCommandApprovalPayload | null {
  const text = String(input || '').trim()
  if (!text.startsWith(DANGEROUS_COMMAND_APPROVAL_PREFIX)) return null
  const payloadText = text.slice(DANGEROUS_COMMAND_APPROVAL_PREFIX.length).trim()
  if (!payloadText) return null
  try {
    const obj = JSON.parse(payloadText)
    if (!obj || typeof obj !== 'object') return null
    const command = String((obj as any).command || '').trim()
    if (!command) return null
    return {
      code: String((obj as any).code || '').trim() || 'dangerous_command_requires_approval',
      command,
      matchedPattern: String((obj as any).matchedPattern || '').trim() || undefined
    }
  } catch {
    return null
  }
}

function parseMemoryInjection(input: unknown): MemoryInjectionSummary | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, any>
  const rawItems = Array.isArray(obj.items) ? obj.items : []
  const items = rawItems
    .map((x) => {
      if (!x || typeof x !== 'object') return null
      const content = String((x as any).content || '').trim()
      if (!content) return null
      const id = String((x as any).id || '').trim() || undefined
      const type = String((x as any).type || '').trim() || 'semantic'
      const scope = String((x as any).scope || '').trim() || undefined
      const similarity = Number((x as any).similarity)
      const score = Number((x as any).score)
      return {
        id,
        type,
        scope,
        content,
        similarity: Number.isFinite(similarity) ? similarity : undefined,
        score: Number.isFinite(score) ? score : undefined
      }
    })
    .filter(Boolean) as MemoryInjectionSummary['items']
  if (!items.length) return null
  const countRaw = Number(obj.count)
  const durationRaw = Number(obj.durationMs)
  const workspaceRaw = Number(obj.workspaceCount)
  const globalRaw = Number(obj.globalCount)
  return {
    count: Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : items.length,
    durationMs: Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.floor(durationRaw) : undefined,
    workspaceCount: Number.isFinite(workspaceRaw) && workspaceRaw >= 0 ? Math.floor(workspaceRaw) : undefined,
    globalCount: Number.isFinite(globalRaw) && globalRaw >= 0 ? Math.floor(globalRaw) : undefined,
    items
  }
}

function applyTabCompletionSuggestion(base: string, result: TabCompleteResult): string | null {
  const draft = String(base || '')
  const mode = result.mode
  const out = String(result.text || '').trim()
  if (!draft) return null
  if (!out) return null
  if (mode === 'complete') {
    if (!/^[A-Za-z][A-Za-z'-]{0,23}$/.test(out)) return null
    return `${draft}${out}`
  }
  if (mode !== 'translate') {
    return null
  }
  if (out === draft.trim()) return null
  return out
}

function isOllamaLikeProviderCandidate(provider: {
  id?: string
  name?: string
  config?: { baseUrl?: string }
} | null | undefined): boolean {
  const id = String(provider?.id || '').toLowerCase()
  const name = String(provider?.name || '').toLowerCase()
  const baseUrl = String(provider?.config?.baseUrl || '').toLowerCase()
  return (
    id.includes('ollama') ||
    name.includes('ollama') ||
    baseUrl.includes('127.0.0.1:11434') ||
    baseUrl.includes('localhost:11434')
  )
}

function CircularProgress({ value }: { value: number }) {
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference
  const label = value >= 99.5 ? '99+' : `${Math.round(Math.max(0, value))}%`

  return (
    <div className="relative w-5 h-5 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-muted-foreground/20"
        />
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-all duration-300 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[7px] leading-none text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

function MaskedIcon({ url, className }: { url: string; className?: string }) {
  const u = String(url || '').trim()
  if (!u) return null
  const style: any = {
    WebkitMaskImage: `url(${u})`,
    maskImage: `url(${u})`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    backgroundColor: 'currentColor'
  }
  return <span className={className} style={style} aria-hidden="true" />
}

function normalizeChatMarkdown(input: string): string {
  const s = String(input || '')
  const hasUnescapedFence = /(^|\n)[ \t]{0,3}```/.test(s)
  if (hasUnescapedFence) return s
  return s
    .replace(/(^|\n)([ \t]{0,3})\\```/g, '$1$2```')
    .replace(/``\s*`([^`\n]+)`\s*``/g, '`$1`')
}

function stripWrappedBackticks(input: string): string {
  let text = String(input || '').trim()
  while (text.length >= 2 && text.startsWith('`') && text.endsWith('`')) {
    text = text.slice(1, -1).trim()
  }
  return text
}

function linkifyQuotedFileNames(input: string): string {
  const s = String(input || '')
  if (!s) return s
  const parts = s.split(/(```[\s\S]*?```)/g)
  const fileExt = '(?:ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)'
  const quoted = new RegExp(`(['"“”‘’])([^\\n\\r]{1,260}\\.${fileExt})\\1`, 'gi')
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part
      return part.replace(quoted, (_m, _q, file) => `[\`${file}\`](${file})`)
    })
    .join('')
}

function toolTraceSignature(trace: any): string {
  const normalizeSigText = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim()
  const rawName = String(trace?.name || '')
    .trim()
    .replace(/^tool_start:/, '')
    .replace(/^tool_done:/, '')
    .replace(/^tool_end:/, '')
    .trim()
  const name = rawName === 'multi_tool_use.parallel' ? 'multi_tool_use_parallel' : rawName
  const argsText = String(trace?.argsPreview?.text || '').trim()
  if (name === 'bash') {
    try {
      const parsed = JSON.parse(argsText)
      const cmd = normalizeSigText((parsed as any)?.command)
      return `${name}:${cmd || normalizeSigText(argsText)}`
    } catch {
      return `${name}:${normalizeSigText(argsText)}`
    }
  }
  return `${name}:${normalizeSigText(argsText)}`
}

type ToolTraceCategory = 'explored' | 'edited' | 'ran' | 'context'

function normalizeToolTraceName(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^tool_start:/, '')
    .replace(/^tool_done:/, '')
    .replace(/^tool_end:/, '')
    .trim()
}

function getToolTraceCategory(trace: any): ToolTraceCategory {
  const name = normalizeToolTraceName(trace?.name).toLowerCase()
  if (!name) return 'ran'
  if (name === 'load_skill') return 'context'
  if (
    name === 'read_file' ||
    name === 'list_dir' ||
    name === 'glob_files' ||
    name === 'rg_search' ||
    name === 'websearch' ||
    name === 'webfetch'
  ) {
    return 'explored'
  }
  if (
    name === 'apply_patch' ||
    name === 'write_file' ||
    name === 'create_file' ||
    name === 'delete_file' ||
    name === 'move_file' ||
    name === 'rename_file' ||
    name === 'insert_edit_into_file'
  ) {
    return 'edited'
  }
  return 'ran'
}

function summarizeToolTraceCategories(traces: any[]): Record<ToolTraceCategory, number> {
  const summary: Record<ToolTraceCategory, number> = { explored: 0, edited: 0, ran: 0, context: 0 }
  for (const tr of traces) {
    summary[getToolTraceCategory(tr)] += 1
  }
  return summary
}

function formatToolTraceSummary(summary: Record<ToolTraceCategory, number>): string {
  const parts: string[] = []
  if (summary.explored > 0) parts.push(`Explored ${summary.explored}`)
  if (summary.edited > 0) parts.push(`Edited ${summary.edited}`)
  if (summary.ran > 0) parts.push(`Ran ${summary.ran}`)
  if (summary.context > 0) parts.push(`Context ${summary.context}`)
  return parts.join(' · ')
}

function isToolStageMarker(stage: unknown): boolean {
  const st = String(stage || '').trim()
  return st.startsWith('tool_start:') || st.startsWith('tool_done:') || st.startsWith('tool_end:')
}

function isStageOnlyAssistantMessage(msg: any): boolean {
  if (String(msg?.role || '') !== 'assistant') return false
  if (String(msg?.content || '').trim()) return false
  const meta = (msg?.meta && typeof msg.meta === 'object') ? msg.meta : {}
  if (!isToolStageMarker(meta.stage)) return false
  if (typeof meta.reasoningText === 'string' && meta.reasoningText.trim()) return false
  if (meta.compressionState === 'running' || meta.compressionState === 'done') return false
  if (Array.isArray(meta.artifacts) && meta.artifacts.length > 0) return false
  if (meta.memoryInjection && typeof meta.memoryInjection === 'object') return false
  if (meta.dangerousCommandApproval && typeof meta.dangerousCommandApproval === 'object') return false
  return true
}

async function fetchBackendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15000)
  try {
    const baseUrl = await resolveBackendBaseUrl()
    const res = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal })
    const text = await res.text()
    const data = text ? (JSON.parse(text) as T) : (null as T)
    if (!res.ok) {
      const msg = (data as any)?.error || `HTTP ${res.status}`
      throw new Error(String(msg))
    }
    return data
  } finally {
    window.clearTimeout(timer)
  }
}

function toTtsSpeakText(input: string): string {
  const s = String(input || '')
  if (!s) return ''
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/[#>*_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function App(): JSX.Element {
  const { configLoaded, configError, loadRemoteConfig } = useStore()
  const reduceMotion = useReducedMotion()
  const loadingLang = useMemo(() => resolveAppLang('auto'), [])
  const tLoading = useMemo(() => {
    return {
      loadingTitle: i18nText(loadingLang, 'appInit.loadingTitle'),
      failedTitle: i18nText(loadingLang, 'appInit.failedTitle'),
      subtitle: i18nText(loadingLang, 'appInit.subtitle'),
      retry: i18nText(loadingLang, 'appInit.retry')
    }
  }, [loadingLang])
  useEffect(() => {
    void loadRemoteConfig().catch(() => {})
  }, [loadRemoteConfig])

  useEffect(() => {
    const onFocus = () => {
      void loadRemoteConfig().catch(() => {})
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadRemoteConfig().catch(() => {})
      }
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadRemoteConfig])

  if (!configLoaded) {
    return (
      <div className="h-screen w-screen bg-white text-foreground relative overflow-hidden">
        <div className="h-full w-full grid place-items-center p-6">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            transition={reduceMotion ? undefined : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[520px] text-center"
          >
            <div className="mb-4 flex items-center justify-center">
              <img
                src={loadingGif}
                alt="Loading"
                className="h-24 w-24 object-contain select-none pointer-events-none"
              />
            </div>
            <div className="flex items-center justify-center gap-2">
              <motion.span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full bg-foreground/50"
                animate={reduceMotion ? undefined : { opacity: [0.25, 0.75, 0.25] }}
                transition={reduceMotion ? undefined : { repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
              />
              <div className="text-sm font-semibold tracking-tight">
                {configError ? tLoading.failedTitle : tLoading.loadingTitle}
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{tLoading.subtitle}</div>

            {configError ? (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={reduceMotion ? undefined : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="mt-3 text-xs text-destructive/80 whitespace-pre-wrap break-words"
              >
                {configError}
              </motion.div>
            ) : null}

            {configError ? (
              <div className="mt-5 flex items-center justify-center">
                <Button variant="outline" onClick={() => void loadRemoteConfig().catch(() => {})}>
                  {tLoading.retry}
                </Button>
              </div>
            ) : null}
          </motion.div>
        </div>
      </div>
    )
  }

  return <AppLoaded />
}

function AppLoaded(): JSX.Element {
  const [isLoading, setIsLoading] = useState(false)
  const [skillsCache, setSkillsCache] = useState<SkillEntry[]>([])
  const [skillsStatus, setSkillsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const reduceMotion = useReducedMotion()
  const collapseAnimTransition = useMemo(
    () =>
      reduceMotion
        ? { duration: 0 }
        : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
    [reduceMotion]
  )
  const chatBootTransition = useMemo(
    () =>
      reduceMotion
        ? { duration: 0 }
        : { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
    [reduceMotion]
  )
  const collapseContentAnim = useMemo(
    () =>
      reduceMotion
        ? {
            initial: { opacity: 1, y: 0 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 1, y: 0 },
            transition: { duration: 0 }
          }
        : {
            initial: { opacity: 0, y: 4 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: 2 },
            transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }
          },
    [reduceMotion]
  )

  // Use a single state for mutually exclusive popovers
  const [popoverPanel, setPopoverPanel] = useState<'' | 'attachments' | 'tools' | 'skills' | 'model' | 'thinking' | 'permission' | 'completion' | 'git_branch'>('')
  
  const [traceDetailOpenByKey, setTraceDetailOpenByKey] = useState<Record<string, boolean>>({})
  const [toolTraceGroupOpenByMsgId, setToolTraceGroupOpenByMsgId] = useState<Record<string, boolean>>({})
  const [reasoningOpenByMsgId, setReasoningOpenByMsgId] = useState<Record<string, boolean>>({})
  const [memoryInjectionOpenByMsgId, setMemoryInjectionOpenByMsgId] = useState<Record<string, boolean>>({})
  const [collapsedTurnOpenById, setCollapsedTurnOpenById] = useState<Record<string, boolean>>({})
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastSoundAtRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const typingTimerRef = useRef<number | null>(null)
  const compressionTypingTimerRef = useRef<number | null>(null)
  const composerApiRef = useRef<{
    appendText: (text: string) => void
    setVoiceDraft: (finalText: string, interimText: string) => void
    commitVoiceFinal: (text: string) => void
    clearVoiceDraft: () => void
  } | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const voiceSessionIdRef = useRef<string | null>(null)
  const voiceEventSourceRef = useRef<EventSource | null>(null)
  const voiceBaseUrlRef = useRef<string>('')
  const voiceLastDraftRef = useRef<string>('')
  const voiceGotFinalRef = useRef(false)
  const voiceStopWaiterRef = useRef<null | (() => void)>(null)
  const toggleRecordingRef = useRef<null | (() => void)>(null)
  const voiceAudioCtxRef = useRef<AudioContext | null>(null)
  const voiceProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const voiceGainRef = useRef<GainNode | null>(null)
  const voicePendingRef = useRef<Uint8Array[]>([])
  const voiceSendTimerRef = useRef<number | null>(null)
  const voiceChunkInFlightRef = useRef(false)
  const chatScrollRef = useRef<HTMLElement | null>(null)
  const chatBottomSentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollAnimRef = useRef<number | null>(null)
  const scrollVelRef = useRef(0)
  const isAutoScrollActiveRef = useRef(false)
  const chatIsAtBottomRef = useRef(true)
  const showScrollToBottomRef = useRef(false)
  const isLoadingRef = useRef(false)
  const userScrollLockedRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const suppressAutoScrollUntilRef = useRef(0)
  const userScrollIntentUntilRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const lastMessageKeyRef = useRef('')
  const lastSeenMessageKeyRef = useRef('')
  const userMsgElMapRef = useRef<Map<string, HTMLElement>>(new Map())
  const turnSummaryBtnMapRef = useRef<Map<string, HTMLButtonElement>>(new Map())
  const turnStabilizeRafByIdRef = useRef<Map<string, number>>(new Map())
  const highlightUserMsgTimerRef = useRef<number | null>(null)
  const dangerousApprovalThreadsRef = useRef<Set<string>>(new Set())
  const copiedMessageTimerRef = useRef<number | null>(null)
  const [highlightUserMsgId, setHighlightUserMsgId] = useState('')
  const [userNavItems, setUserNavItems] = useState<Array<{ id: string; topRatio: number; widthPx: number; content: string }>>([])
  const [navHover, setNavHover] = useState<{ id: string; topRatio: number; content: string } | null>(null)
  const [chatScrollbarVisible, setChatScrollbarVisible] = useState(false)
  const chatScrollbarHideTimerRef = useRef<number | null>(null)

  const handleCopyMessage = useCallback(async (messageId: string, text: string) => {
    const content = String(text || '')
    if (!content.trim()) return
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessageId(messageId)
      if (copiedMessageTimerRef.current != null) window.clearTimeout(copiedMessageTimerRef.current)
      copiedMessageTimerRef.current = window.setTimeout(() => setCopiedMessageId(''), 1200)
    } catch {
      return
    }
  }, [])

  useEffect(() => {
    return () => {
      if (chatScrollbarHideTimerRef.current != null) {
        window.clearTimeout(chatScrollbarHideTimerRef.current)
        chatScrollbarHideTimerRef.current = null
      }
      if (copiedMessageTimerRef.current != null) {
        window.clearTimeout(copiedMessageTimerRef.current)
        copiedMessageTimerRef.current = null
      }
    }
  }, [])
  
  const { 
    messages, 
    chats,
    chatInitDone,
    addMessage, 
    updateMessageById,
    persistMessageById,
    activeChatId,
    updateChat,
    settings: settings0, 
    providers: providers0,
    voiceModelsInstalled,
    getActiveProvider,
    ui,
    updateComposer,
    updateSettings,
    toggleSidebarCollapsed,
    createChat,
    ensureActiveChatInProject,
    initApp,
    setActiveRightPanel,
    setPreviewUrl,
    openFileInExplorer
  } = useStore()
  const settings = settings0!
  const providers = providers0!

  const voiceModelId = String(settings.voice?.model || '').trim()
  const isVoiceModelAvailable = useMemo(() => {
    if (!voiceModelId) return false
    const list = Array.isArray(voiceModelsInstalled) ? voiceModelsInstalled : []
    return list.some((m: any) => String(m?.id || '').trim() === voiceModelId)
  }, [voiceModelsInstalled, voiceModelId])

  const { leftWidth, isResizingLeft, startResizingLeft, stopResizingLeft, updateLeftWidthFromClientX } = useLeftPaneLayout({
    initialWidth: 288,
    minWidth: 200,
    maxWidth: 800,
    dragOffsetPx: 8
  })
  const [rightWidth, setRightWidth] = useState(600)
  const [isResizingRight, setIsResizingRight] = useState(false)
  const [backendBaseUrl, setBackendBaseUrl] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<number | null>(null)
  const [fullAccessConfirmOpen, setFullAccessConfirmOpen] = useState(false)
  const [chatIsAtBottom, setChatIsAtBottom] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [imageDragActive, setImageDragActive] = useState(false)
  const [bundledSlashCommands, setBundledSlashCommands] = useState<SlashCommandEntry[]>([])
  const [projectSlashCommands, setProjectSlashCommands] = useState<SlashCommandEntry[]>([])
  const imageDragDepthRef = useRef(0)
  const showComposerToolSkillEntrances = false
  const wasLoadingRef = useRef(false)
  const statusCenterBootstrappedRef = useRef(false)
  const setChatBottomIfChanged = useCallback((next: boolean) => {
    if (chatIsAtBottomRef.current === next) return
    chatIsAtBottomRef.current = next
    setChatIsAtBottom(next)
  }, [])

  useEffect(() => {
    if (statusCenterBootstrappedRef.current) return
    statusCenterBootstrappedRef.current = true
    const api = window.anima?.statusCenter
    if (!api?.setState) return
    void api.setState({ state: 'idle', title: 'Idle' })
  }, [])

  useEffect(() => {
    const api = window.anima?.statusCenter
    if (!api?.setState) return

    if (isLoading) {
      wasLoadingRef.current = true
      void api.setState({ state: 'running', title: 'Running' })
      return
    }

    if (wasLoadingRef.current) {
      wasLoadingRef.current = false
      void api.setState({ state: 'done', title: 'Done' })
    }
  }, [isLoading])

  const setScrollToBottomIfChanged = useCallback((next: boolean) => {
    if (showScrollToBottomRef.current === next) return
    showScrollToBottomRef.current = next
    setShowScrollToBottom(next)
  }, [])

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId])
  const persistedCompression = useMemo(() => ((activeChat as any)?.meta?.compression as any) || null, [activeChat])
  const persistedCompressionSummary = useMemo(() => String(persistedCompression?.summary || '').trim(), [persistedCompression])
  const persistedCompressionUntilId = useMemo(() => String(persistedCompression?.summarizedUntilMessageId || '').trim(), [persistedCompression])
  const hasRuntimeCompression = useMemo(() => {
    return messages.some((m) => {
      const cs = (m as any)?.meta?.compressionState
      return cs === 'running' || cs === 'done'
    })
  }, [messages])
  const displayMessages = useMemo(() => {
    if (hasRuntimeCompression) return messages
    if (!persistedCompressionSummary) return messages

    const synthetic = {
      id: `compression:${activeChatId || 'unknown'}`,
      role: 'assistant',
      content: persistedCompressionSummary,
      meta: { compressionState: 'done', source: 'persisted' }
    } as any

    const untilId = String(persistedCompressionUntilId || '').trim()
    if (!untilId) return [...messages, synthetic]

    const idx = messages.findIndex((m: any) => String(m?.id || '').trim() === untilId)
    if (idx < 0) return [...messages, synthetic]

    const next = [...messages]
    next.splice(idx + 1, 0, synthetic)
    return next
  }, [messages, hasRuntimeCompression, persistedCompressionSummary, persistedCompressionUntilId, activeChatId])

  const effectiveTurnIdByMessageId = useMemo(() => {
    const map: Record<string, string> = {}
    let fallbackSeq = 0
    let currentTurnId = ''
    for (const m of displayMessages as any[]) {
      const mid = String(m?.id || '').trim()
      if (!mid) continue
      const explicitTurnId = String(m?.turnId || '').trim()
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
  }, [displayMessages])

  const latestTurnId = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i -= 1) {
      const mid = String((displayMessages[i] as any)?.id || '').trim()
      const tid = mid ? String(effectiveTurnIdByMessageId[mid] || '').trim() : ''
      if (tid) return tid
    }
    return ''
  }, [displayMessages, effectiveTurnIdByMessageId])

  const turnProcessStatsById = useMemo(() => {
    const map: Record<
      string,
      { memoryCount: number; reasoningCount: number; toolCount: number; skillCount: number; hasProcess: boolean; finalAssistantMessageId: string }
    > = {}
    const skillSets: Record<string, Set<string>> = {}
    const skillCalls: Record<string, number> = {}
    const parseSkillId = (tr: any): string => {
      const raw = String(tr?.argsPreview?.text || '').trim()
      if (!raw) return ''
      try {
        const obj = JSON.parse(raw)
        const sid = String(obj?.id || '').trim()
        return sid
      } catch {
        return ''
      }
    }
    for (const m of displayMessages as any[]) {
      const mid = String(m?.id || '').trim()
      const tid = mid ? String(effectiveTurnIdByMessageId[mid] || '').trim() : ''
      if (!tid) continue
      const current = map[tid] || { memoryCount: 0, reasoningCount: 0, toolCount: 0, skillCount: 0, hasProcess: false, finalAssistantMessageId: '' }
      if (m?.role === 'assistant') {
        current.finalAssistantMessageId = String(m?.id || '').trim() || current.finalAssistantMessageId
        const memoryInjection = parseMemoryInjection(m?.meta?.memoryInjection)
        if (memoryInjection?.count) current.memoryCount = Math.max(current.memoryCount, memoryInjection.count)
        const reasoning = String(m?.meta?.reasoningText || '').trim()
        if (reasoning) current.reasoningCount += 1
      } else if (m?.role === 'tool') {
        const traces = Array.isArray(m?.meta?.toolTraces) ? m.meta.toolTraces : []
        if (traces.length) {
          current.toolCount += traces.length
          for (const tr of traces) {
            const rawName = String(tr?.name || '').trim()
            const name = rawName.replace(/^tool_start:/, '').replace(/^tool_done:/, '').replace(/^tool_end:/, '').trim()
            if (name !== 'load_skill') continue
            skillCalls[tid] = (skillCalls[tid] || 0) + 1
            const sid = parseSkillId(tr)
            if (!sid) continue
            if (!skillSets[tid]) skillSets[tid] = new Set<string>()
            skillSets[tid].add(sid)
          }
        }
      }
      current.skillCount = skillSets[tid]?.size || skillCalls[tid] || 0
      current.hasProcess = current.memoryCount > 0 || current.reasoningCount > 0 || current.toolCount > 0 || current.skillCount > 0
      map[tid] = current
    }
    return map
  }, [displayMessages, effectiveTurnIdByMessageId])

  const turnFirstAssistantMessageIdById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of displayMessages as any[]) {
      const mid = String(m?.id || '').trim()
      const tid = mid ? String(effectiveTurnIdByMessageId[mid] || '').trim() : ''
      if (!tid || m?.role !== 'assistant') continue
      if (!map[tid]) map[tid] = mid
    }
    return map
  }, [displayMessages, effectiveTurnIdByMessageId])

  const dangerousApprovalsByTurn = useMemo(() => {
    const map: Record<string, Array<{ command: string; status: 'approved_once' | 'approved_thread' | 'rejected' }>> = {}
    const normalizeCommand = (raw: unknown) => String(raw || '').replace(/\s+/g, ' ').trim()
    for (const m of displayMessages as any[]) {
      const mid = String(m?.id || '').trim()
      const turnId = mid ? String(effectiveTurnIdByMessageId[mid] || '').trim() : ''
      if (!turnId || m?.role !== 'assistant') continue
      const command = normalizeCommand(m?.meta?.dangerousCommandApproval?.command)
      const status = String(m?.meta?.dangerousCommandApproval?.status || '').trim()
      if (!command) continue
      if (status === 'approved_once' || status === 'approved_thread' || status === 'rejected') {
        if (!Array.isArray(map[turnId])) map[turnId] = []
        map[turnId].push({ command, status })
      }
    }
    return map
  }, [displayMessages, effectiveTurnIdByMessageId])

  const completedToolTraceSignaturesByTurn = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const m of displayMessages as any[]) {
      if (m?.role !== 'tool') continue
      const mid = String(m?.id || '').trim()
      const turnId = mid ? String(effectiveTurnIdByMessageId[mid] || '').trim() : ''
      if (!turnId) continue
      const traces = Array.isArray(m?.meta?.toolTraces) ? m.meta.toolTraces : []
      for (const tr of traces) {
        const st = String((tr as any)?.status || '').trim()
        if (st === 'running') continue
        const sig = toolTraceSignature(tr)
        if (!sig) continue
        if (!map[turnId]) map[turnId] = new Set<string>()
        map[turnId].add(sig)
      }
    }
    return map
  }, [displayMessages, effectiveTurnIdByMessageId])

  useEffect(() => {
    void resolveBackendBaseUrl()
      .then((url) => setBackendBaseUrl(String(url || '').trim()))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const KEY = 'anima:settings:rev'
    let lastSyncAt = 0
    let lastSeenRev = ''
    try {
      lastSeenRev = typeof localStorage !== 'undefined' ? String(localStorage.getItem(KEY) || '') : ''
    } catch {
      lastSeenRev = ''
    }
    const sync = () => {
      const now = Date.now()
      if (now - lastSyncAt < 500) return
      lastSyncAt = now
      void useStore.getState().loadRemoteConfig().catch(() => {})
    }
    const onStorage = (e: StorageEvent) => {
      if (!e) return
      if (e.key !== KEY) return
      const next = String(e.newValue || '')
      if (next && next === lastSeenRev) return
      lastSeenRev = next
      sync()
    }
    const bc = (() => {
      try {
        if (typeof BroadcastChannel === 'undefined') return null
        return new BroadcastChannel('anima:settings')
      } catch {
        return null
      }
    })()
    const onBc = (e: MessageEvent) => {
      const data = (e as any)?.data
      if (!data || data.type !== 'settings_rev') return
      const next = String(data.rev || '')
      if (next && next === lastSeenRev) return
      lastSeenRev = next
      sync()
    }
    if (bc) bc.addEventListener('message', onBc as any)
    const onFocus = () => {
      let cur = ''
      try {
        cur = typeof localStorage !== 'undefined' ? String(localStorage.getItem(KEY) || '') : ''
      } catch {
        cur = ''
      }
      if (cur && cur === lastSeenRev) return
      lastSeenRev = cur
      sync()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
      try {
        if (bc) {
          bc.removeEventListener('message', onBc as any)
          bc.close()
        }
      } catch {
        //
      }
    }
  }, [])

  const loadChatSummary = async () => {
    const chatId = String(activeChatId || '').trim()
    if (!chatId) return
    setSummaryLoading(true)
    try {
      const res = await fetchBackendJson<{ ok: boolean; compression?: any }>(`/api/chats/${chatId}/summary?t=${Date.now()}`, { method: 'GET', cache: 'no-store' })
      const comp = (res as any)?.compression
      const text = String(comp?.summary || '').trim()
      setSummaryText(text)
      const ts = comp?.summaryUpdatedAt != null ? Number(comp.summaryUpdatedAt) : null
      setSummaryUpdatedAt(Number.isFinite(ts as any) ? (ts as number) : null)
    } finally {
      setSummaryLoading(false)
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        updateLeftWidthFromClientX(e.clientX)
      }
      if (isResizingRight) {
        setRightWidth(Math.max(300, Math.min(1200, window.innerWidth - e.clientX - 8)))
      }
    }

    const handleMouseUp = () => {
      stopResizingLeft()
      setIsResizingRight(false)
    }

    if (isResizingLeft || isResizingRight) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingLeft, isResizingRight, stopResizingLeft, updateLeftWidthFromClientX])

  useEffect(() => {
    void initApp()
  }, [initApp])

  const CompressionCard = ({
    state,
    content
  }: {
    state: 'running' | 'done'
    content: string
  }) => {
    const [collapsed, setCollapsed] = useState(state === 'done')
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const showBody = !collapsed && Boolean(String(content || '').trim())

    useEffect(() => {
      if (state === 'done') setCollapsed(true)
      else setCollapsed(false)
    }, [state])

    useEffect(() => {
      if (!showBody) return
      const el = viewportRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
    }, [content, showBody])

    const title = state === 'running' ? appRuntimeText.compressionRunning : appRuntimeText.compressionDone
    const canToggle = state === 'done'
    return (
      <div className="w-full">
        <div className="rounded-xl border border-black/5 dark:border-white/10 bg-background/60 backdrop-blur-sm overflow-hidden">
          <button
            type="button"
            className={`w-full px-3 py-2 flex items-center justify-between gap-3 text-left ${canToggle ? 'cursor-pointer group' : 'cursor-default'}`}
            onClick={() => {
              if (!canToggle) return
              setCollapsed((v) => !v)
            }}
          >
            <div className={`text-[13px] leading-relaxed font-medium ${state === 'running' ? 'anima-flow-text' : 'text-foreground/80'}`}>{title}</div>
            {canToggle ? (
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground transition-all duration-300 opacity-0 group-hover:opacity-100 ${collapsed ? '' : 'rotate-180'}`}
              />
            ) : (
              <div className="w-4 h-4" />
            )}
          </button>

          <AnimatePresence initial={false}>
            {showBody ? (
              <motion.div
                key="compression-body"
                initial={{ gridTemplateRows: '0fr' }}
                animate={{ gridTemplateRows: '1fr' }}
                exit={{ gridTemplateRows: '0fr' }}
                transition={collapseAnimTransition}
                className="overflow-hidden"
                style={{ display: 'grid', willChange: 'grid-template-rows' }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div ref={viewportRef} className="h-[150px] overflow-y-auto px-3 py-2 custom-scrollbar">
                    <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                      {content}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  const setUpdateState = useUpdateStore((s) => s.setState)

  useEffect(() => {
    return () => {
      turnStabilizeRafByIdRef.current.forEach((raf) => window.cancelAnimationFrame(raf))
      turnStabilizeRafByIdRef.current.clear()
      turnSummaryBtnMapRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const api = window.anima?.update
    if (!api?.getState || !api?.onState) return
    void api
      .getState()
      .then((res: any) => {
        if (res && res.ok && res.state) setUpdateState(res.state)
      })
      .catch(() => {})

    const unsub = api.onState((state: any) => {
      if (state) setUpdateState(state)
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [setUpdateState])

  useEffect(() => {
    const api = window.anima?.update
    if (!api?.check) return
    const t = setTimeout(() => {
      void api.check({ interactive: false })
    }, 1500)
    return () => clearTimeout(t)
  }, [])

  const activeProvider = getActiveProvider()
  const [routeHash, setRouteHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash || '' : ''))
  const isSettingsWindow = routeHash.startsWith('#/settings')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onHashChange = () => setRouteHash(window.location.hash || '')
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const openSettings = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!window.location.hash.startsWith('#/settings')) {
      window.location.hash = '/settings'
      setRouteHash(window.location.hash || '#/settings')
    }
  }, [])

  const downsampleToPcm16le = (input: Float32Array, inputRate: number, targetRate: number) => {
    const inRate = Number(inputRate) || 0
    const outRate = Number(targetRate) || 0
    if (!inRate || !outRate || outRate > inRate) return new Uint8Array()
    const ratio = inRate / outRate
    const outLen = Math.floor(input.length / ratio)
    if (outLen <= 0) return new Uint8Array()
    const out = new Int16Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio
      const idx = Math.floor(pos)
      const nextIdx = Math.min(input.length - 1, idx + 1)
      const frac = pos - idx
      const sample = input[idx] * (1 - frac) + input[nextIdx] * frac
      const clamped = Math.max(-1, Math.min(1, sample))
      out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    }
    return new Uint8Array(out.buffer)
  }

  const cleanupVoiceCapture = async () => {
    if (voiceSendTimerRef.current != null) {
      window.clearInterval(voiceSendTimerRef.current)
      voiceSendTimerRef.current = null
    }
    voicePendingRef.current = []
    voiceChunkInFlightRef.current = false

    const proc = voiceProcessorRef.current
    voiceProcessorRef.current = null
    if (proc) {
      try {
        proc.disconnect()
      } catch {
        //
      }
    }
    const src = voiceSourceRef.current
    voiceSourceRef.current = null
    if (src) {
      try {
        src.disconnect()
      } catch {
        //
      }
    }
    const gain = voiceGainRef.current
    voiceGainRef.current = null
    if (gain) {
      try {
        gain.disconnect()
      } catch {
        //
      }
    }

    const ctx = voiceAudioCtxRef.current
    voiceAudioCtxRef.current = null
    if (ctx) {
      try {
        await ctx.close()
      } catch {
        //
      }
    }

    const s = mediaStreamRef.current
    if (s) s.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
  }

  const cleanupVoiceSession = () => {
    const es = voiceEventSourceRef.current
    voiceEventSourceRef.current = null
    if (es) {
      try {
        es.close()
      } catch {
        //
      }
    }
    voiceSessionIdRef.current = null
    voiceBaseUrlRef.current = ''
    voiceStopWaiterRef.current = null
    voiceGotFinalRef.current = false
    voiceLastDraftRef.current = ''
  }

  const cleanupVoiceStreaming = async (opts?: { sendStop?: boolean }) => {
    const sendStop = opts?.sendStop !== false
    const sessionId = voiceSessionIdRef.current
    await cleanupVoiceCapture()
    cleanupVoiceSession()

    if (sendStop && sessionId) {
      try {
        await fetchBackendJson<{ ok: boolean }>('/voice/stream/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        })
      } catch {
        //
      }
    }
  }

  const waitForVoiceStopAck = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      if (voiceGotFinalRef.current) return resolve()
      const done = () => {
        if (voiceStopWaiterRef.current === done) voiceStopWaiterRef.current = null
        resolve()
      }
      voiceStopWaiterRef.current = done
      window.setTimeout(() => {
        if (voiceStopWaiterRef.current === done) voiceStopWaiterRef.current = null
        resolve()
      }, Math.max(200, timeoutMs))
    })
  }

  const toggleRecording = async () => {
    if (isRecording) {
      setIsRecording(false)
      const sessionId = voiceSessionIdRef.current
      const draftFallback = String(voiceLastDraftRef.current || '').trim()
      await cleanupVoiceCapture()
      const waitAck = waitForVoiceStopAck(2500)
      if (sessionId) {
        try {
          await fetchBackendJson<{ ok: boolean }>('/voice/stream/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          })
        } catch {
          //
        }
      }
      await waitAck
      if (!voiceGotFinalRef.current) {
        if (draftFallback) composerApiRef.current?.commitVoiceFinal(draftFallback)
        else composerApiRef.current?.clearVoiceDraft()
      }
      cleanupVoiceSession()
      return
    }

    if (!isVoiceModelAvailable) {
      alert(i18nText(appLang, 'app.configureModelFirst'))
      return
    }

    if (!settings.voice?.enabled) {
      updateSettings({
        voice: {
          enabled: true,
          model: settings.voice?.model || 'openai/whisper-large-v3-turbo',
          language: settings.voice?.language || 'auto',
          autoDetect: settings.voice?.autoDetect ?? true,
          localModels: settings.voice?.localModels || []
        }
      })
    }

    try {
      const startRes = await fetchBackendJson<{ ok: boolean; sessionId: string; sampleRate: number }>('/voice/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleRate: 16000, updateIntervalMs: 1200, minUpdateBytes: 32000 })
      })
      if (!startRes.ok || !startRes.sessionId) {
        throw new Error('Failed to start voice session')
      }
      voiceSessionIdRef.current = startRes.sessionId
      voiceGotFinalRef.current = false
      voiceLastDraftRef.current = ''

      const voiceBaseUrl = String(backendBaseUrl || (await resolveBackendBaseUrl()) || '').trim()
      voiceBaseUrlRef.current = voiceBaseUrl
      const es = new EventSource(`${voiceBaseUrl}/voice/stream/events?sessionId=${encodeURIComponent(startRes.sessionId)}`)
      voiceEventSourceRef.current = es
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(String((ev as any)?.data || '{}'))
          const typ = String(data?.type || '')
          if (typ === 'voice_update') {
            const finalText = String(data?.finalText || '')
            const interimText = String(data?.interimText || '')
            composerApiRef.current?.setVoiceDraft(finalText, interimText)
            const a = String(finalText || '').trim()
            const b = String(interimText || '').trim()
            const combined = a && b ? `${a}${a.endsWith(' ') || a.endsWith('\n') ? '' : ' '}${b}` : a || b
            voiceLastDraftRef.current = combined
            return
          }
          if (typ === 'voice_final') {
            const text = String(data?.text || '')
            composerApiRef.current?.commitVoiceFinal(text)
            voiceGotFinalRef.current = true
            voiceLastDraftRef.current = String(text || '').trim()
            voiceStopWaiterRef.current?.()
            return
          }
          if (typ === 'done') {
            voiceStopWaiterRef.current?.()
            return
          }
          if (typ === 'error') {
            throw new Error(String(data?.error || 'Voice stream error'))
          }
        } catch (e) {
          console.error('Voice stream event parse failed', e)
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      const ctx = new AudioContext()
      voiceAudioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      voiceSourceRef.current = source
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      voiceProcessorRef.current = processor

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        const pcm = downsampleToPcm16le(input, ctx.sampleRate, 16000)
        if (pcm.byteLength > 0) voicePendingRef.current.push(pcm)
      }

      source.connect(processor)
      const gain = ctx.createGain()
      gain.gain.value = 0
      voiceGainRef.current = gain
      processor.connect(gain)
      gain.connect(ctx.destination)

      voiceSendTimerRef.current = window.setInterval(() => {
        if (!voiceSessionIdRef.current) return
        if (voiceChunkInFlightRef.current) return
        if (!voicePendingRef.current.length) return
        const parts = voicePendingRef.current
        voicePendingRef.current = []
        const total = parts.reduce((acc, p) => acc + p.byteLength, 0)
        if (!total) return
        const buf = new Uint8Array(total)
        let off = 0
        for (const p of parts) {
          buf.set(p, off)
          off += p.byteLength
        }
        voiceChunkInFlightRef.current = true
        fetch(`${voiceBaseUrl}/voice/stream/chunk?sessionId=${encodeURIComponent(voiceSessionIdRef.current)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: buf
        })
          .catch(() => {})
          .finally(() => {
            voiceChunkInFlightRef.current = false
          })
      }, 400)

      setIsRecording(true)
    } catch (err) {
      console.error('Error accessing microphone:', err)
      await cleanupVoiceStreaming({ sendStop: true })
      setIsRecording(false)
    }
  }
  toggleRecordingRef.current = () => void toggleRecording()

  useEffect(() => {
    const isMac = isMacLike()
    const shortcutById = new Map(SHORTCUTS.map((s) => [s.id, s]))
    const isEditable = (target: EventTarget | null) => {
      const el = target as any
      if (!el) return false
      const tag = String(el.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      if (el.isContentEditable) return true
      return false
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const primary = isMac ? e.metaKey : e.ctrlKey
      if (!primary) return
      if (isEditable(e.target) && !e.altKey && !e.shiftKey && String(e.key || '').toLowerCase() !== ',') {
        return
      }

      const handle = (id: ShortcutId, fn: () => void) => {
        const def = shortcutById.get(id as any)
        if (!def) return false
        const st = useStore.getState()
        const overrides = (st.settings as any)?.shortcuts?.bindings as any
        const raw = overrides && Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : undefined
        if (raw === null) return false
        const b = raw ? normalizeBinding(raw) : null
        const binding = b || def.binding
        if (!matchShortcut(e, binding, isMac)) return false
        e.preventDefault()
        fn()
        return true
      }

      const openSettingsLocal = () => {
        if (!window.location.hash.startsWith('#/settings')) {
          window.location.hash = '/settings'
          setRouteHash(window.location.hash || '#/settings')
        }
      }

      if (handle('openSettings', () => openSettingsLocal())) return
      if (
        handle('openShortcuts', () => {
          useStore.getState().setActiveTab('shortcuts')
          openSettingsLocal()
        })
      )
        return

      if (handle('toggleLeftSidebar', () => useStore.getState().toggleSidebarCollapsed())) return
      if (
        handle('openSidebarSearch', () => {
          const st = useStore.getState()
          if (!st.ui.sidebarSearchOpen) st.toggleSidebarSearch()
        })
      )
        return
      if (handle('toggleRightSidebar', () => useStore.getState().toggleRightSidebar())) return

      if (handle('rightFiles', () => useStore.getState().setActiveRightPanel('files'))) return
      if (handle('rightGit', () => useStore.getState().setActiveRightPanel('git'))) return
      if (handle('rightTerminal', () => useStore.getState().setActiveRightPanel('terminal'))) return
      if (handle('rightPreview', () => useStore.getState().setActiveRightPanel('preview'))) return

      if (
        handle('toggleVoice', () => {
          toggleRecordingRef.current?.()
        })
      )
        return
      if (handle('newChat', () => void useStore.getState().createChat())) return
      if (
        handle('addProject', () => {
          void (async () => {
            const res = await window.anima?.window?.pickDirectory?.()
            if (!res?.ok || res.canceled) return
            const dir = String(res.path || '').trim()
            if (!dir) return
            await useStore.getState().addProject(dir)
          })()
        })
      )
        return
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const composer = ui.composer
  const projects = Array.isArray(settings.projects) ? settings.projects : []
  const activeProjectId = String(ui.activeProjectId || '').trim()
  const activeProject = activeProjectId ? projects.find((p: any) => String(p?.id || '').trim() === activeProjectId) || null : null
  const activeProjectDir = String((activeProject as any)?.dir || '').trim()
  const activeProjectName = String((activeProject as any)?.name || '').trim()
  const [topGitBranch, setTopGitBranch] = useState('')
  const [topGitRepoDir, setTopGitRepoDir] = useState('')
  const [gitBranches, setGitBranches] = useState<string[]>([])
  const [gitBranchLoading, setGitBranchLoading] = useState(false)

  useEffect(() => {
    let canceled = false
    const loadTopGitBranch = async () => {
      const fallbackWorkspaceDir = String(settings.workspaceDir || '').trim()
      const base = String(activeProjectDir || fallbackWorkspaceDir).trim()
      if (!base) {
        if (!canceled) {
          setTopGitBranch('')
          setTopGitRepoDir('')
        }
        return
      }
      try {
        const repoRes = await window.anima.git.checkIsRepo(base)
        if (!repoRes?.ok || !repoRes.isRepo) {
          if (!canceled) {
            setTopGitBranch('')
            setTopGitRepoDir('')
          }
          return
        }
        const branchRes = await window.anima.git.getBranches(base)
        const branch = String(branchRes?.current || branchRes?.branches?.[0] || 'HEAD').trim()
        if (!canceled) {
          setTopGitBranch(branch)
          setTopGitRepoDir(base)
        }
      } catch {
        if (!canceled) {
          setTopGitBranch('')
          setTopGitRepoDir('')
        }
      }
    }
    void loadTopGitBranch()
    return () => {
      canceled = true
    }
  }, [activeProjectDir, settings.workspaceDir])

  const refreshGitBranches = useCallback(async () => {
    const repoDir = String(topGitRepoDir || '').trim()
    if (!repoDir) {
      setGitBranches([])
      return
    }
    setGitBranchLoading(true)
    try {
      const res = await window.anima.git.getBranches(repoDir)
      if (res?.ok) {
        const next = Array.isArray(res.branches) ? res.branches.map((b) => String(b || '').trim()).filter(Boolean) : []
        setGitBranches(next)
        const current = String(res.current || '').trim()
        if (current) setTopGitBranch(current)
      }
    } finally {
      setGitBranchLoading(false)
    }
  }, [topGitRepoDir])

  const switchGitBranch = useCallback(async (branch: string) => {
    const repoDir = String(topGitRepoDir || '').trim()
    const target = String(branch || '').trim()
    if (!repoDir || !target) return
    try {
      const res = await window.anima.git.checkout({ cwd: repoDir, branch: target })
      if (res?.ok) {
        setTopGitBranch(target)
        await refreshGitBranches()
      }
    } catch {
      // ignore branch switch errors in compact bar
    }
  }, [topGitRepoDir, refreshGitBranches])

  const formatTokenCount = (n?: number) => {
    if (n == null || Number.isNaN(n)) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
    return String(n)
  }

  const openPreviewUrl = (raw: string) => {
    const text = String(raw || '').trim()
    if (!text) return
    const normalized = /^https?:\/\//i.test(text) ? text : `http://${text}`
    setPreviewUrl(normalized)
    setActiveRightPanel('preview')
  }

  const openLinkTarget = (raw: string) => {
    const rawText = String(raw || '').trim()
    if (!rawText) return
    const text = (() => {
      let t = rawText
      if (t.startsWith('<') && t.endsWith('>')) t = t.slice(1, -1)
      t = t.replace(/^[`"'“”‘’]+/, '').replace(/[`"'“”‘’]+$/, '')
      t = t.replace(/[)\].,;:，。；：]+$/, '')
      return t.trim()
    })()
    if (!text) return
    if (/^https?:\/\//i.test(text)) {
      openPreviewUrl(text)
      return
    }
    if (
      text.startsWith('file://') ||
      text.startsWith('/') ||
      text.startsWith('\\') ||
      text.startsWith('./') ||
      text.startsWith('../') ||
      text.startsWith('~/')
    ) {
      openFileInExplorer(text)
      return
    }
    if (/\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(text)) {
      openFileInExplorer(text)
      return
    }
    openPreviewUrl(text)
  }

  const renderArtifacts = (items: Artifact[], size: 'sm' | 'md' = 'md') => {
    const arts = Array.isArray(items) ? items.filter((a) => a && typeof a.path === 'string' && a.path.trim()) : []
    if (!arts.length) return null
    const imgH = size === 'sm' ? 'h-16' : 'h-24'
    const chip = size === 'sm' ? 'text-[11px] px-2 py-1' : 'text-[12px] px-2.5 py-1.5'
    const gap = size === 'sm' ? 'gap-1.5' : 'gap-2'

    return (
      <div className={`flex flex-wrap ${gap}`}>
        {arts.map((a, idx) => {
          const p = String(a.path || '').trim()
          const name = String(a.title || '').trim() || p.split('/').pop() || 'artifact'
          const isImage = a.kind === 'image' || String(a.mime || '').toLowerCase().startsWith('image/')
          const isVideo = a.kind === 'video' || String(a.mime || '').toLowerCase().startsWith('video/')
          const ws = resolveWorkspaceDir()
          const src =
            backendBaseUrl && ws
              ? `${backendBaseUrl}/api/artifacts/file?path=${encodeURIComponent(p)}&workspaceDir=${encodeURIComponent(ws)}`
              : `file://${p}`
          if (isImage) {
            return (
              <button
                key={`${p}:${idx}`}
                type="button"
                className="rounded-md border border-border/60 bg-muted/10 hover:bg-muted/30 transition-colors overflow-hidden"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openLinkTarget(p)
                }}
                title={p}
              >
                <img src={src} alt={name} className={`${imgH} w-auto max-w-[320px] object-contain`} />
              </button>
            )
          }
          if (isVideo) {
            return (
              <div
                key={`${p}:${idx}`}
                className="rounded-md border border-border/60 bg-muted/10 overflow-hidden"
                title={p}
              >
                <div className="flex items-center justify-end px-2 py-1 border-b border-border/40 bg-muted/10">
                  <button
                    type="button"
                    className={`rounded border border-border/60 bg-background/40 hover:bg-background/60 transition-colors font-mono ${chip}`}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openLinkTarget(p)
                    }}
                  >
                    Open
                  </button>
                </div>
                <video
                  src={src}
                  className={`${imgH} w-auto max-w-[320px] bg-black`}
                  controls
                  preload="metadata"
                />
              </div>
            )
          }
          return (
            <button
              key={`${p}:${idx}`}
              type="button"
              className={`rounded-md border border-border/60 bg-muted/10 hover:bg-muted/30 transition-colors font-mono ${chip}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                openLinkTarget(p)
              }}
              title={p}
            >
              {name}
            </button>
          )
        })}
      </div>
    )
  }

  const tokenStatus = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      const used = m.meta?.totalTokens
      const remaining = m.meta?.rateLimit?.remainingTokens
      const limit = m.meta?.rateLimit?.limitTokens
      if (used != null || remaining != null || limit != null) return { used, remaining, limit }
    }
    return { used: undefined, remaining: undefined, limit: undefined }
  }, [messages])

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].id
    }
    return ''
  }, [messages])

  const sortedProviders = useMemo(() => {
    const list = (providers || []).filter((p) => {
        if (!p.isEnabled) return false
        if (!p?.config?.modelsFetched) return false
        if (!Array.isArray(p?.config?.models)) return false
        // Support both string[] and ProviderModel[]
        return p.config.models.some((m: any) => typeof m === 'string' ? true : m.isEnabled)
    })
    list.sort((a, b) => {
      const enabled = Number(Boolean(b.isEnabled)) - Number(Boolean(a.isEnabled))
      if (enabled) return enabled
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    return list
  }, [providers])

  const isAutoModel = !String(composer.providerOverrideId || '').trim() && !String(composer.modelOverride || '').trim()
  const effectiveProviderId = String(composer.providerOverrideId || activeProvider?.id || '').trim()
  const effectiveProvider = useMemo(() => {
    const byId = effectiveProviderId ? providers.find((p) => p.id === effectiveProviderId) : undefined
    return byId || activeProvider
  }, [providers, activeProvider, effectiveProviderId])
  const effectiveModel = String(composer.modelOverride || effectiveProvider?.config?.selectedModel || '').trim()

  const usageStats = useMemo(() => {
    const used = tokenStatus.used || 0
    let total = 0
    
    // Try to get total from model config if not in metadata
    if (!total && effectiveProvider?.config?.models) {
      const models = effectiveProvider.config.models
      if (Array.isArray(models)) {
        const m = models.find((x: any) => (typeof x === 'string' ? x : x.id) === effectiveModel)
        if (m && typeof m !== 'string' && m.config?.contextWindow) {
          total = m.config.contextWindow
        }
      }
    }

    if (!total) {
      total = Number(composer.contextWindowOverride || 0)
    }
    
    const percentage = total > 0 ? Math.min(100, (used / total) * 100) : 0
    return { used, total, percentage }
  }, [tokenStatus, effectiveProvider, effectiveModel, composer.contextWindowOverride])

  const thinkingLevel = ((): 'off' | 'low' | 'medium' | 'high' | 'xhigh' => {
    const raw = String(composer.thinkingLevel || '').trim().toLowerCase()
    if (raw === 'off' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh') return raw
    return 'medium'
  })()
  const effectiveProviderIdLower = String(effectiveProvider?.id || '').toLowerCase()
  const effectiveProviderNameLower = String(effectiveProvider?.name || '').toLowerCase()
  const effectiveProviderBaseUrlLower = String(effectiveProvider?.config?.baseUrl || '').toLowerCase()
  const isOllamaLikeProvider =
    effectiveProviderIdLower.includes('ollama') ||
    effectiveProviderNameLower.includes('ollama') ||
    effectiveProviderBaseUrlLower.includes('127.0.0.1:11434') ||
    effectiveProviderBaseUrlLower.includes('localhost:11434')
  const shouldShowAnalysis =
    effectiveProvider?.type === 'deepseek' ||
    isOllamaLikeProvider

  const toggleAutoModel = () => {
    if (isAutoModel) {
      if (activeProvider?.id && activeProvider?.config?.selectedModel) {
        updateComposer({ providerOverrideId: activeProvider.id, modelOverride: activeProvider.config.selectedModel })
      }
      return
    }
    updateComposer({ providerOverrideId: '', modelOverride: '' })
  }

  const getProviderIconUrl = (provider: { id?: string; type?: string; icon?: string }) => {
    if (provider.icon) return provider.icon
    const id = String(provider.id || '').toLowerCase()
    const type = String(provider.type || '').toLowerCase()
    const slugById: Record<string, string> = {
      openai: 'openai',
      anthropic: 'anthropic',
      google: 'gemini',
      deepseek: 'deepseek',
      moonshot: 'moonshot',
      openrouter: 'openrouter',
      github: 'github',
      azure: 'microsoft-azure',
      aihubmix: 'aihubmix'
    }
    const slugByType: Record<string, string> = {
      openai: 'openai',
      openai_compatible: 'openai',
      deepseek: 'deepseek',
      moonshot: 'moonshot',
      anthropic: 'anthropic',
      google: 'gemini',
      github: 'github',
      azure: 'microsoft-azure'
    }
    const slug = slugById[id] || slugByType[type]
    if (!slug) return ''
    return `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${slug}.svg`
  }

  const builtinTools = useMemo(() => {
    const runtimeLang = resolveAppLang(settings.language)
    const runtimeText = APP_RUNTIME_STRINGS[runtimeLang] || APP_RUNTIME_STRINGS.en
    return [
      { id: 'glob_files', name: runtimeText.builtinTools.glob_files },
      { id: 'bash', name: runtimeText.builtinTools.bash },
      { id: 'read_file', name: runtimeText.builtinTools.read_file },
      { id: 'rg_search', name: runtimeText.builtinTools.rg_search },
      { id: 'WebSearch', name: runtimeText.builtinTools.WebSearch },
      { id: 'WebFetch', name: runtimeText.builtinTools.WebFetch },
      { id: 'list_dir', name: runtimeText.builtinTools.list_dir }
    ]
  }, [settings.language])

  const uuid = () => {
    const anyCrypto = globalThis.crypto as any
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID()
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  const ensureSkills = async () => {
    if (skillsStatus === 'loading') return
    setSkillsStatus('loading')
    try {
      const res = await fetchBackendJson<{ ok: boolean; skills?: SkillEntry[] }>(`/skills/list?t=${Date.now()}`, { method: 'GET', cache: 'no-store' })
      const next = Array.isArray(res.skills) ? res.skills : []
      setSkillsCache(next)
      setSkillsStatus('ok')
    } catch {
      setSkillsStatus('error')
    }
  }

  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)
  const openTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = (panel: typeof popoverPanel) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setPopoverPanel(panel)
    if (panel === 'skills') {
      ensureSkills()
    }
  }

  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setPopoverPanel('')
    }, 300)
  }

  const handleInputPanelMouseEnter = (panel: typeof popoverPanel) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    openTimerRef.current = setTimeout(() => {
      setPopoverPanel(panel)
      if (panel === 'skills') ensureSkills()
      openTimerRef.current = null
    }, 30)
  }

  const handleInputPanelMouseLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    handleMouseLeave()
  }

  const handlePopoverOpenChange = async (name: typeof popoverPanel, open: boolean) => {
    if (open) {
      setPopoverPanel(name)
      if (name === 'skills') await ensureSkills()
    } else {
      setPopoverPanel('')
    }
  }

  const buildComposerPayload = (opts?: { dangerousCommandApprovals?: string[]; dangerousCommandAllowForThread?: boolean }) => {
    const workspaceDir = resolveWorkspaceDir()
    const enabledToolIds = composer.enabledToolIds.length ? composer.enabledToolIds : settings.toolsEnabledIds
    const enabledMcpServerIds = composer.enabledMcpServerIds.length ? composer.enabledMcpServerIds : settings.mcpEnabledServerIds
    const enabledSkillIds = composer.enabledSkillIds.length ? composer.enabledSkillIds : settings.skillsEnabledIds
    const completionProviderId = String((settings as any).tabCompletionProviderId || '').trim()
    const completionModelId = String((settings as any).tabCompletionModelId || '').trim()
    const completionContextLimit = Math.max(0, Math.min(12, Number(composer.completionContextLimit ?? 4) || 4))

    const selectedModelConfig = effectiveProvider?.config?.models?.find(
      (m: any) => typeof m !== 'string' && m.id === effectiveModel
    ) as ProviderModel | undefined

    const dangerousCommandApprovals = Array.isArray(opts?.dangerousCommandApprovals)
      ? opts?.dangerousCommandApprovals.filter((x) => String(x || '').trim()).map((x) => String(x).trim())
      : []

    const chatId = String(useStore.getState().activeChatId || activeChatId || '').trim()
    const dangerousCommandAllowForThread =
      Boolean(opts?.dangerousCommandAllowForThread) ||
      (chatId ? dangerousApprovalThreadsRef.current.has(chatId) : false)

    return {
      attachments: composer.attachments.map((a) => ({ path: a.path, mode: a.mode })),
      chatId,
      workspaceDir,
      toolMode: composer.toolMode || settings.defaultToolMode,
      permissionMode: composer.permissionMode || 'workspace_whitelist',
      enabledToolIds,
      enabledMcpServerIds,
      skillMode: composer.skillMode || settings.defaultSkillMode,
      enabledSkillIds,
      orchestrationForce: Boolean((settings as any).orchestrationForce),
      providerOverrideId: composer.providerOverrideId || '',
      modelOverride: composer.modelOverride || '',
      contextWindowOverride: composer.contextWindowOverride || selectedModelConfig?.config?.contextWindow || 0,
      maxOutputTokens: selectedModelConfig?.config?.maxOutputTokens,
      jsonConfig: selectedModelConfig?.config?.jsonConfig,
      thinkingLevel,
      completionEnabled: composer.completionEnabled !== false,
      completionTranslateEnabled: composer.completionTranslateEnabled !== false,
      completionSpellSuggestEnabled: composer.completionSpellSuggestEnabled !== false,
      completionContextLimit,
      completionProviderId,
      completionModelId,
      dangerousCommandApprovals,
      dangerousCommandAllowForThread
    }
  }

  const activeWorkspaceDir = useMemo(() => {
    const dir = String(activeProjectDir || '').trim()
    if (dir) return dir
    return ''
  }, [activeProjectDir])

  const resolveWorkspaceDir = () => activeWorkspaceDir

  const loadBundledSlashCommands = useCallback(async () => {
    try {
      const res = await fetchBackendJson<{ ok: boolean; commands?: BundledSlashCommandEntry[] }>(
        `/commands/list?t=${Date.now()}`,
        { method: 'GET', cache: 'no-store' }
      )
      const loaded = Array.isArray(res.commands) ? res.commands : []
      const next = loaded
        .map((item): SlashCommandEntry | null => {
          const name = String(item?.name || '').trim()
          const template = String(item?.template || '').trim()
          if (!name || !template) return null
          return {
            id: String(item?.id || `bundled:${name}`).trim() || `bundled:${name}`,
            name,
            title: String(item?.title || `/${name}`),
            description: String(item?.description || `Run /${name}`),
            source: 'builtin',
            kind: 'prompt',
            template,
            filePath: String(item?.file || '').trim() || undefined
          }
        })
        .filter((item): item is SlashCommandEntry => Boolean(item))
        .sort((a, b) => a.name.localeCompare(b.name))
      setBundledSlashCommands(next)
    } catch {
      setBundledSlashCommands([])
    }
  }, [])

  const loadProjectSlashCommands = useCallback(async () => {
    const workspaceDir = String(activeWorkspaceDir || '').trim()
    if (!workspaceDir || !window.anima?.fs?.readDir || !window.anima?.fs?.readFile) {
      setProjectSlashCommands([])
      return
    }
    const commandsDir = `${workspaceDir.replace(/\/$/, '')}/.anima/commands`
    const listRes = await window.anima.fs.readDir(commandsDir)
    if (!listRes?.ok || !Array.isArray(listRes.files)) {
      setProjectSlashCommands([])
      return
    }
    const markdownFiles = listRes.files.filter((file) => !file.isDirectory && /\.md$/i.test(String(file.name || '')))
    const loaded = await Promise.all(markdownFiles.map(async (file) => {
      const contentRes = await window.anima.fs.readFile(String(file.path || ''))
      if (!contentRes?.ok) return null
      return parseProjectSlashCommandFile(String(file.path || ''), String(contentRes.content || ''))
    }))
    setProjectSlashCommands(
      loaded
        .filter((item): item is SlashCommandEntry => Boolean(item))
        .sort((a, b) => a.name.localeCompare(b.name))
    )
  }, [activeWorkspaceDir])

  useEffect(() => {
    void loadBundledSlashCommands()
  }, [loadBundledSlashCommands])

  useEffect(() => {
    void loadProjectSlashCommands()
  }, [loadProjectSlashCommands])

  useEffect(() => {
    const handleFocus = () => {
      void loadBundledSlashCommands()
      void loadProjectSlashCommands()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [loadBundledSlashCommands, loadProjectSlashCommands])

  const normalizeAttachmentPath = (filePath: string, workspaceDir: string) => {
    const fp = String(filePath || '').trim()
    const wd = String(workspaceDir || '').trim()
    if (!fp) return ''
    if (!wd) return fp
    const base = wd.endsWith('/') ? wd : `${wd}/`
    if (fp === wd) return fp
    if (fp.startsWith(base)) return fp.slice(base.length)
    return fp
  }

  const addAttachments = (paths: string[]) => {
    const workspaceDir = resolveWorkspaceDir()
    const existing = new Set(composer.attachments.map((a) => a.path))
    const next = [...composer.attachments]
    for (const p of paths) {
      const normalized = normalizeAttachmentPath(p, workspaceDir)
      if (!normalized) continue
      if (existing.has(normalized)) continue
      existing.add(normalized)
      next.push({ id: uuid(), path: normalized, mode: 'inline' })
    }
    updateComposer({ attachments: next })
  }

  const handlePickFiles = async () => {
    const res = await window.anima?.window?.pickFiles?.()
    if (!res?.ok || res.canceled) return
    const paths = Array.isArray(res.paths) ? res.paths.map((p: any) => String(p || '')).filter(Boolean) : []
    if (paths.length === 0) return
    addAttachments(paths)
  }

  const isImageFileLike = (nameOrType: string) => {
    const s = String(nameOrType || '').trim().toLowerCase()
    if (!s) return false
    if (s.startsWith('image/')) return true
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s)
  }

  const hasImageDataTransfer = (dt?: DataTransfer | null) => {
    if (!dt) return false
    if (dt.items && dt.items.length) {
      for (const item of Array.from(dt.items)) {
        if (item.kind === 'file' && isImageFileLike(item.type)) return true
      }
    }
    if (dt.files && dt.files.length) {
      for (const file of Array.from(dt.files)) {
        if (isImageFileLike(file.type) || isImageFileLike(file.name)) return true
      }
    }
    return false
  }

  const resolveImageAttachmentPaths = async (files: File[]) => {
    const out: string[] = []
    const workspaceDir = resolveWorkspaceDir()
    for (const file of files) {
      if (!isImageFileLike(file.type) && !isImageFileLike(file.name)) continue
      const localPath = String((file as any)?.path || '').trim()
      if (localPath) {
        out.push(localPath)
        continue
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!bytes.length) continue
      const res = await window.anima?.window?.saveImageAttachment?.({
        bytes,
        fileName: String(file.name || '').trim() || undefined,
        workspaceDir,
        mime: String(file.type || '').trim() || undefined
      })
      if (res?.ok && String(res.path || '').trim()) {
        out.push(String(res.path).trim())
      }
    }
    return out
  }

  const addImageFilesAsAttachments = async (filesInput: FileList | File[]) => {
    const files = Array.from(filesInput || [])
    if (!files.length) return
    const paths = await resolveImageAttachmentPaths(files)
    if (!paths.length) return
    addAttachments(paths)
  }

  const handleRootDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasImageDataTransfer(e.dataTransfer)) return
    imageDragDepthRef.current += 1
    setImageDragActive(true)
  }

  const handleRootDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasImageDataTransfer(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!imageDragActive) setImageDragActive(true)
  }

  const handleRootDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!imageDragActive) return
    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1)
    if (imageDragDepthRef.current === 0) setImageDragActive(false)
  }

  const handleRootDrop = (e: DragEvent<HTMLDivElement>) => {
    const hasImage = hasImageDataTransfer(e.dataTransfer)
    if (!hasImage && !imageDragActive) return
    e.preventDefault()
    imageDragDepthRef.current = 0
    setImageDragActive(false)
    if (!hasImage) return
    void addImageFilesAsAttachments(e.dataTransfer.files)
  }

  const handleComposerPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files || [])
    const imageFiles = files.filter((f) => isImageFileLike(f.type) || isImageFileLike(f.name))
    if (!imageFiles.length) return
    e.preventDefault()
    void addImageFilesAsAttachments(imageFiles)
  }

  const toggleId = (arr: string[], id: string, enabled: boolean) => {
    const set = new Set(arr)
    if (enabled) set.add(id)
    else set.delete(id)
    return Array.from(set)
  }

  const openSkillsFolder = async () => {
    try {
      await fetchBackendJson('/skills/openDir', { method: 'POST' })
    } finally {
      await ensureSkills()
    }
  }

  const permissionMode = composer.permissionMode || 'workspace_whitelist'

  const handlePermissionModeChange = (nextMode: 'workspace_whitelist' | 'full_access') => {
    if (nextMode === 'full_access' && permissionMode !== 'full_access') {
      setFullAccessConfirmOpen(true)
      return
    }
    updateComposer({ permissionMode: nextMode })
  }

  const t = (() => {
    const dict = APP_SHADCN_DICTIONARIES[0] as any
    return dict[settings.language as keyof typeof dict] || dict.en
  })()
  const appLang = resolveAppLang(settings.language)
  const appRuntimeText = APP_RUNTIME_STRINGS[appLang] || APP_RUNTIME_STRINGS.en

  const slashText = (() => {
    const dict = APP_SHADCN_DICTIONARIES[1] as any
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const deriveReasoningSummaryFromTraces = (traces: ToolTrace[]) => {
    if (!traces.length) return undefined
    return `${t.trace.toolCount(traces.length)}`
  }

  const addDangerousApprovalMessage = (payload: DangerousCommandApprovalPayload, turnId: string) => {
    addMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      turnId,
      meta: {
        dangerousCommandApproval: {
          command: payload.command,
          matchedPattern: payload.matchedPattern,
          runId: payload.runId,
          approvalId: payload.approvalId,
          status: 'pending',
          selectedOption: 'approve_once'
        }
      }
    } as any)
  }

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  const lastMessageKey = useMemo(() => {
    const last = messages[messages.length - 1] as any
    const id = String(last?.id || '')
    const len = typeof last?.content === 'string' ? last.content.length : 0
    return `${messages.length}:${id}:${len}`
  }, [messages])

  useEffect(() => {
    lastMessageKeyRef.current = lastMessageKey
  }, [lastMessageKey])

  const cancelScrollAnim = useCallback(() => {
    if (scrollAnimRef.current != null) {
      window.cancelAnimationFrame(scrollAnimRef.current)
      scrollAnimRef.current = null
    }
  }, [])

  const stopAutoScroll = useCallback(() => {
    isAutoScrollActiveRef.current = false
    scrollVelRef.current = 0
    cancelScrollAnim()
  }, [cancelScrollAnim])

  const markProgrammaticScroll = useCallback(() => {
    programmaticScrollRef.current = true
    if (programmaticScrollTimerRef.current != null) {
      window.clearTimeout(programmaticScrollTimerRef.current)
      programmaticScrollTimerRef.current = null
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false
      programmaticScrollTimerRef.current = null
    }, 80)
  }, [])

  const markUserScrollIntent = useCallback((holdMs = 260) => {
    const now = performance.now()
    userScrollIntentUntilRef.current = now + Math.max(80, holdMs)
  }, [])

  const showChatScrollbarTemporarily = useCallback((holdMs = 700) => {
    setChatScrollbarVisible(true)
    if (chatScrollbarHideTimerRef.current != null) {
      window.clearTimeout(chatScrollbarHideTimerRef.current)
    }
    chatScrollbarHideTimerRef.current = window.setTimeout(() => {
      setChatScrollbarVisible(false)
      chatScrollbarHideTimerRef.current = null
    }, Math.max(260, holdMs))
  }, [])

  const suppressAutoScrollFor = useCallback((holdMs = 420) => {
    const now = performance.now()
    suppressAutoScrollUntilRef.current = Math.max(suppressAutoScrollUntilRef.current, now + Math.max(120, holdMs))
  }, [])

  const stabilizeTurnSummaryViewport = useCallback(
    (turnId: string, anchorTop: number, holdMs = 520) => {
      const id = String(turnId || '').trim()
      if (!id) return
      const scrollEl = chatScrollRef.current
      const anchorEl = turnSummaryBtnMapRef.current.get(id)
      if (!scrollEl || !anchorEl) return

      const prevRaf = turnStabilizeRafByIdRef.current.get(id)
      if (prevRaf != null) {
        window.cancelAnimationFrame(prevRaf)
        turnStabilizeRafByIdRef.current.delete(id)
      }

      const endAt = performance.now() + Math.max(180, holdMs)
      const tick = () => {
        const el = chatScrollRef.current
        const btn = turnSummaryBtnMapRef.current.get(id)
        if (!el || !btn) {
          turnStabilizeRafByIdRef.current.delete(id)
          return
        }

        const delta = btn.getBoundingClientRect().top - anchorTop
        if (Math.abs(delta) > 0.5) {
          markProgrammaticScroll()
          el.scrollTop += delta
        }

        if (performance.now() >= endAt) {
          turnStabilizeRafByIdRef.current.delete(id)
          return
        }

        const nextRaf = window.requestAnimationFrame(tick)
        turnStabilizeRafByIdRef.current.set(id, nextRaf)
      }

      const raf = window.requestAnimationFrame(tick)
      turnStabilizeRafByIdRef.current.set(id, raf)
    },
    [markProgrammaticScroll]
  )

  const startAutoScroll = useCallback((opts?: { force?: boolean }) => {
    const el = chatScrollRef.current
    if (!el) return
    if (!opts?.force && performance.now() < suppressAutoScrollUntilRef.current) return
    if (!opts?.force && userScrollLockedRef.current) return
    if (isAutoScrollActiveRef.current) return
    isAutoScrollActiveRef.current = true

    let lastTs = performance.now()

    const tick = (ts: number) => {
      if (!isAutoScrollActiveRef.current) {
        scrollAnimRef.current = null
        return
      }
      const shouldFollow = opts?.force || !userScrollLockedRef.current
      if (!shouldFollow) {
        stopAutoScroll()
        return
      }

      const dt = Math.max(0, Math.min(64, ts - lastTs))
      lastTs = ts

      const target = Math.max(0, el.scrollHeight - el.clientHeight)
      const x = el.scrollTop
      const err = target - x

      const k = 0.0022
      const damping = 0.86
      const v0 = scrollVelRef.current
      const v1 = (v0 + err * (k * dt)) * Math.pow(damping, dt / 16)
      scrollVelRef.current = v1

      const next = x + v1
      markProgrammaticScroll()
      el.scrollTop = next

      const near = Math.abs(err) < 0.8 && Math.abs(v1) < 0.15
      if (near && !isLoadingRef.current) {
        stopAutoScroll()
        return
      }

      scrollAnimRef.current = window.requestAnimationFrame(tick)
    }

    scrollAnimRef.current = window.requestAnimationFrame(tick)
  }, [markProgrammaticScroll, stopAutoScroll])

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    showChatScrollbarTemporarily()
    const prevTop = lastScrollTopRef.current
    const currTop = el.scrollTop
    lastScrollTopRef.current = currTop
    const gap = el.scrollHeight - (el.scrollTop + el.clientHeight)
    if (programmaticScrollRef.current) {
      if (currTop < prevTop - 1.5) {
        userScrollLockedRef.current = true
        setChatBottomIfChanged(false)
        stopAutoScroll()
        return
      }
      const hasUserIntent = performance.now() < userScrollIntentUntilRef.current
      if (hasUserIntent && currTop < prevTop - 2) {
        userScrollLockedRef.current = true
        setChatBottomIfChanged(false)
        stopAutoScroll()
        return
      }
      if (gap <= 24) {
        userScrollLockedRef.current = false
        setChatBottomIfChanged(true)
        setScrollToBottomIfChanged(false)
        lastSeenMessageKeyRef.current = lastMessageKeyRef.current
      }
      return
    }

    if (gap <= 24) {
      userScrollLockedRef.current = false
      setChatBottomIfChanged(true)
      setScrollToBottomIfChanged(false)
      lastSeenMessageKeyRef.current = lastMessageKeyRef.current
      return
    }

    userScrollLockedRef.current = true
    setChatBottomIfChanged(false)
    stopAutoScroll()
  }, [setChatBottomIfChanged, setScrollToBottomIfChanged, showChatScrollbarTemporarily, stopAutoScroll])

  const scrollToTop = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    userScrollLockedRef.current = true
    stopAutoScroll()
    el.scrollTo({ top: 0, behavior: 'smooth' })
  }, [stopAutoScroll])

  const scrollToBottom = useCallback(() => {
    const el = chatScrollRef.current
    if (!el) return
    userScrollLockedRef.current = false
    setScrollToBottomIfChanged(false)
    setChatBottomIfChanged(true)
    markProgrammaticScroll()
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    startAutoScroll({ force: true })
  }, [markProgrammaticScroll, setChatBottomIfChanged, setScrollToBottomIfChanged, startAutoScroll])

  const scrollToUserMessage = useCallback(
    (id: string) => {
      const el = chatScrollRef.current
      if (!el) return
      userScrollLockedRef.current = true
      stopAutoScroll()
      const target = userMsgElMapRef.current.get(id)
      const top = Math.max(0, (target?.offsetTop ?? 0) - 24)
      el.scrollTo({ top, behavior: 'smooth' })
      if (highlightUserMsgTimerRef.current != null) window.clearTimeout(highlightUserMsgTimerRef.current)
      setHighlightUserMsgId(id)
      highlightUserMsgTimerRef.current = window.setTimeout(() => {
        setHighlightUserMsgId('')
        highlightUserMsgTimerRef.current = null
      }, 900)
    },
    [stopAutoScroll]
  )

  useEffect(() => {
    const el = chatScrollRef.current
    if (!el) return
    const userMsgs = messages.filter((m) => m.role === 'user')
    if (!userMsgs.length) {
      setUserNavItems([])
      return
    }
    const maxLen = Math.max(1, ...userMsgs.map((m) => (typeof m.content === 'string' ? m.content.length : 0)))
    const denom = Math.log(1 + maxLen)
    const next: Array<{ id: string; topRatio: number; widthPx: number; content: string }> = []
    const sh = Math.max(1, el.scrollHeight)
    for (const m of userMsgs) {
      const id = String(m.id || '').trim()
      if (!id) continue
      const top = userMsgElMapRef.current.get(id)?.offsetTop
      if (top == null) continue
      const content = typeof m.content === 'string' ? m.content : ''
      const len = content.length
      const norm = denom > 0 ? Math.log(1 + Math.max(0, len)) / denom : 0
      const widthPx = 4 + norm * (18 - 4)
      const topRatio = Math.max(0, Math.min(1, top / sh))
      next.push({ id, topRatio, widthPx, content })
    }
    next.sort((a, b) => a.topRatio - b.topRatio)
    setUserNavItems(next)
  }, [lastMessageKey, messages])

  useEffect(() => {
    isLoadingRef.current = Boolean(isLoading)
  }, [isLoading])

  useEffect(() => {
    chatIsAtBottomRef.current = Boolean(chatIsAtBottom)
  }, [chatIsAtBottom])

  useEffect(() => {
    showScrollToBottomRef.current = Boolean(showScrollToBottom)
  }, [showScrollToBottom])

  useEffect(() => {
    setChatIsAtBottom(true)
    chatIsAtBottomRef.current = true
    userScrollLockedRef.current = false
    setShowScrollToBottom(false)
    lastSeenMessageKeyRef.current = lastMessageKeyRef.current
    window.setTimeout(() => {
      const el = chatScrollRef.current
      if (!el) return
      markProgrammaticScroll()
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
      startAutoScroll({ force: true })
    }, 0)
  }, [activeChatId, markProgrammaticScroll, startAutoScroll])

  useEffect(() => {
    const root = chatScrollRef.current
    const target = chatBottomSentinelRef.current
    if (!root || !target || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        userScrollLockedRef.current = false
        setChatBottomIfChanged(true)
        setScrollToBottomIfChanged(false)
        lastSeenMessageKeyRef.current = lastMessageKeyRef.current
        if (isLoadingRef.current) {
          startAutoScroll({ force: true })
        }
      },
      {
        root,
        rootMargin: '0px 0px 32px 0px',
        threshold: 0
      }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [displayMessages.length, setChatBottomIfChanged, setScrollToBottomIfChanged, startAutoScroll])

  useEffect(() => {
    if (!userScrollLockedRef.current) {
      if (performance.now() < suppressAutoScrollUntilRef.current) return
      lastSeenMessageKeyRef.current = lastMessageKey
      setShowScrollToBottom(false)
      startAutoScroll(isLoading ? { force: true } : undefined)
      return
    }
    if (lastMessageKey !== lastSeenMessageKeyRef.current) {
      setShowScrollToBottom(true)
    }
  }, [isLoading, lastMessageKey, startAutoScroll])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = settings.density

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const computeDark = () => {
      if (settings.theme === 'dark') return true
      if (settings.theme === 'light') return false
      return media?.matches ?? false
    }
    const apply = () => {
      const isDark = computeDark()
      root.classList.toggle('dark', isDark)

      const color = settings.themeColor || 'zinc'
      const theme = THEMES[color]
      if (theme) {
        const vars = isDark ? theme.cssVars.dark : theme.cssVars.light
        Object.entries(vars).forEach(([key, value]) => {
          const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
          root.style.setProperty(cssVar, value)
        })
      }
    }
    apply()
    if (!media) return
    const listener = () => apply()
    if (media.addEventListener) media.addEventListener('change', listener)
    else media.addListener(listener)
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', listener)
      else media.removeListener(listener)
    }
  }, [settings.theme, settings.density, settings.themeColor])

  const playStreamingTick = () => {
    if (!settings.enableStreamingSoundEffects) return
    const now = performance.now()
    if (now - lastSoundAtRef.current < 120) return
    lastSoundAtRef.current = now

    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor()
    }
    const ctx = audioContextRef.current
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.015
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.03)
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (typingTimerRef.current) {
      window.clearInterval(typingTimerRef.current)
      typingTimerRef.current = null
    }
    if (compressionTypingTimerRef.current) {
      window.clearInterval(compressionTypingTimerRef.current)
      compressionTypingTimerRef.current = null
    }
  }

  const handleTabComplete = useCallback(
    async (
      rawInput: string,
      mode: 'complete' | 'translate' | 'spell_suggest' = 'complete',
      options?: { clickedWord?: string }
    ): Promise<TabCompleteResult | null> => {
      const input = String(rawInput || '')
      if (!input.trim()) return null
      const composerPayload = buildComposerPayload()
      if (mode === 'complete' && composerPayload.completionEnabled === false) return null
      if (mode === 'translate' && composerPayload.completionTranslateEnabled === false) return null
      if (mode === 'spell_suggest' && (composerPayload as any).completionSpellSuggestEnabled === false) return null

      const completionProviderId = String(composerPayload.completionProviderId || '').trim()
      const completionProvider = completionProviderId
        ? providers.find((p) => String(p.id || '').trim() === completionProviderId)
        : effectiveProvider
      const timeoutMs = isOllamaLikeProviderCandidate(completionProvider) ? 3200 : 1800

      const controller = new AbortController()
      const timer = window.setTimeout(() => controller.abort(), timeoutMs)
      try {
        const baseUrl = await resolveBackendBaseUrl()
        const res = await fetch(`${baseUrl}/api/composer/tab_complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            input,
            chatId: composerPayload.chatId,
            composer: composerPayload,
            contextLimit: composerPayload.completionContextLimit,
            tabMode: mode,
            translateEnabled: mode === 'translate',
            clickedWord: String(options?.clickedWord || '').trim() || undefined
          })
        })
        const text = await res.text()
        if (!res.ok) return null
        const data = text ? JSON.parse(text) : {}
        const modeRaw = String((data as any)?.mode || '').trim().toLowerCase()
        const resolvedMode: TabCompleteResult['mode'] =
          modeRaw === 'translate' || modeRaw === 'complete' || modeRaw === 'spell_suggest' ? modeRaw : mode
        const candidates = Array.isArray((data as any)?.candidates)
          ? (data as any).candidates.map((x: any) => String(x || '').trim()).filter(Boolean)
          : []
        if (resolvedMode === 'spell_suggest') {
          if (!candidates.length) return null
          return {
            mode: resolvedMode,
            text: candidates[0] || '',
            candidates
          }
        }
        const out = String((data as any)?.text || '').trim()
        if (!out) return null
        return {
          mode: resolvedMode,
          text: out,
          candidates: candidates.length ? candidates : undefined
        }
      } catch {
        return null
      } finally {
        window.clearTimeout(timer)
      }
    },
    [buildComposerPayload, effectiveProvider, providers]
  )

  const ensureActiveChatForCurrentContext = useCallback(async (): Promise<string> => {
    const stateNow = useStore.getState()
    const projectsNow = Array.isArray((stateNow.settings as any)?.projects) ? ((stateNow.settings as any).projects as any[]) : []
    const activeProjectId = String(stateNow.ui.activeProjectId || '').trim()
    const hasActiveProject = Boolean(activeProjectId) && projectsNow.some((p: any) => String(p?.id || '').trim() === activeProjectId)
    if (hasActiveProject) {
      return String(await ensureActiveChatInProject(activeProjectId)).trim()
    }
    const existingChatId = String(stateNow.activeChatId || '').trim()
    if (existingChatId && stateNow.chats.some((c: any) => String(c?.id || '').trim() === existingChatId)) {
      return existingChatId
    }
    await createChat({ expandSidebar: false })
    return String(useStore.getState().activeChatId || '').trim()
  }, [createChat, ensureActiveChatInProject])

  const handleSend = async (
    rawText: string,
    opts?: {
      skipUserMessage?: boolean
      dangerousCommandApprovals?: string[]
      dangerousCommandAllowForThread?: boolean
      resumeFromThread?: boolean
      resumeRunId?: string
      resumeApprovalId?: string
      resumeDecision?: 'approve_once' | 'approve_thread' | 'reject'
      turnIdOverride?: string
    }
  ): Promise<boolean> => {
    const trimmed = String(rawText || '').trim()
    const resumeFromThread = Boolean(opts?.resumeFromThread)
    const resumeRunId = String(opts?.resumeRunId || '').trim()
    const isRunResume = Boolean(resumeRunId)
    if ((!trimmed && !resumeFromThread && !isRunResume) || isLoading) return false
    
    const isAcpProvider = String(effectiveProvider?.type || '').trim() === 'acp'
    if (!effectiveProvider) {
      openSettings()
      return false
    }

    const ensuredChatId = String(await ensureActiveChatForCurrentContext()).trim()
    if (!ensuredChatId) return false

    const userMessage = trimmed
    const userAttachments = composer.attachments.map((a) => ({ path: a.path }))
    const userAttachmentsWorkspaceDir = resolveWorkspaceDir()
    setIsLoading(true)
    const controller = new AbortController()
    abortControllerRef.current = controller

    const turnId = String(opts?.turnIdOverride || '').trim() || crypto.randomUUID()
    let currentAssistantId = crypto.randomUUID()

    const speakAssistantIfNeeded = async (content: string) => {
      const curSettings = useStore.getState().settings as any
      const tts = (curSettings?.tts || {}) as any
      if (!tts || !tts.enabled || !tts.autoPlay) return
      const provider = String(tts.provider || 'macos_say').trim()
      const text = toTtsSpeakText(content)
      if (!text) return
      try {
        await fetchBackendJson<{ ok: boolean }>('/api/tts/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            model: String(tts.model || ''),
            endpoint: String(tts.endpoint || ''),
            apiKey: String(tts.apiKey || ''),
            qwenModel: String(tts.qwenModel || ''),
            qwenLanguageType: String(tts.qwenLanguageType || ''),
            qwenMode: String(tts.qwenMode || 'endpoint'),
            qwenLocalModelId: String(tts.qwenLocalModelId || ''),
            qwenLocalEndpoint: String(tts.qwenLocalEndpoint || ''),
            speed: Number(tts.speed || 1),
            pitch: Number(tts.pitch || 1),
            volume: Number(tts.volume || 1),
            text,
            localModels: Array.isArray(tts.localModels) ? tts.localModels : []
          })
        })
      } catch (e) {
        console.warn('TTS auto play failed', e)
      }
    }

    const updateLastMessage = (content: string, meta?: any) => {
      const { updateMessageById, activeChatId } = useStore.getState()
      if (activeChatId) {
        updateMessageById(activeChatId, currentAssistantId, { content, meta })
      }
    }
    const assignMemoryInjectionToTurnFirstAssistant = (injection: MemoryInjectionSummary | null) => {
      if (!injection || !injection.items.length) return
      const { messages, activeChatId, updateMessageById, persistMessageById } = useStore.getState()
      const firstAssistant = messages.find((m: any) => m?.role === 'assistant' && String(m?.turnId || '') === String(turnId || ''))
      const msgId = String(firstAssistant?.id || '').trim()
      if (!msgId) return
      const nextMeta = { ...(firstAssistant?.meta || {}), memoryInjection: injection }
      if (activeChatId) {
        updateMessageById(activeChatId, msgId, { meta: nextMeta } as any)
        void persistMessageById(activeChatId, msgId, String(firstAssistant?.content || ''), nextMeta as any)
      }
    }
    const persistCurrentAssistantMessage = async (content: string, meta?: Message['meta']) => {
      const { activeChatId, persistMessageById } = useStore.getState()
      if (!activeChatId) return
      await persistMessageById(activeChatId, currentAssistantId, content, meta)
    }
    const runSend = async () => {
      const composerPayload = buildComposerPayload({
        dangerousCommandApprovals: opts?.dangerousCommandApprovals || [],
        dangerousCommandAllowForThread: opts?.dangerousCommandAllowForThread
      })

      if (!opts?.skipUserMessage) {
        addMessage({
          role: 'user',
          content: userMessage,
          turnId,
          meta: userAttachments.length ? { userAttachments, userAttachmentsWorkspaceDir } : undefined
        } as any)
      }
      if (!opts?.skipUserMessage && composer.attachments.length) updateComposer({ attachments: [] })
      userScrollLockedRef.current = false
      chatIsAtBottomRef.current = true
      setChatIsAtBottom(true)
      setShowScrollToBottom(false)
      window.requestAnimationFrame(() => {
        const el = chatScrollRef.current
        if (el) {
          markProgrammaticScroll()
          el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
        }
        startAutoScroll({ force: true })
      })

      try {
        // Add placeholder for assistant
        addMessage({
          id: currentAssistantId,
          role: 'assistant',
          content: '',
          turnId,
          meta: shouldShowAnalysis ? { reasoningStatus: 'pending', reasoningText: '' } : undefined
        } as any)

        const runMessages = (resumeFromThread || isRunResume) ? [] : [{ role: 'user' as const, content: userMessage }]
        const threadId = ensuredChatId || turnId

      if (settings.enableStreamingResponse) {
        let fullContent = ''
        let pendingContent = ''
        let typingDone: Promise<void> | null = null
        let typingDoneResolve: (() => void) | null = null

        let usage: BackendUsage | null = null
        let traces: ToolTrace[] = []
        let assistantMeta: NonNullable<Message['meta']> = shouldShowAnalysis ? { reasoningStatus: 'pending', reasoningText: '' } : {}
        let reasoningText = ''
        let dangerousApprovalFromTrace: DangerousCommandApprovalPayload | null = null
        let gotDone = false
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
        let latestAssistantStep: number | null = null
        let compressionMsgId: string | null = null
        let compressionSeenStart = false
        let compressionEnded = false
        let compressionFullContent = ''
        let compressionPendingContent = ''
        const traceMessageIds: Record<string, string> = {}

        const stopTyping = () => {
          if (typingTimerRef.current != null) {
            window.clearInterval(typingTimerRef.current)
            typingTimerRef.current = null
          }
          if (typingDoneResolve) {
            typingDoneResolve()
            typingDoneResolve = null
            typingDone = null
          }
        }

        const startTyping = () => {
          if (typingTimerRef.current != null) return
          if (!typingDone) {
            typingDone = new Promise<void>((resolve) => {
              typingDoneResolve = resolve
            })
          }
          typingTimerRef.current = window.setInterval(() => {
            if (!pendingContent) {
              stopTyping()
              return
            }
            const charsPerTick = gotDone ? 6 : 1
            const part = pendingContent.slice(0, charsPerTick)
            pendingContent = pendingContent.slice(charsPerTick)
            fullContent += part
            playStreamingTick()
            updateLastMessage(fullContent)
          }, 12)
        }

        const normalizeStep = (raw: unknown): number | null => {
          const n = Number(raw)
          return Number.isFinite(n) ? n : null
        }

        const handleAssistantStep = (rawStep: unknown) => {
          const step = normalizeStep(rawStep)
          if (step == null) return
          if (latestAssistantStep == null) {
            latestAssistantStep = step
            return
          }
          if (step <= latestAssistantStep) return
          latestAssistantStep = step
          const hasCurrentAssistantBody = Boolean(
            String(fullContent || '').trim() ||
            String(pendingContent || '').trim() ||
            String(reasoningText || '').trim()
          )
          if (!hasCurrentAssistantBody) return
          stopTyping()
          updateLastMessage(fullContent, assistantMeta)
          const { activeChatId, persistMessageById } = useStore.getState()
          if (activeChatId) {
            void persistMessageById(activeChatId, currentAssistantId, fullContent, assistantMeta)
          }
          const newAssistantId = crypto.randomUUID()
          currentAssistantId = newAssistantId
          fullContent = ''
          pendingContent = ''
          reasoningText = ''
          assistantMeta = shouldShowAnalysis ? { reasoningStatus: 'pending', reasoningText: '' } : {}
          addMessage({
            id: newAssistantId,
            role: 'assistant',
            content: '',
            turnId,
            meta: shouldShowAnalysis ? { reasoningStatus: 'pending', reasoningText: '' } : undefined
          } as any)
        }

        const stopCompressionTyping = () => {
          if (compressionTypingTimerRef.current != null) {
            window.clearInterval(compressionTypingTimerRef.current)
            compressionTypingTimerRef.current = null
          }
        }

        const startCompressionTyping = () => {
          if (compressionTypingTimerRef.current != null) return
          compressionTypingTimerRef.current = window.setInterval(() => {
            if (!compressionPendingContent) {
              stopCompressionTyping()
              return
            }
            const charsPerTick = compressionEnded ? 10 : 2
            const part = compressionPendingContent.slice(0, charsPerTick)
            compressionPendingContent = compressionPendingContent.slice(charsPerTick)
            compressionFullContent += part
            ensureCompressionMsg('running', compressionFullContent)
          }, 12)
        }

        const upsertTrace = (trace: ToolTrace) => {
          if (
            trace.name === 'bash' &&
            trace.status === 'failed' &&
            !dangerousApprovalFromTrace &&
            typeof trace.error?.message === 'string'
          ) {
            const parsed = parseDangerousCommandApproval(trace.error.message)
            if (parsed) {
              dangerousApprovalFromTrace = parsed
              return
            }
          }
          const { updateMessageById, activeChatId, addMessage, persistMessageById, messages } = useStore.getState()
          
          let msgId = traceMessageIds[trace.id]
          if (!msgId) {
            const existingByTraceId = messages.find((m: any) => {
              if (m?.role !== 'tool') return false
              if (String(m?.turnId || '') !== String(turnId || '')) return false
              const list = Array.isArray(m?.meta?.toolTraces) ? m.meta.toolTraces : []
              return list.some((x: any) => String(x?.id || '') === String(trace.id || ''))
            })
            const existingId = String(existingByTraceId?.id || '').trim()
            if (existingId) {
              msgId = existingId
              traceMessageIds[trace.id] = existingId
            }
          }
          if (!msgId) {
            const incomingSig = toolTraceSignature(trace)
            if (incomingSig) {
              const existingRunningMsg = [...messages]
                .reverse()
                .find((m: any) => {
                  if (m?.role !== 'tool') return false
                  if (String(m?.turnId || '') !== String(turnId || '')) return false
                  const list = Array.isArray(m?.meta?.toolTraces) ? m.meta.toolTraces : []
                  return list.some((x: any) => String(x?.status || '') === 'running' && toolTraceSignature(x) === incomingSig)
                })
              const existingId = String(existingRunningMsg?.id || '').trim()
              if (existingId) {
                msgId = existingId
                traceMessageIds[trace.id] = existingId
              }
            }
          }
          if (msgId) {
             const existing = messages.find((m) => m.id === msgId)
             const nextMeta = { ...(existing?.meta || {}), toolTraces: [trace] }
             updateMessageById(activeChatId || '', msgId, {
               meta: nextMeta
             })
             if (activeChatId && trace.status !== 'running') {
               void persistMessageById(activeChatId, msgId, existing?.content || '', nextMeta)
             }
          } else {
             updateLastMessage(fullContent, assistantMeta)
             if (activeChatId) {
               void persistMessageById(activeChatId, currentAssistantId, fullContent, assistantMeta)
             }

             msgId = crypto.randomUUID()
             traceMessageIds[trace.id] = msgId
             
             addMessage({
               id: msgId,
               role: 'tool',
               content: '',
               turnId,
               meta: { toolTraces: [trace] }
             } as any)
          }

          updateLastMessage(fullContent, assistantMeta)
        }

        const ensureCompressionMsg = (state: 'running' | 'done', content?: string) => {
          const { insertMessageBefore, updateMessageById, activeChatId, messages } = useStore.getState()
          const cid = String(activeChatId || '').trim()
          if (!cid) return
          if (!compressionMsgId) {
            compressionMsgId = crypto.randomUUID()
            insertMessageBefore(currentAssistantId, {
              id: compressionMsgId,
              role: 'assistant',
              content: content || '',
              turnId,
              meta: { compressionState: state }
            } as any)
            return
          }
          const existing = messages.find((m) => m.id === compressionMsgId)
          const nextMeta = { ...(existing?.meta || {}), compressionState: state }
          updateMessageById(cid, compressionMsgId, { content: typeof content === 'string' ? content : existing?.content || '', meta: nextMeta } as any)
        }

        let shouldRunProvider = !isAcpProvider
        if (isAcpProvider) {
          try {
            const acp = (effectiveProvider as any)?.config?.acp || {}
            const command = String(acp.command || '').trim()
            if (!command) throw new Error('ACP provider command is not configured')
            const createRes = await window.anima.acp.createSession({
              workspaceDir: composerPayload.workspaceDir,
              threadId,
              permissionMode: composerPayload.permissionMode,
              agent: {
                id: String(effectiveProvider?.id || '').trim(),
                name: String(effectiveProvider?.name || effectiveProvider?.id || 'ACP').trim(),
                kind: String(acp.kind || 'native_acp').trim() as any,
                command,
                args: Array.isArray(acp.args) ? acp.args.map((x: any) => String(x)) : [],
                env: acp.env && typeof acp.env === 'object' ? acp.env : {},
                framing: String(acp.framing || 'auto').trim() as any
              },
              approvalMode: String(acp.approvalMode || 'per_action') as any
            })
            if (!createRes?.ok || !createRes.sessionId) throw new Error(String(createRes?.error || 'Failed to create ACP session'))

            const sessionId = String(createRes.sessionId).trim()
            let unsub: (() => void) | null = null

            const donePromise = new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                void window.anima.acp.cancel({ sessionId, runId: turnId }).catch(() => {})
                resolve()
              }
              controller.signal.addEventListener('abort', onAbort, { once: true })

              unsub = window.anima.acp.onEvent(sessionId, (evt: any) => {
                const e = (evt || {}) as {
                  type?: string
                  content?: string
                  stage?: string
                  step?: number
                  reasoning?: string
                  usage?: BackendUsage
                  rateLimit?: BackendRateLimit
                  traces?: ToolTrace[]
                  artifacts?: Artifact[]
                  memoryInjection?: MemoryInjectionSummary
                  trace?: ToolTrace
                  ok?: boolean
                  error?: string
                }
                if (e.type === 'delta' && typeof e.content === 'string' && e.content) {
                  handleAssistantStep(e.step)
                  pendingContent += e.content
                  startTyping()
                  return
                }
                if (e.type === 'stage' && typeof e.stage === 'string' && e.stage) {
                  assistantMeta = { ...assistantMeta, stage: e.stage }
                  updateLastMessage(fullContent, assistantMeta)
                  return
                }
                if (e.type === 'reasoning_delta' && typeof e.content === 'string' && e.content) {
                  reasoningText += e.content
                  assistantMeta = { ...assistantMeta, reasoningText, reasoningStatus: 'streaming' }
                  updateLastMessage(fullContent, assistantMeta)
                  return
                }
                if (e.type === 'reasoning' && typeof e.content === 'string' && e.content.trim()) {
                  reasoningText = reasoningText ? `${reasoningText}\n\n${e.content.trim()}` : e.content.trim()
                  assistantMeta = { ...assistantMeta, reasoningText, reasoningStatus: 'streaming' }
                  updateLastMessage(fullContent, assistantMeta)
                  return
                }
                if (e.type === 'trace' && e.trace) {
                  upsertTrace(e.trace)
                  if (dangerousApprovalFromTrace) {
                    void window.anima.acp.cancel({ sessionId, runId: turnId }).catch(() => {})
                    resolve()
                  }
                  return
                }
                if (e.type === 'error') {
                  const err = typeof e.error === 'string' && e.error.trim() ? e.error.trim() : appRuntimeText.unknownError
                  reject(new Error(err))
                  return
                }
                if (e.type === 'done') {
                  usage = e.usage || null
                  const memoryInjection = parseMemoryInjection(e.memoryInjection)
                  if (e.rateLimit && Object.keys(e.rateLimit).length) {
                    assistantMeta = { ...assistantMeta, rateLimit: e.rateLimit }
                  }
                  if (memoryInjection) {
                    assistantMeta = { ...assistantMeta, memoryInjection }
                    assignMemoryInjectionToTurnFirstAssistant(memoryInjection)
                  }
                  if (Array.isArray(e.artifacts)) {
                    assistantMeta = { ...assistantMeta, artifacts: e.artifacts }
                  }
                  if (Array.isArray(e.traces)) {
                    traces = e.traces
                    for (const trace of e.traces) {
                      if (!trace || trace.status === 'running') continue
                      upsertTrace(trace)
                    }
                    assistantMeta = {
                      ...assistantMeta,
                      reasoningSummary: deriveReasoningSummaryFromTraces(traces) ?? assistantMeta.reasoningSummary
                    }
                  }
                  if (typeof e.reasoning === 'string' && e.reasoning.trim()) {
                    reasoningText = reasoningText ? reasoningText : e.reasoning.trim()
                    assistantMeta = { ...assistantMeta, reasoningText }
                  }
                  if (shouldShowAnalysis || reasoningText.trim()) {
                    assistantMeta = { ...assistantMeta, reasoningStatus: 'done' }
                  }
                  assistantMeta = { ...assistantMeta, stage: undefined }
                  gotDone = true
                  resolve()
                }
              })
            })

            const startRes = await window.anima.acp.prompt({ sessionId, prompt: userMessage, runId: turnId })
            if (!startRes?.ok) throw new Error(String(startRes?.error || 'Failed to start ACP prompt'))
            await donePromise.finally(() => {
              try {
                unsub?.()
              } catch {
                //
              }
            })
          } catch (e: any) {
            throw e
          }
        }

        if (shouldRunProvider) {
          const baseUrl = await resolveBackendBaseUrl()
          const resumePath = isRunResume ? `/api/runs/${encodeURIComponent(resumeRunId)}/resume?stream=1` : '/api/runs?stream=1'
          const res = await fetch(`${baseUrl}${resumePath}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(
                    isRunResume
                      ? {
                          approvalId: String(opts?.resumeApprovalId || '').trim(),
                          decision: String(opts?.resumeDecision || 'approve_once').trim(),
                          composer: composerPayload,
                          temperature: settings.temperature,
                          maxTokens: settings.maxTokens
                        }
                      : {
                          messages: runMessages,
                          composer: composerPayload,
                          temperature: settings.temperature,
                          maxTokens: settings.maxTokens,
                          runId: turnId,
                          threadId,
                          useThreadMessages: true
                        }
                  ),
                  signal: controller.signal
                })
          if (!res.ok) {
            const text = await res.text()
            const data = text ? JSON.parse(text) : null
            const msg = data?.error || `HTTP ${res.status}`
            throw new Error(String(msg))
          }

          reader = res.body?.getReader() || null
          if (!reader) throw new Error('Streaming unavailable')

          const decoder = new TextDecoder()
          let buf = ''
          let reading = true
          while (reading) {
            const { value, done } = await reader.read()
            if (done) {
              reading = false
              break
            }
            buf += decoder.decode(value, { stream: true })
            let scanning = true
            while (scanning) {
              const idx = buf.indexOf('\n\n')
              if (idx < 0) {
                scanning = false
                break
              }
              const chunk = buf.slice(0, idx)
              buf = buf.slice(idx + 2)
              const lines = chunk.split('\n')
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue
                const jsonText = line.slice('data: '.length).trim()
                if (!jsonText) continue
                const evt = JSON.parse(jsonText) as {
                  type?: string
                  runId?: string
                  content?: string
                  stage?: string
                  step?: number
                  reasoning?: string
                  usage?: BackendUsage
                  rateLimit?: BackendRateLimit
                  traces?: ToolTrace[]
                  artifacts?: Artifact[]
                  memoryInjection?: MemoryInjectionSummary
                  trace?: ToolTrace
                  approval?: {
                    code?: string
                    command?: string
                    matchedPattern?: string
                    approvalId?: string
                  }
                  mode?: string
                  summaryPreview?: string
                  summaryUpdatedAt?: number
                  summarizedUntilMessageId?: string
                  summary?: string
                  ok?: boolean
                  error?: string
                }
                if (evt.type === 'delta' && typeof evt.content === 'string' && evt.content) {
                  handleAssistantStep(evt.step)
                  pendingContent += evt.content
                  startTyping()
                } else if (evt.type === 'run') {
                  continue
                } else if (evt.type === 'approval_required' && evt.approval) {
                  const command = String(evt.approval.command || '').trim()
                  if (command) {
                    dangerousApprovalFromTrace = {
                      code: String(evt.approval.code || '').trim() || 'dangerous_command_requires_approval',
                      command,
                      matchedPattern: String(evt.approval.matchedPattern || '').trim() || undefined,
                      runId: String(evt.runId || resumeRunId || '').trim() || undefined,
                      approvalId: String(evt.approval.approvalId || '').trim() || undefined
                    }
                    scanning = false
                    reading = false
                    break
                  }
                } else if (evt.type === 'stage' && typeof evt.stage === 'string' && evt.stage) {
                  assistantMeta = { ...assistantMeta, stage: evt.stage }
                  updateLastMessage(fullContent, assistantMeta)
                } else if (evt.type === 'reasoning_delta' && typeof evt.content === 'string' && evt.content) {
                  reasoningText += evt.content
                  assistantMeta = { ...assistantMeta, reasoningText, reasoningStatus: 'streaming' }
                  updateLastMessage(fullContent, assistantMeta)
                } else if (evt.type === 'reasoning' && typeof evt.content === 'string' && evt.content.trim()) {
                  reasoningText = reasoningText ? `${reasoningText}\n\n${evt.content.trim()}` : evt.content.trim()
                  assistantMeta = { ...assistantMeta, reasoningText, reasoningStatus: 'streaming' }
                  updateLastMessage(fullContent, assistantMeta)
                } else if (evt.type === 'trace' && evt.trace) {
                  upsertTrace(evt.trace)
                } else if (evt.type === 'error') {
                  const err = typeof evt.error === 'string' && evt.error.trim() ? evt.error.trim() : appRuntimeText.unknownError
                  throw new Error(err)
                } else if (evt.type === 'compression_start') {
                  compressionSeenStart = true
                  compressionEnded = false
                  compressionFullContent = ''
                  compressionPendingContent = ''
                  stopCompressionTyping()
                  ensureCompressionMsg('running', '')
                } else if (evt.type === 'compression_delta' && typeof evt.content === 'string' && evt.content) {
                  compressionPendingContent += evt.content
                  startCompressionTyping()
                } else if (evt.type === 'compression_end') {
                  compressionEnded = true
                  stopCompressionTyping()
                  compressionPendingContent = ''
                  const ok = evt.ok !== false
                  if (ok) {
                    if (typeof evt.summary === 'string') compressionFullContent = evt.summary
                  } else {
                    const err = typeof evt.error === 'string' && evt.error.trim() ? evt.error.trim() : appRuntimeText.unknownError
                    compressionFullContent = appRuntimeText.compressionFailed.replace('{error}', err)
                  }
                  ensureCompressionMsg('done', compressionFullContent)
                  if (ok) {
                    const cid = String(activeChatId || '').trim()
                    if (cid) {
                      void (async () => {
                        try {
                          const res = await fetchBackendJson<{ ok: boolean; compression?: any }>(`/api/chats/${cid}/summary?t=${Date.now()}`, { method: 'GET', cache: 'no-store' })
                          if (res && (res as any).compression) {
                            updateChat(cid, { meta: { compression: (res as any).compression } })
                          }
                        } catch {
                          return
                        }
                      })()
                    }
                  }
                } else if (evt.type === 'done') {
                  if (compressionSeenStart && !compressionEnded) ensureCompressionMsg('done', compressionFullContent)
                  usage = evt.usage || null
                  const memoryInjection = parseMemoryInjection(evt.memoryInjection)
                  if (evt.rateLimit && Object.keys(evt.rateLimit).length) {
                    assistantMeta = { ...assistantMeta, rateLimit: evt.rateLimit }
                  }
                  if (memoryInjection) {
                    assistantMeta = { ...assistantMeta, memoryInjection }
                    assignMemoryInjectionToTurnFirstAssistant(memoryInjection)
                  }
                  if (Array.isArray(evt.artifacts)) {
                    assistantMeta = { ...assistantMeta, artifacts: evt.artifacts }
                  }
                  if (Array.isArray(evt.traces)) {
                    traces = evt.traces
                    for (const trace of evt.traces) {
                      if (!trace || trace.status === 'running') continue
                      upsertTrace(trace)
                    }
                    assistantMeta = {
                      ...assistantMeta,
                      reasoningSummary: deriveReasoningSummaryFromTraces(traces) ?? assistantMeta.reasoningSummary
                    }
                  }
                  if (typeof evt.reasoning === 'string' && evt.reasoning.trim()) {
                    reasoningText = reasoningText ? reasoningText : evt.reasoning.trim()
                    assistantMeta = { ...assistantMeta, reasoningText }
                  }
                  if (shouldShowAnalysis || reasoningText.trim()) {
                    assistantMeta = { ...assistantMeta, reasoningStatus: 'done' }
                  }
                  assistantMeta = { ...assistantMeta, stage: undefined }
                  gotDone = true
                  scanning = false
                  reading = false
                }
              }
            }
          }
        }
        stopCompressionTyping()
        const dangerousApproval = dangerousApprovalFromTrace as DangerousCommandApprovalPayload | null
        if (dangerousApproval) {
          stopTyping()
          if (reader) await reader.cancel().catch(() => {})
          if (!String(dangerousApproval.runId || '').trim()) {
            dangerousApproval.runId = String(turnId || '').trim() || undefined
          }
          addDangerousApprovalMessage(dangerousApproval, turnId)
          return
        }
        if (compressionSeenStart && !compressionEnded) ensureCompressionMsg('done', compressionFullContent)
        if (gotDone) {
          if (reader) {
            await reader.cancel().catch(() => {})
          }
        } else {
          if (shouldShowAnalysis || assistantMeta.reasoningStatus === 'streaming' || assistantMeta.reasoningText) {
            assistantMeta = { ...assistantMeta, reasoningStatus: 'done' }
            updateLastMessage(fullContent, assistantMeta)
          }
        }

        const waitTyping = typingDone
        if (waitTyping) {
          const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
          await Promise.race([waitTyping, timeout])
        }
        if (pendingContent) {
          fullContent += pendingContent
          pendingContent = ''
          updateLastMessage(fullContent, assistantMeta)
        }
        stopTyping()

        if (usage) {
          assistantMeta = {
            ...assistantMeta,
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0
          }
        }
        updateLastMessage(fullContent, assistantMeta)
        await persistCurrentAssistantMessage(fullContent, assistantMeta)
        await speakAssistantIfNeeded(fullContent)
      } else {
        const baseUrl = await resolveBackendBaseUrl()
        const resumeRunId = String(opts?.resumeRunId || '').trim()
        const isRunResume = Boolean(resumeRunId)
        const resumePath = isRunResume ? `/api/runs/${encodeURIComponent(resumeRunId)}/resume` : '/api/runs'
        const res = await fetch(`${baseUrl}${resumePath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isRunResume
              ? {
                  approvalId: String(opts?.resumeApprovalId || '').trim(),
                  decision: String(opts?.resumeDecision || 'approve_once').trim(),
                  composer: composerPayload,
                  temperature: settings.temperature,
                  maxTokens: settings.maxTokens
                }
              : {
                  messages: runMessages,
                  composer: composerPayload,
                  temperature: settings.temperature,
                  maxTokens: settings.maxTokens,
                  runId: turnId,
                  threadId,
                  useThreadMessages: true
                }
          ),
          signal: controller.signal
        })
        
        if (!res.ok) {
          const text = await res.text()
          const data = text ? JSON.parse(text) : null
          if (res.status === 409 && String(data?.code || '').trim() === 'approval_required' && data?.approval) {
            const command = String(data.approval.command || '').trim()
            if (command) {
              addDangerousApprovalMessage(
                {
                  code: String(data.approval.code || '').trim() || 'dangerous_command_requires_approval',
                  command,
                  matchedPattern: String(data.approval.matchedPattern || '').trim() || undefined,
                  runId: String(data.runId || resumeRunId || '').trim() || undefined,
                  approvalId: String(data.approval.approvalId || '').trim() || undefined
                },
                turnId
              )
              return
            }
          }
          const msg = data?.error || `HTTP ${res.status}`
          throw new Error(String(msg))
        }

        const data = await res.json() as {
          ok: boolean
          runId?: string
          content?: string
          usage?: BackendUsage
          rateLimit?: BackendRateLimit
          traces?: ToolTrace[]
          artifacts?: Artifact[]
          reasoning?: string
          memoryInjection?: MemoryInjectionSummary
        }
        
        const content = typeof data.content === 'string' ? data.content : ''
        const usage = data.usage
        const rateLimit = data.rateLimit
        const traces = Array.isArray(data.traces) ? data.traces : []
        const artifacts = Array.isArray(data.artifacts) ? data.artifacts : []
        const memoryInjection = parseMemoryInjection(data.memoryInjection)

        const dangerousTrace = traces.find((tr) => {
          if (tr?.name !== 'bash' || tr?.status !== 'failed') return false
          return Boolean(parseDangerousCommandApproval(tr?.error?.message))
        })
        if (dangerousTrace) {
          const parsed = parseDangerousCommandApproval(dangerousTrace?.error?.message)
          if (parsed) {
            parsed.runId = String(data.runId || '').trim() || parsed.runId
            addDangerousApprovalMessage(parsed, turnId)
            return
          }
        }

        // 非流式工具轨迹与流式保持一致：直接追加 tool 消息并持久化，避免刷新后丢失。
        const { addMessage } = useStore.getState()
        for (const trace of traces) {
          const msgId = crypto.randomUUID()
          addMessage({
            id: msgId,
            role: 'tool',
            content: '',
            turnId,
            meta: { toolTraces: [trace] }
          } as any)
        }

        const reasoning = typeof data.reasoning === 'string' && data.reasoning.trim() ? data.reasoning : undefined
        const assistantMeta: Message['meta'] | undefined =
          usage || (rateLimit && Object.keys(rateLimit).length) || Boolean(reasoning) || shouldShowAnalysis || artifacts.length > 0 || Boolean(memoryInjection)
            ? {
                promptTokens: usage ? usage?.prompt_tokens ?? 0 : undefined,
                completionTokens: usage ? usage?.completion_tokens ?? 0 : undefined,
                totalTokens: usage ? usage?.total_tokens ?? 0 : undefined,
                rateLimit: rateLimit && Object.keys(rateLimit).length ? rateLimit : undefined,
                reasoningSummary: deriveReasoningSummaryFromTraces(traces),
                reasoningText: reasoning,
                reasoningStatus: shouldShowAnalysis ? 'done' : reasoning ? 'done' : undefined,
                artifacts: artifacts.length ? artifacts : undefined,
                memoryInjection: memoryInjection || undefined
              }
            : undefined
        if (memoryInjection) {
          assignMemoryInjectionToTurnFirstAssistant(memoryInjection)
        }
        updateLastMessage(content, assistantMeta)
        await persistCurrentAssistantMessage(content, assistantMeta)
        await speakAssistantIfNeeded(content)
      }
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return
      }
      console.error(error)
      const errMsg = error instanceof Error ? error.message : String(error)
      updateLastMessage(
        String(effectiveProvider?.type || '').trim() === 'acp'
          ? `Error: ${errMsg}\n\nPlease check the ACP provider command, arguments, and workspace settings.`
          : t.proxyOrKeyError(errMsg)
      )
      await persistCurrentAssistantMessage(
        String(effectiveProvider?.type || '').trim() === 'acp'
          ? `Error: ${errMsg}\n\nPlease check the ACP provider command, arguments, and workspace settings.`
          : t.proxyOrKeyError(errMsg)
      )
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
    }

    void runSend()
    return true
  }

  const builtinSlashCommands = useMemo<SlashCommandEntry[]>(() => {
    return [
      { id: 'builtin:new', name: 'new', title: '/new', description: slashText.newDesc, source: 'builtin', kind: 'action' },
      { id: 'builtin:status', name: 'status', title: '/status', description: slashText.statusDesc, source: 'builtin', kind: 'action' },
      { id: 'builtin:mcp', name: 'mcp', title: '/mcp', description: slashText.mcpDesc, source: 'builtin', kind: 'action' },
      { id: 'builtin:coder-status', name: 'coder-status', title: '/coder-status', description: slashText.coderStatusDesc, source: 'builtin', kind: 'action' },
      { id: 'builtin:coder-start', name: 'coder-start', title: '/coder-start', description: slashText.coderStartDesc, source: 'builtin', kind: 'action' },
      { id: 'builtin:coder-stop', name: 'coder-stop', title: '/coder-stop', description: slashText.coderStopDesc, source: 'builtin', kind: 'action' }
    ]
  }, [slashText])

  const slashCommands = useMemo(() => {
    const merged = new Map<string, SlashCommandEntry>()
    for (const command of builtinSlashCommands) merged.set(command.name, command)
    for (const command of bundledSlashCommands) merged.set(command.name, command)
    for (const command of projectSlashCommands) merged.set(command.name, command)
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [builtinSlashCommands, bundledSlashCommands, projectSlashCommands])

  const effectiveEnabledSkillIds = useMemo(() => {
    const fromComposer = Array.isArray(composer.enabledSkillIds) ? composer.enabledSkillIds : []
    if (fromComposer.length) return fromComposer.map((x) => String(x || '').trim()).filter(Boolean)
    const fromSettings = Array.isArray(settings.skillsEnabledIds) ? settings.skillsEnabledIds : []
    return fromSettings.map((x) => String(x || '').trim()).filter(Boolean)
  }, [composer.enabledSkillIds, settings.skillsEnabledIds])

  const slashSkills = useMemo(() => {
    const enabledSet = new Set(effectiveEnabledSkillIds)
    const items = (Array.isArray(skillsCache) ? skillsCache : [])
      .map((s) => {
        const id = String((s as any)?.id || '').trim()
        if (!id) return null
        const file = String((s as any)?.file || '').trim()
        const dir = String((s as any)?.dir || '').trim()
        const src = `${file} ${dir}`.toLowerCase()
        const source: 'personal' | 'system' =
          src.includes('/skills/.system/') || src.includes('/.system/') ? 'system' : 'personal'
        return {
          id,
          name: String((s as any)?.name || id).trim() || id,
          description: String((s as any)?.description || '').trim(),
          source,
          isEnabled: enabledSet.has(id)
        }
      })
      .filter((x): x is { id: string; name: string; description: string; source: 'personal' | 'system'; isEnabled: boolean } => Boolean(x))
      .sort((a, b) => {
        if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    return items
  }, [effectiveEnabledSkillIds, skillsCache])

  const appendSlashAssistantMessage = useCallback(async (content: string) => {
    const chatId = String(await ensureActiveChatForCurrentContext()).trim()
    if (!chatId) return false
    addMessage({
      role: 'assistant',
      content,
      meta: { slashCommand: true }
    } as any)
    return true
  }, [addMessage, ensureActiveChatForCurrentContext])

  const handleExecuteSlashCommand = useCallback(async (rawInput: string) => {
    const parsed = parseSlashInput(rawInput)
    if (!parsed?.name) return { handled: false as const }
    const command = slashCommands.find((item) => item.name === parsed.name)
    if (!command) return { handled: false as const }

    const sendPrompt = async (text: string) => {
      const ok = await handleSend(text)
      return ok ? { handled: true as const, clearValue: true as const } : { handled: true as const, clearValue: false as const }
    }

    if (command.kind === 'prompt' && command.template) {
      const rendered = renderSlashCommandTemplate(command.template, {
        args: parsed.args,
        workspace: activeWorkspaceDir
      }).trim()
      const prompt =
        parsed.args && !command.template.includes('{{args}}')
          ? `${rendered}\n\n${parsed.args}`.trim()
          : rendered
      if (!prompt) return { handled: true as const, clearValue: false as const }
      return await sendPrompt(prompt)
    }

    if (command.name === 'new') {
      await createChat()
      return { handled: true as const, clearValue: true as const }
    }

    if (command.name === 'status') {
      const enabledMcpServerIds = composer.enabledMcpServerIds.length ? composer.enabledMcpServerIds : settings.mcpEnabledServerIds
      const enabledMcpNames = (Array.isArray(settings.mcpServers) ? settings.mcpServers : [])
        .filter((item: any) => enabledMcpServerIds.includes(String(item?.id || '')))
        .map((item: any) => String(item?.name || item?.id || '').trim())
        .filter(Boolean)
      const lines = [
        slashText.statusTitle,
        `- ${slashText.statusProject}: ${activeProjectName || '-'}`,
        `- ${slashText.statusWorkspace}: ${activeWorkspaceDir || '-'}`,
        `- ${slashText.statusProvider}: ${String(activeProvider?.name || effectiveProviderId || '-').trim() || '-'}`,
        `- ${slashText.statusModel}: ${String(effectiveModel || '-').trim() || '-'}`,
        `- ${slashText.statusTools}: ${composer.toolMode || settings.defaultToolMode || '-'}`,
        `- ${slashText.statusPermission}: ${permissionMode || '-'}`,
        `- ${slashText.statusSkills}: ${composer.skillMode || settings.defaultSkillMode || '-'}`,
        `- ${slashText.statusMcp}: ${enabledMcpNames.length ? enabledMcpNames.join(', ') : '-'}`
      ]
      const ok = await appendSlashAssistantMessage(lines.join('\n'))
      return { handled: true as const, clearValue: ok as boolean }
    }

    if (command.name === 'mcp') {
      const enabledIds = composer.enabledMcpServerIds.length ? composer.enabledMcpServerIds : settings.mcpEnabledServerIds
      const servers = Array.isArray(settings.mcpServers) ? settings.mcpServers : []
      if (!servers.length) {
        const ok = await appendSlashAssistantMessage(`${slashText.mcpTitle}\n\n${slashText.mcpNone}`)
        return { handled: true as const, clearValue: ok as boolean }
      }
      const enabled = servers
        .filter((item: any) => enabledIds.includes(String(item?.id || '')))
        .map((item: any) => String(item?.name || item?.id || '').trim())
        .filter(Boolean)
      const disabled = servers
        .filter((item: any) => !enabledIds.includes(String(item?.id || '')))
        .map((item: any) => String(item?.name || item?.id || '').trim())
        .filter(Boolean)
      const message = [
        slashText.mcpTitle,
        '',
        `- ${slashText.mcpEnabled}: ${enabled.length ? enabled.join(', ') : '-'}`,
        `- ${slashText.mcpDisabled}: ${disabled.length ? disabled.join(', ') : '-'}`
      ].join('\n')
      const ok = await appendSlashAssistantMessage(message)
      return { handled: true as const, clearValue: ok as boolean }
    }

    if (command.name === 'coder-status') {
      const res = await window.anima?.coder?.status?.()
      const status = res?.ok ? res : { ok: false, error: 'Unavailable' }
      const message = [
        slashText.coderTitle,
        `- ${slashText.coderName}: ${String(status.settings?.name || '-').trim() || '-'}`,
        `- ${slashText.coderRunning}: ${status.running ? 'true' : 'false'}`,
        `- ${slashText.coderPid}: ${status.pid ?? '-'}`,
        `- ${slashText.coderTransport}: ${String(status.settings?.transport || '-').trim() || '-'}`,
        `- ${slashText.coderEndpoint}: ${String(status.settings?.endpointType || '-').trim() || '-'}`,
        `- ${slashText.coderDebugPort}: ${status.debugPortReady ? 'true' : 'false'}`,
        `- ${slashText.coderError}: ${String(status.lastError || status.error || '-').trim() || '-'}`
      ].join('\n')
      const ok = await appendSlashAssistantMessage(message)
      return { handled: true as const, clearValue: ok as boolean }
    }

    if (command.name === 'coder-start') {
      const currentCoder = (useStore.getState().settings as any)?.coder
      const res = await window.anima?.coder?.start?.({ settings: currentCoder })
      const ok = await appendSlashAssistantMessage(
        res?.ok ? slashText.coderStarted : slashText.coderStartFailed(String(res?.error || 'unknown error'))
      )
      return { handled: true as const, clearValue: ok as boolean }
    }

    if (command.name === 'coder-stop') {
      const res = await window.anima?.coder?.stop?.()
      const ok = await appendSlashAssistantMessage(
        res?.ok ? slashText.coderStopped : slashText.coderStopFailed(String(res?.error || 'unknown error'))
      )
      return { handled: true as const, clearValue: ok as boolean }
    }

    return { handled: false as const }
  }, [
    activeProjectName,
    activeProvider?.name,
    activeWorkspaceDir,
    addMessage,
    appendSlashAssistantMessage,
    composer.enabledMcpServerIds,
    composer.skillMode,
    composer.toolMode,
    createChat,
    effectiveModel,
    effectiveProviderId,
    handleSend,
    permissionMode,
    settings.defaultSkillMode,
    settings.defaultToolMode,
    settings.mcpEnabledServerIds,
    settings.mcpServers,
    slashCommands,
    slashText
  ])

  return (
    <div
      className="h-screen w-full overflow-hidden bg-white text-foreground transition-colors duration-300 relative"
      style={{ ['--app-left-pane-width' as any]: `${leftWidth}px` }}
      onDragEnter={handleRootDragEnter}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
    >
      {imageDragActive ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/5">
          <div className="rounded-xl border border-primary/30 bg-background/95 px-4 py-2 text-sm text-primary shadow-sm">
            {i18nText(appLang, 'app.dropImageHint')}
          </div>
        </div>
      ) : null}
      <div className="draggable absolute inset-x-0 top-0 h-2" />
      <div className="flex h-full w-full overflow-hidden gap-0">
        <SettingsDialog />
        <UpdateDialog />
        <Dialog
          open={summaryOpen}
          onOpenChange={(open) => {
            setSummaryOpen(open)
            if (open) void loadChatSummary().catch(() => {})
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{i18nText(appLang, 'app.summaryTitle')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {summaryUpdatedAt != null && (
                <div className="text-xs text-muted-foreground">
                  {i18nText(appLang, 'app.updatedAt', { time: new Date(summaryUpdatedAt).toLocaleString() })}
                </div>
              )}
              <ScrollArea className="h-[420px] rounded-md border p-3">
                {summaryLoading ? (
                  <div className="text-sm text-muted-foreground">{i18nText(appLang, 'app.summaryLoading')}</div>
                ) : !summaryText ? (
                  <div className="text-sm text-muted-foreground">{i18nText(appLang, 'app.summaryEmpty')}</div>
                ) : settings.enableMarkdown ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeRaw]}
                    className="prose prose-sm dark:prose-invert max-w-none prose-p:text-[13px] prose-li:text-[13px] prose-table:text-[13px] prose-p:leading-relaxed prose-li:leading-relaxed prose-headings:font-semibold prose-h1:text-[21px] prose-h1:leading-[1.25] prose-h2:text-[18px] prose-h2:leading-[1.3] prose-h3:text-[16px] prose-h3:leading-[1.35] text-foreground/90"
                    components={{
                      pre: ({ children }) => <>{children}</>,
                      code({ inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '')
                        const lang = match ? match[1] : 'text'
                        const value = String(children).replace(/\n$/, '')
                        const trimmed = value.trim()
                        const displayText = inline ? stripWrappedBackticks(trimmed) : trimmed
                        const isFileToken =
                          !/^https?:\/\//i.test(displayText) &&
                          (displayText.startsWith('file://') ||
                            displayText.startsWith('/') ||
                            displayText.startsWith('\\') ||
                            displayText.startsWith('./') ||
                            displayText.startsWith('../') ||
                            displayText.startsWith('~/') ||
                            /\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(displayText))
                        const isShortFence = !inline && !match && trimmed && !trimmed.includes('\n') && trimmed.length <= 80
                        if (isShortFence) {
                          return (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground" {...props}>
                              {trimmed}
                            </code>
                          )
                        }
                        if (lang === 'mermaid') {
                          return <MermaidBlock chart={value} />
                        }
                        if (!inline) {
                          return <CodeBlock language={lang} value={value} className={className} {...props} />
                        }
                        if (isFileToken) {
                          return (
                            <button
                              type="button"
                              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                openLinkTarget(displayText)
                              }}
                              title={displayText}
                            >
                              {displayText}
                            </button>
                          )
                        }
                        return (
                          <code className={className} {...props}>
                            {displayText}
                          </code>
                        )
                      },
                      img({ src, alt, ...props }: any) {
                        const raw = String(src || '').trim()
                        if (!raw) return null
                        const isLikelyUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
                        const isRelativePath = raw && !isLikelyUrl && !raw.startsWith('/') && !raw.startsWith('\\')
                        if (isRelativePath) {
                          const name = raw.split('/').pop() || raw
                          return (
                            <button
                              type="button"
                              className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                openLinkTarget(raw)
                              }}
                              title={raw}
                            >
                              {name}
                            </button>
                          )
                        }
                        return <img src={raw} alt={String(alt || '')} {...props} />
                      },
                      a({ href, children, className, ...props }: any) {
                        const target = String(href || '').trim()
                        const linkClass = 'text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                        return (
                          <a
                            {...props}
                            href={target}
                            className={[className, linkClass].filter(Boolean).join(' ')}
                            onClick={(e) => {
                              if (!target) return
                              e.preventDefault()
                              openLinkTarget(target)
                            }}
                          >
                            {children}
                          </a>
                        )
                      }
                    }}
                  >
                    {linkifyQuotedFileNames(normalizeChatMarkdown(summaryText))}
                  </ReactMarkdown>
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{summaryText}</div>
                )}
              </ScrollArea>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={summaryLoading || !activeChatId}
                onClick={async () => {
                  const chatId = String(activeChatId || '').trim()
                  if (!chatId) return
                  setSummaryLoading(true)
                  try {
                    const res = await fetchBackendJson<{ ok: boolean; compression?: any }>(`/api/chats/${chatId}/compact`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({})
                    })
                    const comp = (res as any)?.compression
                    if (comp) {
                      updateChat(chatId, { meta: { compression: comp } })
                      const text = String(comp?.summary || '').trim()
                      setSummaryText(text)
                      const ts = comp?.summaryUpdatedAt != null ? Number(comp.summaryUpdatedAt) : null
                      setSummaryUpdatedAt(Number.isFinite(ts as any) ? (ts as number) : null)
                    }
                  } finally {
                    setSummaryLoading(false)
                  }
                }}
              >
                {appRuntimeText.compressNow}
              </Button>
              <Button
                onClick={() => setSummaryOpen(false)}
              >
                {i18nText(appLang, 'common.close')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={fullAccessConfirmOpen} onOpenChange={setFullAccessConfirmOpen}>
          <DialogContent className="max-w-[540px]">
            <DialogHeader>
              <DialogTitle>{t.composer.permissionConfirmTitle}</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground leading-6">
              {t.composer.permissionConfirmDesc}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFullAccessConfirmOpen(false)}>
                {t.composer.permissionConfirmCancel}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  updateComposer({ permissionMode: 'full_access' })
                  setFullAccessConfirmOpen(false)
                }}
              >
                {t.composer.permissionConfirmContinue}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {isSettingsWindow ? (
          <SettingsWindow />
        ) : (
          <>
            <ChatHistoryPanel
              onOpenSettings={openSettings}
              width={leftWidth}
              onResizeStart={(e) => {
                e.preventDefault()
                startResizingLeft()
              }}
            />
            <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-[var(--app-shell-content-bg)]">
              <div className="flex h-full min-w-0 flex-col overflow-hidden pt-2 pr-2 pb-2">
              <header className="h-[52px] shrink-0 draggable relative z-30">
              <div className="absolute left-4 top-[4px] flex items-center">
                <div className="w-[80px] h-7" />
                {ui.sidebarCollapsed && (
                  <div className="flex items-center gap-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/55 hover:text-muted-foreground hover:bg-black/5"
                            onClick={toggleSidebarCollapsed}
                          >
                            <PanelLeftOpen className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{i18nText(appLang, 'app.showSidebar')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/55 hover:text-muted-foreground hover:bg-black/5"
                            onClick={() => {
                              void createChat({ expandSidebar: false })
                            }}
                          >
                            <MessageCircle className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{i18nText(appLang, 'app.newChat')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground/55 hover:text-muted-foreground hover:bg-black/5"
                            onClick={openSettings}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{i18nText(appLang, 'common.settings')}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>
              <div className="absolute right-4 top-[4px] flex items-center gap-1 no-drag">
                {!ui.rightSidebarOpen && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground/55 hover:text-muted-foreground hover:bg-black/5"
                          onClick={() => setActiveRightPanel('files')}
                        >
                          <Folder className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{i18nText(appLang, 'app.files')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground/55 hover:text-muted-foreground hover:bg-black/5"
                          onClick={() => setActiveRightPanel('git')}
                        >
                          <GitBranch className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{i18nText(appLang, 'app.commit')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground/55 hover:text-muted-foreground hover:bg-black/5"
                          onClick={() => setActiveRightPanel('terminal')}
                        >
                          <TerminalSquare className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{i18nText(appLang, 'app.terminal')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground/55 hover:text-muted-foreground hover:bg-black/5"
                          onClick={() => setActiveRightPanel('preview')}
                        >
                          <Globe className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{i18nText(appLang, 'app.preview')}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>

              <div className="absolute left-0 right-0 top-[6px] flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 text-xs text-primary">
                  <span>{i18nText(appLang, 'app.messageCount', { count: messages.length })}</span>
                </div>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-col flex-1 overflow-hidden min-w-0 relative">
            <main
              ref={chatScrollRef as any}
              onScroll={handleChatScroll}
              onWheel={() => {
                markUserScrollIntent()
                showChatScrollbarTemporarily(900)
              }}
              onTouchStart={() => {
                markUserScrollIntent(380)
                showChatScrollbarTemporarily(900)
              }}
              onTouchMove={() => {
                markUserScrollIntent(380)
                showChatScrollbarTemporarily(900)
              }}
              className={`flex-1 overflow-y-auto pt-4 pl-6 pr-6 pb-4 no-drag chat-scrollbar-auto-hide ${
                chatScrollbarVisible ? 'chat-scrollbar-visible' : ''
              }`}
            >
              <AnimatePresence initial={false} mode="wait">
                {!chatInitDone ? (
                  <motion.div
                    key="chat-init-skeleton"
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                    transition={chatBootTransition}
                    className="h-full"
                  >
                    <div className="max-w-3xl mx-auto w-full py-2 space-y-4">
                      {[68, 52, 62, 46].map((w, idx) => (
                        <div key={`chat-init-skeleton-${idx}`} className={`flex ${idx % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                          <div className="max-w-[78%] min-w-[220px] rounded-2xl border border-black/5 bg-muted/40 px-4 py-3">
                            <div className="space-y-2">
                              <div className="h-2.5 rounded bg-foreground/10 animate-pulse" style={{ width: `${w}%`, animationDelay: `${idx * 120}ms` }} />
                              <div className="h-2.5 rounded bg-foreground/10 animate-pulse w-[76%]" style={{ animationDelay: `${idx * 120 + 60}ms` }} />
                              <div className="h-2.5 rounded bg-foreground/10 animate-pulse w-[44%]" style={{ animationDelay: `${idx * 120 + 120}ms` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="chat-ready-content"
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
                    transition={chatBootTransition}
                    className="h-full"
                  >
                    {displayMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
                        <img
                          src={animaLogo}
                          alt="Anima logo"
                          className="h-24 w-24 object-contain select-none pointer-events-none"
                        />
                        <p className="font-semibold text-[22px] tracking-tight text-foreground">{t.helloTitle}</p>
                        <p className="text-sm text-muted-foreground text-center max-w-[520px] leading-6">
                          {activeProvider ? t.helloSubtitleConnected(activeProvider.name) : t.helloSubtitleDisconnected}
                        </p>
                        {!activeProvider && (
                          <Button onClick={openSettings} className="mt-6 rounded-full">
                            {t.configureProvider}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5 pb-2 max-w-3xl mx-auto w-full">
                  {displayMessages.map((msg: any, index) => {
                    const ctx = { index, active: true }
                    return (
                    <Fragment key={String(msg?.id || index)}>
                    {(() => {
                      const msgIdForTurn = String(msg?.id || '').trim()
                      const turnId = msgIdForTurn ? String(effectiveTurnIdByMessageId[msgIdForTurn] || '').trim() : ''
                      const collapseHistoricalProcess = (settings as any).collapseHistoricalProcess !== false
                      const isHistoricalTurn = Boolean(collapseHistoricalProcess && turnId && turnId !== latestTurnId)
                      const turnExpanded = Boolean(turnId && collapsedTurnOpenById[turnId])
                      const shouldHideProcess = Boolean(isHistoricalTurn && !turnExpanded)
                      const turnStats = turnId ? turnProcessStatsById[turnId] : undefined
                      const isFirstAssistantOfTurn =
                        msg.role === 'assistant' &&
                        Boolean(turnId) &&
                        String(msg?.id || '').trim() === String(turnFirstAssistantMessageIdById[turnId] || '').trim()
                      const isFinalAssistantOfTurn =
                        msg.role === 'assistant' &&
                        Boolean(turnStats?.finalAssistantMessageId) &&
                        String(msg?.id || '').trim() === String(turnStats?.finalAssistantMessageId || '').trim()
                      const isLatestTurn = Boolean(turnId && turnId === latestTurnId)
                      const showTurnProcessSummary = Boolean(
                        collapseHistoricalProcess && turnStats?.hasProcess && isFirstAssistantOfTurn && !isLatestTurn
                      )
                      const isLatestMessage = ctx.index === displayMessages.length - 1
                      const isTypingAssistantMessage = Boolean(msg.role === 'assistant' && isLoading && isLatestMessage)
                      const assistantMeta: any = msg.role === 'assistant' ? (msg.meta || {}) : null
                      const assistantHasReasoning =
                        Boolean(assistantMeta) &&
                        typeof assistantMeta.reasoningText === 'string' &&
                        assistantMeta.reasoningText.trim().length > 0
                      const assistantHasTokens = Boolean(
                        assistantMeta &&
                        assistantMeta.totalTokens != null
                      )
                      const assistantHasContent = typeof msg.content === 'string' && msg.content.trim().length > 0
                      const assistantHasCompression =
                        Boolean(assistantMeta) &&
                        (assistantMeta.compressionState === 'running' || assistantMeta.compressionState === 'done')
                      const assistantHasDangerousApproval =
                        Boolean(assistantMeta?.dangerousCommandApproval) &&
                        typeof assistantMeta?.dangerousCommandApproval?.command === 'string' &&
                        assistantMeta?.dangerousCommandApproval?.command.trim().length > 0
                      const assistantHasMemoryInjection = isFirstAssistantOfTurn
                      const assistantHasVisibleBody = Boolean(
                        assistantHasContent ||
                        assistantHasReasoning ||
                        assistantHasTokens ||
                        assistantHasCompression ||
                        assistantHasDangerousApproval ||
                        assistantHasMemoryInjection
                      )
                      if (msg.role !== 'user' && msg.role !== 'tool') {
                        if (!assistantHasVisibleBody && !showTurnProcessSummary) return null
                      }

                      const isCollapsibleProcessRow =
                        (msg.role === 'assistant' && !isFinalAssistantOfTurn) || msg.role === 'tool'
                      const processRowVisible = !(isCollapsibleProcessRow && shouldHideProcess)
                      const showOnlyFinalAssistantArtifacts = Boolean(shouldHideProcess && msg.role === 'assistant' && isFinalAssistantOfTurn)
                      let prevVisibleMsg: any = null
                      for (let j = index - 1; j >= 0; j -= 1) {
                        const candidate = displayMessages[j]
                        if (isStageOnlyAssistantMessage(candidate)) continue
                        prevVisibleMsg = candidate
                        break
                      }
                      const isToolGroupHead = msg.role === 'tool' && String(prevVisibleMsg?.role || '') !== 'tool'

                      // 历史轮次折叠时，非标题行的过程消息应完全移除，避免空行继续占用 flex gap 间距。
                      if (isCollapsibleProcessRow && !processRowVisible && !showTurnProcessSummary) return null
                      if (msg.role === 'tool' && !isToolGroupHead) return null

                      const turnDangerousApprovals = turnId ? dangerousApprovalsByTurn[turnId] || [] : []

                      if (msg.role === 'assistant') {
                        const meta: any = msg.meta || {}
                        const approval = meta?.dangerousCommandApproval
                        if (approval && typeof approval.command === 'string' && approval.command.trim()) {
                          const selectedOption = String(approval.selectedOption || 'approve_once') as
                            | 'approve_once'
                            | 'approve_thread'
                            | 'approve_whitelist'
                            | 'reject'
                          const status = String(approval.status || 'pending')
                          if (status !== 'pending' || approval.dismissed) return null
                          const disabled = status !== 'pending'
                          const options: Array<{ id: 'approve_once' | 'approve_thread' | 'reject'; label: string }> = [
                            { id: 'approve_once', label: t.dangerousApprovalOptionOnce },
                            { id: 'approve_thread', label: t.dangerousApprovalOptionAlways },
                            { id: 'reject', label: t.dangerousApprovalOptionReject }
                          ]
                          const patchApproval = (patch: Record<string, any>) => {
                            const nextMeta = {
                              ...meta,
                              dangerousCommandApproval: { ...approval, ...patch }
                            }
                            updateMessageById(activeChatId || '', String(msg.id || ''), { meta: nextMeta } as any)
                            if (activeChatId) {
                              void persistMessageById(activeChatId, String(msg.id || ''), String(msg.content || ''), nextMeta as any)
                            }
                          }
                          const submitApproval = () => {
                            if (disabled) return
                            const command = String(approval.command || '').trim()
                            if (!command) return
                            const activeCid = String(activeChatId || '').trim()
                            const allowForThread = selectedOption === 'approve_thread' || selectedOption === 'approve_whitelist'
                            if (selectedOption === 'reject') {
                              patchApproval({ status: 'rejected', dismissed: true })
                            } else if (allowForThread) {
                              if (activeCid) dangerousApprovalThreadsRef.current.add(activeCid)
                              patchApproval({ status: 'approved_thread', dismissed: true })
                            } else {
                              patchApproval({ status: 'approved_once', dismissed: true })
                            }
                            const runId = String(approval.runId || '').trim()
                            const approvalId = String(approval.approvalId || '').trim()
                            const decision =
                              selectedOption === 'reject'
                                ? 'reject'
                                : allowForThread
                                  ? 'approve_thread'
                                  : 'approve_once'
                            if (runId) {
                              void handleSend('', {
                                skipUserMessage: true,
                                dangerousCommandApprovals: selectedOption === 'reject' ? [] : [command],
                                dangerousCommandAllowForThread: allowForThread,
                                resumeRunId: runId,
                                resumeApprovalId: approvalId,
                                resumeDecision: decision,
                                turnIdOverride: String(msg?.turnId || '').trim() || undefined
                              })
                              return
                            }
                            void handleSend('', {
                              skipUserMessage: true,
                              dangerousCommandApprovals: selectedOption === 'reject' ? [] : [command],
                              dangerousCommandAllowForThread: allowForThread,
                              resumeFromThread: true,
                              turnIdOverride: String(msg?.turnId || '').trim() || undefined
                            })
                          }
                          return (
                            <div className="py-1.5">
                              <div className="rounded-2xl border border-black/6 bg-white p-4 space-y-3">
                                <div className="text-[14px] font-medium">{t.dangerousApprovalQuestion}</div>
                                <pre className="rounded-md border bg-muted/50 px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-all">{approval.command}</pre>
                                <div className="space-y-1">
                                  {options.map((opt, idx) => {
                                    const selected = selectedOption === opt.id
                                    return (
                                      <button
                                        key={opt.id}
                                        type="button"
                                        disabled={disabled}
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] ${
                                          selected ? 'bg-muted' : 'hover:bg-muted/60'
                                        } ${disabled ? 'opacity-70 cursor-default' : ''}`}
                                        onClick={() => patchApproval({ selectedOption: opt.id })}
                                      >
                                        <span className="w-4 shrink-0 text-muted-foreground">{idx + 1}.</span>
                                        <span className="flex-1">{opt.label}</span>
                                        {selected ? <Check className="w-3.5 h-3.5 text-muted-foreground" /> : null}
                                      </button>
                                    )
                                  })}
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[12px] text-muted-foreground">
                                    {status === 'pending' ? t.dangerousApprovalPending : status === 'rejected' ? t.dangerousApprovalRejected : ''}
                                  </span>
                                  <Button size="sm" className="h-8 rounded-full px-4" disabled={disabled} onClick={submitApproval}>
                                    {t.dangerousApprovalSubmit}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )
                        }
                      }

                      if (msg.role === 'assistant' && showTurnProcessSummary && !assistantHasVisibleBody) {
                        return (
                          <div className="w-full">
                            <div className="py-0.5">
                              <button
                                type="button"
                                className="group w-full flex items-center gap-2 min-w-0 py-0.5 rounded-md text-left hover:bg-muted/10 transition-colors motion-reduce:transition-none"
                                ref={(el) => {
                                  if (!turnId) return
                                  const map = turnSummaryBtnMapRef.current
                                  if (el) map.set(turnId, el)
                                  else map.delete(turnId)
                                }}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  if (!turnId) return
                                  const anchorTop = (e.currentTarget as HTMLButtonElement).getBoundingClientRect().top
                                  const nextExpanded = !turnExpanded
                                  userScrollLockedRef.current = true
                                  setChatBottomIfChanged(false)
                                  stopAutoScroll()
                                  markUserScrollIntent(720)
                                  suppressAutoScrollFor(620)
                                  setCollapsedTurnOpenById((prev) => ({ ...prev, [turnId]: nextExpanded }))
                                  if (nextExpanded) {
                                    stabilizeTurnSummaryViewport(turnId, anchorTop, 620)
                                  }
                                }}
                                aria-expanded={turnExpanded}
                              >
                                <span className="text-[12px] font-medium text-muted-foreground group-hover:text-foreground truncate">
                                  {t.foldProcessSummary(turnStats!.memoryCount, turnStats!.reasoningCount, turnStats!.toolCount, turnStats!.skillCount)}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-opacity motion-reduce:transition-none flex items-center justify-center ${
                                    turnExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                  }`}
                                >
                                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${turnExpanded ? 'rotate-0' : '-rotate-90'}`} />
                                </span>
                              </button>
                            </div>
                          </div>
                        )
                      }

                      return (
                      <div className="w-full">
                      {showTurnProcessSummary ? (
                        <div className="py-0.5">
                          <button
                            type="button"
                            className="group w-full flex items-center gap-2 min-w-0 py-0.5 rounded-md text-left hover:bg-muted/10 transition-colors motion-reduce:transition-none"
                            ref={(el) => {
                              if (!turnId) return
                              const map = turnSummaryBtnMapRef.current
                              if (el) map.set(turnId, el)
                              else map.delete(turnId)
                            }}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (!turnId) return
                              const anchorTop = (e.currentTarget as HTMLButtonElement).getBoundingClientRect().top
                              const nextExpanded = !turnExpanded
                              userScrollLockedRef.current = true
                              setChatBottomIfChanged(false)
                              stopAutoScroll()
                              markUserScrollIntent(720)
                              suppressAutoScrollFor(620)
                              setCollapsedTurnOpenById((prev) => ({ ...prev, [turnId]: nextExpanded }))
                              if (nextExpanded) {
                                stabilizeTurnSummaryViewport(turnId, anchorTop, 620)
                              }
                            }}
                            aria-expanded={turnExpanded}
                          >
                            <span className="text-[12px] font-medium text-muted-foreground group-hover:text-foreground truncate">
                              {t.foldProcessSummary(turnStats!.memoryCount, turnStats!.reasoningCount, turnStats!.toolCount, turnStats!.skillCount)}
                            </span>
                            <span
                              aria-hidden="true"
                              className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-opacity motion-reduce:transition-none flex items-center justify-center ${
                                turnExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${turnExpanded ? 'rotate-0' : '-rotate-90'}`} />
                            </span>
                          </button>
                        </div>
                      ) : null}
                      {(() => {
                        const body = msg.role === 'user' ? (
                        <div className={`group py-3 flex justify-end ${msg.id === lastUserMessageId ? 'sticky top-2 z-20' : ''}`}>
                           <div className="flex flex-col items-end gap-2">
                              <div
                                ref={(el) => {
                                  const id = String(msg.id || '').trim()
                                  if (!id) return
                                  const map = userMsgElMapRef.current
                                  if (el) map.set(id, el)
                                  else map.delete(id)
                                }}
                                className={`w-fit max-w-[520px] rounded-2xl border border-border/60 bg-black/5 dark:bg-white/10 px-4 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90 transition-shadow ${msg.id === highlightUserMsgId ? 'ring-2 ring-primary/35 shadow-sm' : ''}`}
                              >
                                {msg.content}
                              </div>
                              {(() => {
                                const meta: any = msg.meta || {}
                                const atts = Array.isArray(meta.userAttachments) ? meta.userAttachments : []
                                const ws = String(meta.userAttachmentsWorkspaceDir || '').trim()
                                const imgs = atts
                                  .map((a: any) => String(a?.path || '').trim())
                                  .filter(Boolean)
                                  .filter((p: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p.split('/').pop()?.toLowerCase() || p.toLowerCase()))
                                if (!imgs.length) return null
                                if (!backendBaseUrl) return null
                                return (
                                  <div className="flex flex-wrap justify-end gap-2 max-w-[520px]">
                                    {imgs.map((p: string, idx: number) => {
                                      const url = `${backendBaseUrl}/api/attachments/file?path=${encodeURIComponent(p)}${ws ? `&workspaceDir=${encodeURIComponent(ws)}` : ''}`
                                      return (
                                        <img
                                          key={`${p}:${idx}`}
                                          src={url}
                                          alt={p.split('/').pop() || 'image'}
                                          className="h-20 w-20 rounded-2xl border border-border/60 object-cover bg-muted/10"
                                          loading="lazy"
                                        />
                                      )
                                    })}
                                  </div>
                                )
                              })()}
                              <button
                                type="button"
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-all ${
                                  copiedMessageId === String(msg.id || '') ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                }`}
                                onClick={() => void handleCopyMessage(String(msg.id || ''), String(msg.content || ''))}
                                title={copiedMessageId === String(msg.id || '') ? appRuntimeText.copied : appRuntimeText.copy}
                              >
                                {copiedMessageId === String(msg.id || '') ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              </button>
                           </div>
                        </div>
                      ) : msg.role === 'tool' ? (
                        <div className="py-0.5 group">
                            <AnimatePresence initial={false}>
                              {!shouldHideProcess ? (
                                <motion.div
                                  key={`tool-traces:${String(msg.id || '')}`}
                                  initial={false}
                                  animate={{ gridTemplateRows: '1fr' }}
                                  exit={{ gridTemplateRows: '0fr' }}
                                  transition={collapseAnimTransition}
                                  className="overflow-hidden"
                                  style={{ display: 'grid', willChange: 'grid-template-rows' }}
                                >
                                  <div className="min-h-0 overflow-hidden">
                                  {(() => {
                              const segmentToolMessages: any[] = []
                              for (let i = index; i < displayMessages.length; i += 1) {
                                const nextMsg = displayMessages[i]
                                const nextMsgId = String(nextMsg?.id || '').trim()
                                const nextTurnId = nextMsgId ? String(effectiveTurnIdByMessageId[nextMsgId] || '').trim() : ''
                                if (turnId && nextTurnId && nextTurnId !== turnId) break
                                if (String(nextMsg?.role || '') === 'tool') {
                                  segmentToolMessages.push(nextMsg)
                                  continue
                                }
                                if (isStageOnlyAssistantMessage(nextMsg)) continue
                                break
                              }
                              const rawTraces = segmentToolMessages.flatMap((m: any) =>
                                Array.isArray(m?.meta?.toolTraces) ? m.meta.toolTraces : []
                              )
                              const traces = rawTraces.filter((tr: any) => {
                                if (String(tr?.status || '') !== 'running') return true
                                const sig = toolTraceSignature(tr)
                                if (turnId && completedToolTraceSignaturesByTurn[turnId]?.has(sig)) return false
                                return !rawTraces.some((x: any) => {
                                  if (x === tr) return false
                                  const st = String(x?.status || '')
                                  if (st === 'running') return false
                                  return toolTraceSignature(x) === sig
                                })
                              })
                              const toolMsgId = String(msg.id || '')
                              const hasStoredGroupOpen = Object.prototype.hasOwnProperty.call(toolTraceGroupOpenByMsgId, toolMsgId)
                              const groupOpen = hasStoredGroupOpen
                                ? Boolean(toolTraceGroupOpenByMsgId[toolMsgId])
                                : Boolean(isLoading && isLatestTurn)
                              const summary = summarizeToolTraceCategories(traces)
                              const summaryText = formatToolTraceSummary(summary)
                              if (!traces.length) return null

                              return (
                                <div className="space-y-0.5">
                                  <button
                                    type="button"
                                    className="group w-full flex items-center gap-2 min-w-0 py-0.5 rounded-md text-left hover:bg-muted/10 transition-colors motion-reduce:transition-none"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      setToolTraceGroupOpenByMsgId((prev) => ({ ...prev, [toolMsgId]: !groupOpen }))
                                    }}
                                    aria-expanded={groupOpen}
                                  >
                                    <span className="min-w-0 truncate text-[12px] text-muted-foreground/80">
                                      {summaryText}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-opacity motion-reduce:transition-none flex items-center justify-center ${
                                        groupOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                      }`}
                                    >
                                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 motion-reduce:transition-none ${groupOpen ? 'rotate-0' : '-rotate-90'}`} />
                                    </span>
                                  </button>
                                  <AnimatePresence initial={false}>
                                    {groupOpen ? (
                                      <motion.div
                                        key={`tool-trace-group:${toolMsgId}`}
                                        initial={{ gridTemplateRows: '0fr' }}
                                        animate={{ gridTemplateRows: '1fr' }}
                                        exit={{ gridTemplateRows: '0fr' }}
                                        transition={collapseAnimTransition}
                                        className="overflow-hidden"
                                        style={{ display: 'grid', willChange: 'grid-template-rows' }}
                                      >
                                        <div className="min-h-0 overflow-hidden">
                                          <motion.div
                                            className="space-y-0.5"
                                            initial={collapseContentAnim.initial}
                                            animate={collapseContentAnim.animate}
                                            exit={collapseContentAnim.exit}
                                            transition={collapseContentAnim.transition}
                                          >
                                  {traces.map((tr: any) => {
                                    const detailKey = `${msg.id}:${tr.id}`
                                    const detailOpen = !!traceDetailOpenByKey[detailKey]
                                    const isRunning = tr.status === 'running'
                                    const isFailed = tr.status === 'failed'

                                    const traceName = normalizeToolTraceName(tr.name)
                                    const isParallelTrace = traceName === 'multi_tool_use_parallel' || traceName === 'multi_tool_use.parallel'
                                    let entity = traceName
                                    const normalizeValue = (val: any) => String(val ?? '').replace(/\\`/g, '`').replace(/`/g, '').trim()
                                    const stripCodeFences = (raw: string) => {
                                      const trimmed = String(raw || '').trim()
                                      const m = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/)
                                      return (m && m[1] ? m[1] : trimmed).trim()
                                    }
                                    const sanitizePotentialJson = (raw: string) => stripCodeFences(raw).replace(/\\`/g, '`').replace(/`/g, '').trim()
                                    const extractJsonSubstring = (raw: string) => {
                                      const text = String(raw || '')
                                      let start = -1
                                      const stack: Array<'{' | '['> = []
                                      let inString = false
                                      let escaped = false
                                      for (let i = 0; i < text.length; i++) {
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
                                          if (ch === '"') {
                                            inString = false
                                            continue
                                          }
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
                                    const parseMaybeJson = (text: string) => {
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
                                      if (extracted) {
                                        const recovered = tryParse(extracted)
                                        if (recovered != null) {
                                          if (typeof recovered === 'string') {
                                            const nested = tryParse(sanitizePotentialJson(recovered))
                                            return nested != null ? nested : recovered
                                          }
                                          return recovered
                                        }
                                      }

                                      return null
                                    }
                                    const resultText = typeof tr.resultPreview?.text === 'string' ? tr.resultPreview.text : ''
                                    const argsObj = (() => {
                                      const parsed = parseMaybeJson(tr.argsPreview?.text || '')
                                      return parsed && typeof parsed === 'object' ? parsed : {}
                                    })()
                                    const resultObj: any = parseMaybeJson(resultText)
                                    const resultItems = Array.isArray(resultObj)
                                      ? resultObj
                                      : Array.isArray(resultObj?.results)
                                        ? resultObj.results
                                        : Array.isArray(resultObj?.items)
                                          ? resultObj.items
                                          : null
                                    const traceLang =
                                      settings.language === 'zh' ? 'zh' : settings.language === 'ja' ? 'ja' : 'en'
                                    const runtimeByLang = APP_RUNTIME_STRINGS[traceLang as 'en' | 'zh' | 'ja'] || APP_RUNTIME_STRINGS.en
                                    const traceI18n = {
                                      searchResultSummary: (n: number) =>
                                        runtimeByLang.trace.searchResultSummary.replace('{count}', String(n)),
                                      linkFallback: runtimeByLang.trace.linkFallback,
                                      webpageLink: runtimeByLang.trace.webpageLink,
                                      status: runtimeByLang.trace.status,
                                      truncated: runtimeByLang.trace.truncated,
                                      dir: runtimeByLang.trace.dir,
                                      file: runtimeByLang.trace.file,
                                      lineLabel: (n: number | string) => runtimeByLang.trace.lineLabel.replace('{line}', String(n)),
                                      matchedContent: runtimeByLang.trace.matchedContent,
                                      readDone: runtimeByLang.trace.readDone,
                                      failed: runtimeByLang.trace.failed
                                    }
                                    let resultSummary = ''
                                    let detailMarkdown = ''
                                    const parallelChildLabels = (() => {
                                      if (!isParallelTrace) return [] as string[]
                                      const rawUses = Array.isArray((argsObj as any)?.tool_uses) ? (argsObj as any).tool_uses : []
                                      return rawUses
                                        .map((item: any) => {
                                          if (!item || typeof item !== 'object') return ''
                                          const recipient = normalizeValue(item?.recipient_name || item?.name)
                                          const params = item?.parameters && typeof item.parameters === 'object' ? item.parameters : {}
                                          if (recipient === 'functions.exec_command') {
                                            return normalizeValue((params as any)?.cmd || (params as any)?.command)
                                          }
                                          if (recipient.startsWith('functions.')) return recipient.slice('functions.'.length)
                                          return recipient
                                        })
                                        .filter(Boolean)
                                    })()
                                    const traceKind: 'execute' | 'search' | 'browse' | 'read' | 'edit' =
                                      traceName === 'rg_search' || traceName === 'glob_files' || traceName === 'WebSearch'
                                        ? 'search'
                                        : traceName === 'read_file'
                                          ? 'read'
                                          : traceName === 'apply_patch'
                                            ? 'edit'
                                            : traceName === 'WebFetch'
                                              ? 'browse'
                                              : 'execute'
                                    const traceStatusText = (() => {
                                      const key = isFailed ? 'failed' : isRunning ? 'running' : 'done'
                                      return runtimeByLang.trace.statusText[traceKind][key]
                                    })()

                                    if (traceName === 'bash') {
                                      entity = normalizeValue(argsObj.command)
                                    } else if (traceName === 'rg_search' || traceName === 'glob_files') {
                                      entity = normalizeValue(argsObj.pattern)
                                      if (argsObj.path) entity += ` in ${normalizeValue(argsObj.path)}`
                                    } else if (traceName === 'read_file') {
                                      entity = normalizeValue(argsObj.path)
                                    } else if (traceName === 'apply_patch') {
                                      entity = normalizeValue(argsObj.path)
                                    } else if (traceName === 'WebSearch') {
                                      entity = normalizeValue(argsObj.query)
                                      const count = Array.isArray(resultItems) ? resultItems.length : undefined
                                      resultSummary = typeof count === 'number' ? traceI18n.searchResultSummary(count) : ''
                                    } else if (traceName === 'WebFetch') {
                                      entity = normalizeValue(argsObj.url)
                                    } else if (traceName === 'load_skill') {
                                      entity = normalizeValue(argsObj.id) || 'load_skill'
                                    } else if (isParallelTrace) {
                                      if (parallelChildLabels.length > 0) {
                                        const showCount = 3
                                        const shown = parallelChildLabels.slice(0, showCount)
                                        const extra = parallelChildLabels.length - shown.length
                                        entity = shown.join(' · ')
                                        if (extra > 0) entity = `${entity} +${extra}`
                                      } else {
                                        entity = ''
                                      }
                                    } else {
                                      entity = normalizeValue(entity)
                                    }

                                    const canOpenEntityInFiles =
                                      (traceName === 'read_file' || traceName === 'apply_patch') &&
                                      Boolean(entity)
                                    const normalizeCommand = (raw: unknown) => String(raw || '').replace(/\s+/g, ' ').trim()
                                    const bashCommandNormalized = traceName === 'bash' ? normalizeCommand(argsObj.command) : ''
                                    const matchedApproval =
                                      traceName === 'bash'
                                        ? turnDangerousApprovals.find((a) => normalizeCommand(a.command) === bashCommandNormalized)
                                        : undefined
                                    const toolApprovalText =
                                      matchedApproval?.status === 'approved_once'
                                        ? t.dangerousApprovalStatusApprovedOnce
                                        : matchedApproval?.status === 'approved_thread'
                                          ? t.dangerousApprovalStatusApprovedThread
                                          : matchedApproval?.status === 'rejected'
                                            ? t.dangerousApprovalStatusRejected
                                            : ''
                                    const rejectedByUserHint =
                                      String((tr as any)?.resultPreview?.text || '').toLowerCase().includes('user rejected dangerous command approval') ||
                                      String((tr as any)?.error?.message || '').toLowerCase().includes('user rejected dangerous command approval')
                                    const isRejectedByUser = traceName === 'bash' && (matchedApproval?.status === 'rejected' || rejectedByUserHint)
                                    const notExecutedText = runtimeByLang.notExecuted
                                    const isEditTrace = traceName === 'apply_patch'
                                    const runningStatusText =
                                      isRejectedByUser
                                        ? notExecutedText
                                        : traceName === 'load_skill' && !isRunning && !isFailed
                                        ? runtimeByLang.loadSkillDone
                                        : isParallelTrace && isRunning
                                          ? runtimeByLang.parallelRunning
                                        : isEditTrace && !isRunning && !isFailed
                                          ? runtimeByLang.editedFiles
                                          : traceStatusText
                                    const displayEntity = (() => {
                                      const text = String(entity || '').trim()
                                      if (traceName !== 'bash') return text
                                      const max = 80
                                      if (text.length <= max) return text
                                      return `${text.slice(0, max - 3)}...`
                                    })()
                                    const shouldHideRejectedGhostRow =
                                      isRejectedByUser &&
                                      !String(displayEntity || '').trim()
                                    const countDiffLines = (oldContent: unknown, newContent: unknown) => {
                                      try {
                                        const patch = createTwoFilesPatch('a', 'b', String(oldContent ?? ''), String(newContent ?? ''))
                                        let added = 0
                                        let removed = 0
                                        for (const line of patch.split('\n')) {
                                          if (
                                            line.startsWith('---') ||
                                            line.startsWith('+++') ||
                                            line.startsWith('@@') ||
                                            line.startsWith('Index:') ||
                                            line.startsWith('diff ')
                                          ) {
                                            continue
                                          }
                                          if (line.startsWith('+')) added += 1
                                          else if (line.startsWith('-')) removed += 1
                                        }
                                        return { added, removed }
                                      } catch {
                                        return { added: 0, removed: 0 }
                                      }
                                    }
                                    const editDiffSummaries = Array.isArray(tr.diffs)
                                      ? tr.diffs.map((d: any) => {
                                          const path = String(d?.path || '').trim()
                                          const fileName = (path.split('/').pop() || path || 'unknown').trim()
                                          const stats = countDiffLines(d?.oldContent, d?.newContent)
                                          return { path, fileName, ...stats }
                                        })
                                      : []
                                    const totalAdded = editDiffSummaries.reduce((n: number, x: any) => n + (x.added || 0), 0)
                                    const totalRemoved = editDiffSummaries.reduce((n: number, x: any) => n + (x.removed || 0), 0)
                                    const approvalBadgeClass =
                                      matchedApproval?.status === 'rejected'
                                        ? 'border-red-200 bg-red-50 text-red-700'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'

                                    if (isParallelTrace && Array.isArray(resultObj?.results)) {
                                      const lines = (resultObj.results as any[])
                                        .map((r: any, idx: number) => {
                                          const ok = Boolean(r?.ok)
                                          const icon = ok ? '✅' : '❌'
                                          const label = normalizeValue(parallelChildLabels[idx] || r?.recipientName || r?.toolName || `#${idx + 1}`)
                                          const duration = Number(r?.durationMs)
                                          const durationText = Number.isFinite(duration) && duration >= 0 ? ` (${Math.floor(duration)}ms)` : ''
                                          const err = !ok ? normalizeValue(r?.error || r?.result?.error || '') : ''
                                          return `- ${idx + 1}. ${icon} ${label}${durationText}${err ? ` — ${err}` : ''}`
                                        })
                                        .filter(Boolean)
                                      detailMarkdown = lines.join('\n')
                                    } else if (traceName === 'WebSearch' && Array.isArray(resultItems)) {
                                      const circled = [
                                        '',
                                        '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
                                        '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'
                                      ]
                                      const marker = (n: number) => circled[n] || `(${n})`

                                      const lines = resultItems
                                        .map((r: any, idx: number) => {
                                          const title = String(r?.title || r?.url || traceI18n.linkFallback).trim()
                                          const url = String(r?.url || '').trim()
                                          const snippet = String(r?.snippet || '').trim()
                                          const m = marker(idx + 1)
                                          if (url && snippet) return `${m} [${title}](${url}) — ${snippet}`
                                          if (url) return `${m} [${title}](${url})`
                                          if (snippet) return `${m} ${title} — ${snippet}`
                                          return `${m} ${title}`
                                        })
                                        .filter(Boolean)
                                      detailMarkdown = lines.join('  \n')
                                    } else if (traceName === 'WebFetch' && resultObj) {
                                      const lines: string[] = []
                                      const url = String(resultObj.finalUrl || resultObj.url || '').trim()
                                      if (url) lines.push(`- [${traceI18n.webpageLink}](${url})`)
                                      const statusParts: string[] = []
                                      if (resultObj.status) statusParts.push(`HTTP ${resultObj.status}`)
                                      if (resultObj.contentType) statusParts.push(String(resultObj.contentType))
                                      if (resultObj.truncated) statusParts.push(traceI18n.truncated)
                                      if (statusParts.length) lines.push(`- ${traceI18n.status}: ${statusParts.join(' · ')}`)
                                      detailMarkdown = lines.join('\n')
                                    } else if (Array.isArray(resultObj?.paths)) {
                                      detailMarkdown = resultObj.paths.map((p: any) => `- ${String(p)}`).join('\n')
                                    } else if (Array.isArray(resultObj?.entries)) {
                                      detailMarkdown = resultObj.entries
                                        .map((e: any) => {
                                          const name = String(e?.name || '')
                                          const type = e?.type === 'dir' ? traceI18n.dir : e?.type === 'file' ? traceI18n.file : ''
                                          return name ? `- ${name}${type ? `（${type}）` : ''}` : ''
                                        })
                                        .filter(Boolean)
                                        .join('\n')
                                    } else if (Array.isArray(resultObj?.matches)) {
                                      detailMarkdown = resultObj.matches
                                        .map((m: any) => {
                                          const path = String(m?.path || '')
                                          const line = m?.line
                                          const text = String(m?.text || '').trim()
                                          if (!path && !text) return ''
                                          if (path && line) return `- ${path} ${traceI18n.lineLabel(line)}: ${text || traceI18n.matchedContent}`
                                          if (path) return `- ${path}: ${text || traceI18n.matchedContent}`
                                          return `- ${text}`
                                        })
                                        .filter(Boolean)
                                        .join('\n')
                                    } else if (Array.isArray(resultObj?.diffs) && traceName !== 'apply_patch') {
                                      detailMarkdown = resultObj.diffs
                                        .map((d: any) => String(d?.path || ''))
                                        .filter(Boolean)
                                        .map((p: string) => `- [${p}](${p})`)
                                        .join('\n')
                                    } else if (resultObj?.meta?.path) {
                                      detailMarkdown = `- ${traceI18n.readDone}: ${String(resultObj.meta.path)}`
                                    } else if (resultObj?.ok === false) {
                                      const errMsg = String(resultObj?.error || traceI18n.failed).trim()
                                      detailMarkdown = errMsg ? `- ${traceI18n.failed}: ${errMsg}` : ''
                                    }

                                    const hasDetail =
                                      Boolean(detailMarkdown) ||
                                      (Array.isArray((tr as any).artifacts) && (tr as any).artifacts.length > 0) ||
                                      (Array.isArray(tr.diffs) && tr.diffs.length > 0) ||
                                      (tr.status === 'failed' && Boolean(tr.error?.message))
                                    if (shouldHideRejectedGhostRow) return null

                                    return (
                                      <div key={tr.id} className="group rounded-lg hover:bg-muted/40 transition-colors py-0.5">
                                        <div
                                          className={`flex items-center gap-2 ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
                                          onClick={() => {
                                            if (!hasDetail) return
                                            setTraceDetailOpenByKey((s) => ({ ...s, [detailKey]: !s[detailKey] }))
                                          }}
                                        >
                                          <span
                                            className={`shrink-0 text-[12px] font-medium ${
                                              isRunning && !isRejectedByUser ? 'anima-flow-text' : 'text-muted-foreground group-hover:text-foreground'
                                            }`}
                                          >
                                            {runningStatusText}
                                          </span>
                                          
                                          <div className="min-w-0 flex-1 flex items-center gap-2">
                                            {traceName === 'bash' && toolApprovalText ? (
                                              <span className={`shrink-0 inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] leading-none font-medium ${approvalBadgeClass}`}>
                                                {toolApprovalText}
                                              </span>
                                            ) : null}
                                            {isEditTrace && editDiffSummaries.length > 0 && !isRunning && !detailOpen ? (
                                              <span className="inline-flex items-center gap-1.5 min-w-0">
                                                <button
                                                  type="button"
                                                  className="max-w-[220px] truncate text-[12px] text-blue-600 hover:underline"
                                                  title={editDiffSummaries[0]?.path || editDiffSummaries[0]?.fileName}
                                                  onMouseDown={(e) => e.stopPropagation()}
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    const p = String(editDiffSummaries[0]?.path || '').trim()
                                                    if (p) openFileInExplorer(p)
                                                  }}
                                                >
                                                  {editDiffSummaries[0]?.fileName}
                                                </button>
                                                <span className="text-[12px] text-emerald-600 font-medium">+{totalAdded}</span>
                                                <span className="text-[12px] text-red-500 font-medium">-{totalRemoved}</span>
                                              </span>
                                            ) : isEditTrace && detailOpen ? null : canOpenEntityInFiles ? (
                                              <button
                                                type="button"
                                                className="inline-block max-w-full text-[12px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-md truncate align-middle border border-transparent hover:border-border/50 transition-colors hover:underline cursor-pointer"
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  openFileInExplorer(entity)
                                                }}
                                                title={entity}
                                              >
                                                {displayEntity}
                                              </button>
                                            ) : (
                                              <span className="inline-block max-w-full text-[12px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-md truncate align-middle border border-transparent hover:border-border/50 transition-colors">
                                                {displayEntity}
                                              </span>
                                            )}
                                            {resultSummary && (
                                              <span className="inline-block max-w-full text-[12px] font-mono text-muted-foreground bg-muted/10 px-1.5 py-0.5 rounded-md truncate align-middle border border-border/30">
                                                {resultSummary}
                                              </span>
                                            )}
                                            <span className="text-[11px] text-muted-foreground/40 whitespace-nowrap tabular-nums">
                                              {isRejectedByUser ? '' : typeof tr.durationMs === 'number' ? `${tr.durationMs}ms` : ''}
                                            </span>
                                            {hasDetail ? (
                                              <span
                                                aria-hidden="true"
                                                className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-opacity motion-reduce:transition-none flex items-center justify-center ${
                                                  detailOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                                }`}
                                              >
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${detailOpen ? 'rotate-0' : '-rotate-90'}`} />
                                              </span>
                                            ) : null}
                                          </div>
                                        </div>

                                        <AnimatePresence initial={false}>
                                          {detailOpen && hasDetail ? (
                                            <motion.div
                                              key="trace-detail"
                                              initial={{ gridTemplateRows: '0fr' }}
                                              animate={{ gridTemplateRows: '1fr' }}
                                              exit={{ gridTemplateRows: '0fr' }}
                                              transition={collapseAnimTransition}
                                              className="overflow-hidden"
                                              style={{ display: 'grid', willChange: 'grid-template-rows' }}
                                            >
                                              <div className="min-h-0 overflow-hidden">
                                              <motion.div
                                                className="mt-2 space-y-2 pb-1"
                                                initial={collapseContentAnim.initial}
                                                animate={collapseContentAnim.animate}
                                                exit={collapseContentAnim.exit}
                                                transition={collapseContentAnim.transition}
                                              >
                                                {Array.isArray((tr as any).artifacts) && (tr as any).artifacts.length > 0 && (
                                                  <div className="space-y-1">
                                                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{i18nText(appLang, 'app.artifacts')}</div>
                                                    {renderArtifacts((tr as any).artifacts as Artifact[], 'sm')}
                                                  </div>
                                                )}
                                                {detailMarkdown ? (
                                                  <ReactMarkdown
                                                    remarkPlugins={[remarkGfm, remarkMath]}
                                                    rehypePlugins={[rehypeKatex, rehypeRaw]}
                                                    className="prose prose-sm dark:prose-invert max-w-none text-[11px] text-foreground/80 prose-ul:pl-3 prose-ol:pl-3"
                                                    components={{
                                                      pre: ({ children }) => <>{children}</>,
                                                      code({ inline, className, children, ...props }: any) {
                                                        const value = String(children).replace(/\n$/, '')
                                                        const trimmed = value.trim()
                                                        const displayText = inline ? stripWrappedBackticks(trimmed) : trimmed
                                                        const isFileToken =
                                                          Boolean(inline) &&
                                                          !/^https?:\/\//i.test(displayText) &&
                                                          (displayText.startsWith('file://') ||
                                                            displayText.startsWith('/') ||
                                                            displayText.startsWith('\\') ||
                                                            displayText.startsWith('./') ||
                                                            displayText.startsWith('../') ||
                                                            displayText.startsWith('~/') ||
                                                            /\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(displayText))
                                                        if (isFileToken) {
                                                          return (
                                                            <button
                                                              type="button"
                                                              className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground hover:underline cursor-pointer"
                                                              onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                openLinkTarget(displayText)
                                                              }}
                                                              title={displayText}
                                                            >
                                                              {displayText}
                                                            </button>
                                                          )
                                                        }
                                                        return <code className={className} {...props}>{displayText}</code>
                                                      },
                                                      a({ href, children, ...props }: any) {
                                                        const target = String(href || '').trim()
                                                        return (
                                                          <a
                                                            {...props}
                                                            href={target}
                                                            className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                                            onClick={(e) => {
                                                              if (!target) return
                                                              e.preventDefault()
                                                              openLinkTarget(target)
                                                            }}
                                                          >
                                                            {children}
                                                          </a>
                                                        )
                                                      }
                                                    }}
                                                  >
                                                    {linkifyQuotedFileNames(detailMarkdown)}
                                                  </ReactMarkdown>
                                                ) : null}

                                                {tr.diffs && tr.diffs.length > 0 && (
                                                  <div className="space-y-1">
                                                    <div className="space-y-2">
                                                      {tr.diffs.map((d: any, i: number) => (
                                                        <DiffView key={i} oldContent={d.oldContent} newContent={d.newContent} fileName={d.path} />
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}

                                                {tr.status === 'failed' && tr.error?.message && (
                                                  <div className="space-y-1">
                                                    <div className="text-[10px] font-medium text-red-500 uppercase tracking-wider">{t.trace.error}</div>
                                                    <div className="text-[10px] text-red-600 dark:text-red-400 whitespace-pre-wrap break-words bg-red-500/10 rounded p-2">
                                                      {tr.error.message}
                                                    </div>
                                                  </div>
                                                )}
                                              </motion.div>
                                              </div>
                                            </motion.div>
                                          ) : null}
                                        </AnimatePresence>
                                      </div>
                                    )
                                  })}
                                          </motion.div>
                                        </div>
                                      </motion.div>
                                    ) : null}
                                  </AnimatePresence>
                                </div>
                              )
                                  })()}
                                  </div>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                        </div>
                      ) : (
                        <div className="py-0.5 group">
                          <div className="space-y-0.5">
                            {(() => {
                              if (shouldHideProcess) return null
                              if (!isFirstAssistantOfTurn) return null
                              const meta = msg.meta || {}
                              const injection = parseMemoryInjection(meta.memoryInjection)
                              const memoryCount = Math.max(0, Number(injection?.count || 0))
                              const hasItems = Boolean(memoryCount > 0 && injection?.items?.length)
                              const msgId = String(msg.id || '')
                              const open = Boolean(memoryInjectionOpenByMsgId[msgId])
                              const toggle = () => {
                                if (!hasItems) return
                                setMemoryInjectionOpenByMsgId((prev) => ({ ...prev, [msgId]: !open }))
                              }
                              return (
                                <div key={`memory-injection-block:${msgId}`} className="overflow-hidden">
                                  <button
                                    type="button"
                                    className="group w-full flex items-center gap-2 min-w-0 py-0.5 rounded-md text-left hover:bg-muted/10 transition-colors motion-reduce:transition-none"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      toggle()
                                    }}
                                    aria-expanded={hasItems ? open : false}
                                  >
                                    <span className="text-[12px] font-medium text-muted-foreground group-hover:text-foreground">
                                      {appRuntimeText.injectedMemories.replace('{count}', String(memoryCount))}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground/40 whitespace-nowrap tabular-nums">
                                      {typeof injection?.durationMs === 'number' ? `${injection.durationMs}ms` : ''}
                                    </span>
                                    {hasItems ? (
                                      <span
                                        aria-hidden="true"
                                        className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-opacity motion-reduce:transition-none flex items-center justify-center ${
                                          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                        }`}
                                      >
                                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 motion-reduce:transition-none ${open ? 'rotate-0' : '-rotate-90'}`} />
                                      </span>
                                    ) : null}
                                  </button>

                                  <AnimatePresence initial={false}>
                                    {open && hasItems ? (
                                      <motion.div
                                        key={`memory-injection-content:${msgId}`}
                                        initial={{ gridTemplateRows: '0fr' }}
                                        animate={{ gridTemplateRows: '1fr' }}
                                        exit={{ gridTemplateRows: '0fr' }}
                                        transition={collapseAnimTransition}
                                        className="overflow-hidden"
                                        style={{ display: 'grid', willChange: 'grid-template-rows' }}
                                      >
                                        <div className="min-h-0 overflow-hidden">
                                          <motion.div
                                            className="mt-1 space-y-1"
                                            initial={collapseContentAnim.initial}
                                            animate={collapseContentAnim.animate}
                                            exit={collapseContentAnim.exit}
                                            transition={collapseContentAnim.transition}
                                          >
                                            {(injection?.items || []).map((item, idx) => {
                                              const type = String(item.type || 'semantic').trim()
                                              const content = String(item.content || '').trim()
                                              if (!content) return null
                                              return (
                                                <div key={`${String(item.id || '')}:${idx}`} className="flex items-start gap-2">
                                                  <span className="mt-[6px] h-1 w-1 rounded-full bg-muted-foreground/50 shrink-0" />
                                                  <span className="text-[12px] leading-relaxed text-foreground/85 break-words">
                                                    <span className="inline-block text-muted-foreground mr-1">[{type}]</span>
                                                    {content}
                                                  </span>
                                                </div>
                                              )
                                            })}
                                          </motion.div>
                                        </div>
                                      </motion.div>
                                    ) : null}
                                  </AnimatePresence>
                                </div>
                              )
                            })()}
                            {(() => {
                              if (shouldHideProcess) return null
                              const meta = msg.meta || {}
                              const status = meta.reasoningStatus
                              const text = typeof meta.reasoningText === 'string' ? meta.reasoningText.trim() : ''
                              if (!text) return null
                              const isThinkingRaw = status === 'pending' || status === 'streaming'
                              const isLatest = ctx.index === displayMessages.length - 1
                              const isThinking = Boolean(isThinkingRaw && isLoading && isLatest)
                              const msgId = String(msg.id || '')
                              const open = reasoningOpenByMsgId[msgId] ?? isThinking
                              const headerText = isThinking ? appRuntimeText.thinkingRunning : appRuntimeText.thinkingDone
                              const toggle = () => {
                                setReasoningOpenByMsgId((prev) => {
                                  const curr = prev[msgId] ?? isThinking
                                  return { ...prev, [msgId]: !curr }
                                })
                              }
                              return (
                                <div key={`reasoning-block:${msgId}`} className="overflow-hidden">
                                  <button
                                    type="button"
                                    className="group w-full flex items-center gap-2 min-w-0 py-0.5 rounded-md text-left hover:bg-muted/10 transition-colors motion-reduce:transition-none"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      toggle()
                                    }}
                                    aria-expanded={open}
                                  >
                                    <span
                                      className={`text-[12px] font-medium shrink-0 ${
                                        isThinking ? 'anima-flow-text' : 'text-muted-foreground group-hover:text-foreground'
                                      }`}
                                    >
                                      {headerText}
                                    </span>
                                    <span
                                      aria-hidden="true"
                                      className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-opacity motion-reduce:transition-none flex items-center justify-center ${
                                        open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                      }`}
                                    >
                                      <ChevronDown
                                        className={`w-3.5 h-3.5 transition-transform duration-300 motion-reduce:transition-none ${
                                          open ? 'rotate-0' : '-rotate-90'
                                        }`}
                                      />
                                    </span>
                                  </button>

                                  <AnimatePresence initial={false}>
                                    {open ? (
                                      <motion.div
                                        key={`reasoning-content:${msgId}`}
                                        initial={{ gridTemplateRows: '0fr' }}
                                        animate={{ gridTemplateRows: '1fr' }}
                                        exit={{ gridTemplateRows: '0fr' }}
                                        transition={collapseAnimTransition}
                                        className="overflow-hidden"
                                        style={{ display: 'grid', willChange: 'grid-template-rows' }}
                                      >
                                        <div className="min-h-0 overflow-hidden">
                                          <motion.div
                                            className="mt-1 text-[13px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
                                            initial={collapseContentAnim.initial}
                                            animate={collapseContentAnim.animate}
                                            exit={collapseContentAnim.exit}
                                            transition={collapseContentAnim.transition}
                                          >
                                            {text}
                                          </motion.div>
                                        </div>
                                      </motion.div>
                                    ) : null}
                                  </AnimatePresence>
                                </div>
                              )
                            })()}

                            {(() => {
                              const cs = (msg.meta as any)?.compressionState
                              if (cs !== 'running' && cs !== 'done') return null
                              return (
                                <CompressionCard
                                  state={cs}
                                  content={typeof msg.content === 'string' ? msg.content : String(msg.content || '')}
                                />
                              )
                            })()}

                            {(() => {
                              const cs = (msg.meta as any)?.compressionState
                              return cs === 'running' || cs === 'done'
                            })() ? null : settings.enableMarkdown ? (
                              <div>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkMath]}
                                  rehypePlugins={[rehypeKatex, rehypeRaw]}
                                  className={`prose prose-sm dark:prose-invert max-w-none prose-p:text-[13px] prose-li:text-[13px] prose-table:text-[13px] prose-p:leading-relaxed prose-li:leading-relaxed prose-p:font-medium prose-li:font-medium prose-headings:font-semibold prose-h1:text-[21px] prose-h1:leading-[1.25] prose-h2:text-[18px] prose-h2:leading-[1.3] prose-h3:text-[16px] prose-h3:leading-[1.35] text-foreground/90 ${
                                    isTypingAssistantMessage ? 'anima-typing-fade' : ''
                                  }`}
                                  components={{
                                    pre: ({ children }) => <>{children}</>,
                                    code({ inline, className, children, ...props }: any) {
                                      const match = /language-(\w+)/.exec(className || '')
                                      const lang = match ? match[1] : 'text'
                                      const value = String(children).replace(/\n$/, '')
                                      const trimmed = value.trim()
                                      const displayText = inline ? stripWrappedBackticks(trimmed) : trimmed
                                      const isFileToken =
                                        !/^https?:\/\//i.test(displayText) &&
                                        (displayText.startsWith('file://') ||
                                          displayText.startsWith('/') ||
                                          displayText.startsWith('\\') ||
                                          displayText.startsWith('./') ||
                                          displayText.startsWith('../') ||
                                          displayText.startsWith('~/') ||
                                          /\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(displayText))
                                      const isShortFence = !inline && !match && trimmed && !trimmed.includes('\n') && trimmed.length <= 80
                                      if (isShortFence) {
                                        return (
                                          <code
                                            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground"
                                            {...props}
                                          >
                                            {trimmed}
                                          </code>
                                        )
                                      }
                                      if (lang === 'mermaid') {
                                        return <MermaidBlock chart={value} />
                                      }
                                      if (!inline) {
                                        return <CodeBlock language={lang} value={value} className={className} {...props} />
                                      }
                                      if (isFileToken) {
                                        return (
                                          <button
                                            type="button"
                                            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                                            onClick={(e) => {
                                              e.preventDefault()
                                              e.stopPropagation()
                                              openLinkTarget(displayText)
                                            }}
                                            title={displayText}
                                          >
                                            {displayText}
                                          </button>
                                        )
                                      }
                                      return <code className={className} {...props}>{displayText}</code>
                                    },
                                    img({ src, alt, ...props }: any) {
                                      const raw = String(src || '').trim()
                                      const hasArtifacts = Array.isArray(msg.meta?.artifacts) && msg.meta.artifacts.length > 0
                                      const isGeneratedPath =
                                        raw.startsWith('sandbox:') ||
                                        raw.startsWith('.anima/') ||
                                        raw.startsWith('/.anima/') ||
                                        raw.includes('/.anima/artifacts/')

                                      if (hasArtifacts && isGeneratedPath) return null

                                      if (raw.startsWith('sandbox:')) {
                                        const ws = resolveWorkspaceDir()
                                        const rel = raw.replace(/^sandbox:/, '')
                                        if (backendBaseUrl && ws && rel.startsWith('/')) {
                                          const abs = `${ws.replace(/\/$/, '')}${rel}`
                                          const url = `${backendBaseUrl}/api/artifacts/file?path=${encodeURIComponent(abs)}&workspaceDir=${encodeURIComponent(ws)}`
                                          return <img src={url} alt={String(alt || '')} {...props} />
                                        }
                                        return null
                                      }

                                      const isLikelyUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
                                      const isRelativePath = raw && !isLikelyUrl && !raw.startsWith('/') && !raw.startsWith('\\')
                                      if (isRelativePath) {
                                        const name = raw.split('/').pop() || raw
                                        return (
                                          <button
                                            type="button"
                                            className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                            onClick={(e) => {
                                              e.preventDefault()
                                              e.stopPropagation()
                                              openLinkTarget(raw)
                                            }}
                                            title={raw}
                                          >
                                            {name}
                                          </button>
                                        )
                                      }

                                      return <img src={raw} alt={String(alt || '')} {...props} />
                                    },
                                    a({ href, children, className, ...props }: any) {
                                      const target = String(href || '').trim()
                                      const linkClass =
                                        'text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                                      return (
                                        <a
                                          {...props}
                                          href={target}
                                          className={[className, linkClass].filter(Boolean).join(' ')}
                                          onClick={(e) => {
                                            if (!target) return
                                            e.preventDefault()
                                            openLinkTarget(target)
                                          }}
                                        >
                                          {children}
                                        </a>
                                      )
                                    }
                                  }}
                                >
                                  {linkifyQuotedFileNames(normalizeChatMarkdown(msg.content || ''))}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <p
                                className={`whitespace-pre-wrap text-[13px] leading-relaxed font-medium text-foreground/90 ${
                                  isTypingAssistantMessage ? 'anima-typing-fade' : ''
                                }`}
                              >
                                {msg.content || ''}
                              </p>
                            )}
                            {(() => {
                              const st = String((msg.meta as any)?.stage || '').trim()
                              if (showOnlyFinalAssistantArtifacts) return null
                              if (!st) return null
                              if (st === 'verify') return null
                              if (st === 'model' || st === 'tool' || st === 'model_call' || st === 'tool_call') return null
                              if (st.startsWith('tool_start:') || st.startsWith('tool_done:') || st.startsWith('tool_end:')) return null
                              return (
                              <div className="text-[11px] text-muted-foreground pt-1">
                                {st}
                              </div>
                              )
                            })()}
                            {Array.isArray(msg.meta?.artifacts) && msg.meta?.artifacts.length > 0 && (
                              <div className="pt-1">
                                {renderArtifacts(msg.meta.artifacts, 'md')}
                              </div>
                            )}
                            {isFinalAssistantOfTurn && String(msg.content || '').trim() && !(isLoading && isLatestTurn) ? (
                              <button
                                type="button"
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-all ${
                                  copiedMessageId === String(msg.id || '')
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-100'
                                }`}
                                onClick={() => void handleCopyMessage(String(msg.id || ''), String(msg.content || ''))}
                                title={copiedMessageId === String(msg.id || '') ? appRuntimeText.copied : appRuntimeText.copy}
                              >
                                {copiedMessageId === String(msg.id || '') ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              </button>
                            ) : null}

                          </div>
                        </div>
                      )

                        if (!isCollapsibleProcessRow) return body

                        return (
                          <AnimatePresence initial={false}>
                            {processRowVisible ? (
                              <motion.div
                                key={`turn-process-row:${String(msg.id || '')}`}
                                initial={{ gridTemplateRows: '0fr', opacity: 0 }}
                                animate={{ gridTemplateRows: '1fr', opacity: 1 }}
                                exit={{ gridTemplateRows: '0fr', opacity: 0 }}
                                transition={collapseAnimTransition}
                                className="overflow-hidden"
                                style={{ display: 'grid', willChange: 'grid-template-rows,opacity' }}
                              >
                                <div className="min-h-0 overflow-hidden">
                                  <motion.div
                                    initial={collapseContentAnim.initial}
                                    animate={collapseContentAnim.animate}
                                    exit={collapseContentAnim.exit}
                                    transition={collapseContentAnim.transition}
                                  >
                                    {body}
                                  </motion.div>
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        )
                      })()}
                    </div>
                    )
                    })()}
                    </Fragment>
                    )
                  })}
                        <div ref={chatBottomSentinelRef} aria-hidden="true" className="h-px w-full" />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </main>
            {userNavItems.length > 0 && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 h-[260px] w-6 z-20 no-drag group pointer-events-auto">
                <div className="flex flex-col h-full items-center select-none">
                  <button
                    type="button"
                    className="h-6 w-6 rounded-md bg-background/60 backdrop-blur text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground hover:bg-background/80"
                    onClick={scrollToTop}
                  >
                    <ChevronDown className="w-3.5 h-3.5 rotate-180 mx-auto" />
                  </button>
                  <div
                    className="relative flex-1 w-3 my-2 rounded-full overflow-visible"
                    onMouseLeave={() => setNavHover(null)}
                  >
                    <div className="absolute inset-0 rounded-full bg-muted/10 opacity-0 group-hover:opacity-100 transition-opacity" />

                    {userNavItems.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        className={`absolute right-0 h-1 rounded-full bg-muted-foreground/45 hover:bg-primary opacity-35 hover:opacity-100 group-hover:opacity-90 transition-opacity transition-colors ${it.id === highlightUserMsgId ? 'bg-primary opacity-100' : ''}`}
                        style={{ top: `${it.topRatio * 100}%`, width: `${it.widthPx}px`, transform: 'translateY(-50%)' }}
                        onClick={() => scrollToUserMessage(it.id)}
                        onMouseEnter={() => setNavHover({ id: it.id, topRatio: it.topRatio, content: it.content })}
                        title={String(it.content || '').slice(0, 80)}
                      />
                    ))}

                    {navHover && (
                      <div
                        className="absolute right-full mr-2 w-[320px] max-w-[320px] max-h-[220px] overflow-auto px-3 py-2 rounded-xl bg-background/90 backdrop-blur border border-border/60 text-[12px] text-foreground shadow-sm whitespace-pre-wrap break-words"
                        style={{ top: `${navHover.topRatio * 100}%`, transform: 'translateY(-50%)' }}
                      >
                        {navHover.content || '—'}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="h-6 w-6 rounded-md bg-background/60 backdrop-blur text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground hover:bg-background/80"
                    onClick={scrollToBottom}
                  >
                    <ChevronDown className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {showScrollToBottom ? (
                <motion.div
                  key="scroll-to-bottom"
                  initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 no-drag"
                >
                  <TooltipProvider>
                    <Tooltip delayDuration={150}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-full bg-transparent hover:bg-muted/40 text-primary/80 hover:text-primary transition-colors"
                          onClick={() => {
                            lastSeenMessageKeyRef.current = lastMessageKey
                            setShowScrollToBottom(false)
                            setChatIsAtBottom(true)
                            chatIsAtBottomRef.current = true
                            userScrollLockedRef.current = false
                            const el = chatScrollRef.current
                            if (el) {
                              markProgrammaticScroll()
                              el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
                            }
                            startAutoScroll({ force: true })
                          }}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{i18nText(appLang, 'app.newContentBelow')}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <footer className="pl-6 pr-6 pt-6 pb-0 no-drag overflow-visible">
              <div className="max-w-[50rem] mx-auto relative bg-white rounded-xl border border-border px-2 py-1.5 transition-all duration-200 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_14px_-12px_rgba(0,0,0,0.24)]">
                  {composer.attachments.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 px-1">
                      {composer.attachments.map((a) => {
                        const p = String(a.path || '').trim()
                        if (!p) return null
                        const name = p.split('/').pop() || p
                        const lower = name.toLowerCase()
                        const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lower)
                        const ws = resolveWorkspaceDir()
                        const src =
                          isImage && backendBaseUrl
                            ? `${backendBaseUrl}/api/attachments/file?path=${encodeURIComponent(p)}${ws ? `&workspaceDir=${encodeURIComponent(ws)}` : ''}`
                            : ''

                        return (
                          <div key={a.id} className="group relative shrink-0">
                            {isImage && src ? (
                              <img
                                src={src}
                                alt={name}
                                className="h-14 w-14 rounded-2xl border border-black/6 object-cover"
                              />
                            ) : (
                              <div className="h-14 max-w-[220px] rounded-2xl border border-black/6 bg-black/[0.03] px-2 py-1.5 flex items-center">
                                <div className="text-xs truncate">{name}</div>
                              </div>
                            )}
                            <button
                              type="button"
                              className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/95 border border-black/10 shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center"
                              onClick={() => updateComposer({ attachments: composer.attachments.filter((x) => x.id !== a.id) })}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <ChatComposer
                    placeholder={t.typeMessage}
                    isLoading={isLoading}
                    onSend={handleSend}
                    onTabComplete={handleTabComplete}
                    slashCommands={slashCommands}
                    slashEmptyLabel={slashText.empty}
                    slashMenuTitle={slashText.menuTitle}
                    slashMenuHint={slashText.menuHint}
                    slashSourceLabels={{ builtin: slashText.builtIn, project: slashText.project }}
                    slashCommandSectionLabel={slashText.commandSection}
                    slashSkillSectionLabel={slashText.skillSection}
                    slashCommandKindLabel={slashText.kindCommand}
                    slashSkillKindLabel={slashText.kindSkill}
                    slashSkills={slashSkills}
                    slashSkillSourceLabels={{ personal: slashText.personal, system: slashText.system }}
                    slashNoSkillsLabel={slashText.noSkills}
                    onNeedLoadSkills={() => {
                      void ensureSkills()
                    }}
                    tabApplyHint={t.composer.completionApplyHint}
                    spellSuggestEnabled={composer.completionSpellSuggestEnabled !== false}
                    onExecuteSlashCommand={handleExecuteSlashCommand}
                    onStop={handleStop}
                    onPasteImage={handleComposerPaste}
                    onApi={(api) => {
                      composerApiRef.current = api
                    }}
                    isRecording={isRecording}
                    isVoiceModelAvailable={isVoiceModelAvailable}
                    onToggleRecording={() => {
                      if (!isRecording && !isVoiceModelAvailable) {
                        alert(i18nText(appLang, 'app.configureModelFirst'))
                        return
                      }
                      void toggleRecording()
                    }}
                    leftControls={
                      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden text-muted-foreground">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-full shrink-0 text-muted-foreground/80 hover:text-foreground hover:bg-black/5 focus-visible:ring-0 focus-visible:ring-offset-0"
                          onClick={() => void handlePickFiles()}
                        >
                          <Paperclip className="w-4 h-4" />
                        </Button>

                        {showComposerToolSkillEntrances ? (
                          <>
                            <Popover open={popoverPanel === 'tools'} onOpenChange={(open) => handlePopoverOpenChange('tools', open)}>
                              <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('tools')} onMouseLeave={handleInputPanelMouseLeave}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-black/5 focus-visible:ring-0 focus-visible:ring-offset-0"
                                >
                                  <Wrench className="w-4 h-4" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80" align="start" onMouseEnter={() => handleMouseEnter('tools')} onMouseLeave={handleMouseLeave}>
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <h4 className="font-medium text-xs leading-none">{t.composer.tools}</h4>
                                    <select
                                      className="text-xs border rounded px-2 py-1"
                                      value={composer.toolMode}
                                      onChange={(e) => updateComposer({ toolMode: e.target.value as any })}
                                    >
                                      <option value="auto">{t.composer.auto}</option>
                                      <option value="all">{t.composer.all}</option>
                                      <option value="disabled">{t.composer.disabled}</option>
                                    </select>
                                  </div>

                                  <div className="space-y-2">
                                    <h5 className="text-[11px] font-medium text-muted-foreground uppercase">{i18nText(appLang, 'common.builtIn')}</h5>
                                    <ScrollArea className="h-[240px]">
                                      <div className="flex flex-col gap-1 pr-3">
                                        {builtinTools.map((tool) => (
                                          <div key={tool.id} className="flex items-center space-x-2">
                                            <Checkbox
                                              className="rounded-none"
                                              id={tool.id}
                                              checked={composer.enabledToolIds.includes(tool.id)}
                                              onCheckedChange={(checked) =>
                                                updateComposer({ enabledToolIds: toggleId(composer.enabledToolIds, tool.id, !!checked) })
                                              }
                                            />
                                            <label htmlFor={tool.id} className="text-xs leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                              {tool.name}
                                            </label>
                                          </div>
                                        ))}
                                      </div>
                                    </ScrollArea>
                                  </div>

                                  <div className="space-y-2">
                                    <h5 className="text-[11px] font-medium text-muted-foreground uppercase">{t.composer.mcpServers}</h5>
                                    {settings.mcpServers.length === 0 ? (
                                      <div className="text-xs text-muted-foreground">—</div>
                                    ) : (
                                      <ScrollArea className="h-[200px]">
                                        <div className="space-y-1">
                                          {settings.mcpServers.map((s) => (
                                            <div key={s.id} className="flex items-center space-x-2">
                                              <Checkbox
                                                className="rounded-none"
                                                id={s.id}
                                                checked={composer.enabledMcpServerIds.includes(s.id)}
                                                onCheckedChange={(checked) =>
                                                  updateComposer({ enabledMcpServerIds: toggleId(composer.enabledMcpServerIds, s.id, !!checked) })
                                                }
                                              />
                                              <label htmlFor={s.id} className="text-xs leading-none">
                                                <span className="block font-medium">{s.name || s.id}</span>
                                                <span className="block text-[10px] text-muted-foreground truncate w-[200px]">{s.url}</span>
                                              </label>
                                            </div>
                                          ))}
                                        </div>
                                      </ScrollArea>
                                    )}
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>

                            <Popover open={popoverPanel === 'skills'} onOpenChange={(open) => handlePopoverOpenChange('skills', open)}>
                              <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('skills')} onMouseLeave={handleInputPanelMouseLeave}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-black/5 focus-visible:ring-0 focus-visible:ring-offset-0"
                                >
                                  <Sparkles className="w-4 h-4" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-[460px] p-0 overflow-hidden border border-border/70 bg-popover shadow-[0_20px_56px_-28px_rgba(0,0,0,0.45)]"
                                align="start"
                                onMouseEnter={() => handleMouseEnter('skills')}
                                onMouseLeave={handleMouseLeave}
                              >
                                <div className="border-b border-border/60 bg-muted/25 px-3 py-2.5 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <h4 className="font-medium text-xs leading-none tracking-[0.02em]">{t.composer.skills}</h4>
                                    <select
                                      className="h-7 rounded-md border border-border/70 bg-background px-2 text-xs"
                                      value={composer.skillMode}
                                      onChange={(e) => updateComposer({ skillMode: e.target.value as any })}
                                    >
                                      <option value="auto">{t.composer.auto}</option>
                                      <option value="all">{t.composer.all}</option>
                                      <option value="disabled">{t.composer.disabled}</option>
                                    </select>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-muted-foreground">{t.composer.skillsLoaded(skillsCache.length)}</span>
                                    <div className="flex gap-1.5">
                                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => void ensureSkills()}>
                                        {t.composer.refresh}
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => void openSkillsFolder()}>
                                        {t.composer.openFolder}
                                      </Button>
                                    </div>
                                  </div>
                                </div>

                                {skillsCache.length === 0 ? (
                                  <div className="px-3 py-4 text-xs text-muted-foreground">—</div>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-[minmax(0,1fr),auto] items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-muted-foreground border-b border-border/60">
                                      <span>{t.composer.skillName}</span>
                                      <span>{t.composer.skillType}</span>
                                    </div>
                                    <ScrollArea className="h-[320px]">
                                      <div>
                                        {skillsCache.map((s) => {
                                          const typeLabel = String(s.dir || '').includes('/.system/')
                                            ? t.composer.skillTypeSystem
                                            : t.composer.skillTypePersonal
                                          return (
                                            <label
                                              key={s.id}
                                              htmlFor={`skill-${s.id}`}
                                              className="grid grid-cols-[auto,minmax(0,1fr),auto] items-start gap-2 px-3 py-2.5 border-b border-border/45 hover:bg-accent/35 transition-colors cursor-pointer"
                                            >
                                              <Checkbox
                                                className="mt-0.5 rounded-[4px]"
                                                id={`skill-${s.id}`}
                                                disabled={s.isValid === false}
                                                checked={composer.enabledSkillIds.includes(s.id)}
                                                onCheckedChange={(checked) => updateComposer({ enabledSkillIds: toggleId(composer.enabledSkillIds, s.id, !!checked) })}
                                              />
                                              <div className="min-w-0 space-y-1">
                                                <div className="text-xs font-medium leading-none truncate">{s.name || s.id}</div>
                                                <div className="text-[11px] text-muted-foreground line-clamp-2 leading-4">{s.description || s.id}</div>
                                                {s.isValid === false ? (
                                                  <div className="text-[10px] text-destructive line-clamp-2">
                                                    {Array.isArray(s.errors) && s.errors.length ? s.errors.join(', ') : t.composer.invalid}
                                                  </div>
                                                ) : null}
                                              </div>
                                              <div className="pt-0.5">
                                                <Badge variant="outline" className="h-5 rounded-md px-2 text-[10px] font-normal">
                                                  {typeLabel}
                                                </Badge>
                                              </div>
                                            </label>
                                          )
                                        })}
                                      </div>
                                    </ScrollArea>
                                  </>
                                )}
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : null}

                        <Popover open={popoverPanel === 'model'} onOpenChange={(open) => handlePopoverOpenChange('model', open)}>
                          <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('model')} onMouseLeave={handleInputPanelMouseLeave}>
                            <Button
                              variant="ghost"
                              className="h-9 rounded-full gap-2 px-3.5 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-black/5 shrink min-w-0 max-w-[220px] focus-visible:ring-0 focus-visible:ring-offset-0"
                            >
                              {effectiveProvider ? <MaskedIcon url={getProviderIconUrl(effectiveProvider)} className="w-3.5 h-3.5 shrink-0" /> : null}
                              <span className="truncate">{effectiveModel || 'Anima'}</span>
                              <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px]" align="start" onMouseEnter={() => handleMouseEnter('model')} onMouseLeave={handleMouseLeave}>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="font-medium text-xs leading-none">{t.composer.model}</h4>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{i18nText(appLang, 'common.auto')}</span>
                                  <Switch checked={isAutoModel} onCheckedChange={toggleAutoModel} />
                                </div>
                              </div>
                              <ScrollArea className="h-[240px]">
                                <div className="space-y-4 pr-3">
                                  {sortedProviders.map((p) => {
                                    const iconUrl = getProviderIconUrl(p)
                                    const models = Array.isArray(p.config?.models) ? p.config.models : []
                                    const isProviderSelected = String(p.id) === effectiveProviderId

                                    return (
                                      <div key={p.id} className="space-y-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold border bg-muted/50">
                                            {iconUrl ? <MaskedIcon url={iconUrl} className="w-3.5 h-3.5" /> : String(p.name || p.id || '?')[0]}
                                          </div>
                                          <span className="text-xs font-medium">{p.name}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                          {models.map((m) => {
                                            const modelId = typeof m === 'string' ? m : m.id
                                            const isEnabled = typeof m === 'string' ? true : m.isEnabled
                                            if (!isEnabled) return null

                                            const selected = isProviderSelected && effectiveModel === modelId
                                            return (
                                              <Badge
                                                key={`${p.id}:${modelId}`}
                                                variant={selected ? 'default' : 'outline'}
                                                className="cursor-pointer font-normal"
                                                onClick={() => updateComposer({ providerOverrideId: p.id, modelOverride: modelId })}
                                              >
                                                {modelId}
                                              </Badge>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </ScrollArea>
                            </div>
                          </PopoverContent>
                        </Popover>

                        {effectiveProvider ? (
                          <Popover open={popoverPanel === 'thinking'} onOpenChange={(open) => handlePopoverOpenChange('thinking', open)}>
                            <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('thinking')} onMouseLeave={handleInputPanelMouseLeave}>
                            <Button
                              variant="ghost"
                              className="h-9 rounded-full gap-1.5 px-3 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-black/5 shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                            >
                              <Brain className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate">
                                {{
                                  off: t.composer.thinkingOff,
                                  low: t.composer.thinkingLow,
                                  medium: t.composer.thinkingMedium,
                                  high: t.composer.thinkingHigh,
                                  xhigh: t.composer.thinkingXHigh
                                }[thinkingLevel] || t.composer.thinkingMedium}
                                </span>
                                <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-44 p-1"
                              align="start"
                              side="top"
                              sideOffset={8}
                              onMouseEnter={() => handleMouseEnter('thinking')}
                              onMouseLeave={handleMouseLeave}
                            >
                              <div className="px-2 py-1">
                                <h4 className="font-medium text-xs leading-none">{t.composer.thinkingSelect}</h4>
                              </div>
                              {[
                                { value: 'off', label: t.composer.thinkingOff },
                                { value: 'low', label: t.composer.thinkingLow },
                                { value: 'medium', label: t.composer.thinkingMedium },
                                { value: 'high', label: t.composer.thinkingHigh },
                                { value: 'xhigh', label: t.composer.thinkingXHigh }
                              ].map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  className="w-full h-8 px-2 rounded-md text-xs flex items-center justify-between hover:bg-black/5"
                                  onClick={() => {
                                    updateComposer({ thinkingLevel: opt.value as any })
                                    setPopoverPanel('')
                                  }}
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <Brain className="w-3.5 h-3.5 text-muted-foreground" />
                                    {opt.label}
                                  </span>
                                  {thinkingLevel === opt.value ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5" />}
                                </button>
                              ))}
                            </PopoverContent>
                          </Popover>
                        ) : null}

                      </div>
                    }
                  />
              </div>
              <div className="max-w-[50rem] mx-auto mt-2 px-1 w-full">
                <div className="w-full flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Popover open={popoverPanel === 'permission'} onOpenChange={(open) => handlePopoverOpenChange('permission', open)}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 rounded-md gap-1.5 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-black/5 shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                          title={t.composer.permission}
                        >
                          <Shield className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">
                            {permissionMode === 'full_access' ? t.composer.permissionFull : t.composer.permissionDefault}
                          </span>
                          <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-44 p-1" align="start" side="top" sideOffset={8}>
                        <div className="px-2 py-1">
                          <h4 className="font-medium text-xs leading-none">{t.composer.permission}</h4>
                        </div>
                        {[
                          { value: 'workspace_whitelist', label: t.composer.permissionDefault },
                          { value: 'full_access', label: t.composer.permissionFull }
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            className="w-full h-8 px-2 rounded-md text-xs flex items-center justify-between hover:bg-black/5"
                            onClick={() => handlePermissionModeChange(opt.value as 'workspace_whitelist' | 'full_access')}
                          >
                            <span>{opt.label}</span>
                            {permissionMode === opt.value ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5" />}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>

                    <Popover open={popoverPanel === 'completion'} onOpenChange={(open) => handlePopoverOpenChange('completion', open)}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 rounded-md gap-1.5 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-black/5 shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                          title={t.composer.completion}
                        >
                          <Sparkles className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{t.composer.completion}</span>
                          <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3 space-y-3" align="start" side="top" sideOffset={8}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs">{t.composer.completionEnable}</span>
                          <Switch
                            checked={composer.completionEnabled !== false}
                            onCheckedChange={(checked) => updateComposer({ completionEnabled: Boolean(checked) })}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs">{t.composer.completionTranslate}</span>
                          <Switch
                            checked={composer.completionTranslateEnabled !== false}
                            onCheckedChange={(checked) => updateComposer({ completionTranslateEnabled: Boolean(checked) })}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs">{t.composer.completionSpellSuggest}</span>
                          <Switch
                            checked={composer.completionSpellSuggestEnabled !== false}
                            onCheckedChange={(checked) => updateComposer({ completionSpellSuggestEnabled: Boolean(checked) })}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs">{t.composer.completionContextLimit}</span>
                          <select
                            className="h-7 rounded-md border bg-background px-2 text-xs"
                            value={String(Math.max(0, Math.min(12, Number(composer.completionContextLimit ?? 4) || 4)))}
                            onChange={(e) => updateComposer({ completionContextLimit: Number(e.target.value) })}
                          >
                            {[0, 2, 4, 6, 8, 10, 12].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Popover
                      open={popoverPanel === 'git_branch'}
                      onOpenChange={(open) => {
                        setPopoverPanel(open ? 'git_branch' : '')
                        if (open) void refreshGitBranches()
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          className="h-8 rounded-md gap-1.5 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground hover:bg-black/5 shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                          title={topGitRepoDir ? topGitRepoDir : i18nText(appLang, 'app.noGitRepo')}
                        >
                          <GitBranch className="w-3.5 h-3.5 shrink-0" />
                          <span className="max-w-[140px] truncate">{topGitRepoDir ? (topGitBranch || 'HEAD') : i18nText(appLang, 'app.noGitRepo')}</span>
                          <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-1.5" align="end" side="top" sideOffset={8}>
                        {!topGitRepoDir ? (
                          <div className="px-2 py-2 text-xs text-muted-foreground">{i18nText(appLang, 'app.currentProjectNotGitRepo')}</div>
                        ) : (
                          <div className="space-y-1">
                            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase">{i18nText(appLang, 'app.branches')}</div>
                            {gitBranchLoading ? (
                              <div className="px-2 py-2 text-xs text-muted-foreground">{i18nText(appLang, 'common.loading')}</div>
                            ) : (
                              (gitBranches.length ? gitBranches : [topGitBranch || 'HEAD']).map((b) => {
                                const branch = String(b || '').trim()
                                const selected = branch && branch === topGitBranch
                                return (
                                  <button
                                    key={branch || 'HEAD'}
                                    type="button"
                                    className="w-full h-8 px-2 rounded-md text-xs flex items-center justify-between hover:bg-black/5"
                                    onClick={() => {
                                      void switchGitBranch(branch)
                                      setPopoverPanel('')
                                    }}
                                  >
                                    <span className="inline-flex items-center gap-1.5 truncate">
                                      <GitBranch className="w-3.5 h-3.5 shrink-0" />
                                      <span className="truncate">{branch || 'HEAD'}</span>
                                    </span>
                                    {selected ? <Check className="w-3.5 h-3.5" /> : null}
                                  </button>
                                )
                              })
                            )}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>

                    <TooltipProvider>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full transition-colors text-muted-foreground hover:text-foreground hover:bg-black/5 cursor-default focus-visible:ring-0 focus-visible:ring-offset-0"
                          >
                            <CircularProgress value={usageStats.percentage} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <div className="flex flex-col gap-1">
                            <div className="font-medium">
                              {i18nText(appLang, 'app.contextUsage', {
                                percent: usageStats.percentage > 0 ? `${usageStats.percentage.toFixed(1)}%` : '0%'
                              })}
                            </div>
                            <div className="text-muted-foreground">
                              {i18nText(appLang, 'app.contextUsed', { used: formatTokenCount(usageStats.used) })}
                            </div>
                            {usageStats.total > 0 && (
                              <div className="text-muted-foreground">
                                {i18nText(appLang, 'app.contextLimit', { limit: formatTokenCount(usageStats.total) })}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
              </footer>
              </div>
            </div>
            </div>
            </div>
            <div className="relative h-full shrink-0 flex">
              <RightSidebar width={rightWidth} onResizeStart={() => setIsResizingRight(true)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ChatComposer({
  placeholder,
  isLoading,
  onSend,
  onTabComplete,
  slashCommands,
  slashEmptyLabel,
  slashMenuTitle,
  slashMenuHint,
  slashSourceLabels,
  slashCommandSectionLabel,
  slashSkillSectionLabel,
  slashCommandKindLabel,
  slashSkillKindLabel,
  slashSkills,
  slashSkillSourceLabels,
  slashNoSkillsLabel,
  onNeedLoadSkills,
  tabApplyHint,
  spellSuggestEnabled,
  onExecuteSlashCommand,
  onStop,
  onPasteImage,
  onApi,
  isRecording,
  isVoiceModelAvailable,
  onToggleRecording,
  leftControls
}: {
  placeholder: string
  isLoading: boolean
  onSend: (text: string) => Promise<boolean>
  onTabComplete?: (
    text: string,
    mode?: 'complete' | 'translate' | 'spell_suggest',
    options?: { clickedWord?: string }
  ) => Promise<TabCompleteResult | null>
  slashCommands: SlashCommandEntry[]
  slashEmptyLabel: string
  slashMenuTitle: string
  slashMenuHint: string
  slashSourceLabels: { builtin: string; project: string }
  slashCommandSectionLabel: string
  slashSkillSectionLabel: string
  slashCommandKindLabel: string
  slashSkillKindLabel: string
  slashSkills: Array<{ id: string; name: string; description?: string; source: 'personal' | 'system'; isEnabled: boolean }>
  slashSkillSourceLabels: { personal: string; system: string }
  slashNoSkillsLabel: string
  onNeedLoadSkills?: () => void
  tabApplyHint: string
  spellSuggestEnabled: boolean
  onExecuteSlashCommand: (rawInput: string) => Promise<{ handled: boolean; clearValue?: boolean; nextValue?: string }>
  onStop: () => void
  onPasteImage?: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  onApi?: (api: {
    appendText: (text: string) => void
    setVoiceDraft: (finalText: string, interimText: string) => void
    commitVoiceFinal: (text: string) => void
    clearVoiceDraft: () => void
  }) => void
  isRecording: boolean
  isVoiceModelAvailable: boolean
  onToggleRecording: () => void
  leftControls: ReactNode
}): JSX.Element {
  const uiLang = resolveAppLang(useStore((s) => s.settings?.language))
  const [value, setValue] = useState('')
  const [pendingTabCompletion, setPendingTabCompletion] = useState<{
    base: string
    suggestion: string
    mode: TabCompleteResult['mode']
    nextValue: string
  } | null>(null)
  const [spellSuggestState, setSpellSuggestState] = useState<{
    start: number
    end: number
    word: string
    candidates: string[]
    activeIndex: number
  } | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const voiceAnchorRef = useRef<number | null>(null)
  const tabCompleteRunningRef = useRef(false)
  const spellSuggestRunningRef = useRef(false)
  const lastAutoSpellKeyRef = useRef('')
  const tabChordTimerRef = useRef<number | null>(null)
  const tabChordBaseRef = useRef('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const slashMenuRef = useRef<HTMLDivElement | null>(null)
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const reduceMotion = useReducedMotion()
  const actionButtonSizeClass = 'h-8 w-8 p-0 rounded-full'

  const isSpellTokenChar = (ch: string): boolean => /[A-Za-z'-]/.test(ch)
  const isEnglishToken = (word: string): boolean => /^[A-Za-z][A-Za-z'-]{0,39}$/.test(word)
  const resolveWordRangeAtCaret = useCallback((text: string, caret: number) => {
    const s = String(text || '')
    const n = s.length
    if (!n) return null
    const pos = Math.max(0, Math.min(n, Number.isFinite(caret) ? caret : 0))
    const anchor = pos > 0 && isSpellTokenChar(s[pos - 1] || '') ? pos - 1 : pos
    if (!isSpellTokenChar(s[anchor] || '')) return null
    let start = anchor
    while (start > 0 && isSpellTokenChar(s[start - 1] || '')) start -= 1
    let end = anchor + 1
    while (end < n && isSpellTokenChar(s[end] || '')) end += 1
    const word = s.slice(start, end)
    if (!isEnglishToken(word)) return null
    return { start, end, word }
  }, [])
  const applySpellCandidate = useCallback((candidate: string) => {
    const picked = String(candidate || '').trim()
    if (!picked || !spellSuggestState) return
    const { start, end } = spellSuggestState
    setValue((prev) => `${prev.slice(0, start)}${picked}${prev.slice(end)}`)
    setSpellSuggestState(null)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [spellSuggestState])
  const handleWordClickSuggest = useCallback((clientX: number, clientY: number) => {
    if (!spellSuggestEnabled) return
    if (!onTabComplete) return
    const probe = window.anima?.spell?.probeAtPoint
    if (!probe) return
    window.setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      const caret = Number(el.selectionStart ?? 0)
      const range = resolveWordRangeAtCaret(value, caret)
      if (!range) {
        setSpellSuggestState(null)
        return
      }
      void (async () => {
        const probeRes = await probe({ x: Math.round(clientX), y: Math.round(clientY) }).catch(() => null)
        if (!probeRes || !probeRes.ok) {
          setSpellSuggestState(null)
          return
        }
        if (parseSlashInput(value)?.shouldSuggest) {
          setSpellSuggestState(null)
          return
        }
        const misspelledWord = String(probeRes.misspelledWord || '').trim()
        if (!misspelledWord) {
          setSpellSuggestState(null)
          return
        }
        if (misspelledWord.toLowerCase() !== range.word.toLowerCase()) {
          setSpellSuggestState(null)
          return
        }
        const completed = await onTabComplete(value, 'spell_suggest', { clickedWord: range.word })
        const candidates = Array.isArray(completed?.candidates) ? completed!.candidates!.map((x) => String(x || '').trim()).filter(Boolean) : []
        if (!candidates.length) {
          setSpellSuggestState(null)
          return
        }
        setSpellSuggestState({
          start: range.start,
          end: range.end,
          word: range.word,
          candidates,
          activeIndex: 0
        })
      })()
    }, 0)
  }, [onTabComplete, resolveWordRangeAtCaret, spellSuggestEnabled, value])
  const resolvePrevWordRangeBeforeCaret = useCallback((text: string, caret: number) => {
    const s = String(text || '')
    const n = s.length
    if (!n) return null
    let i = Math.max(0, Math.min(n, Number.isFinite(caret) ? caret : 0)) - 1
    while (i >= 0 && !isSpellTokenChar(s[i] || '')) i -= 1
    if (i < 0) return null
    const end = i + 1
    while (i >= 0 && isSpellTokenChar(s[i] || '')) i -= 1
    const start = i + 1
    const word = s.slice(start, end)
    if (!isEnglishToken(word)) return null
    return { start, end, word }
  }, [])
  const resolveWordProbePoint = useCallback((
    el: HTMLTextAreaElement,
    text: string,
    range: { start: number; end: number }
  ): { x: number; y: number } | null => {
    if (!document?.body) return null
    const computed = window.getComputedStyle(el)
    const mirror = document.createElement('div')
    mirror.style.position = 'fixed'
    mirror.style.left = '-100000px'
    mirror.style.top = '0'
    mirror.style.visibility = 'hidden'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordBreak = 'break-word'
    mirror.style.overflowWrap = 'break-word'
    mirror.style.width = `${el.clientWidth}px`
    mirror.style.font = computed.font
    mirror.style.fontSize = computed.fontSize
    mirror.style.fontFamily = computed.fontFamily
    mirror.style.fontWeight = computed.fontWeight
    mirror.style.fontStyle = computed.fontStyle
    mirror.style.letterSpacing = computed.letterSpacing
    mirror.style.lineHeight = computed.lineHeight
    mirror.style.padding = computed.padding
    mirror.style.border = '0'
    mirror.style.boxSizing = computed.boxSizing
    mirror.style.textTransform = computed.textTransform
    mirror.style.textIndent = computed.textIndent
    mirror.style.tabSize = computed.tabSize
    mirror.style.webkitTextSizeAdjust = computed.webkitTextSizeAdjust

    const before = text.slice(0, range.start)
    const word = text.slice(range.start, range.end) || ' '
    mirror.textContent = before
    const span = document.createElement('span')
    span.textContent = word
    mirror.appendChild(span)
    document.body.appendChild(mirror)

    try {
      const mirrorRect = mirror.getBoundingClientRect()
      const wordRect = span.getBoundingClientRect()
      const hostRect = el.getBoundingClientRect()
      const offsetX = wordRect.left - mirrorRect.left - el.scrollLeft
      const offsetY = wordRect.top - mirrorRect.top - el.scrollTop
      const width = Math.max(1, wordRect.width)
      const height = Math.max(1, wordRect.height)
      const x = Math.round(hostRect.left + offsetX + Math.min(width - 1, Math.max(1, width / 2)))
      const y = Math.round(hostRect.top + offsetY + Math.min(height - 1, Math.max(1, height / 2)))
      return { x, y }
    } catch {
      return null
    } finally {
      mirror.remove()
    }
  }, [])
  const triggerAutoSpellSuggestOnBlur = useCallback((nextValue: string, caret: number | null | undefined) => {
    if (!spellSuggestEnabled) return
    if (!onTabComplete) return
    const probe = window.anima?.spell?.probeAtPoint
    const el = inputRef.current
    if (!probe || !el) return
    if (Boolean(parseSlashInput(nextValue)?.shouldSuggest)) return
    if (spellSuggestRunningRef.current) return
    const text = String(nextValue || '')
    if (!text.trim()) return
    const pos = Number.isFinite(Number(caret)) ? Number(caret) : text.length
    if (pos > 0 && isSpellTokenChar(text[pos - 1] || '')) return
    const range = resolvePrevWordRangeBeforeCaret(text, pos)
    if (!range) return
    const probePoint = resolveWordProbePoint(el, text, range)
    if (!probePoint) return
    const key = `${range.start}:${range.end}:${range.word}:${text}`
    if (lastAutoSpellKeyRef.current === key) return
    spellSuggestRunningRef.current = true
    void (async () => {
      try {
        const probeRes = await probe({ x: probePoint.x, y: probePoint.y }).catch(() => null)
        if (!probeRes || !probeRes.ok) {
          setSpellSuggestState(null)
          return
        }
        const misspelledWord = String(probeRes.misspelledWord || '').trim()
        if (!misspelledWord || misspelledWord.toLowerCase() !== range.word.toLowerCase()) {
          setSpellSuggestState(null)
          return
        }
        lastAutoSpellKeyRef.current = key
        const completed = await onTabComplete(text, 'spell_suggest', { clickedWord: range.word })
        const candidates = Array.isArray(completed?.candidates) ? completed!.candidates!.map((x) => String(x || '').trim()).filter(Boolean) : []
        if (!candidates.length) {
          setSpellSuggestState(null)
          return
        }
        setSpellSuggestState({
          start: range.start,
          end: range.end,
          word: range.word,
          candidates,
          activeIndex: 0
        })
      } finally {
        spellSuggestRunningRef.current = false
      }
    })()
  }, [onTabComplete, resolvePrevWordRangeBeforeCaret, resolveWordProbePoint, spellSuggestEnabled])

  const slashInput = useMemo(() => parseSlashInput(value), [value])
  const exactSlashCommand = useMemo(
    () => (slashInput?.name ? slashCommands.find((item) => item.name === slashInput.name) || null : null),
    [slashCommands, slashInput?.name]
  )
  const slashSuggestions = useMemo(() => {
    if (!slashInput?.shouldSuggest) return []
    return filterSlashCommands(slashCommands, slashInput.query)
  }, [slashCommands, slashInput])
  const slashSkillSuggestions = useMemo(() => {
    if (!slashInput?.shouldSuggest) return []
    const q = String(slashInput.query || '').trim().toLowerCase()
    if (!q) return slashSkills
    return slashSkills.filter((item) => {
      const name = String(item.name || '').toLowerCase()
      const id = String(item.id || '').toLowerCase()
      const desc = String(item.description || '').toLowerCase()
      return name.includes(q) || id.includes(q) || desc.includes(q)
    })
  }, [slashInput, slashSkills])
  const slashMenuOpen = Boolean(slashInput?.shouldSuggest && !slashDismissed)
  const activeSlashSuggestion = slashSuggestions[Math.min(slashIndex, Math.max(0, slashSuggestions.length - 1))] || null
  const selectedSlashCommand = useMemo(() => {
    if (!slashDismissed || !exactSlashCommand || !slashInput?.name) return null
    return exactSlashCommand
  }, [exactSlashCommand, slashDismissed, slashInput?.name])
  const selectedSlashPrefix = selectedSlashCommand ? `/${selectedSlashCommand.name}` : ''
  const inputDisplayValue = useMemo(() => {
    if (!selectedSlashCommand) return value
    if (value === selectedSlashPrefix) return ''
    if (value.startsWith(`${selectedSlashPrefix} `)) return value.slice(selectedSlashPrefix.length + 1)
    return value
  }, [selectedSlashCommand, selectedSlashPrefix, value])

  useEffect(() => {
    setSlashIndex(0)
  }, [value, slashCommands])

  useEffect(() => {
    if (!pendingTabCompletion) return
    if (value !== pendingTabCompletion.base) {
      setPendingTabCompletion(null)
    }
  }, [pendingTabCompletion, value])

  useEffect(() => {
    if (spellSuggestEnabled) return
    setSpellSuggestState(null)
  }, [spellSuggestEnabled])

  useEffect(() => {
    if (!spellSuggestState) return
    const { start, end } = spellSuggestState
    if (start < 0 || end <= start || end > value.length) {
      setSpellSuggestState(null)
      return
    }
    const nextWord = value.slice(start, end)
    if (!nextWord || nextWord.toLowerCase() !== spellSuggestState.word.toLowerCase()) {
      setSpellSuggestState(null)
    }
  }, [spellSuggestState, value])

  useEffect(() => {
    return () => {
      if (tabChordTimerRef.current != null) {
        window.clearTimeout(tabChordTimerRef.current)
        tabChordTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!slashMenuOpen || !slashSuggestions.length) return
    const nextIndex = Math.min(slashIndex, Math.max(0, slashSuggestions.length - 1))
    const node = slashItemRefs.current[nextIndex]
    if (!node) return
    node.scrollIntoView({ block: 'nearest' })
  }, [slashIndex, slashMenuOpen, slashSuggestions.length])

  useEffect(() => {
    if (!slashMenuOpen) return
    if (!onNeedLoadSkills) return
    onNeedLoadSkills()
  }, [slashMenuOpen, onNeedLoadSkills])

  const api = useMemo(() => {
    const ensureAnchor = (prev: string) => {
      if (voiceAnchorRef.current != null) return prev
      const spacer = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
      voiceAnchorRef.current = prev.length + spacer.length
      return prev + spacer
    }

    const applyDraft = (finalText: string, interimText: string) => {
      const a = String(finalText || '').trim()
      const b = String(interimText || '').trim()
      const combined = a && b ? `${a}${a.endsWith(' ') || a.endsWith('\n') ? '' : ' '}${b}` : a || b
      setValue((prev) => {
        const base = ensureAnchor(prev)
        const anchor = voiceAnchorRef.current ?? base.length
        return base.slice(0, anchor) + combined
      })
    }

    return {
      appendText: (text: string) => {
        const piece = String(text || '').trim()
        if (!piece) return
        setValue((prev) => {
          const spacer = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
          return prev + spacer + piece
        })
      },
      setVoiceDraft: (finalText: string, interimText: string) => {
        applyDraft(finalText, interimText)
      },
      commitVoiceFinal: (text: string) => {
        const piece = String(text || '').trim()
        if (!piece) {
          voiceAnchorRef.current = null
          return
        }
        setValue((prev) => {
          const base = ensureAnchor(prev)
          const anchor = voiceAnchorRef.current ?? base.length
          voiceAnchorRef.current = null
          return base.slice(0, anchor) + piece
        })
      },
      clearVoiceDraft: () => {
        setValue((prev) => {
          const anchor = voiceAnchorRef.current
          voiceAnchorRef.current = null
          if (anchor == null) return prev
          return prev.slice(0, anchor).replace(/[ \t]+$/, '')
        })
      }
    }
  }, [])

  useEffect(() => {
    if (onApi) onApi(api)
  }, [onApi, api])

  const focusInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  const applySlashSuggestion = useCallback((command: SlashCommandEntry) => {
    setSlashDismissed(true)
    setValue(`/${command.name}`)
    focusInput()
  }, [focusInput])

  const requestTabCompletion = useCallback((mode: 'complete' | 'translate', current: string) => {
    if (!onTabComplete) return
    if (tabCompleteRunningRef.current) return
    tabCompleteRunningRef.current = true
    void (async () => {
      try {
        const completed = await onTabComplete(current, mode)
        if (!completed) return
        const suggestion = String(completed.text || '').trim()
        if (!suggestion) return
        const next = applyTabCompletionSuggestion(current, completed)
        if (next && next !== current) {
          setPendingTabCompletion({
            base: current,
            suggestion,
            mode: completed.mode,
            nextValue: next
          })
        }
      } finally {
        tabCompleteRunningRef.current = false
      }
    })()
  }, [onTabComplete])

  const onSubmit = useCallback(async () => {
    if (isLoading) {
      onStop()
      return
    }
    if (spellSuggestState) setSpellSuggestState(null)
    if (tabChordTimerRef.current != null) {
      window.clearTimeout(tabChordTimerRef.current)
      tabChordTimerRef.current = null
      tabChordBaseRef.current = ''
    }
    if (pendingTabCompletion) setPendingTabCompletion(null)
    const text = String(value || '').trim()
    if (!text) return
    if (slashInput) {
      if (!exactSlashCommand && activeSlashSuggestion) {
        applySlashSuggestion(activeSlashSuggestion)
        return
      }
      const result = await onExecuteSlashCommand(text)
      if (result.handled) {
        if (typeof result.nextValue === 'string') setValue(result.nextValue)
        else if (result.clearValue !== false) setValue('')
        focusInput()
        return
      }
      return
    }
    const ok = await onSend(text)
    if (ok) setValue('')
  }, [
    activeSlashSuggestion,
    applySlashSuggestion,
    exactSlashCommand,
    focusInput,
    isLoading,
    onExecuteSlashCommand,
    onSend,
    onStop,
    pendingTabCompletion,
    slashInput,
    spellSuggestState,
    value
  ])

  return (
    <div className="relative w-full">
      {slashMenuOpen ? (
        <div className="absolute left-0 bottom-full z-40 mb-2 w-[300px] max-w-[min(100vw-2.5rem,300px)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-xs font-medium leading-none">
              {slashMenuTitle}
            </div>
            <div className="text-[11px] text-muted-foreground">{slashMenuHint}</div>
          </div>
          <div ref={slashMenuRef} className="max-h-[320px] overflow-y-auto p-1.5 custom-scrollbar">
            <div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{slashCommandSectionLabel}</div>
            {slashSuggestions.length > 0 ? (
              slashSuggestions.map((command, index) => {
                const selected = index === Math.min(slashIndex, Math.max(0, slashSuggestions.length - 1))
                return (
                  <button
                    key={`${command.source}:${command.name}`}
                    ref={(node) => {
                      slashItemRefs.current[index] = node
                    }}
                    type="button"
                    aria-selected={selected}
                    className={`group mb-1 flex w-full items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
                      selected ? 'border-border bg-accent text-accent-foreground' : 'border-transparent hover:bg-black/5'
                    }`}
                    onMouseEnter={() => setSlashIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applySlashSuggestion(command)
                    }}
                  >
                    <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${selected ? 'bg-primary' : 'bg-muted-foreground/35'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium leading-none">{command.title}</span>
                        <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                          {slashCommandKindLabel}
                        </Badge>
                        <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                          {command.source === 'project' ? slashSourceLabels.project : slashSourceLabels.builtin}
                        </Badge>
                      </div>
                      <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{command.description}</div>
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="px-2 py-2 text-xs text-muted-foreground">{slashEmptyLabel}</div>
            )}

            <div className="mt-1 border-t pt-2">
              <div className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{slashSkillSectionLabel}</div>
              {slashSkillSuggestions.length > 0 ? (
                slashSkillSuggestions.map((skill) => (
                  <div
                    key={`skill:${skill.id}`}
                    className="mb-1 flex items-start gap-2 rounded-md border border-transparent px-2 py-2 hover:bg-black/5"
                    title={skill.id}
                  >
                    <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${skill.isEnabled ? 'bg-primary' : 'bg-muted-foreground/35'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium leading-none truncate">{skill.name}</span>
                        <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                          {slashSkillKindLabel}
                        </Badge>
                        <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                          {skill.source === 'system' ? slashSkillSourceLabels.system : slashSkillSourceLabels.personal}
                        </Badge>
                      </div>
                      {skill.description ? <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{skill.description}</div> : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">{slashNoSkillsLabel}</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {spellSuggestState && !slashMenuOpen ? (
        <div className="absolute left-0 bottom-full z-40 mb-2 w-[260px] max-w-[min(100vw-2.5rem,260px)] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md">
          <div className="border-b px-3 py-2 text-[11px] text-muted-foreground">
            {i18nText(uiLang, 'app.spellSuggestions', { word: spellSuggestState.word })}
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1.5 custom-scrollbar">
            {spellSuggestState.candidates.map((candidate, idx) => {
              const selected = idx === spellSuggestState.activeIndex
              return (
                <button
                  key={`${spellSuggestState.word}:${candidate}:${idx}`}
                  type="button"
                  className={`mb-1 flex w-full items-center rounded-md border px-2 py-2 text-left text-[13px] transition-colors ${
                    selected ? 'border-border bg-accent text-accent-foreground' : 'border-transparent hover:bg-black/5'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applySpellCandidate(candidate)
                  }}
                >
                  {candidate}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <div className="px-2">
        <div className="flex items-start gap-2">
          {selectedSlashCommand ? (
            <div
              className="mt-0.5 inline-flex h-7 items-center rounded-lg border border-border bg-white px-2.5 text-[13px] text-foreground shrink-0"
              title={selectedSlashCommand.title}
            >
              <span>{selectedSlashCommand.name}</span>
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <InputAnimation
              ref={inputRef}
              className="w-full bg-transparent border-0 resize-none shadow-none text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 px-0"
              placeholder={placeholder}
              rows={2}
              value={inputDisplayValue}
              onChange={(e) => {
                const next = e.target.value
                if (pendingTabCompletion) setPendingTabCompletion(null)
                if (spellSuggestState) setSpellSuggestState(null)
                if (tabChordTimerRef.current != null) {
                  window.clearTimeout(tabChordTimerRef.current)
                  tabChordTimerRef.current = null
                  tabChordBaseRef.current = ''
                }
                if (selectedSlashCommand) {
                  const normalized = String(next || '')
                  const mergedValue = normalized ? `${selectedSlashPrefix} ${normalized}` : selectedSlashPrefix
                  setValue(mergedValue)
                  return
                }
                setSlashDismissed(false)
                setValue(next)
              }}
              onPaste={onPasteImage}
              onClick={(e) => {
                const x = Number(e.clientX)
                const y = Number(e.clientY)
                if (!Number.isFinite(x) || !Number.isFinite(y)) return
                handleWordClickSuggest(x, y)
              }}
              onBlur={(e) => {
                const el = e.currentTarget as HTMLTextAreaElement
                const text = String(el.value || '')
                const caret = Number(el.selectionStart ?? text.length)
                triggerAutoSpellSuggestOnBlur(text, caret)
              }}
              onKeyDown={(e) => {
                if (spellSuggestState) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    const len = spellSuggestState.candidates.length
                    if (!len) return
                    setSpellSuggestState((prev) => {
                      if (!prev) return prev
                      return { ...prev, activeIndex: (prev.activeIndex + 1) % len }
                    })
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    const len = spellSuggestState.candidates.length
                    if (!len) return
                    setSpellSuggestState((prev) => {
                      if (!prev) return prev
                      return { ...prev, activeIndex: (prev.activeIndex - 1 + len) % len }
                    })
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const picked = spellSuggestState.candidates[spellSuggestState.activeIndex] || ''
                    if (picked) applySpellCandidate(picked)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setSpellSuggestState(null)
                    return
                  }
                }
                if (slashMenuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault()
                  if (!slashSuggestions.length) return
                  setSlashIndex((prev) => {
                    if (e.key === 'ArrowDown') return (prev + 1) % slashSuggestions.length
                    return (prev - 1 + slashSuggestions.length) % slashSuggestions.length
                  })
                  return
                }
                if (slashMenuOpen && e.key === 'Tab') {
                  if (!activeSlashSuggestion) return
                  e.preventDefault()
                  applySlashSuggestion(activeSlashSuggestion)
                  return
                }
                if (e.key === 'Escape' && pendingTabCompletion) {
                  e.preventDefault()
                  setPendingTabCompletion(null)
                  return
                }
                if (e.key === 'Escape' && tabChordTimerRef.current != null) {
                  e.preventDefault()
                  window.clearTimeout(tabChordTimerRef.current)
                  tabChordTimerRef.current = null
                  tabChordBaseRef.current = ''
                  return
                }
                if (
                  (e.key === 't' || e.key === 'T') &&
                  !e.metaKey &&
                  !e.ctrlKey &&
                  !e.altKey &&
                  !e.shiftKey &&
                  tabChordTimerRef.current != null
                ) {
                  e.preventDefault()
                  window.clearTimeout(tabChordTimerRef.current)
                  tabChordTimerRef.current = null
                  const current = String(tabChordBaseRef.current || value || '')
                  tabChordBaseRef.current = ''
                  if (!current.trim()) return
                  requestTabCompletion('translate', current)
                  return
                }
                if (e.key === 'Tab' && !e.shiftKey && !slashInput && !slashMenuOpen && onTabComplete) {
                  const current = String(value || '')
                  if (!current.trim()) return
                  e.preventDefault()
                  if (pendingTabCompletion && pendingTabCompletion.base === current) {
                    setPendingTabCompletion(null)
                    if (pendingTabCompletion.nextValue !== current) {
                      setValue(pendingTabCompletion.nextValue)
                    }
                    return
                  }
                  if (tabChordTimerRef.current != null) {
                    window.clearTimeout(tabChordTimerRef.current)
                    tabChordTimerRef.current = null
                  }
                  tabChordBaseRef.current = current
                  tabChordTimerRef.current = window.setTimeout(() => {
                    tabChordTimerRef.current = null
                    const base = String(tabChordBaseRef.current || current)
                    tabChordBaseRef.current = ''
                    if (!base.trim()) return
                    requestTabCompletion('complete', base)
                  }, 260)
                  return
                }
                if (slashMenuOpen && e.key === 'Escape') {
                  e.preventDefault()
                  setSlashDismissed(true)
                  return
                }
                if (
                  selectedSlashCommand &&
                  !String(inputDisplayValue || '').trim() &&
                  (e.key === 'Backspace' || e.key === 'Delete')
                ) {
                  e.preventDefault()
                  setSlashDismissed(false)
                  setValue('')
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void onSubmit()
                }
              }}
            />
          </div>
        </div>
      </div>
      {pendingTabCompletion ? (
        <div className="px-2 pt-1 space-y-0.5">
          <div className="text-[11px] text-muted-foreground">{tabApplyHint}</div>
          <div className="text-[11px] text-muted-foreground truncate">{pendingTabCompletion.nextValue}</div>
        </div>
      ) : null}
      <div className="flex justify-between items-end px-2 pt-1.5 pb-0 mt-0.5 gap-2.5">
        {leftControls}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={`${actionButtonSizeClass} transition-all duration-200 focus-visible:ring-0 focus-visible:ring-offset-0 ${
              isRecording
                ? 'text-blue-500 border-0 bg-blue-500/8 hover:bg-blue-500/12'
                : `text-muted-foreground hover:text-foreground hover:bg-black/5 ${isVoiceModelAvailable ? '' : 'opacity-50'}`
            }`}
            onClick={onToggleRecording}
            title={isRecording ? i18nText(uiLang, 'app.stopRecording') : i18nText(uiLang, 'app.voiceInput')}
          >
            {isRecording ? (
              <div className="flex items-end justify-center gap-[2px] w-4 h-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <motion.span
                    key={i}
                    className="w-[2px] h-full bg-current rounded-full"
                    style={{ transformOrigin: 'center' }}
                    animate={
                      reduceMotion
                        ? { scaleY: 0.7, opacity: 0.9 }
                        : { scaleY: [0.25, 1, 0.35, 0.85, 0.3], opacity: [0.6, 1, 0.7, 1, 0.6] }
                    }
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.95, repeat: Infinity, ease: 'easeInOut', delay: i * 0.08 }
                    }
                  />
                ))}
              </div>
            ) : (
              <Mic className="w-4 h-4 opacity-70" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className={`${actionButtonSizeClass} transition-all duration-200 focus-visible:ring-0 focus-visible:ring-offset-0 ${
              String(value || '').trim() || isLoading
                ? 'bg-black text-white hover:bg-black/90'
                : 'bg-black/55 text-white/80'
            }`}
            onClick={() => void onSubmit()}
            disabled={!String(value || '').trim() && !isLoading}
          >
            {isLoading ? <Square className="w-4 h-4 fill-current stroke-current text-white" /> : <ArrowUp className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default App
