import { Fragment, useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type DragEvent, type ClipboardEvent } from 'react'
import { Send, StopCircle, Paperclip, PanelLeftOpen, MessageSquarePlus, Wrench, Sparkles, X, ChevronDown, Mic, Folder, Brain, Eye, Check, GitBranch } from 'lucide-react'
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
import { resolveBackendBaseUrl, useStore, type Message, type ToolTrace, type ProviderModel, type Artifact } from './store/useStore'
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

type DangerousCommandApprovalPayload = {
  code: string
  command: string
  matchedPattern?: string
  runId?: string
  approvalId?: string
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
      <div className="absolute inset-0 flex items-center justify-center text-[7px] leading-none text-primary/90">
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
    backgroundColor: 'hsl(var(--primary))'
  }
  return <span className={className} style={style} aria-hidden="true" />
}

function normalizeChatMarkdown(input: string): string {
  const s = String(input || '')
  const hasUnescapedFence = /(^|\n)[ \t]{0,3}```/.test(s)
  if (hasUnescapedFence) return s
  return s.replace(/(^|\n)([ \t]{0,3})\\```/g, '$1$2```')
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
  const name = String(trace?.name || '').trim()
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

function App(): JSX.Element {
  const { configLoaded, configError, loadRemoteConfig } = useStore()
  const reduceMotion = useReducedMotion()
  const loadingLang = useMemo(() => {
    const nav = (() => {
      try {
        return String(navigator.language || '').toLowerCase()
      } catch {
        return ''
      }
    })()
    if (nav.startsWith('zh')) return 'zh'
    if (nav.startsWith('ja')) return 'ja'
    return 'en'
  }, [])
  const tLoading = useMemo(() => {
    const dict = {
      en: {
        loadingTitle: 'Loading settings…',
        failedTitle: 'Failed to load settings',
        subtitle: 'Connecting to local backend',
        retry: 'Retry'
      },
      zh: {
        loadingTitle: '正在加载设置…',
        failedTitle: '加载设置失败',
        subtitle: '正在连接本地后端',
        retry: '重试'
      },
      ja: {
        loadingTitle: '設定を読み込み中…',
        failedTitle: '設定の読み込みに失敗しました',
        subtitle: 'ローカルバックエンドに接続中',
        retry: '再試行'
      }
    } as const
    return dict[loadingLang as keyof typeof dict] || dict.en
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
      <div className="h-screen w-screen bg-background text-foreground relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,hsl(var(--primary)/0.08),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(var(--foreground)/0.06),transparent_55%)]" />

        <div className="h-full w-full grid place-items-center p-6">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            transition={reduceMotion ? undefined : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[520px] text-center"
          >
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
  const [popoverPanel, setPopoverPanel] = useState<'' | 'attachments' | 'tools' | 'skills' | 'model' | 'thinking' | 'permission'>('')
  
  const [traceDetailOpenByKey, setTraceDetailOpenByKey] = useState<Record<string, boolean>>({})
  const [reasoningOpenByMsgId, setReasoningOpenByMsgId] = useState<Record<string, boolean>>({})
  const [collapsedTurnOpenById, setCollapsedTurnOpenById] = useState<Record<string, boolean>>({})
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
  const [highlightUserMsgId, setHighlightUserMsgId] = useState('')
  const [userNavItems, setUserNavItems] = useState<Array<{ id: string; topRatio: number; widthPx: number; content: string }>>([])
  const [navHover, setNavHover] = useState<{ id: string; topRatio: number; content: string } | null>(null)
  
  const { 
    messages, 
    chats,
    addMessage, 
    updateMessageById,
    persistMessageById,
    persistLastMessage, 
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
  const imageDragDepthRef = useRef(0)
  const showComposerToolSkillEntrances = false
  const setChatBottomIfChanged = useCallback((next: boolean) => {
    if (chatIsAtBottomRef.current === next) return
    chatIsAtBottomRef.current = next
    setChatIsAtBottom(next)
  }, [])

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
      { reasoningCount: number; toolCount: number; skillCount: number; hasProcess: boolean; finalAssistantMessageId: string }
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
      const current = map[tid] || { reasoningCount: 0, toolCount: 0, skillCount: 0, hasProcess: false, finalAssistantMessageId: '' }
      if (m?.role === 'assistant') {
        current.finalAssistantMessageId = String(m?.id || '').trim() || current.finalAssistantMessageId
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
      current.hasProcess = current.reasoningCount > 0 || current.toolCount > 0 || current.skillCount > 0
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

    const title = state === 'running' ? '在压缩对话历史以节省上下文…' : '已压缩对话历史'
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
      alert('请配置模型')
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
    let total = tokenStatus.limit || 0
    const defaultTotal = 128_000
    
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

    // Fallback to remaining + used
    if (!total && tokenStatus.remaining && used) {
      total = used + tokenStatus.remaining
    }

    if (!total) total = defaultTotal
    
    const percentage = total > 0 ? Math.min(100, (used / total) * 100) : 0
    return { used, total, percentage }
  }, [tokenStatus, effectiveProvider, effectiveModel])

  const thinkingLevel = composer.thinkingLevel && composer.thinkingLevel !== 'default' ? composer.thinkingLevel : 'medium'
  const shouldShowAnalysis = effectiveProvider?.type === 'deepseek' && (
    thinkingLevel !== 'off'
  )

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
    return [
      { id: 'glob_files', name: 'Glob 文件' },
      { id: 'bash', name: 'Bash 命令' },
      { id: 'read_file', name: '读文件' },
      { id: 'rg_search', name: 'ripgrep 搜索' },
      { id: 'WebSearch', name: 'WebSearch 搜索' },
      { id: 'WebFetch', name: 'WebFetch 抓取' },
      { id: 'list_dir', name: '列目录' }
    ]
  }, [])

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
      providerOverrideId: composer.providerOverrideId || '',
      modelOverride: composer.modelOverride || '',
      contextWindowOverride: composer.contextWindowOverride || selectedModelConfig?.config?.contextWindow || 0,
      maxOutputTokens: selectedModelConfig?.config?.maxOutputTokens,
      jsonConfig: selectedModelConfig?.config?.jsonConfig,
      thinkingLevel,
      dangerousCommandApprovals,
      dangerousCommandAllowForThread
    }
  }

  const resolveWorkspaceDir = () => {
    const st = useStore.getState()
    const s = st.settings as any
    const projects = Array.isArray(s?.projects) ? s.projects : []
    const pid = String(st.ui?.activeProjectId || '').trim()
    const p = pid ? projects.find((x: any) => String(x?.id || '').trim() === pid) : null
    const dir = String(p?.dir || '').trim()
    if (dir) return dir
    return String(s?.workspaceDir || '').trim()
  }

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
    const dict = {
      en: {
        appName: 'Anima',
        helloTitle: 'Hello. I am Anima.',
        helloSubtitleConnected: (name: string) => `Connected to ${name}`,
        helloSubtitleDisconnected: 'Please configure a provider to start.',
        configureProvider: 'Configure Provider',
        typeMessage: 'Type a message...',
        noProviderActive: 'No Provider Active',
        settings: 'Settings',
        noProject: 'No project selected',
        foldProcessSummary: (thinking: number, tools: number, skills: number) =>
          `Thought ${thinking} times, tools ${tools} calls, skills ${skills}`,
        foldProcessExpand: 'Expand process',
        foldProcessCollapse: 'Collapse process',
        dangerousApprovalQuestion: 'Do you want to run this dangerous command?',
        dangerousApprovalOptionOnce: 'Yes',
        dangerousApprovalOptionAlways: 'Yes, do not intercept again in this conversation',
        dangerousApprovalOptionReject: 'No',
        dangerousApprovalSubmit: 'Submit',
        dangerousApprovalPending: 'Waiting for your choice',
        dangerousApprovalRejected: 'Canceled',
        dangerousApprovalStatusApprovedOnce: 'Allowed',
        dangerousApprovalStatusApprovedThread: 'Allowed (this conversation)',
        dangerousApprovalStatusRejected: 'Rejected',
        proxyOrKeyError: (msg: string) => `Error: ${msg}\n\nPlease check your API Key and Network settings.`,
        composer: {
          attachments: 'Attachments',
          workspace: 'Workspace',
          tools: 'Tools',
          skills: 'Skills',
        model: 'Model',
          context: 'Context',
          addFiles: 'Add files',
          clear: 'Clear',
          selectFolder: 'Select folder',
          openSettings: 'Open Settings',
          toolMode: 'Tool mode',
          permission: 'Permission',
          permissionDefault: 'Default permission',
          permissionFull: 'Full access',
          permissionConfirmTitle: 'Enable full access?',
          permissionConfirmDesc:
            'In full access mode, Anima can run commands outside workspace restrictions. Continue only if you trust the current task.',
          permissionConfirmCancel: 'Cancel',
          permissionConfirmContinue: 'Yes, continue',
          dangerousCommandConfirmTitle: 'Approve dangerous command?',
          dangerousCommandConfirmDesc: 'This command matched your blacklist under default permission. Continue only if you trust it.',
          dangerousCommandConfirmCancel: 'Cancel',
          dangerousCommandConfirmContinue: 'Approve and run',
          skillMode: 'Skill mode',
          auto: 'Auto',
          all: 'All',
          disabled: 'Disabled',
          mcpServers: 'MCP Servers',
          refresh: 'Refresh',
          openFolder: 'Open folder',
          modelOverride: 'Override model',
          useProviderDefault: 'Use provider default',
          contextWindow: 'Context window (messages)',
          thinking: 'Thinking',
          thinkingDefault: 'Default',
          thinkingOff: 'Off',
          thinkingLow: 'Low',
          thinkingMedium: 'Medium',
          thinkingHigh: 'High',
          preview: 'Preview',
          prepare: 'Prepare'
        },
        trace: {
          title: 'Steps & Tools',
          steps: 'Steps',
          tools: 'Tool calls',
          reasoning: 'Summary',
          thinkingPending: 'Thinking...',
          analyzing: 'Analyzing...',
          analysisDone: 'Analysis complete',
          running: 'Running',
          succeeded: 'Succeeded',
          failed: 'Failed',
          toolCount: (n: number) => `Tools ${n}`,
          failedCount: (n: number) => `Failed ${n}`,
          durationMs: (n: number) => `${n}ms`,
          args: 'Args',
          result: 'Result',
          error: 'Error'
        }
      },
      zh: {
        appName: 'Anima',
        helloTitle: '你好，我是 Anima。',
        helloSubtitleConnected: (name: string) => `已连接：${name}`,
        helloSubtitleDisconnected: '请先配置一个提供商以开始使用。',
        configureProvider: '配置提供商',
        typeMessage: '输入消息…',
        noProviderActive: '未启用提供商',
        settings: '设置',
        noProject: '未选择项目',
        foldProcessSummary: (thinking: number, tools: number, skills: number) =>
          `思考了${thinking}次，工具调用${tools}次，技能使用${skills}个`,
        foldProcessExpand: '展开过程',
        foldProcessCollapse: '收起过程',
        dangerousApprovalQuestion: '是否执行这个危险命令？',
        dangerousApprovalOptionOnce: '是',
        dangerousApprovalOptionAlways: '是，本次对话不再拦截',
        dangerousApprovalOptionReject: '否',
        dangerousApprovalSubmit: '提交',
        dangerousApprovalPending: '等待你的选择',
        dangerousApprovalRejected: '已取消',
        dangerousApprovalStatusApprovedOnce: '已允许',
        dangerousApprovalStatusApprovedThread: '本次对话已允许',
        dangerousApprovalStatusRejected: '已拒绝',
        proxyOrKeyError: (msg: string) => `错误：${msg}\n\n请检查 API Key 与网络代理设置。`,
        composer: {
          attachments: '附件',
          workspace: '工作区',
          tools: '工具 / MCP',
          skills: '技能',
        model: '模型',
          context: '上下文',
          addFiles: '添加文件',
          clear: '清除',
          selectFolder: '选择目录',
          openSettings: '打开设置',
          toolMode: '工具模式',
          permission: '权限',
          permissionDefault: '当前项目',
          permissionFull: '当前电脑',
          permissionConfirmTitle: '启用完全访问权限？',
          permissionConfirmDesc: '开启后将不再限制工作区和白名单范围，请仅在可信任务中使用。',
          permissionConfirmCancel: '取消',
          permissionConfirmContinue: '是，仍然继续',
          dangerousCommandConfirmTitle: '确认执行危险命令？',
          dangerousCommandConfirmDesc: '该命令在默认权限下命中了黑名单，仅在你确认可信时继续执行。',
          dangerousCommandConfirmCancel: '取消',
          dangerousCommandConfirmContinue: '确认并执行',
          skillMode: '技能模式',
          auto: '自动',
          all: '全部',
          disabled: '禁用',
          mcpServers: 'MCP 服务器',
          refresh: '刷新',
          openFolder: '打开文件夹',
          modelOverride: '临时覆盖模型',
          useProviderDefault: '使用提供商默认',
          contextWindow: '上下文窗口（消息数）',
          thinking: '思考',
          thinkingDefault: '默认',
          thinkingOff: '关闭',
          thinkingLow: '低',
          thinkingMedium: '中',
          thinkingHigh: '高',
          preview: '预览',
          prepare: '准备'
        },
        trace: {
          title: '步骤与工具',
          steps: '步骤',
          tools: '工具调用',
          reasoning: '思考过程',
          thinkingPending: '思考中…',
          analyzing: '分析中…',
          analysisDone: '分析完成',
          running: '运行中',
          succeeded: '成功',
          failed: '失败',
          toolCount: (n: number) => `工具 ${n} 次`,
          failedCount: (n: number) => `失败 ${n} 次`,
          durationMs: (n: number) => `${n}ms`,
          args: '参数',
          result: '结果',
          error: '错误'
        }
      },
      ja: {
        appName: 'Anima',
        helloTitle: 'こんにちは。Anima です。',
        helloSubtitleConnected: (name: string) => `${name} に接続中`,
        helloSubtitleDisconnected: 'まずプロバイダーを設定してください。',
        configureProvider: 'プロバイダー設定',
        typeMessage: 'メッセージを入力…',
        noProviderActive: 'プロバイダー未有効',
        settings: '設定',
        noProject: 'プロジェクト未選択',
        foldProcessSummary: (thinking: number, tools: number, skills: number) =>
          `思考 ${thinking} 回、ツール ${tools} 回、スキル ${skills} 件`,
        foldProcessExpand: 'プロセスを表示',
        foldProcessCollapse: 'プロセスを折りたたむ',
        dangerousApprovalQuestion: 'この危険なコマンドを実行しますか？',
        dangerousApprovalOptionOnce: 'はい',
        dangerousApprovalOptionAlways: 'はい、この会話では以後ブロックしない',
        dangerousApprovalOptionReject: 'いいえ',
        dangerousApprovalSubmit: '送信',
        dangerousApprovalPending: '選択待ち',
        dangerousApprovalRejected: 'キャンセル済み',
        dangerousApprovalStatusApprovedOnce: '許可済み',
        dangerousApprovalStatusApprovedThread: 'この会話で許可済み',
        dangerousApprovalStatusRejected: '拒否済み',
        proxyOrKeyError: (msg: string) => `エラー: ${msg}\n\nAPI Key とネットワーク設定を確認してください。`,
        composer: {
          attachments: '添付',
          workspace: 'ワークスペース',
          tools: 'ツール / MCP',
          skills: 'スキル',
        model: 'モデル',
          context: 'コンテキスト',
          addFiles: 'ファイル追加',
          clear: 'クリア',
          selectFolder: 'フォルダー選択',
          openSettings: '設定を開く',
          toolMode: 'ツールモード',
          permission: '権限',
          permissionDefault: 'デフォルト権限',
          permissionFull: 'フルアクセス',
          permissionConfirmTitle: 'フルアクセスを有効化しますか？',
          permissionConfirmDesc:
            'フルアクセスではワークスペース制限なしでコマンド実行できます。信頼できるタスクでのみ使用してください。',
          permissionConfirmCancel: 'キャンセル',
          permissionConfirmContinue: 'はい、続行',
          dangerousCommandConfirmTitle: '危険コマンドを許可しますか？',
          dangerousCommandConfirmDesc: 'このコマンドは既定権限のブラックリストに一致しました。信頼できる場合のみ続行してください。',
          dangerousCommandConfirmCancel: 'キャンセル',
          dangerousCommandConfirmContinue: '許可して実行',
          skillMode: 'スキルモード',
          auto: '自動',
          all: 'すべて',
          disabled: '無効',
          mcpServers: 'MCP サーバー',
          refresh: '更新',
          openFolder: 'フォルダーを開く',
          modelOverride: 'モデル上書き',
          useProviderDefault: '既定モデルを使用',
          contextWindow: 'コンテキスト（メッセージ数）',
          thinking: 'Thinking',
          thinkingDefault: 'Default',
          thinkingOff: 'Off',
          thinkingLow: 'Low',
          thinkingMedium: 'Medium',
          thinkingHigh: 'High',
          preview: 'プレビュー',
          prepare: '準備'
        },
        trace: {
          title: '手順とツール',
          steps: '手順',
          tools: 'ツール呼び出し',
          reasoning: '要約',
          thinkingPending: '思考中…',
          analyzing: '分析中…',
          analysisDone: '分析完了',
          running: '実行中',
          succeeded: '成功',
          failed: '失敗',
          toolCount: (n: number) => `ツール ${n} 回`,
          failedCount: (n: number) => `失敗 ${n} 回`,
          durationMs: (n: number) => `${n}ms`,
          args: '引数',
          result: '結果',
          error: 'エラー'
        }
      }
    } as const
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
  }, [setChatBottomIfChanged, setScrollToBottomIfChanged, stopAutoScroll])

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

    let ensuredProjectId = String(useStore.getState().ui.activeProjectId || '').trim()
    if (!ensuredProjectId) {
      const res = await window.anima?.window?.pickDirectory?.()
      if (!res?.ok || res.canceled) return false
      const dir = String(res.path || '').trim()
      if (!dir) return false
      ensuredProjectId = await useStore.getState().addProject(dir)
      if (ensuredProjectId) await useStore.getState().createChatInProject(ensuredProjectId)
    }

    if (ensuredProjectId && !String(useStore.getState().activeChatId || '').trim()) {
      await useStore.getState().createChatInProject(ensuredProjectId)
    }

    const ensuredChatId = String(useStore.getState().activeChatId || '').trim()
    if (!ensuredChatId) return false

    const userMessage = trimmed
    const userAttachments = composer.attachments.map((a) => ({ path: a.path }))
    const userAttachmentsWorkspaceDir = resolveWorkspaceDir()
    setIsLoading(true)
    const controller = new AbortController()
    abortControllerRef.current = controller

    const turnId = String(opts?.turnIdOverride || '').trim() || crypto.randomUUID()
    let currentAssistantId = crypto.randomUUID()

    const updateLastMessage = (content: string, meta?: any) => {
      const { updateMessageById, activeChatId } = useStore.getState()
      if (activeChatId) {
        updateMessageById(activeChatId, currentAssistantId, { content, meta })
      }
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
             // Finalize current assistant message
             const finalizedAssistantMeta =
               typeof assistantMeta?.reasoningText === 'string' && assistantMeta.reasoningText.trim()
                 ? { ...assistantMeta, reasoningStatus: 'done' as const }
                 : assistantMeta
             updateLastMessage(fullContent, finalizedAssistantMeta)
             if (activeChatId) {
               void persistMessageById(activeChatId, currentAssistantId, fullContent, finalizedAssistantMeta)
             }

             msgId = crypto.randomUUID()
             traceMessageIds[trace.id] = msgId
             
             // Add Tool Message
             addMessage({
               id: msgId,
               role: 'tool',
               content: '',
               turnId,
               meta: { toolTraces: [trace] }
             } as any)

             // Create NEW Assistant Message
             const newAssistantId = crypto.randomUUID()
             currentAssistantId = newAssistantId
             
             fullContent = ''
             reasoningText = ''
             assistantMeta = { reasoningStatus: 'pending', reasoningText: '' }
             
             addMessage({
               id: newAssistantId,
               role: 'assistant',
               content: '',
               turnId,
               meta: assistantMeta
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
                  trace?: ToolTrace
                  ok?: boolean
                  error?: string
                }
                if (e.type === 'delta' && typeof e.content === 'string' && e.content) {
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
                  const err = typeof e.error === 'string' && e.error.trim() ? e.error.trim() : 'Unknown error'
                  reject(new Error(err))
                  return
                }
                if (e.type === 'done') {
                  usage = e.usage || null
                  if (e.rateLimit && Object.keys(e.rateLimit).length) {
                    assistantMeta = { ...assistantMeta, rateLimit: e.rateLimit }
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
                  const err = typeof evt.error === 'string' && evt.error.trim() ? evt.error.trim() : 'Unknown error'
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
                    const err = typeof evt.error === 'string' && evt.error.trim() ? evt.error.trim() : '未知错误'
                    compressionFullContent = `压缩失败：${err}`
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
                  if (evt.rateLimit && Object.keys(evt.rateLimit).length) {
                    assistantMeta = { ...assistantMeta, rateLimit: evt.rateLimit }
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
        await persistLastMessage()
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
        }
        
        const content = typeof data.content === 'string' ? data.content : ''
        const usage = data.usage
        const rateLimit = data.rateLimit
        const traces = Array.isArray(data.traces) ? data.traces : []
        const artifacts = Array.isArray(data.artifacts) ? data.artifacts : []

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

        // Insert tool messages for non-streaming response
        const { insertMessageBefore } = useStore.getState()
        for (const trace of traces) {
          const msgId = crypto.randomUUID()
          insertMessageBefore(currentAssistantId, {
            id: msgId,
            role: 'tool',
            content: '',
            turnId,
            meta: { toolTraces: [trace] }
          } as any)
        }

        const reasoning = typeof data.reasoning === 'string' && data.reasoning.trim() ? data.reasoning : undefined
        const assistantMeta: Message['meta'] | undefined =
          usage || (rateLimit && Object.keys(rateLimit).length) || Boolean(reasoning) || shouldShowAnalysis || artifacts.length > 0
            ? {
                promptTokens: usage ? usage?.prompt_tokens ?? 0 : undefined,
                completionTokens: usage ? usage?.completion_tokens ?? 0 : undefined,
                totalTokens: usage ? usage?.total_tokens ?? 0 : undefined,
                rateLimit: rateLimit && Object.keys(rateLimit).length ? rateLimit : undefined,
                reasoningSummary: deriveReasoningSummaryFromTraces(traces),
                reasoningText: reasoning,
                reasoningStatus: shouldShowAnalysis ? 'done' : reasoning ? 'done' : undefined,
                artifacts: artifacts.length ? artifacts : undefined
              }
            : undefined
        updateLastMessage(content, assistantMeta)
        await persistLastMessage()
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
      await persistLastMessage()
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
            松开即可添加图片附件
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
              <DialogTitle>对话摘要</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {summaryUpdatedAt != null && (
                <div className="text-xs text-muted-foreground">
                  更新时间：{new Date(summaryUpdatedAt).toLocaleString()}
                </div>
              )}
              <ScrollArea className="h-[420px] rounded-md border p-3">
                {summaryLoading ? (
                  <div className="text-sm text-muted-foreground">加载中…</div>
                ) : !summaryText ? (
                  <div className="text-sm text-muted-foreground">暂无摘要。</div>
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
                        const isFileToken =
                          !/^https?:\/\//i.test(trimmed) &&
                          (trimmed.startsWith('file://') ||
                            trimmed.startsWith('/') ||
                            trimmed.startsWith('\\') ||
                            trimmed.startsWith('./') ||
                            trimmed.startsWith('../') ||
                            trimmed.startsWith('~/') ||
                            /\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(trimmed))
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
                                openLinkTarget(trimmed)
                              }}
                              title={trimmed}
                            >
                              {trimmed}
                            </button>
                          )
                        }
                        return (
                          <code className={className} {...props}>
                            {children}
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
                立即压缩
              </Button>
              <Button
                onClick={() => setSummaryOpen(false)}
              >
                关闭
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
            <div className="flex-1 flex flex-col h-full overflow-hidden relative rounded-l-[var(--app-shell-content-radius)] bg-[var(--app-shell-content-bg)]">
              <div className="flex h-full min-w-0 flex-col overflow-hidden pt-2 pr-2 pb-2">
              <header className="h-[52px] shrink-0 draggable relative z-30">
              <div className="absolute left-4 top-[4px] flex items-center">
                <div className="w-[80px] h-7" />
                {ui.sidebarCollapsed && (
                  <div className="flex items-center gap-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleSidebarCollapsed}>
                            <PanelLeftOpen className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Show Sidebar</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={createChat}>
                            <MessageSquarePlus className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>New Chat</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>

              <div className="absolute left-0 right-0 top-[6px] flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 text-xs text-primary">
                  <span>{messages.length} 条消息</span>
                  {topGitRepoDir ? (
                    <>
                      <span>·</span>
                      <GitBranch className="w-3.5 h-3.5" />
                      <TooltipProvider>
                        <Tooltip delayDuration={300}>
                          <TooltipTrigger asChild>
                            <span className="max-w-[300px] truncate pointer-events-auto cursor-help font-medium">
                              {topGitBranch}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {topGitRepoDir}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-col flex-1 overflow-hidden min-w-0 relative">
            <main
              ref={chatScrollRef as any}
              onScroll={handleChatScroll}
              onWheel={() => markUserScrollIntent()}
              onTouchStart={() => markUserScrollIntent(380)}
              onTouchMove={() => markUserScrollIntent(380)}
              className="flex-1 overflow-y-auto pt-4 pl-6 pr-6 pb-4 no-drag"
            >
              {displayMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
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
                        settings.showTokenUsage &&
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
                      const assistantHasVisibleBody = Boolean(
                        assistantHasContent ||
                        assistantHasReasoning ||
                        assistantHasTokens ||
                        assistantHasCompression ||
                        assistantHasDangerousApproval
                      )

                      if (msg.role !== 'user' && msg.role !== 'tool') {
                        if (!assistantHasVisibleBody && !showTurnProcessSummary) return null
                      }

                      const isCollapsibleProcessRow =
                        (msg.role === 'assistant' && !isFinalAssistantOfTurn) || msg.role === 'tool'
                      const processRowVisible = !(isCollapsibleProcessRow && shouldHideProcess)
                      const showOnlyFinalAssistantArtifacts = Boolean(shouldHideProcess && msg.role === 'assistant' && isFinalAssistantOfTurn)

                      // 历史轮次折叠时，非标题行的过程消息应完全移除，避免空行继续占用 flex gap 间距。
                      if (isCollapsibleProcessRow && !processRowVisible && !showTurnProcessSummary) return null

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
                                  {t.foldProcessSummary(turnStats!.reasoningCount, turnStats!.toolCount, turnStats!.skillCount)}
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
                              {t.foldProcessSummary(turnStats!.reasoningCount, turnStats!.toolCount, turnStats!.skillCount)}
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
                        <div className={`py-3 flex justify-end ${msg.id === lastUserMessageId ? 'sticky top-2 z-20' : ''}`}>
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
                           </div>
                        </div>
                      ) : msg.role === 'tool' ? (
                        <div className="py-0.5">
                            <AnimatePresence initial={false}>
                              {!shouldHideProcess && Array.isArray(msg.meta?.toolTraces) && msg.meta?.toolTraces.length > 0 ? (
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
                              const rawTraces = msg.meta?.toolTraces || []
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

                              return (
                                <div className="space-y-0.5">
                                  {traces.map((tr: any) => {
                                    const detailKey = `${msg.id}:${tr.id}`
                                    const detailOpen = !!traceDetailOpenByKey[detailKey]
                                    const isRunning = tr.status === 'running'
                                    const isFailed = tr.status === 'failed'

                                    let entity = tr.name
                                    const displayTraceName = (() => {
                                      const raw = String(tr.name || '').trim()
                                      const n = raw.replace(/^tool_start:/, '').replace(/^tool_done:/, '').replace(/^tool_end:/, '').trim()
                                      if (!n) return ''
                                      if (n === 'model_call' || n === 'tool_call') return ''
                                      return n
                                    })()
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
                                    const traceI18n = {
                                      searchResultSummary: (n: number) =>
                                        traceLang === 'zh'
                                          ? `已搜索到${n}条结果`
                                          : traceLang === 'ja'
                                            ? `${n}件の検索結果を取得`
                                            : `Found ${n} search results`,
                                      linkFallback: traceLang === 'zh' ? '链接' : traceLang === 'ja' ? 'リンク' : 'Link',
                                      webpageLink: traceLang === 'zh' ? '网页链接' : traceLang === 'ja' ? 'ページリンク' : 'Page Link',
                                      status: traceLang === 'zh' ? '状态' : traceLang === 'ja' ? '状態' : 'Status',
                                      truncated: traceLang === 'zh' ? '已截断' : traceLang === 'ja' ? '切り詰め済み' : 'Truncated',
                                      dir: traceLang === 'zh' ? '文件夹' : traceLang === 'ja' ? 'フォルダー' : 'Directory',
                                      file: traceLang === 'zh' ? '文件' : traceLang === 'ja' ? 'ファイル' : 'File',
                                      lineLabel: (n: number | string) =>
                                        traceLang === 'zh' ? `第${n}行` : traceLang === 'ja' ? `${n}行目` : `line ${n}`,
                                      matchedContent:
                                        traceLang === 'zh' ? '匹配内容' : traceLang === 'ja' ? '一致内容' : 'Matched content',
                                      readDone: traceLang === 'zh' ? '已读取' : traceLang === 'ja' ? '読み取り済み' : 'Read',
                                      failed: traceLang === 'zh' ? '失败' : traceLang === 'ja' ? '失敗' : 'Failed'
                                    }
                                    let resultSummary = ''
                                    let detailMarkdown = ''
                                    const traceKind: 'execute' | 'search' | 'browse' | 'read' | 'edit' =
                                      tr.name === 'rg_search' || tr.name === 'glob_files' || tr.name === 'WebSearch'
                                        ? 'search'
                                        : tr.name === 'read_file'
                                          ? 'read'
                                          : tr.name === 'write_file' || tr.name === 'replace_file' || tr.name === 'edit_file'
                                            ? 'edit'
                                            : tr.name === 'WebFetch'
                                              ? 'browse'
                                              : 'execute'
                                    const traceStatusText = (() => {
                                      const textMap = {
                                        zh: {
                                          execute: { running: '在执行', done: '已执行', failed: '执行失败' },
                                          search: { running: '在搜索', done: '已搜索', failed: '搜索失败' },
                                          browse: { running: '在浏览', done: '已浏览', failed: '浏览失败' },
                                          read: { running: '在阅读', done: '已读取', failed: '读取失败' },
                                          edit: { running: '在编辑', done: '已编辑', failed: '编辑失败' }
                                        },
                                        ja: {
                                          execute: { running: '実行中', done: '実行完了', failed: '実行失敗' },
                                          search: { running: '検索中', done: '検索完了', failed: '検索失敗' },
                                          browse: { running: '閲覧中', done: '閲覧完了', failed: '閲覧失敗' },
                                          read: { running: '読込中', done: '読込完了', failed: '読込失敗' },
                                          edit: { running: '編集中', done: '編集完了', failed: '編集失敗' }
                                        },
                                        en: {
                                          execute: { running: 'Running', done: 'Executed', failed: 'Failed' },
                                          search: { running: 'Searching', done: 'Searched', failed: 'Search failed' },
                                          browse: { running: 'Browsing', done: 'Browsed', failed: 'Browse failed' },
                                          read: { running: 'Reading', done: 'Read', failed: 'Read failed' },
                                          edit: { running: 'Editing', done: 'Edited', failed: 'Edit failed' }
                                        }
                                      } as const
                                      const lang = traceLang === 'zh' ? 'zh' : traceLang === 'ja' ? 'ja' : 'en'
                                      const key = isFailed ? 'failed' : isRunning ? 'running' : 'done'
                                      return textMap[lang][traceKind][key]
                                    })()

                                    if (tr.name === 'bash') {
                                      entity = normalizeValue(argsObj.command)
                                    } else if (tr.name === 'rg_search' || tr.name === 'glob_files') {
                                      entity = normalizeValue(argsObj.pattern)
                                      if (argsObj.path) entity += ` in ${normalizeValue(argsObj.path)}`
                                    } else if (tr.name === 'read_file') {
                                      entity = normalizeValue(argsObj.path)
                                    } else if (tr.name === 'write_file' || tr.name === 'replace_file' || tr.name === 'edit_file') {
                                      entity = normalizeValue(argsObj.path)
                                    } else if (tr.name === 'WebSearch') {
                                      entity = normalizeValue(argsObj.query)
                                      const count = Array.isArray(resultItems) ? resultItems.length : undefined
                                      resultSummary = typeof count === 'number' ? traceI18n.searchResultSummary(count) : ''
                                    } else if (tr.name === 'WebFetch') {
                                      entity = normalizeValue(argsObj.url)
                                    } else if (tr.name === 'load_skill') {
                                      entity = normalizeValue(argsObj.id) || 'load_skill'
                                    } else {
                                      entity = normalizeValue(entity)
                                    }

                                    const canOpenEntityInFiles =
                                      (tr.name === 'read_file' ||
                                        tr.name === 'write_file' ||
                                        tr.name === 'replace_file' ||
                                        tr.name === 'edit_file') &&
                                      Boolean(entity)
                                    const normalizeCommand = (raw: unknown) => String(raw || '').replace(/\s+/g, ' ').trim()
                                    const bashCommandNormalized = tr.name === 'bash' ? normalizeCommand(argsObj.command) : ''
                                    const matchedApproval =
                                      tr.name === 'bash'
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
                                    const isEditTrace = tr.name === 'write_file' || tr.name === 'replace_file' || tr.name === 'edit_file'
                                    const runningStatusText =
                                      tr.name === 'load_skill' && !isRunning && !isFailed
                                        ? traceLang === 'zh'
                                          ? '已加载技能'
                                          : traceLang === 'ja'
                                            ? 'スキル読み込み完了'
                                            : 'Loaded skill'
                                        : isEditTrace && !isRunning && !isFailed
                                          ? traceLang === 'zh'
                                            ? '已编辑的文件'
                                            : traceLang === 'ja'
                                              ? '編集済みファイル'
                                              : 'Edited file'
                                          : traceStatusText
                                    const displayEntity = (() => {
                                      const text = String(entity || '').trim()
                                      if (tr.name !== 'bash') return text
                                      const max = 80
                                      if (text.length <= max) return text
                                      return `${text.slice(0, max - 3)}...`
                                    })()
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

                                    if (tr.name === 'WebSearch' && Array.isArray(resultItems)) {
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
                                    } else if (tr.name === 'WebFetch' && resultObj) {
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
                                    } else if (
                                      Array.isArray(resultObj?.diffs) &&
                                      tr.name !== 'write_file' &&
                                      tr.name !== 'replace_file' &&
                                      tr.name !== 'edit_file'
                                    ) {
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
                                            className={`shrink-0 text-[12px] font-medium ${isRunning ? 'anima-flow-text' : 'text-muted-foreground group-hover:text-foreground'}`}
                                          >
                                            {runningStatusText}
                                          </span>
                                          
                                          <div className="min-w-0 flex-1 flex items-center gap-2">
                                            {tr.name === 'bash' && toolApprovalText ? (
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
                                              {typeof tr.durationMs === 'number' ? `${tr.durationMs}ms` : ''}
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
                                                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Artifacts</div>
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
                                                        const isFileToken =
                                                          Boolean(inline) &&
                                                          !/^https?:\/\//i.test(trimmed) &&
                                                          (trimmed.startsWith('file://') ||
                                                            trimmed.startsWith('/') ||
                                                            trimmed.startsWith('\\') ||
                                                            trimmed.startsWith('./') ||
                                                            trimmed.startsWith('../') ||
                                                            trimmed.startsWith('~/') ||
                                                            /\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(trimmed))
                                                        if (isFileToken) {
                                                          return (
                                                            <button
                                                              type="button"
                                                              className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground hover:underline cursor-pointer"
                                                              onClick={(e) => {
                                                                e.preventDefault()
                                                                e.stopPropagation()
                                                                openLinkTarget(trimmed)
                                                              }}
                                                              title={trimmed}
                                                            >
                                                              {trimmed}
                                                            </button>
                                                          )
                                                        }
                                                        return <code className={className} {...props}>{children}</code>
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
                                </div>
                              )
                                  })()}
                                  </div>
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                        </div>
                      ) : (
                        <div className="py-0.5">
                          <div className="space-y-0.5">
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
                              const headerText =
                                settings.language === 'zh'
                                  ? isThinking
                                    ? '思考中…'
                                    : '思考已完成'
                                  : settings.language === 'ja'
                                    ? isThinking
                                      ? '思考中…'
                                      : '思考完了'
                                    : isThinking
                                      ? 'Thinking…'
                                      : 'Thought complete'
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
                                      const isFileToken =
                                        !/^https?:\/\//i.test(trimmed) &&
                                        (trimmed.startsWith('file://') ||
                                          trimmed.startsWith('/') ||
                                          trimmed.startsWith('\\') ||
                                          trimmed.startsWith('./') ||
                                          trimmed.startsWith('../') ||
                                          trimmed.startsWith('~/') ||
                                          /\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(trimmed))
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
                                              openLinkTarget(trimmed)
                                            }}
                                            title={trimmed}
                                          >
                                            {trimmed}
                                          </button>
                                        )
                                      }
                                      return <code className={className} {...props}>{children}</code>
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
                              if (st === 'model_call' || st === 'tool_call') return null
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
                            {settings.showTokenUsage && !showOnlyFinalAssistantArtifacts && msg.meta?.totalTokens != null && (
                              <div className="text-[11px] text-muted-foreground">
                                Tokens: {msg.meta.promptTokens ?? 0} + {msg.meta.completionTokens ?? 0} ={' '}
                                {msg.meta.totalTokens}
                              </div>
                            )}

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
                      <TooltipContent>下方有新内容</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <footer className="pl-6 pr-6 pt-6 pb-0 no-drag overflow-visible">
              <div className="max-w-3xl mx-auto relative bg-white rounded-xl shadow-sm border border-border px-2 py-2 transition-all duration-200">
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
                              className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-background border border-black/6 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
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
                    onStop={handleStop}
                    onPasteImage={handleComposerPaste}
                    onApi={(api) => {
                      composerApiRef.current = api
                    }}
                    isRecording={isRecording}
                    isVoiceModelAvailable={isVoiceModelAvailable}
                    onToggleRecording={() => {
                      if (!isRecording && !isVoiceModelAvailable) {
                        alert('请配置模型')
                        return
                      }
                      void toggleRecording()
                    }}
                    leftControls={
                      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-full shrink-0 text-primary/80 hover:text-primary hover:bg-primary/10 focus-visible:ring-0 focus-visible:ring-offset-0"
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
                                  className="h-9 w-9 rounded-full shrink-0 text-primary/80 hover:text-primary hover:bg-primary/10 focus-visible:ring-0 focus-visible:ring-offset-0"
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
                                    <h5 className="text-[11px] font-medium text-muted-foreground uppercase">Built-in</h5>
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
                                  className="h-9 w-9 rounded-full shrink-0 text-primary/80 hover:text-primary hover:bg-primary/10 focus-visible:ring-0 focus-visible:ring-offset-0"
                                >
                                  <Sparkles className="w-4 h-4" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80" align="start" onMouseEnter={() => handleMouseEnter('skills')} onMouseLeave={handleMouseLeave}>
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between">
                                    <h4 className="font-medium text-xs leading-none">{t.composer.skills}</h4>
                                    <select
                                      className="text-xs border rounded px-2 py-1"
                                      value={composer.skillMode}
                                      onChange={(e) => updateComposer({ skillMode: e.target.value as any })}
                                    >
                                      <option value="auto">{t.composer.auto}</option>
                                      <option value="all">{t.composer.all}</option>
                                      <option value="disabled">{t.composer.disabled}</option>
                                    </select>
                                  </div>

                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">{skillsCache.length} loaded</span>
                                    <div className="flex gap-2">
                                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void ensureSkills()}>
                                        {t.composer.refresh}
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void openSkillsFolder()}>
                                        {t.composer.openFolder}
                                      </Button>
                                    </div>
                                  </div>

                                  {skillsCache.length === 0 ? (
                                    <div className="text-xs text-muted-foreground">—</div>
                                  ) : (
                                    <ScrollArea className="h-[300px]">
                                      <div className="space-y-2">
                                        {skillsCache.map((s) => (
                                          <div key={s.id} className="flex items-start space-x-2">
                                            <Checkbox
                                              className="rounded-none"
                                              id={`skill-${s.id}`}
                                              disabled={s.isValid === false}
                                              checked={composer.enabledSkillIds.includes(s.id)}
                                              onCheckedChange={(checked) => updateComposer({ enabledSkillIds: toggleId(composer.enabledSkillIds, s.id, !!checked) })}
                                            />
                                            <label htmlFor={`skill-${s.id}`} className="text-xs leading-none space-y-1">
                                              <span className="block font-medium">{s.name || s.id}</span>
                                              <span className="block text-[10px] text-muted-foreground line-clamp-2">{s.description || s.id}</span>
                                              {s.isValid === false ? (
                                                <span className="block text-[10px] text-destructive line-clamp-2">
                                                  {Array.isArray(s.errors) && s.errors.length ? s.errors.join(', ') : 'invalid'}
                                                </span>
                                              ) : null}
                                            </label>
                                          </div>
                                        ))}
                                      </div>
                                    </ScrollArea>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : null}

                        <Popover open={popoverPanel === 'model'} onOpenChange={(open) => handlePopoverOpenChange('model', open)}>
                          <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('model')} onMouseLeave={handleInputPanelMouseLeave}>
                            <Button
                              variant="ghost"
                              className="h-9 rounded-full gap-2 px-3.5 text-xs font-normal text-foreground/82 hover:text-foreground hover:bg-black/5 shrink min-w-0 max-w-[220px] focus-visible:ring-0 focus-visible:ring-offset-0"
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
                                  <span className="text-xs text-muted-foreground">Auto</span>
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

                        {effectiveProvider?.type === 'deepseek' ? (
                          <Popover open={popoverPanel === 'thinking'} onOpenChange={(open) => handlePopoverOpenChange('thinking', open)}>
                            <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('thinking')} onMouseLeave={handleInputPanelMouseLeave}>
                            <Button
                              variant="ghost"
                              className="h-9 rounded-full gap-1.5 px-3 text-xs font-normal text-foreground/82 hover:text-foreground hover:bg-black/5 shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                            >
                              <Brain className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                              <span className="truncate">
                                {{
                                  off: t.composer.thinkingOff,
                                  low: t.composer.thinkingLow,
                                  medium: t.composer.thinkingMedium,
                                  high: t.composer.thinkingHigh
                                }[thinkingLevel] || t.composer.thinkingMedium}
                                </span>
                                <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-40 p-1"
                              align="start"
                              side="top"
                              sideOffset={8}
                              onMouseEnter={() => handleMouseEnter('thinking')}
                              onMouseLeave={handleMouseLeave}
                            >
                              <div className="px-2 py-1">
                                <h4 className="font-medium text-xs leading-none">{t.composer.thinking}</h4>
                              </div>
                              {[
                                { value: 'off', label: t.composer.thinkingOff },
                                { value: 'low', label: t.composer.thinkingLow },
                                { value: 'medium', label: t.composer.thinkingMedium },
                                { value: 'high', label: t.composer.thinkingHigh }
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
                                  <span>{opt.label}</span>
                                  {thinkingLevel === opt.value ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5" />}
                                </button>
                              ))}
                            </PopoverContent>
                          </Popover>
                        ) : null}

                        <Popover open={popoverPanel === 'permission'} onOpenChange={(open) => handlePopoverOpenChange('permission', open)}>
                          <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('permission')} onMouseLeave={handleInputPanelMouseLeave}>
                            <Button
                              variant="ghost"
                              className="h-9 rounded-full gap-1.5 px-3 text-xs font-normal text-foreground/82 hover:text-foreground hover:bg-black/5 shrink-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                              title={t.composer.permission}
                            >
                              <Eye className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                              <span className="truncate">
                                {permissionMode === 'full_access' ? t.composer.permissionFull : t.composer.permissionDefault}
                              </span>
                              <ChevronDown className="w-3.5 h-3.5 opacity-50 shrink-0" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-44 p-1"
                            align="start"
                            side="top"
                            sideOffset={8}
                            onMouseEnter={() => handleMouseEnter('permission')}
                            onMouseLeave={handleMouseLeave}
                          >
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
                                onClick={() => {
                                  setPopoverPanel('')
                                  handlePermissionModeChange(opt.value as 'workspace_whitelist' | 'full_access')
                                }}
                              >
                                <span>{opt.label}</span>
                                {permissionMode === opt.value ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5" />}
                              </button>
                            ))}
                          </PopoverContent>
                        </Popover>

                        <TooltipProvider>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 rounded-full transition-colors text-muted-foreground hover:text-foreground hover:bg-black/5 cursor-default focus-visible:ring-0 focus-visible:ring-offset-0"
                              >
                                <CircularProgress value={usageStats.percentage} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <div className="flex flex-col gap-1">
                                <div className="font-medium">
                                  Context Usage: {usageStats.percentage > 0 ? `${usageStats.percentage.toFixed(1)}%` : '0%'}
                                </div>
                                <div className="text-muted-foreground">Used: {formatTokenCount(usageStats.used)}</div>
                                {usageStats.total > 0 && <div className="text-muted-foreground">Limit: {formatTokenCount(usageStats.total)}</div>}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    }
                  />
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
  const [value, setValue] = useState('')
  const voiceAnchorRef = useRef<number | null>(null)
  const reduceMotion = useReducedMotion()

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

  const onSubmit = useCallback(async () => {
    if (isLoading) {
      onStop()
      return
    }
    const text = String(value || '').trim()
    if (!text) return
    const ok = await onSend(text)
    if (ok) setValue('')
  }, [isLoading, onStop, onSend, value])

  return (
    <div className="w-full">
      <InputAnimation
        className="w-full bg-transparent border-0 resize-none shadow-none text-[13px] leading-relaxed"
        placeholder={placeholder}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={onPasteImage}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void onSubmit()
          }
        }}
      />
      <div className="flex justify-between items-end px-0.5 pt-1.5 pb-0 mt-0.5 gap-2.5">
        {leftControls}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={`h-9 w-9 rounded-full transition-all duration-200 focus-visible:ring-0 focus-visible:ring-offset-0 ${
              isRecording
                ? 'text-blue-500 border-0 bg-blue-500/8 hover:bg-blue-500/12'
                : `text-primary hover:text-primary hover:bg-primary/15 ${isVoiceModelAvailable ? '' : 'opacity-50'}`
            }`}
            onClick={onToggleRecording}
            title={isRecording ? 'Stop Recording' : 'Voice Input'}
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
            className={`h-9 w-9 rounded-full transition-all duration-200 text-primary hover:text-primary hover:bg-primary/15 focus-visible:ring-0 focus-visible:ring-offset-0 ${
              String(value || '').trim() || isLoading ? '' : 'opacity-50'
            }`}
            onClick={() => void onSubmit()}
            disabled={!String(value || '').trim() && !isLoading}
          >
            {isLoading ? <StopCircle className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default App
