import { useState, useRef, useEffect, useMemo } from 'react'
import { Send, StopCircle, Paperclip, PanelLeftOpen, SquarePen, FolderOpen, Wrench, Sparkles, X, ChevronDown, Terminal, Mic, MicOff, Folder, Search, PenLine, Compass, Eye } from 'lucide-react'
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
import { resolveBackendBaseUrl, useStore, type Message, type ToolTrace, type TodoItem, type ProviderModel } from './store/useStore'
import { THEMES } from './lib/themes'
import { SettingsDialog, SettingsWindow } from './components/SettingsDialog'
import { ChatHistoryPanel } from './components/ChatHistoryPanel'
import { InputAnimation } from './components/InputAnimation'
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { RightSidebar } from './components/sidebar/RightSidebar'

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

  return (
    <div className="relative w-4 h-4 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 16 16">
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="opacity-20"
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
          className="transition-all duration-300 ease-out"
        />
      </svg>
    </div>
  )
}

function normalizeChatMarkdown(input: string): string {
  const s = String(input || '')
  const hasUnescapedFence = /(^|\n)[ \t]{0,3}```/.test(s)
  if (hasUnescapedFence) return s
  return s.replace(/(^|\n)([ \t]{0,3})\\```/g, '$1$2```')
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
  const skillsContentCacheRef = useRef(new Map<string, { content: string; updatedAt?: number }>())
  
  // Use a single state for mutually exclusive popovers
  const [popoverPanel, setPopoverPanel] = useState<'' | 'attachments' | 'workspace' | 'tools' | 'skills' | 'model'>('')
  
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
  
  const { 
    messages, 
    addMessage, 
    persistLastMessage, 
    activeChatId,
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
    setPreviewUrl
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
    void initApp()
  }, [initApp])

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
    
    const percentage = total > 0 ? (used / total) * 100 : 0
    return { used, total, percentage }
  }, [tokenStatus, effectiveProvider, effectiveModel])

  const shouldShowAnalysis = effectiveProvider?.type === 'deepseek' && Boolean(effectiveProvider?.config?.thinkingEnabled)

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
      { id: 'list_dir', name: '列目录' },
      { id: 'mac_reminders_create', name: '创建提醒事项' },
      { id: 'mac_reminders_list', name: '列出提醒事项' },
      { id: 'mac_reminders_complete', name: '完成提醒事项' },
      { id: 'mac_notes_create', name: '创建备忘录' },
      { id: 'mac_notes_append', name: '追加备忘录' }
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
      const res = await fetchBackendJson<{ ok: boolean; skills?: SkillEntry[] }>('/skills/list', { method: 'GET' })
      const next = Array.isArray(res.skills) ? res.skills : []
      setSkillsCache(next)
      setSkillsStatus('ok')
    } catch {
      setSkillsStatus('error')
    }
  }

  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

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

  const handlePopoverOpenChange = async (name: typeof popoverPanel, open: boolean) => {
    if (open) {
      setPopoverPanel(name)
      if (name === 'skills') await ensureSkills()
    } else {
      setPopoverPanel('')
    }
  }

  const buildComposerPayload = () => {
    const workspaceDir = (composer.workspaceDir || settings.workspaceDir || '').trim()
    const enabledToolIds = composer.enabledToolIds.length ? composer.enabledToolIds : settings.toolsEnabledIds
    const enabledMcpServerIds = composer.enabledMcpServerIds.length ? composer.enabledMcpServerIds : settings.mcpEnabledServerIds
    const enabledSkillIds = composer.enabledSkillIds.length ? composer.enabledSkillIds : settings.skillsEnabledIds

    const selectedModelConfig = effectiveProvider?.config?.models?.find(
      (m: any) => typeof m !== 'string' && m.id === effectiveModel
    ) as ProviderModel | undefined

    return {
      attachments: composer.attachments.map((a) => ({ path: a.path, mode: a.mode })),
      chatId: activeChatId || '',
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
      jsonConfig: selectedModelConfig?.config?.jsonConfig
    }
  }

  const resolveWorkspaceDir = () => (composer.workspaceDir || settings.workspaceDir || '').trim()

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

  const handlePickDirectory = async () => {
    const res = await window.anima?.window?.pickDirectory?.()
    if (!res?.ok || res.canceled) return
    const dir = String(res.path || '').trim()
    if (!dir) return
    updateComposer({ workspaceDir: dir })
    updateSettings({ workspaceDir: dir })
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

  const buildRequestMessages = async (userMessage: string) => {
    const activeSystemPrompt =
      settings.systemPrompts.find((p) => p.id === settings.selectedSystemPromptId)?.content ||
      settings.systemPrompts[0]?.content ||
      ''


    const tokenizeForMemory = (text: string) => {
      const s = (text || '').toLowerCase().trim()
      if (!s) return []
      const cleaned = s.replace(/[^\w\s\u4e00-\u9fff]+/g, ' ')
      if (/\s/.test(cleaned)) {
        return cleaned.split(/\s+/).filter(Boolean)
      }
      const compact = cleaned.replace(/\s+/g, '')
      return Array.from(compact).filter((ch) => /[\w\u4e00-\u9fff]/.test(ch))
    }

    const memorySimilarity = (a: string, b: string) => {
      const A = new Set(tokenizeForMemory(a))
      const B = new Set(tokenizeForMemory(b))
      if (A.size === 0 || B.size === 0) return 0
      let inter = 0
      for (const x of A) if (B.has(x)) inter += 1
      const union = A.size + B.size - inter
      return union <= 0 ? 0 : inter / union
    }

    const enabledMemories = settings.memories.filter((m) => m.isEnabled && m.content.trim())

    const memoryBlock = (() => {
      if (!settings.memoryEnabled) return Promise.resolve('')
      if (enabledMemories.length === 0) return Promise.resolve('')

      const topK = Math.max(0, Number(settings.memoryMaxRetrieveCount || 0))
      if (!settings.memoryRetrievalEnabled) {
        return Promise.resolve(`User memory:\n${enabledMemories.map((m) => `- ${m.content.trim()}`).join('\n')}`)
      }
      if (topK === 0) return Promise.resolve('')

      const threshold = Math.min(1, Math.max(0, Number(settings.memorySimilarityThreshold || 0)))

      const scored = enabledMemories
        .map((m) => ({ m, score: memorySimilarity(userMessage, m.content) }))
        .filter((x) => x.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK || undefined)
        .map((x) => x.m)
      if (scored.length === 0) return Promise.resolve('')
      return Promise.resolve(`User memory:\n${scored.map((m) => `- ${m.content.trim()}`).join('\n')}`)
    })()

    const pluginsBlock = settings.plugins.some((p) => p.isEnabled && p.systemPromptAddon.trim())
      ? settings.plugins
          .filter((p) => p.isEnabled && p.systemPromptAddon.trim())
          .map((p) => p.systemPromptAddon.trim())
          .join('\n\n')
      : ''

    const skillsMode = composer.skillMode || settings.defaultSkillMode
    const enabledSkillIds = composer.enabledSkillIds.length ? composer.enabledSkillIds : settings.skillsEnabledIds

    const skillsBlock = (async () => {
      const mode = skillsMode
      if (mode === 'disabled') return ''
      try {
        let ids: string[] = []
        if (mode === 'all') {
          const indexRes = await fetchBackendJson<{ ok: boolean; skills?: SkillEntry[] }>('/skills/list', { method: 'GET' })
          if (!indexRes?.ok) return ''
          const allSkills = Array.isArray(indexRes.skills) ? indexRes.skills : []
          ids = allSkills.map((s) => s.id).filter(Boolean)
        } else {
          ids = enabledSkillIds
        }
        if (ids.length === 0) return ''

        const contentRes = await fetchBackendJson<{ ok: boolean; skills?: SkillEntry[] }>('/skills/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        })
        if (!contentRes?.ok) return ''
        const fetched = Array.isArray(contentRes.skills) ? contentRes.skills : []
        const cached = skillsContentCacheRef.current
        for (const s of fetched) {
          const content = String(s.content || '')
          if (!content.trim()) continue
          cached.set(s.id, { content, updatedAt: s.updatedAt })
        }
        const selected = fetched.filter((s) => String(s.content || '').trim() && s.isValid !== false)
        if (selected.length === 0) return ''

        const body = selected
          .map((s) => {
            const header = `${s.name || s.id} (${s.id})`
            const content = String(s.content || '').trim()
            return `${header}\n${content}`
          })
          .join('\n\n')

        return `Skills:\nThe following skill definitions are available. Apply them when relevant.\n\n${body}`
      } catch {
        return ''
      }
    })()

    const systemPrompt = [activeSystemPrompt, await memoryBlock, await skillsBlock, pluginsBlock]
      .filter(Boolean)
      .join('\n\n')

    const maxContextMessages = Math.max(0, settings.maxContextMessages || 0)
    const shouldCompress =
      settings.enableAutoCompression && messages.length > Math.max(0, settings.compressionThreshold || 0)
    const compressedWindow = Math.max(0, settings.keepRecentMessages || 0) || maxContextMessages
    const baseWindow = shouldCompress ? Math.min(maxContextMessages, compressedWindow) : maxContextMessages
    const override = Math.max(0, composer.contextWindowOverride || 0)
    const contextWindow = override > 0 ? override : baseWindow
    const contextMessages = messages.slice(-contextWindow)

    return [
      { role: 'system' as const, content: systemPrompt },
      ...contextMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: userMessage }
    ]
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

      const userMessage = inputValue.trim()
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

    // Add user message
    addMessage({ role: 'user', content: userMessage, turnId })

      try {
        // Add placeholder for assistant
        addMessage({
          id: currentAssistantId,
          role: 'assistant',
          content: '',
          turnId,
          meta: shouldShowAnalysis ? { reasoningStatus: 'pending', reasoningText: '' } : undefined
        } as any)

        const requestMessages = await buildRequestMessages(userMessage)
        const composerPayload = buildComposerPayload()

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
             if (activeChatId) {
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

        const baseUrl = await resolveBackendBaseUrl()
        const res = await fetch(`${baseUrl}/chat?stream=1`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  messages: requestMessages,
                  composer: composerPayload,
                  temperature: settings.temperature,
                  maxTokens: settings.maxTokens,
                  turnId
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
                reasoning?: string
                usage?: BackendUsage
                rateLimit?: BackendRateLimit
                traces?: ToolTrace[]
                trace?: ToolTrace
              }
              if (evt.type === 'delta' && typeof evt.content === 'string' && evt.content) {
                pendingContent += evt.content
                startTyping()
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
              } else if (evt.type === 'done') {
                usage = evt.usage || null
                if (evt.rateLimit && Object.keys(evt.rateLimit).length) {
                  assistantMeta = { ...assistantMeta, rateLimit: evt.rateLimit }
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
                gotDone = true
                scanning = false
                reading = false
              }
            }
          }
        }
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
        const res = await fetch(`${baseUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: requestMessages,
            composer: composerPayload,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            turnId
          }),
          signal: controller.signal
        })
        
        if (!res.ok) {
          const text = await res.text()
          const data = text ? JSON.parse(text) : null
          const msg = data?.error || `HTTP ${res.status}`
          throw new Error(String(msg))
        }

        const data = await res.json() as { ok: boolean; content?: string; usage?: BackendUsage; rateLimit?: BackendRateLimit; traces?: ToolTrace[]; reasoning?: string }
        
        const content = typeof data.content === 'string' ? data.content : ''
        const usage = data.usage
        const rateLimit = data.rateLimit
        const traces = Array.isArray(data.traces) ? data.traces : []
        
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
          usage || (rateLimit && Object.keys(rateLimit).length) || Boolean(reasoning) || shouldShowAnalysis || todoSnapshot
            ? {
                promptTokens: usage ? usage?.prompt_tokens ?? 0 : undefined,
                completionTokens: usage ? usage?.completion_tokens ?? 0 : undefined,
                totalTokens: usage ? usage?.total_tokens ?? 0 : undefined,
                rateLimit: rateLimit && Object.keys(rateLimit).length ? rateLimit : undefined,
                reasoningSummary: deriveReasoningSummaryFromTraces(traces),
                reasoningText: reasoning,
                reasoningStatus: shouldShowAnalysis ? 'done' : reasoning ? 'done' : undefined,
                todoSnapshot
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
                          {resolveWorkspaceDir() ? resolveWorkspaceDir().split(/[\\/]/).pop() : 'Default Workspace'}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {resolveWorkspaceDir() || 'Default Workspace'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <main className="flex-1 overflow-y-auto pt-4 pl-8 pr-8 pb-4 no-drag scroll-smooth">
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
                        <div className={`py-2 pl-6 pr-6 flex justify-end ${msg.id === lastUserMessageId ? 'sticky top-0 z-20 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70' : ''}`}>
                           <div className="w-fit rounded-[24px] bg-zinc-200/60 dark:bg-secondary/80 px-5 py-3 font-medium text-[15px] leading-relaxed whitespace-pre-wrap text-foreground">{msg.content}</div>
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
                                        .map((p: string) => `- ${p}`)
                                        .join('\n')
                                    } else if (resultObj?.meta?.path) {
                                      detailMarkdown = `- 已读取：${String(resultObj.meta.path)}`
                                    } else if (resultObj?.ok === false) {
                                      const errMsg = String(resultObj?.error || '失败').trim()
                                      detailMarkdown = errMsg ? `- 失败：${errMsg}` : ''
                                    }

                                    const hasDetail =
                                      Boolean(detailMarkdown) ||
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
                                            <span className="inline-block max-w-full text-[12px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded-md truncate align-middle border border-transparent hover:border-border/50 transition-colors">
                                              {entity}
                                            </span>
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
                                            {detailMarkdown ? (
                                              <ReactMarkdown
                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                rehypePlugins={[rehypeKatex, rehypeRaw]}
                                                className="prose prose-sm dark:prose-invert max-w-none text-[11px] text-foreground/80 prose-ul:pl-3 prose-ol:pl-3"
                                                components={{
                                                  pre: ({ children }) => <>{children}</>,
                                                  code({ children, ...props }: any) {
                                                    return <code {...props}>{children}</code>
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
                                                          openPreviewUrl(target)
                                                        }}
                                                      >
                                                        {children}
                                                      </a>
                                                    )
                                                  }
                                                }}
                                              >
                                                {detailMarkdown}
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

                            {settings.enableMarkdown ? (
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
                                      return <code className={className} {...props}>{children}</code>
                                    }
                                  }}
                                >
                                  {normalizeChatMarkdown(msg.content || '')}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap pl-6 text-foreground/90">{msg.content || ''}</p>
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

            <footer className="pl-6 pr-6 pt-6 pb-0 no-drag overflow-visible">
              <div className="max-w-3xl mx-auto relative bg-background rounded-2xl shadow-sm border border-black/5 dark:border-white/10 p-3 transition-all duration-200">
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
                      <Popover open={popoverPanel === 'attachments'} onOpenChange={(open) => handlePopoverOpenChange('attachments', open)}>
                        <PopoverTrigger asChild onMouseEnter={() => handleMouseEnter('attachments')} onMouseLeave={handleMouseLeave}>
                           <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0 text-primary">
                             <Paperclip className="w-4 h-4" />
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="start" onMouseEnter={() => handleMouseEnter('attachments')} onMouseLeave={handleMouseLeave}>
                           <div className="space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="font-medium text-xs leading-none">{t.composer.attachments}</h4>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => updateComposer({ attachments: [] })}>{t.composer.clear}</Button>
                              </div>
                              {composer.attachments.length === 0 ? (
                                <div className="text-xs text-muted-foreground">—</div>
                              ) : (
                                <ScrollArea className="h-[200px]">
                                  <div className="space-y-2 pr-2">
                                    {composer.attachments.map((a) => (
                                      <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2">
                                        <div className="min-w-0 flex-1">
                                          <div className="text-xs font-medium truncate">{a.path}</div>
                                          <div className="text-[11px] text-muted-foreground mt-1">
                                            <select
                                              className="rounded-md border bg-background px-1 py-0.5 text-[10px]"
                                              value={a.mode}
                                              onChange={(e) => updateComposer({ attachments: composer.attachments.map((x) => (x.id === a.id ? { ...x, mode: e.target.value as any } : x)) })}
                                            >
                                              <option value="inline">inline</option>
                                              <option value="tool">tool</option>
                                            </select>
                                          </div>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => updateComposer({ attachments: composer.attachments.filter((x) => x.id !== a.id) })}>
                                          <X className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </ScrollArea>
                              )}
                              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => void handlePickFiles()}>
                                <Paperclip className="w-3.5 h-3.5 mr-2" />
                                {t.composer.addFiles}
                              </Button>
                           </div>
                        </PopoverContent>
                      </Popover>

                      {/* Workspace */}
                      <Popover open={popoverPanel === 'workspace'} onOpenChange={(open) => handlePopoverOpenChange('workspace', open)}>
                        <PopoverTrigger asChild onMouseEnter={() => handleMouseEnter('workspace')} onMouseLeave={handleMouseLeave}>
                           <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0 text-primary">
                             <FolderOpen className="w-4 h-4" />
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="start" onMouseEnter={() => handleMouseEnter('workspace')} onMouseLeave={handleMouseLeave}>
                          <div className="space-y-3">
                             <h4 className="font-medium text-xs leading-none">{t.composer.workspace}</h4>
                             <div className="space-y-2">
                                <Button variant="outline" className={`w-full justify-start h-auto py-2 px-3 ${!composer.workspaceDir ? 'border-primary' : ''}`} onClick={() => updateComposer({ workspaceDir: '' })}>
                                   <div className="flex flex-col items-start gap-1">
                                      <span className="text-xs font-medium">Default</span>
                                      <span className="text-[10px] text-muted-foreground truncate max-w-[240px]">{settings.workspaceDir || '—'}</span>
                                   </div>
                                </Button>
                                <Button variant="outline" className="w-full justify-start text-xs" onClick={() => void handlePickDirectory()}>
                                   <span className="mr-2">＋</span> {t.composer.selectFolder}
                                </Button>
                                <div className="text-[10px] text-muted-foreground break-all px-1">
                                  Current: {resolveWorkspaceDir() || 'Default'}
                                </div>
                             </div>
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* Tools */}
                      <Popover open={popoverPanel === 'tools'} onOpenChange={(open) => handlePopoverOpenChange('tools', open)}>
                        <PopoverTrigger asChild onMouseEnter={() => handleMouseEnter('tools')} onMouseLeave={handleMouseLeave}>
                           <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0 text-primary">
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
                        <PopoverTrigger asChild onMouseEnter={() => handleMouseEnter('skills')} onMouseLeave={handleMouseLeave}>
                           <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full shrink-0 text-primary">
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
                        <PopoverTrigger asChild onMouseEnter={() => handleMouseEnter('model')} onMouseLeave={handleMouseLeave}>
                           <Button variant="ghost" className="h-8 rounded-full gap-2 px-3 text-xs font-normal text-primary hover:text-foreground shrink min-w-0 max-w-[200px]">
                              {effectiveProvider ? (
                                <img
                                  src={getProviderIconUrl(effectiveProvider)}
                                  alt={String(effectiveProvider.name || '').trim() || 'Provider'}
                                  className="w-3.5 h-3.5 shrink-0"
                                />
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
                                                {iconUrl ? <img src={iconUrl} className="w-3.5 h-3.5" /> : String(p.name || p.id || '?')[0]}
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

                       {/* Context Usage */}
                       <TooltipProvider>
                         <Tooltip delayDuration={0}>
                           <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full transition-colors text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 cursor-default"
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
                         className={`h-8 w-8 rounded-full transition-all duration-200 ${isRecording ? 'text-red-500 animate-pulse bg-red-500/10' : `text-primary hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 ${isVoiceModelAvailable ? '' : 'opacity-50'}`}`}
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
                         className={`h-8 w-8 rounded-full transition-all duration-200 ${inputValue.trim() || isLoading ? '' : 'opacity-50'}`}
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
