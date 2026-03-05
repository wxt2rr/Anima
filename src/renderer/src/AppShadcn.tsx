import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Send, StopCircle, Paperclip, PanelLeftOpen, SquarePen, Wrench, Sparkles, X, ChevronDown, Terminal, Mic, MicOff, Folder, Search, PenLine, Compass, Eye } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { CodeBlock } from './components/markdown/CodeBlock'
import { MermaidBlock } from './components/markdown/MermaidBlock'
import 'katex/dist/katex.min.css'
import { DiffView } from './components/DiffView'
import { TodoProgressCard } from './components/TodoProgressCard'
import { resolveBackendBaseUrl, useStore, type Message, type ToolTrace, type TodoItem, type ProviderModel, type Artifact } from './store/useStore'
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
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <div className="max-w-[520px] w-full px-6 space-y-3">
          <div className="text-base font-semibold">Loading settings…</div>
          {configError ? <div className="text-sm text-destructive">{configError}</div> : null}
          <Button variant="outline" onClick={() => void loadRemoteConfig().catch(() => {})}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return <AppLoaded />
}

function AppLoaded(): JSX.Element {
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [skillsCache, setSkillsCache] = useState<SkillEntry[]>([])
  const [skillsStatus, setSkillsStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  // Use a single state for mutually exclusive popovers
  const [popoverPanel, setPopoverPanel] = useState<'' | 'attachments' | 'tools' | 'skills' | 'model'>('')
  
  const [traceDetailOpenByKey, setTraceDetailOpenByKey] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastSoundAtRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)
  const typingTimerRef = useRef<number | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const chatScrollRef = useRef<HTMLElement | null>(null)
  const scrollAnimRef = useRef<number | null>(null)
  const scrollVelRef = useRef(0)
  const isAutoScrollActiveRef = useRef(false)
  const chatIsAtBottomRef = useRef(true)
  const isLoadingRef = useRef(false)
  const userScrollLockedRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const lastScrollTopRef = useRef(0)
  const lastMessageKeyRef = useRef('')
  const lastSeenMessageKeyRef = useRef('')
  const userMsgElMapRef = useRef<Map<string, HTMLElement>>(new Map())
  const highlightUserMsgTimerRef = useRef<number | null>(null)
  const [highlightUserMsgId, setHighlightUserMsgId] = useState('')
  const [userNavItems, setUserNavItems] = useState<Array<{ id: string; topRatio: number; widthPx: number; content: string }>>([])
  const [navHover, setNavHover] = useState<{ id: string; topRatio: number; content: string } | null>(null)
  
  const { 
    messages, 
    chats,
    addMessage, 
    persistLastMessage, 
    activeChatId,
    updateChat,
    settings: settings0, 
    providers: providers0,
    voiceModelsInstalled,
    setSettingsOpen,
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

  const [leftWidth, setLeftWidth] = useState(288)
  const [rightWidth, setRightWidth] = useState(600)
  const [isResizingLeft, setIsResizingLeft] = useState(false)
  const [isResizingRight, setIsResizingRight] = useState(false)
  const [backendBaseUrl, setBackendBaseUrl] = useState('')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState('')
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<number | null>(null)
  const [compressionNotice, setCompressionNotice] = useState<{ text: string; at: number } | null>(null)
  const [chatIsAtBottom, setChatIsAtBottom] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  useEffect(() => {
    void resolveBackendBaseUrl()
      .then((url) => setBackendBaseUrl(String(url || '').trim()))
      .catch(() => {})
  }, [])

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId), [chats, activeChatId])
  const chatCompression = (activeChat as any)?.meta?.compression as any
  const hasChatSummary = Boolean(String(chatCompression?.summary || '').trim())

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
        setLeftWidth(Math.max(200, Math.min(800, e.clientX - 8)))
      }
      if (isResizingRight) {
        setRightWidth(Math.max(300, Math.min(1200, window.innerWidth - e.clientX - 8)))
      }
    }

    const handleMouseUp = () => {
      setIsResizingLeft(false)
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
  }, [isResizingLeft, isResizingRight])

  useEffect(() => {
    if (!compressionNotice) return
    const t = window.setTimeout(() => setCompressionNotice(null), 4500)
    return () => window.clearTimeout(t)
  }, [compressionNotice])

  useEffect(() => {
    void initApp()
  }, [initApp])

  const setUpdateState = useUpdateStore((s) => s.setState)

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
  const isSettingsWindow = typeof window !== 'undefined' && window.location.hash.startsWith('#/settings')

  const openSettings = () => {
    const anima = window.anima
    if (anima?.window?.openSettings) {
      void anima.window.openSettings()
      return
    }
    setSettingsOpen(true)
  }

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      setIsRecording(false)
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      recordingChunksRef.current = []

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        const chunks = recordingChunksRef.current
        recordingChunksRef.current = []
        const blob = new Blob(chunks, { type: 'audio/webm' })
        if (blob.size > 0) {
          try {
            const res = await fetchBackendJson<{ ok: boolean; text: string }>('/voice/transcribe', {
              method: 'POST',
              body: blob,
              headers: {
                'Content-Type': blob.type || 'audio/webm'
              }
            })
            if (res.ok && res.text) {
              setInputValue((prev) => {
                const spacer = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
                return prev + spacer + res.text
              })
            }
          } catch (e) {
            console.error('Transcription failed', e)
          }
        }

        const s = mediaStreamRef.current
        if (s) s.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('Error accessing microphone:', err)
      setIsRecording(false)
    }
  }

  const composer = ui.composer
  const projects = Array.isArray(settings.projects) ? settings.projects : []
  const activeProjectId = String(ui.activeProjectId || '').trim()
  const activeProject = activeProjectId ? projects.find((p: any) => String(p?.id || '').trim() === activeProjectId) || null : null
  const activeProjectDir = String((activeProject as any)?.dir || '').trim()
  const activeProjectName = String((activeProject as any)?.name || '').trim()

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

  const thinkingLevel = composer.thinkingLevel || 'default'
  const shouldShowAnalysis = effectiveProvider?.type === 'deepseek' && (
    thinkingLevel === 'default' ? Boolean(effectiveProvider?.config?.thinkingEnabled) : thinkingLevel !== 'off'
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

  const buildComposerPayload = () => {
    const workspaceDir = resolveWorkspaceDir()
    const enabledToolIds = composer.enabledToolIds.length ? composer.enabledToolIds : settings.toolsEnabledIds
    const enabledMcpServerIds = composer.enabledMcpServerIds.length ? composer.enabledMcpServerIds : settings.mcpEnabledServerIds
    const enabledSkillIds = composer.enabledSkillIds.length ? composer.enabledSkillIds : settings.skillsEnabledIds

    const selectedModelConfig = effectiveProvider?.config?.models?.find(
      (m: any) => typeof m !== 'string' && m.id === effectiveModel
    ) as ProviderModel | undefined

    return {
      attachments: composer.attachments.map((a) => ({ path: a.path, mode: a.mode })),
      chatId: String(useStore.getState().activeChatId || activeChatId || '').trim(),
      workspaceDir,
      toolMode: composer.toolMode || settings.defaultToolMode,
      enabledToolIds,
      enabledMcpServerIds,
      skillMode: composer.skillMode || settings.defaultSkillMode,
      enabledSkillIds,
      providerOverrideId: composer.providerOverrideId || '',
      modelOverride: composer.modelOverride || '',
      contextWindowOverride: composer.contextWindowOverride || selectedModelConfig?.config?.contextWindow || 0,
      maxOutputTokens: selectedModelConfig?.config?.maxOutputTokens,
      jsonConfig: selectedModelConfig?.config?.jsonConfig,
      thinkingLevel
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

  const startAutoScroll = useCallback((opts?: { force?: boolean }) => {
    const el = chatScrollRef.current
    if (!el) return
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
      if (currTop < prevTop - 2) {
        userScrollLockedRef.current = true
        chatIsAtBottomRef.current = false
        setChatIsAtBottom(false)
        stopAutoScroll()
        return
      }
      if (gap <= 24) {
        userScrollLockedRef.current = false
        chatIsAtBottomRef.current = true
        setChatIsAtBottom(true)
        setShowScrollToBottom(false)
        lastSeenMessageKeyRef.current = lastMessageKeyRef.current
      }
      return
    }

    if (gap <= 24) {
      userScrollLockedRef.current = false
      chatIsAtBottomRef.current = true
      setChatIsAtBottom(true)
      setShowScrollToBottom(false)
      lastSeenMessageKeyRef.current = lastMessageKeyRef.current
      return
    }

    userScrollLockedRef.current = true
    chatIsAtBottomRef.current = false
    setChatIsAtBottom(false)
    stopAutoScroll()
  }, [stopAutoScroll])

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
    setShowScrollToBottom(false)
    setChatIsAtBottom(true)
    chatIsAtBottomRef.current = true
    markProgrammaticScroll()
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    startAutoScroll({ force: true })
  }, [markProgrammaticScroll, startAutoScroll])

  const scrollToUserMessage = useCallback(
    (id: string) => {
      const el = chatScrollRef.current
      const target = userMsgElMapRef.current.get(id)
      if (!el || !target) return
      userScrollLockedRef.current = true
      stopAutoScroll()
      const top = Math.max(0, target.offsetTop - 24)
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
      const node = userMsgElMapRef.current.get(id)
      if (!node) continue
      const content = typeof m.content === 'string' ? m.content : ''
      const len = content.length
      const norm = denom > 0 ? Math.log(1 + Math.max(0, len)) / denom : 0
      const widthPx = 4 + norm * (18 - 4)
      const topRatio = Math.max(0, Math.min(1, node.offsetTop / sh))
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
    if (!userScrollLockedRef.current) {
      lastSeenMessageKeyRef.current = lastMessageKey
      setShowScrollToBottom(false)
      startAutoScroll()
      return
    }
    if (lastMessageKey !== lastSeenMessageKeyRef.current) {
      setShowScrollToBottom(true)
    }
  }, [lastMessageKey, startAutoScroll])

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
  }

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return
    
    if (!activeProvider && !effectiveProviderId) {
      openSettings()
      return
    }

    let ensuredProjectId = String(useStore.getState().ui.activeProjectId || '').trim()
    if (!ensuredProjectId) {
      const res = await window.anima?.window?.pickDirectory?.()
      if (!res?.ok || res.canceled) return
      const dir = String(res.path || '').trim()
      if (!dir) return
      ensuredProjectId = await useStore.getState().addProject(dir)
      if (ensuredProjectId) await useStore.getState().createChatInProject(ensuredProjectId)
    }

    if (ensuredProjectId && !String(useStore.getState().activeChatId || '').trim()) {
      await useStore.getState().createChatInProject(ensuredProjectId)
    }

    const ensuredChatId = String(useStore.getState().activeChatId || '').trim()
    if (!ensuredChatId) return

      const userMessage = inputValue.trim()
      const userAttachments = composer.attachments.map((a) => ({ path: a.path }))
      const userAttachmentsWorkspaceDir = resolveWorkspaceDir()
      setInputValue('')
      setIsLoading(true)
      const controller = new AbortController()
      abortControllerRef.current = controller

      const turnId = crypto.randomUUID()
      let currentAssistantId = crypto.randomUUID()

      const updateLastMessage = (content: string, meta?: any) => {
        const { updateMessageById, activeChatId } = useStore.getState()
        if (activeChatId) {
          updateMessageById(activeChatId, currentAssistantId, { content, meta })
        }
      }

    const composerPayload = buildComposerPayload()

    addMessage({
      role: 'user',
      content: userMessage,
      turnId,
      meta: userAttachments.length ? { userAttachments, userAttachmentsWorkspaceDir } : undefined
    } as any)
    if (composer.attachments.length) updateComposer({ attachments: [] })
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

        const runMessages = [{ role: 'user' as const, content: userMessage }]
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
        let gotDone = false
        let compressionMsgId: string | null = null
        let compressionSeenStart = false
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

        const upsertTrace = (trace: ToolTrace) => {
          const { updateMessageById, activeChatId, addMessage, persistMessageById, messages } = useStore.getState()
          
          let msgId = traceMessageIds[trace.id]
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
             updateLastMessage(fullContent, assistantMeta)
             if (activeChatId) {
               void persistMessageById(activeChatId, currentAssistantId, fullContent, assistantMeta)
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

          if (trace.name === 'TodoWrite' && trace.status === 'succeeded') {
            try {
              const resultText = trace.resultPreview?.text || (trace as any).result || '{}'
              const result = JSON.parse(resultText)

              if (result.ok && Array.isArray(result.todos)) {
                const { updateChat, chats, activeChatId } = useStore.getState()
                const currentChat = chats.find((c) => c.id === activeChatId)
                const currentTodos = currentChat?.todoState?.items || []

                let nextTodos = [...currentTodos]
                if (result.merge) {
                  for (const todo of result.todos) {
                    const idx = nextTodos.findIndex((t) => t.id === todo.id)
                    if (idx >= 0) {
                      nextTodos[idx] = { ...nextTodos[idx], ...todo }
                    } else {
                      nextTodos.push(todo)
                    }
                  }
                } else {
                  nextTodos = result.todos
                }

                if (activeChatId) {
                  updateChat(activeChatId, { todoState: { items: nextTodos, lastUpdated: Date.now() } })
                }

                assistantMeta = {
                  ...assistantMeta,
                  todoSnapshot: nextTodos
                }
              }
            } catch (e) {
              console.error('Failed to process TodoWrite result', e)
            }
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

        const baseUrl = await resolveBackendBaseUrl()
        const res = await fetch(`${baseUrl}/api/runs?stream=1`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  messages: runMessages,
                  composer: composerPayload,
                  temperature: settings.temperature,
                  maxTokens: settings.maxTokens,
                  runId: turnId,
                  threadId,
                  useThreadMessages: true
                }),
                signal: controller.signal
              })
        if (!res.ok) {
          const text = await res.text()
          const data = text ? JSON.parse(text) : null
          const msg = data?.error || `HTTP ${res.status}`
          throw new Error(String(msg))
        }

        const reader = res.body?.getReader()
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
                content?: string
                stage?: string
                step?: number
                reasoning?: string
                usage?: BackendUsage
                rateLimit?: BackendRateLimit
                traces?: ToolTrace[]
                artifacts?: Artifact[]
                trace?: ToolTrace
                mode?: string
                summaryPreview?: string
                summaryUpdatedAt?: number
                summarizedUntilMessageId?: string
              }
              if (evt.type === 'delta' && typeof evt.content === 'string' && evt.content) {
                pendingContent += evt.content
                startTyping()
              } else if (evt.type === 'run') {
                continue
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
              } else if (evt.type === 'compression_start') {
                compressionSeenStart = true
                ensureCompressionMsg('running')
              } else if (evt.type === 'compression') {
                ensureCompressionMsg('done', '已压缩对话历史')
                const ts = Date.now()
                setCompressionNotice({ text: '已自动压缩对话历史', at: ts })
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
              } else if (evt.type === 'done') {
                if (compressionSeenStart) ensureCompressionMsg('done', '已压缩对话历史')
                usage = evt.usage || null
                if (evt.rateLimit && Object.keys(evt.rateLimit).length) {
                  assistantMeta = { ...assistantMeta, rateLimit: evt.rateLimit }
                }
                if (Array.isArray(evt.artifacts)) {
                  assistantMeta = { ...assistantMeta, artifacts: evt.artifacts }
                }
                if (Array.isArray(evt.traces)) {
                  traces = evt.traces
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
        if (compressionSeenStart) ensureCompressionMsg('done', '已压缩对话历史')
        if (gotDone) {
          await reader.cancel().catch(() => {})
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
        const res = await fetch(`${baseUrl}/api/runs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: runMessages,
            composer: composerPayload,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            runId: turnId,
            threadId,
            useThreadMessages: true
          }),
          signal: controller.signal
        })
        
        if (!res.ok) {
          const text = await res.text()
          const data = text ? JSON.parse(text) : null
          const msg = data?.error || `HTTP ${res.status}`
          throw new Error(String(msg))
        }

        const data = await res.json() as { ok: boolean; content?: string; usage?: BackendUsage; rateLimit?: BackendRateLimit; traces?: ToolTrace[]; artifacts?: Artifact[]; reasoning?: string }
        
        const content = typeof data.content === 'string' ? data.content : ''
        const usage = data.usage
        const rateLimit = data.rateLimit
        const traces = Array.isArray(data.traces) ? data.traces : []
        const artifacts = Array.isArray(data.artifacts) ? data.artifacts : []
        
        let todoSnapshot: TodoItem[] | undefined
        let todosUpdated = false
        const { updateChat, chats, activeChatId } = useStore.getState()
        const currentChat = chats.find((c) => c.id === activeChatId)
        let nextTodos = currentChat?.todoState?.items || []
        
        for (const trace of traces) {
          if (trace.name === 'TodoWrite' && trace.status === 'succeeded') {
            try {
              const resultText = trace.resultPreview?.text || (trace as any).result || '{}'
              const result = JSON.parse(resultText)
              
              if (result.ok && Array.isArray(result.todos)) {
                let mergedTodos = [...nextTodos]
                if (result.merge) {
                  for (const todo of result.todos) {
                    const idx = mergedTodos.findIndex((t) => t.id === todo.id)
                    if (idx >= 0) {
                      mergedTodos[idx] = { ...mergedTodos[idx], ...todo }
                    } else {
                      mergedTodos.push(todo)
                    }
                  }
                } else {
                  mergedTodos = result.todos
                }
                nextTodos = mergedTodos
                todosUpdated = true
              }
            } catch (e) {
              console.error('Failed to process TodoWrite result', e)
            }
          }
        }
        
        if (todosUpdated && activeChatId) {
          updateChat(activeChatId, { todoState: { items: nextTodos, lastUpdated: Date.now() } })
          todoSnapshot = nextTodos
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
          usage || (rateLimit && Object.keys(rateLimit).length) || Boolean(reasoning) || shouldShowAnalysis || todoSnapshot || artifacts.length > 0
            ? {
                promptTokens: usage ? usage?.prompt_tokens ?? 0 : undefined,
                completionTokens: usage ? usage?.completion_tokens ?? 0 : undefined,
                totalTokens: usage ? usage?.total_tokens ?? 0 : undefined,
                rateLimit: rateLimit && Object.keys(rateLimit).length ? rateLimit : undefined,
                reasoningSummary: deriveReasoningSummaryFromTraces(traces),
                reasoningText: reasoning,
                reasoningStatus: shouldShowAnalysis ? 'done' : reasoning ? 'done' : undefined,
                todoSnapshot,
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
      updateLastMessage(t.proxyOrKeyError(error.message))
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="h-screen w-full overflow-hidden rounded-[20px] bg-secondary/30 dark:bg-black/40 text-foreground transition-colors duration-300 relative">
      <div className="draggable absolute inset-x-0 top-0 h-2" />
      <div className={`flex h-full w-full overflow-hidden p-2 ${ui.sidebarCollapsed ? 'gap-0' : 'gap-2'}`}>
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
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {summaryLoading ? '加载中…' : (summaryText || '暂无摘要。')}
                </div>
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
                      setCompressionNotice({ text: '已手动压缩对话历史', at: Date.now() })
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

        {isSettingsWindow ? (
          <SettingsWindow />
        ) : (
          <>
            <div className="relative h-full shrink-0 flex">
              <ChatHistoryPanel onOpenSettings={openSettings} width={leftWidth} />
              <div
                className={`absolute right-0 top-0 bottom-0 w-1.5 translate-x-full cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors z-50 ${ui.sidebarCollapsed ? 'hidden' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); setIsResizingLeft(true); }}
              />
            </div>
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
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
                            <SquarePen className="w-4 h-4" />
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
                  <span>·</span>
                  <Folder className="w-3.5 h-3.5" />
                  <TooltipProvider>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <span className="max-w-[300px] truncate pointer-events-auto cursor-help font-medium">
                          {activeProjectName || t.noProject}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {activeProjectDir || t.noProject}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {(hasChatSummary || compressionNotice) && (
                    <>
                      <span>·</span>
                      <TooltipProvider>
                        <Tooltip delayDuration={100}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-6 px-2 text-xs pointer-events-auto hover:bg-primary/10"
                              onClick={() => {
                                setSummaryOpen(true)
                                void loadChatSummary().catch(() => {})
                              }}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              摘要
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{compressionNotice ? compressionNotice.text : '查看对话摘要'}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </>
                  )}
                </div>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-col flex-1 overflow-hidden min-w-0 relative">
            <main
              ref={chatScrollRef as any}
              onScroll={handleChatScroll}
              className="flex-1 overflow-y-auto pt-4 pl-6 pr-6 pb-4 no-drag"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
                  <p className="font-medium text-lg text-foreground">{t.helloTitle}</p>
                  <p className="text-sm text-muted-foreground">
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
                  {messages.map((msg) => {
                    if (msg.role !== 'user' && msg.role !== 'tool') {
                      const meta: any = msg.meta || {}
                      const hasReasoning = typeof meta.reasoningText === 'string' && meta.reasoningText.trim().length > 0
                      const hasTodos = Array.isArray(meta.todoSnapshot) && meta.todoSnapshot.length > 0
                      const hasTokens = Boolean(settings.showTokenUsage && meta.totalTokens != null)
                      const hasContent = typeof msg.content === 'string' && msg.content.trim().length > 0

                      if (!hasContent && !hasReasoning && !hasTodos && !hasTokens) return null
                    }

                    return (
                    <div key={msg.id} className="w-full">
                      {msg.role === 'user' ? (
                        <div className={`py-2 flex justify-end ${msg.id === lastUserMessageId ? 'sticky top-0 z-20' : ''}`}>
                           <div className="flex flex-col items-end gap-2">
                              <div
                                ref={(el) => {
                                  const id = String(msg.id || '').trim()
                                  if (!id) return
                                  const map = userMsgElMapRef.current
                                  if (el) map.set(id, el)
                                  else map.delete(id)
                                }}
                                className={`w-fit max-w-[520px] rounded-2xl border border-border/60 bg-black/5 dark:bg-white/10 px-4 py-2 text-[14px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90 transition-shadow ${msg.id === highlightUserMsgId ? 'ring-2 ring-primary/35 shadow-sm' : ''}`}
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
                        <div className="py-0">
                            {Array.isArray(msg.meta?.toolTraces) && msg.meta?.toolTraces.length > 0 && (() => {
                              const traces = msg.meta?.toolTraces || []

                              return (
                                <div className="space-y-1 ml-1 pl-4 border-l-2 border-muted/20">
                                  {traces.map((tr) => {
                                    const detailKey = `${msg.id}:${tr.id}`
                                    const detailOpen = !!traceDetailOpenByKey[detailKey]
                                    const isRunning = tr.status === 'running'
                                    const isFailed = tr.status === 'failed'

                                    const iconClass = `w-3.5 h-3.5 ${isRunning ? 'text-blue-500 animate-pulse' : isFailed ? 'text-red-500' : 'text-muted-foreground'}`
                                    let icon = <Compass className={iconClass} />
                                    let entity = tr.name
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
                                    let resultSummary = ''
                                    let detailMarkdown = ''

                                    if (tr.name === 'bash') {
                                      icon = <Terminal className={iconClass} />
                                      entity = normalizeValue(argsObj.command)
                                    } else if (tr.name === 'rg_search' || tr.name === 'glob_files') {
                                      icon = <Search className={iconClass} />
                                      entity = normalizeValue(argsObj.pattern)
                                      if (argsObj.path) entity += ` in ${normalizeValue(argsObj.path)}`
                                    } else if (tr.name === 'read_file') {
                                      icon = <Eye className={iconClass} />
                                      entity = normalizeValue(argsObj.path)
                                    } else if (tr.name === 'write_file' || tr.name === 'replace_file' || tr.name === 'edit_file') {
                                      icon = <PenLine className={iconClass} />
                                      entity = normalizeValue(argsObj.path)
                                    } else if (tr.name === 'WebSearch') {
                                      icon = <Search className={iconClass} />
                                      entity = normalizeValue(argsObj.query)
                                      const count = Array.isArray(resultItems) ? resultItems.length : undefined
                                      resultSummary = typeof count === 'number' ? `已搜索到${count}条结果` : ''
                                    } else if (tr.name === 'WebFetch') {
                                      icon = <Eye className={iconClass} />
                                      entity = normalizeValue(argsObj.url)
                                    } else {
                                      entity = normalizeValue(entity)
                                    }

                                    const canOpenEntityInFiles =
                                      (tr.name === 'read_file' ||
                                        tr.name === 'write_file' ||
                                        tr.name === 'replace_file' ||
                                        tr.name === 'edit_file') &&
                                      Boolean(entity)

                                    if (tr.name === 'WebSearch' && Array.isArray(resultItems)) {
                                      const circled = [
                                        '',
                                        '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
                                        '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'
                                      ]
                                      const marker = (n: number) => circled[n] || `(${n})`

                                      const lines = resultItems
                                        .map((r: any, idx: number) => {
                                          const title = String(r?.title || r?.url || '链接').trim()
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
                                      if (url) lines.push(`- [网页链接](${url})`)
                                      const statusParts: string[] = []
                                      if (resultObj.status) statusParts.push(`HTTP ${resultObj.status}`)
                                      if (resultObj.contentType) statusParts.push(String(resultObj.contentType))
                                      if (resultObj.truncated) statusParts.push('已截断')
                                      if (statusParts.length) lines.push(`- 状态：${statusParts.join(' · ')}`)
                                      detailMarkdown = lines.join('\n')
                                    } else if (Array.isArray(resultObj?.paths)) {
                                      detailMarkdown = resultObj.paths.map((p: any) => `- ${String(p)}`).join('\n')
                                    } else if (Array.isArray(resultObj?.entries)) {
                                      detailMarkdown = resultObj.entries
                                        .map((e: any) => {
                                          const name = String(e?.name || '')
                                          const type = e?.type === 'dir' ? '文件夹' : e?.type === 'file' ? '文件' : ''
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
                                          if (path && line) return `- ${path} 第${line}行：${text || '匹配内容'}`
                                          if (path) return `- ${path}：${text || '匹配内容'}`
                                          return `- ${text}`
                                        })
                                        .filter(Boolean)
                                        .join('\n')
                                    } else if (Array.isArray(resultObj?.diffs)) {
                                      detailMarkdown = resultObj.diffs
                                        .map((d: any) => String(d?.path || ''))
                                        .filter(Boolean)
                                        .map((p: string) => `- [${p}](${p})`)
                                        .join('\n')
                                    } else if (resultObj?.meta?.path) {
                                      detailMarkdown = `- 已读取：${String(resultObj.meta.path)}`
                                    } else if (resultObj?.ok === false) {
                                      const errMsg = String(resultObj?.error || '失败').trim()
                                      detailMarkdown = errMsg ? `- 失败：${errMsg}` : ''
                                    }

                                    const hasDetail =
                                      Boolean(detailMarkdown) ||
                                      (Array.isArray((tr as any).artifacts) && (tr as any).artifacts.length > 0) ||
                                      (Array.isArray(tr.diffs) && tr.diffs.length > 0) ||
                                      (tr.status === 'failed' && Boolean(tr.error?.message))

                                    return (
                                      <div key={tr.id} className="group rounded-lg hover:bg-muted/40 transition-colors px-2 py-0 -mx-2">
                                        <div
                                          className={`flex items-center gap-2 ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
                                          onClick={() => {
                                            if (!hasDetail) return
                                            setTraceDetailOpenByKey((s) => ({ ...s, [detailKey]: !s[detailKey] }))
                                          }}
                                        >
                                          <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
                                            <span className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0">
                                              {icon}
                                            </span>
                                            {hasDetail ? (
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="absolute inset-0 h-4 w-4 p-0 text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
                                                onClick={() => setTraceDetailOpenByKey((s) => ({ ...s, [detailKey]: !s[detailKey] }))}
                                              >
                                                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${detailOpen ? 'rotate-180' : ''}`} />
                                              </Button>
                                            ) : null}
                                          </div>
                                          
                                          <div className="min-w-0 flex-1 flex items-center gap-2">
                                            <span className="font-mono text-[12px] text-foreground hover:text-foreground/80 cursor-pointer">{tr.name}</span>
                                            {canOpenEntityInFiles ? (
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
                                                {entity}
                                              </button>
                                            ) : (
                                              <span className="inline-block max-w-full text-[12px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-md truncate align-middle border border-transparent hover:border-border/50 transition-colors">
                                                {entity}
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
                                          </div>
                                        </div>

                                        {detailOpen && hasDetail && (
                                          <div className={tr.name === 'WebSearch' ? 'mt-2 space-y-2 pb-1' : 'mt-2 ml-3 space-y-2 pb-1 border-l-2 border-muted pl-2'}>
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
                                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Changes</div>
                                                <div className="space-y-2">
                                                  {tr.diffs.map((d, i) => (
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
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })()}
                        </div>
                      ) : (
                        <div className="py-0.5">
                          <div className="space-y-0.5">
                            {(() => {
                              const meta = msg.meta || {}
                              const status = meta.reasoningStatus
                              const text = typeof meta.reasoningText === 'string' ? meta.reasoningText.trim() : ''
                              if (!text) return null
                              const isThinking = status === 'pending' || status === 'streaming'
                              return (
                                <div className="ml-1 pl-4 border-l-2 border-muted/20 text-[13px] leading-relaxed text-muted-foreground py-0.5">
                                   {text}
                                   {isThinking && <span className="inline-block w-1.5 h-3 bg-muted-foreground/50 ml-1 animate-pulse align-middle"/>}
                                </div>
                              )
                            })()}

                            {msg.meta?.todoSnapshot && msg.meta.todoSnapshot.length > 0 && (
                              <TodoProgressCard todos={msg.meta.todoSnapshot} />
                            )}

                            {(msg.meta as any)?.compressionState === 'running' ? (
                              <div className="pl-6">
                                <div className="inline-flex items-center gap-2 text-[14px] leading-relaxed text-foreground/80">
                                  <span>压缩中</span>
                                  <span className="inline-flex items-center gap-1 translate-y-[1px]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '120ms' }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '240ms' }} />
                                  </span>
                                </div>
                                <div className="mt-2 space-y-2 max-w-[520px]">
                                  <div className="h-3 rounded bg-muted/40 animate-pulse" />
                                  <div className="h-3 w-2/3 rounded bg-muted/30 animate-pulse" />
                                </div>
                              </div>
                            ) : null}

                            {(msg.meta as any)?.compressionState === 'running' ? null : settings.enableMarkdown ? (
                              <div className="pl-6">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm, remarkMath]}
                                  rehypePlugins={[rehypeKatex, rehypeRaw]}
                                  className="prose prose-sm dark:prose-invert max-w-none prose-p:text-[14px] prose-li:text-[14px] prose-table:text-[14px] prose-p:leading-relaxed prose-li:leading-relaxed text-foreground/90"
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
                                      const isFileLike =
                                        target.startsWith('file://') ||
                                        target.startsWith('/') ||
                                        target.startsWith('\\') ||
                                        target.startsWith('./') ||
                                        target.startsWith('../') ||
                                        target.startsWith('~/') ||
                                        /\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(target)
                                      const linkClass = isFileLike
                                        ? 'text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
                                        : ''
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
                              <p className="whitespace-pre-wrap pl-6 text-foreground/90">{msg.content || ''}</p>
                            )}
                            {typeof (msg.meta as any)?.stage === 'string' && String((msg.meta as any).stage || '').trim() && (
                              <div className="text-[11px] text-muted-foreground pl-6 pt-1">
                                {String((msg.meta as any).stage)}
                              </div>
                            )}
                            {Array.isArray(msg.meta?.artifacts) && msg.meta?.artifacts.length > 0 && (
                              <div className="pl-6 pt-1">
                                {renderArtifacts(msg.meta.artifacts, 'md')}
                              </div>
                            )}
                            {settings.showTokenUsage && msg.meta?.totalTokens != null && (
                              <div className="text-[11px] text-muted-foreground pl-6">
                                Tokens: {msg.meta.promptTokens ?? 0} + {msg.meta.completionTokens ?? 0} ={' '}
                                {msg.meta.totalTokens}
                              </div>
                            )}

                          </div>
                        </div>
                      )}
                    </div>
                    )
                  })}
                  <div ref={messagesEndRef} />
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
            {showScrollToBottom && (
              <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 no-drag">
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
              </div>
            )}

            <footer className="pl-6 pr-6 pt-6 pb-0 no-drag overflow-visible">
              <div className="max-w-3xl mx-auto relative bg-background rounded-xl shadow-sm border border-black/5 dark:border-white/10 p-3 transition-all duration-200">
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
                                className="h-14 w-14 rounded-lg border border-border/60 object-cover"
                              />
                            ) : (
                              <div className="h-14 max-w-[220px] rounded-lg border border-border/60 bg-muted/10 px-2 py-1.5 flex items-center">
                                <div className="text-xs truncate">{name}</div>
                              </div>
                            )}
                            <button
                              type="button"
                              className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-background border border-border/60 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                              onClick={() => updateComposer({ attachments: composer.attachments.filter((x) => x.id !== a.id) })}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <InputAnimation
                    className="w-full bg-transparent border-0 resize-none shadow-none text-[13px] leading-relaxed"
                    placeholder={t.typeMessage}
                    rows={1}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <div className="flex justify-between items-center px-2 pb-1 mt-1 gap-2">
                   <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                      {/* Attachments */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full shrink-0 text-primary hover:text-primary hover:bg-primary/15 focus-visible:ring-0 focus-visible:ring-offset-0"
                        onClick={() => void handlePickFiles()}
                      >
                        <Paperclip className="w-4 h-4" />
                      </Button>

                      {/* Tools */}
                      <Popover open={popoverPanel === 'tools'} onOpenChange={(open) => handlePopoverOpenChange('tools', open)}>
                        <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('tools')} onMouseLeave={handleInputPanelMouseLeave}>
                           <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0 text-primary hover:text-primary hover:bg-primary/15 focus-visible:ring-0 focus-visible:ring-offset-0">
                             <Wrench className="w-4 h-4" />
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="start" onMouseEnter={() => handleMouseEnter('tools')} onMouseLeave={handleMouseLeave}>
                          <div className="space-y-3">
                             <div className="flex items-center justify-between">
                               <h4 className="font-medium text-xs leading-none">{t.composer.tools}</h4>
                               <select className="text-xs border rounded px-2 py-1" value={composer.toolMode} onChange={(e) => updateComposer({ toolMode: e.target.value as any })}>
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
                                         <Checkbox className="rounded-none" id={tool.id} checked={composer.enabledToolIds.includes(tool.id)} onCheckedChange={(checked) => updateComposer({ enabledToolIds: toggleId(composer.enabledToolIds, tool.id, !!checked) })} />
                                         <label htmlFor={tool.id} className="text-xs leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{tool.name}</label>
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
                                            <Checkbox className="rounded-none" id={s.id} checked={composer.enabledMcpServerIds.includes(s.id)} onCheckedChange={(checked) => updateComposer({ enabledMcpServerIds: toggleId(composer.enabledMcpServerIds, s.id, !!checked) })} />
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

                      {/* Skills */}
                      <Popover open={popoverPanel === 'skills'} onOpenChange={(open) => handlePopoverOpenChange('skills', open)}>
                        <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('skills')} onMouseLeave={handleInputPanelMouseLeave}>
                           <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0 text-primary hover:text-primary hover:bg-primary/15 focus-visible:ring-0 focus-visible:ring-offset-0">
                             <Sparkles className="w-4 h-4" />
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="start" onMouseEnter={() => handleMouseEnter('skills')} onMouseLeave={handleMouseLeave}>
                           <div className="space-y-3">
                             <div className="flex items-center justify-between">
                               <h4 className="font-medium text-xs leading-none">{t.composer.skills}</h4>
                               <select className="text-xs border rounded px-2 py-1" value={composer.skillMode} onChange={(e) => updateComposer({ skillMode: e.target.value as any })}>
                                  <option value="auto">{t.composer.auto}</option>
                                  <option value="all">{t.composer.all}</option>
                                  <option value="disabled">{t.composer.disabled}</option>
                               </select>
                             </div>
                             
                             <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">{skillsCache.length} loaded</span>
                                <div className="flex gap-2">
                                   <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void ensureSkills()}>{t.composer.refresh}</Button>
                                   <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void openSkillsFolder()}>{t.composer.openFolder}</Button>
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

                      {/* Model Selector */}
                      <Popover open={popoverPanel === 'model'} onOpenChange={(open) => handlePopoverOpenChange('model', open)}>
                        <PopoverTrigger asChild onMouseEnter={() => handleInputPanelMouseEnter('model')} onMouseLeave={handleInputPanelMouseLeave}>
                           <Button variant="ghost" className="h-8 rounded-full gap-2 px-3 text-xs font-normal text-primary hover:text-primary hover:bg-primary/15 shrink min-w-0 max-w-[200px] focus-visible:ring-0 focus-visible:ring-offset-0">
                              {effectiveProvider ? (
                                <MaskedIcon url={getProviderIconUrl(effectiveProvider)} className="w-3.5 h-3.5 shrink-0" />
                              ) : null}
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
                        <select
                          className="h-8 rounded-full border bg-background px-2 text-[11px] text-foreground"
                          value={thinkingLevel}
                          onChange={(e) => updateComposer({ thinkingLevel: e.target.value as any })}
                          title={t.composer.thinking}
                        >
                          <option value="default">{t.composer.thinkingDefault}</option>
                          <option value="off">{t.composer.thinkingOff}</option>
                          <option value="low">{t.composer.thinkingLow}</option>
                          <option value="medium">{t.composer.thinkingMedium}</option>
                          <option value="high">{t.composer.thinkingHigh}</option>
                        </select>
                      ) : null}

                       {/* Context Usage */}
                       <TooltipProvider>
                         <Tooltip delayDuration={0}>
                           <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full transition-colors text-muted-foreground hover:text-primary hover:bg-primary/15 cursor-default focus-visible:ring-0 focus-visible:ring-offset-0"
                              >
                                <CircularProgress value={usageStats.percentage} />
                              </Button>
                           </TooltipTrigger>
                           <TooltipContent side="top" className="text-xs">
                              <div className="flex flex-col gap-1">
                                <div className="font-medium">Context Usage: {usageStats.percentage > 0 ? `${usageStats.percentage.toFixed(1)}%` : '0%'}</div>
                                <div className="text-muted-foreground">Used: {formatTokenCount(usageStats.used)}</div>
                                {usageStats.total > 0 && <div className="text-muted-foreground">Limit: {formatTokenCount(usageStats.total)}</div>}
                              </div>
                           </TooltipContent>
                         </Tooltip>
                       </TooltipProvider>
                    </div>
                     
                     <div className="flex items-center gap-1 shrink-0">

                       <Button 
                         variant="ghost" 
                         size="icon" 
                         className={`h-8 w-8 rounded-full transition-all duration-200 focus-visible:ring-0 focus-visible:ring-offset-0 ${isRecording ? 'text-red-500 animate-pulse bg-red-500/10' : `text-primary hover:text-primary hover:bg-primary/15 ${isVoiceModelAvailable ? '' : 'opacity-50'}`}`}
                         onClick={() => {
                           if (!isRecording && !isVoiceModelAvailable) {
                             alert('请配置模型')
                             return
                           }
                           void toggleRecording()
                         }}
                         title={isRecording ? 'Stop Recording' : 'Voice Input'}
                       >
                         {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 opacity-70" />}
                       </Button>

                       <Button 
                         variant="ghost"
                         size="icon"
                         className={`h-8 w-8 rounded-full transition-all duration-200 text-primary hover:text-primary hover:bg-primary/15 focus-visible:ring-0 focus-visible:ring-offset-0 ${inputValue.trim() || isLoading ? '' : 'opacity-50'}`}
                         onClick={isLoading ? handleStop : handleSend}
                         disabled={!inputValue.trim() && !isLoading}
                       >
                         {isLoading ? <StopCircle className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
                       </Button>
                     </div>
                  </div>
              </div>
            </footer>
            </div>
            </div>
          </div>
          <div className="relative h-full shrink-0 flex">
            <div
              className={`absolute left-0 top-0 bottom-0 w-1.5 -translate-x-full cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors z-50 ${ui.rightSidebarOpen ? '' : 'hidden'}`}
              onMouseDown={(e) => { e.preventDefault(); setIsResizingRight(true); }}
            />
            <RightSidebar width={rightWidth} />
          </div>
          </>
        )}
      </div>
    </div>
  )
}

export default App
