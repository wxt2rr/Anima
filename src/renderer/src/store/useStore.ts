import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { ThemeColor } from '../lib/themes'
import type { ShortcutBinding, ShortcutId } from '../lib/shortcuts'


export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  priority?: 'high' | 'medium' | 'low'
}

export interface Message {
  id: string
  turnId?: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  meta?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    rateLimit?: {
      remainingTokens?: number
      limitTokens?: number
      resetMs?: number
    }
    toolTraces?: ToolTrace[]
    toolSteps?: string[]
    tool_call_id?: string
    reasoningSummary?: string
    reasoningText?: string
    reasoningStatus?: 'pending' | 'streaming' | 'done'
    analysisState?: string
    collapsedAnalysis?: boolean
    todoSnapshot?: TodoItem[]
    todoPlan?: TodoItem[]
    artifacts?: Artifact[]
    stage?: string
    compressionState?: 'running' | 'done'
    userAttachments?: { path: string }[]
    userAttachmentsWorkspaceDir?: string
    dangerousCommandApproval?: {
      command: string
      matchedPattern?: string
      runId?: string
      approvalId?: string
      status?: 'pending' | 'approved_once' | 'approved_thread' | 'approved_whitelist' | 'rejected'
      selectedOption?: 'approve_once' | 'approve_thread' | 'approve_whitelist' | 'reject'
      dismissed?: boolean
    }
  }
}

export interface ArtifactSource {
  toolName?: string
  toolCallId?: string
  traceId?: string
}

export interface Artifact {
  id?: string
  kind: 'image' | 'video' | 'file'
  path: string
  mime?: string
  sizeBytes?: number
  title?: string
  caption?: string
  source?: ArtifactSource
}

export type ToolTraceStatus = 'running' | 'succeeded' | 'failed'

export type ToolPreview = {
  text: string
  truncated?: boolean
}

export interface ToolDiff {
  path: string
  oldContent: string
  newContent: string
}

export interface ToolTrace {
  id: string
  toolCallId?: string
  name: string
  status: ToolTraceStatus
  startedAt?: number
  endedAt?: number
  durationMs?: number
  argsPreview?: ToolPreview
  resultPreview?: ToolPreview
  diffs?: ToolDiff[]
  error?: { message?: string }
  artifacts?: Artifact[]
}

export interface ChatThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  meta?: any
  todoState?: {
    items: TodoItem[]
    lastUpdated: number
  }
}

export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'moonshot'
  | 'custom'
  | 'openai_compatible'
  | 'openai_codex'
  | 'azure'
  | 'github'
  | 'acp'

export interface ModelConfig {
  id: string
  contextWindow?: number
  maxOutputTokens?: number
  jsonConfig?: string
}

export interface ProviderModel {
  id: string
  isEnabled: boolean
  config: ModelConfig
}

export interface Provider {
  id: string
  name: string
  type: ProviderType
  description?: string
  icon?: string
  isEnabled: boolean
  auth?: {
    mode: 'oauth_device_code' | 'oauth_openai_codex'
    profileId?: string
  }
  config: {
    apiKey?: string
    baseUrl?: string
    models: ProviderModel[]
    selectedModel?: string
    thinkingEnabled?: boolean
    modelsFetched?: boolean
    apiFormat?: string
    useMaxCompletionTokens?: boolean
    acp?: {
      kind?: 'native_acp' | 'adapter' | 'acpx_bridge'
      command?: string
      args?: string[]
      env?: Record<string, string>
      framing?: 'auto' | 'jsonl' | 'content_length'
      approvalMode?: 'per_action' | 'per_project' | 'always'
    }
  }
}

export interface SystemPromptPreset {
  id: string
  name: string
  content: string
}

export interface MemoryItem {
  id: string
  content: string
  isEnabled: boolean
}

export type VoiceModelSource = 'remote' | 'local'

export type VoiceModelEntry = {
  id: string
  name: string
  source: VoiceModelSource
  path?: string
}

export type VoiceDownloadStatus = 'idle' | 'starting' | 'running' | 'canceling' | 'done' | 'error' | 'canceled'

export type VoiceDownloadEntry = {
  modelId: string
  taskId: string
  status: VoiceDownloadStatus
  error?: string
  downloadedBytes?: number
  totalBytes?: number
  downloadedFiles?: number
  totalFiles?: number
  currentFile?: string
  destDir?: string
  cancelRequested?: boolean
}

export interface Plugin {
  id: string
  name: string
  description?: string
  isEnabled: boolean
  systemPromptAddon: string
}

export interface McpServer {
  id: string
  name: string
  url: string
}

export interface AcpAgent {
  id: string
  name?: string
  kind?: 'mock' | 'native_acp' | 'adapter' | 'acpx_bridge'
  command?: string
  args?: string[]
  env?: Record<string, string>
  framing?: 'auto' | 'jsonl' | 'content_length'
}

export type ChatDefaultMode = 'auto' | 'all' | 'disabled'
export type ComposerPermissionMode = 'workspace_whitelist' | 'full_access'

export type AttachmentMode = 'inline' | 'tool'

export interface ComposerAttachment {
  id: string
  path: string
  mode: AttachmentMode
}

export interface Project {
  id: string
  name: string
  dir: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
}

export interface Settings {
  proxyUrl?: string
  language: string
  theme: 'light' | 'dark' | 'system'
  themeColor: ThemeColor
  density: 'comfortable' | 'compact'
  maxContextMessages: number
  temperature: number
  maxTokens: number

  enableStreamingResponse: boolean
  streamingNoProgressTimeoutMs?: number
  enableMarkdown: boolean
  collapseHistoricalProcess: boolean
  renderSingleDollarMath: boolean
  enableInfoCardVisualization: boolean

  workspaceDir: string
  projects?: Project[]
  defaultToolMode: ChatDefaultMode
  toolsEnabledIds: string[]
  commandBlacklist?: string[]
  commandWhitelist?: string[]
  mcpEnabledServerIds: string[]
  defaultSkillMode: ChatDefaultMode
  skillsEnabledIds: string[]

  enableStreamingSoundEffects: boolean

  enableAutoCompression: boolean
  compressionThreshold: number
  keepRecentMessages: number

  systemPrompts: SystemPromptPreset[]
  selectedSystemPromptId: string

  memoryEnabled: boolean
  memories: MemoryItem[]
  memoryRetrievalEnabled: boolean
  memoryMaxRetrieveCount: number
  memorySimilarityThreshold: number
  memoryAutoSummarizeEnabled: boolean
  memoryToolModelId: string
  memoryEmbeddingModelId: string
  memoryGlobalEnabled?: boolean
  memoryGlobalWriteEnabled?: boolean
  memoryGlobalRetrieveCount?: number
  memoryScopeAutoEnabled?: boolean
  memoryDefaultWriteScope?: 'workspace' | 'global'
  memoryEmbeddingLocalModels?: Array<{ id: string; name: string; path: string; updatedAt?: number }>

  openclaw?: {
    heartbeatEnabled?: boolean
    heartbeatTelegramChatId?: string
  }

  voice?: {
    enabled: boolean
    model: string
    language: string
    autoDetect: boolean
    localModels?: Array<{ id: string; name: string; path: string }>
  }

  tts?: {
    enabled: boolean
    provider: 'macos_say' | 'piper' | 'kokoro_onnx' | 'custom_http' | 'qwen_tts'
    model: string
    endpoint?: string
    apiKey?: string
    qwenModel?: string
    qwenLanguageType?: string
    speed: number
    pitch: number
    volume: number
    autoPlay: boolean
    testText?: string
    localModels?: Array<{ id: string; name: string; path?: string }>
  }

  shortcuts?: {
    bindings?: Partial<Record<ShortcutId, ShortcutBinding | null>>
  }

  acp?: {
    enabled?: boolean
    defaultAgentId?: string
    approvalMode?: 'per_action' | 'per_project' | 'always'
    agents?: AcpAgent[]
  }

  coder?: {
    enabled?: boolean
    name?: string
    backendKind?: 'codex' | 'cursor' | 'custom'
    backendLabel?: string
    endpointType?: 'terminal' | 'desktop'
    transport?: 'acp' | 'cdpbridge'
    autoStart?: boolean
    command?: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    remoteDebuggingPort?: number
    commandTemplates?: {
      status?: string
      send?: string
      ask?: string
      read?: string
      new?: string
      screenshot?: string
    }
  }
  coderProfiles?: Array<{
    id: string
    enabled?: boolean
    name?: string
    backendKind?: 'codex' | 'cursor' | 'custom'
    backendLabel?: string
    endpointType?: 'terminal' | 'desktop'
    transport?: 'acp' | 'cdpbridge'
    autoStart?: boolean
    command?: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    remoteDebuggingPort?: number
    commandTemplates?: {
      status?: string
      send?: string
      ask?: string
      read?: string
      new?: string
      screenshot?: string
    }
  }>
  activeCoderProfileId?: string

  statusCenter?: {
    tray?: {
      enabled?: boolean
      animated?: boolean
      frameIntervalMs?: number
      fallbackToBuiltin?: boolean
      icons?: {
        idle?: { sizes?: Record<string, string>; frames?: string[] }
        running?: { sizes?: Record<string, string>; frames?: string[] }
        waiting_user?: { sizes?: Record<string, string>; frames?: string[] }
        done?: { sizes?: Record<string, string>; frames?: string[] }
        error?: { sizes?: Record<string, string>; frames?: string[] }
      }
    }
  }

  im?: {
    provider?: 'telegram'
    telegram?: {
      enabled?: boolean
      botToken?: string
      allowedUserIds?: string[]
      allowGroups?: boolean
      pollingIntervalMs?: number
      projectId?: string
    }
  }

  plugins: Plugin[]
  mcpServers: McpServer[]

  media?: {
    imageEnabled: boolean
    videoEnabled: boolean
    imageProviderId?: string
    videoProviderId?: string
    defaultImageModel: string
    defaultImageSize: string
    defaultVideoModel: string
  }
}

interface AppState {
  messages: Message[]
  chats: ChatThread[]
  activeChatId: string
  configLoaded: boolean
  configError: string
  ui: {
    sidebarCollapsed: boolean
    sidebarSearchOpen: boolean
    sidebarSearchQuery: string
    activeProjectId: string
    collapsedProjectIds: string[]
    rightSidebarOpen: boolean
    activeRightPanel: 'files' | 'git' | 'terminal' | 'preview' | null
    previewUrl: string
    fileExplorerRequest: { path: string; nonce: number }
    composer: {
      attachments: ComposerAttachment[]
      workspaceDir: string
      toolMode: ChatDefaultMode
      permissionMode: ComposerPermissionMode
      enabledToolIds: string[]
      enabledMcpServerIds: string[]
      skillMode: ChatDefaultMode
      enabledSkillIds: string[]
      providerOverrideId: string
      modelOverride: string
      contextWindowOverride: number
      thinkingLevel: 'default' | 'off' | 'low' | 'medium' | 'high'
    }
  }
  settings: Settings | null
  providers: Provider[] | null
  isSettingsOpen: boolean
  activeTab: string // For settings dialog navigation
  voiceModelsInstalled: VoiceModelEntry[]
  voiceDownloadByModelId: Record<string, VoiceDownloadEntry>

  initApp: () => Promise<void>

  // Actions
  addMessage: (message: Omit<Message, 'id' | 'timestamp'> & { id?: string }, options?: { persist?: boolean }) => void
  insertMessageBefore: (targetId: string, message: Omit<Message, 'id' | 'timestamp'> & { id?: string }) => void
  updateMessageById: (chatId: string, messageId: string, updates: Partial<Omit<Message, 'id' | 'timestamp'>>) => void
  persistMessageById: (chatId: string, messageId: string, content: string, meta?: Message['meta']) => Promise<void>
  deleteMessagesByTurnId: (chatId: string, turnId: string) => void
  updateLastMessage: (content: string, meta?: Message['meta']) => void
  persistLastMessage: () => Promise<void>
  clearMessages: () => void
  createChat: () => Promise<void>
  createChatInProject: (projectId: string) => Promise<void>
  updateChat: (chatId: string, updates: Partial<ChatThread>) => Promise<void>
  setActiveChat: (chatId: string) => Promise<void>
  deleteChat: (chatId: string) => Promise<void>
  addProject: (dir: string, name?: string) => Promise<string>
  renameProject: (projectId: string, name: string) => void
  togglePinProject: (projectId: string) => void
  setActiveProject: (projectId: string) => void
  toggleProjectCollapsed: (projectId: string) => void
  deleteProject: (projectId: string) => Promise<void>
  toggleSidebarCollapsed: () => void
  toggleSidebarSearch: () => void
  setSidebarSearchQuery: (query: string) => void
  toggleRightSidebar: () => void
  setRightSidebarOpen: (isOpen: boolean) => void
  setActiveRightPanel: (panel: 'files' | 'git' | 'terminal' | 'preview' | null) => void
  setPreviewUrl: (url: string) => void
  openFileInExplorer: (path: string) => void
  updateComposer: (patch: Partial<AppState['ui']['composer']>) => void
  resetComposer: () => void
  
  updateSettings: (settings: Partial<Settings>) => void
  setSettingsOpen: (isOpen: boolean) => void
  setActiveTab: (tab: string) => void

  loadRemoteConfig: () => Promise<void>
  refreshVoiceModelsInstalled: () => Promise<void>
  startVoiceModelDownload: (modelId: string) => Promise<void>
  cancelVoiceModelDownload: (modelId: string) => Promise<void>
  
  // Provider Actions
  addProvider: (provider: Omit<Provider, 'id'>) => void
  updateProvider: (id: string, updates: Partial<Provider> | Partial<Provider['config']>) => void
  toggleProvider: (id: string, isEnabled: boolean) => void
  reorderProviders: (draggedId: string, targetId: string) => void
  getActiveProvider: () => Provider | undefined

  addMemory: (content: string) => void
  updateMemory: (id: string, updates: Partial<MemoryItem>) => void
  deleteMemory: (id: string) => void

  updatePlugin: (id: string, updates: Partial<Plugin>) => void

  addMcpServer: (server: Omit<McpServer, 'id'>) => void
  updateMcpServer: (id: string, updates: Partial<McpServer>) => void
  deleteMcpServer: (id: string) => void
}

const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:17333'
let cachedBackendBaseUrl: string | null = null
let backendBaseUrlPromise: Promise<string> | null = null
const voiceDownloadPollTimeoutByModelId: Record<string, number> = {}
const SETTINGS_REV_KEY = 'anima:settings:rev'
let loadRemoteConfigSeq = 0
let settingsBroadcast: BroadcastChannel | null = null

function getSettingsBroadcast(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === 'undefined') return null
    if (!settingsBroadcast) settingsBroadcast = new BroadcastChannel('anima:settings')
    return settingsBroadcast
  } catch {
    return null
  }
}

function bumpSettingsRevision(): void {
  const rev = String(Date.now())
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SETTINGS_REV_KEY, rev)
  } catch {
    //
  }
  try {
    getSettingsBroadcast()?.postMessage({ type: 'settings_rev', rev })
  } catch {
    //
  }
}

export async function resolveBackendBaseUrl(): Promise<string> {
  if (cachedBackendBaseUrl != null) return cachedBackendBaseUrl
  if (backendBaseUrlPromise) return backendBaseUrlPromise

  backendBaseUrlPromise = (async () => {
    const anyWin = typeof window !== 'undefined' ? (window as any) : null
    try {
      const res = await anyWin?.anima?.backend?.getBaseUrl?.()
      const baseUrl = String(res?.baseUrl || '').trim()
      if (res?.ok && baseUrl) {
        cachedBackendBaseUrl = baseUrl
        return baseUrl
      }
    } catch {
      // ignore
    }

    const fallback =
      typeof window !== 'undefined' && window.location.protocol === 'file:' ? DEFAULT_BACKEND_BASE_URL : ''
    cachedBackendBaseUrl = fallback
    return fallback
  })()

  return backendBaseUrlPromise
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  try {
    const baseUrl = await resolveBackendBaseUrl()
    const res = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status}`
      throw new Error(msg)
    }
    return data
  } finally {
    window.clearTimeout(timer)
  }
}

const api = {
  getChats: () => fetchJson('/api/chats'),
  getChat: (id: string) => fetchJson(`/api/chats/${id}`),
  createChat: (title?: string) => fetchJson('/api/chats', { method: 'POST', body: JSON.stringify({ title }) }),
  addMessage: (chatId: string, msg: any) => fetchJson(`/api/chats/${chatId}/messages`, { method: 'POST', body: JSON.stringify(msg) }),
  updateMessage: (chatId: string, msgId: string, updates: any) => fetchJson(`/api/chats/${chatId}/messages/${msgId}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  updateChat: (id: string, updates: any) => fetchJson(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  deleteChat: (id: string) => fetchJson(`/api/chats/${id}`, { method: 'DELETE' }),
  syncChats: (chats: any[]) => fetchJson('/api/chats/sync', { method: 'POST', body: JSON.stringify(chats) }),
  checkDbStatus: () => fetchJson('/api/db/status')
}

const createDefaultComposer = (): AppState['ui']['composer'] => ({
  attachments: [],
  workspaceDir: '',
  toolMode: 'auto',
  permissionMode: 'workspace_whitelist',
  enabledToolIds: [],
  enabledMcpServerIds: [],
  skillMode: 'auto',
  enabledSkillIds: [],
  providerOverrideId: '',
  modelOverride: '',
  contextWindowOverride: 0,
  thinkingLevel: 'medium'
})

const normalizeComposerPermissionMode = (value: unknown): ComposerPermissionMode =>
  value === 'full_access' ? 'full_access' : 'workspace_whitelist'

const createDefaultUi = (): AppState['ui'] => ({
  sidebarCollapsed: false,
  sidebarSearchOpen: false,
  sidebarSearchQuery: '',
  activeProjectId: '',
  collapsedProjectIds: [],
  rightSidebarOpen: false,
  activeRightPanel: null,
  previewUrl: '',
  fileExplorerRequest: { path: '', nonce: 0 },
  composer: createDefaultComposer()
})

const DEFAULT_ACP_PROVIDERS: Provider[] = [
  {
    id: 'qwen_acp',
    name: 'Qwen Code (ACP)',
    type: 'acp',
    isEnabled: false,
    config: {
      models: [{ id: 'qwen-acp', isEnabled: true, config: { id: 'qwen-acp' } }],
      selectedModel: 'qwen-acp',
      acp: {
        kind: 'native_acp',
        command: 'qwen',
        args: ['--acp'],
        framing: 'jsonl',
        approvalMode: 'per_action'
      }
    }
  },
  {
    id: 'codex_acp',
    name: 'Codex (codex-acp)',
    type: 'acp',
    isEnabled: false,
    config: {
      models: [{ id: 'codex-acp', isEnabled: true, config: { id: 'codex-acp' } }],
      selectedModel: 'codex-acp',
      acp: {
        kind: 'native_acp',
        command: 'codex-acp',
        args: [],
        framing: 'jsonl',
        approvalMode: 'per_action'
      }
    }
  }
]

const normalizeAcpProvider = (provider: Provider): Provider => {
  const config = provider.config || { models: [] }
  const acp = config.acp || {}
  const models = Array.isArray(config.models) && config.models.length
    ? config.models
    : [{ id: String(provider.name || provider.id || 'acp').trim().toLowerCase().replace(/\s+/g, '-'), isEnabled: true, config: { id: String(provider.name || provider.id || 'acp').trim() } }]
  const selectedModel = String(config.selectedModel || models.find((m) => m.isEnabled)?.id || models[0]?.id || '').trim()
  return {
    ...provider,
    config: {
      ...config,
      models,
      selectedModel,
      acp: {
        kind: String(acp.kind || 'native_acp').trim() as any,
        command: String(acp.command || '').trim(),
        args: Array.isArray(acp.args) ? acp.args.map((x: any) => String(x)) : [],
        env: acp.env && typeof acp.env === 'object' ? acp.env : {},
        framing: (String(acp.framing || 'auto').trim() as any) || 'auto',
        approvalMode: (String(acp.approvalMode || 'per_action').trim() as any) || 'per_action'
      }
    }
  }
}

const buildProviderDedupKey = (provider: Provider): string => {
  const type = String(provider?.type || '').trim().toLowerCase()
  const name = String(provider?.name || '').trim().toLowerCase()
  if (type === 'acp') {
    const acp = (provider?.config as any)?.acp || {}
    const command = String(acp.command || '').trim().toLowerCase()
    const args = Array.isArray(acp.args) ? acp.args.map((x: any) => String(x).trim().toLowerCase()).join(' ') : ''
    return `acp:${name}:${command}:${args}`
  }
  const baseUrl = String(provider?.config?.baseUrl || '').trim().toLowerCase()
  return `${type}:${name}:${baseUrl}`
}

const dedupeProviders = (providers: Provider[]): Provider[] => {
  const seen = new Set<string>()
  const out: Provider[] = []
  for (const provider of providers) {
    if (!provider) continue
    const id = String(provider.id || '').trim()
    if (!id) continue
    const key = buildProviderDedupKey(provider)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(provider)
  }
  return out
}

const mergeLegacyAcpProviders = (rawProviders: Provider[], rawSettings: any): Provider[] => {
  const providers = Array.isArray(rawProviders) ? [...rawProviders] : []
  const acp = rawSettings?.acp
  const agents = Array.isArray(acp?.agents) ? acp.agents : []
  const existingIds = new Set(providers.map((p) => String(p?.id || '').trim()).filter(Boolean))
  for (const agent of agents) {
    const kind = String(agent?.kind || 'native_acp').trim()
    if (!kind || kind === 'mock' || kind === 'embedded') continue
    const id = String(agent?.id || '').trim()
    if (!id || existingIds.has(id)) continue
    providers.push(
      normalizeAcpProvider({
        id,
        name: String(agent?.name || id).trim() || id,
        type: 'acp',
        isEnabled: false,
        config: {
          models: [{ id, isEnabled: true, config: { id } }],
          selectedModel: id,
          acp: {
            kind: kind as any,
            command: String(agent?.command || '').trim(),
            args: Array.isArray(agent?.args) ? agent.args.map((x: any) => String(x)) : [],
            env: agent?.env && typeof agent.env === 'object' ? agent.env : {},
            framing: (String(agent?.framing || 'auto').trim() as any) || 'auto',
            approvalMode: String(acp?.approvalMode || 'per_action').trim() as any
          }
        }
      })
    )
    existingIds.add(id)
  }
  for (const provider of DEFAULT_ACP_PROVIDERS) {
    if (!existingIds.has(provider.id)) {
      providers.push(provider)
      existingIds.add(provider.id)
    }
  }
  return dedupeProviders(providers.map((p) => (p.type === 'acp' ? normalizeAcpProvider(p) : p)))
}

const normalizeSettingsPayload = (rawSettings: any): any => {
  if (!rawSettings || typeof rawSettings !== 'object') return rawSettings

  if (!Array.isArray(rawSettings.projects)) rawSettings.projects = []
  if (!Array.isArray(rawSettings.toolsEnabledIds)) rawSettings.toolsEnabledIds = []
  if (!Array.isArray(rawSettings.mcpEnabledServerIds)) rawSettings.mcpEnabledServerIds = []
  if (!Array.isArray(rawSettings.skillsEnabledIds)) rawSettings.skillsEnabledIds = []
  if (!Array.isArray(rawSettings.systemPrompts)) rawSettings.systemPrompts = []
  if (!Array.isArray(rawSettings.memories)) rawSettings.memories = []
  if (typeof rawSettings.memoryGlobalEnabled !== 'boolean') rawSettings.memoryGlobalEnabled = false
  if (typeof rawSettings.memoryGlobalWriteEnabled !== 'boolean') rawSettings.memoryGlobalWriteEnabled = true
  if (!Number.isFinite(Number(rawSettings.memoryGlobalRetrieveCount))) rawSettings.memoryGlobalRetrieveCount = 3
  if (typeof rawSettings.memoryScopeAutoEnabled !== 'boolean') rawSettings.memoryScopeAutoEnabled = false
  rawSettings.memoryDefaultWriteScope =
    String(rawSettings.memoryDefaultWriteScope || '').trim().toLowerCase() === 'global' ? 'global' : 'workspace'
  if (!Array.isArray(rawSettings.plugins)) rawSettings.plugins = []
  if (!Array.isArray(rawSettings.mcpServers)) rawSettings.mcpServers = []

  if (!rawSettings.defaultToolMode) rawSettings.defaultToolMode = 'auto'
  if (!rawSettings.defaultSkillMode) rawSettings.defaultSkillMode = 'auto'
  if (!rawSettings.selectedSystemPromptId) rawSettings.selectedSystemPromptId = ''

  if (!rawSettings.voice) {
    rawSettings.voice = {
      enabled: true,
      model: 'openai/whisper-large-v3-turbo',
      language: 'auto',
      autoDetect: true,
      localModels: []
    }
  } else if (rawSettings.voice && typeof rawSettings.voice === 'object') {
    if (!('localModels' in rawSettings.voice)) rawSettings.voice.localModels = []
    const v = String(rawSettings.voice.model || '').trim()
    if (v && !v.includes('/') && !v.startsWith('local:')) {
      const legacyMap: Record<string, string> = {
        'large-v3-turbo': 'openai/whisper-large-v3-turbo',
        base: 'openai/whisper-base',
        small: 'openai/whisper-small',
        medium: 'openai/whisper-medium',
        tiny: 'openai/whisper-tiny'
      }
      rawSettings.voice.model = legacyMap[v] || v
    }
  }

  if (!rawSettings.tts || typeof rawSettings.tts !== 'object') {
    rawSettings.tts = {
      enabled: false,
      provider: 'macos_say',
      model: 'Samantha',
      endpoint: '',
      apiKey: '',
      qwenModel: 'qwen3-tts-flash',
      qwenLanguageType: 'Auto',
      speed: 1,
      pitch: 1,
      volume: 1,
      autoPlay: false,
      testText: '你好，这是一段本地 TTS 试听文本。',
      localModels: []
    }
  } else {
    const tts = rawSettings.tts
    const provider = String(tts.provider || '').trim()
    tts.provider = provider === 'piper' || provider === 'kokoro_onnx' || provider === 'custom_http' || provider === 'qwen_tts' ? provider : 'macos_say'
    tts.model = String(tts.model || '').trim() || (tts.provider === 'macos_say' ? 'Samantha' : '')
    tts.endpoint = String(tts.endpoint || '').trim()
    tts.apiKey = String(tts.apiKey || '').trim()
    tts.qwenModel = String(tts.qwenModel || '').trim() || 'qwen3-tts-flash'
    tts.qwenLanguageType = String(tts.qwenLanguageType || '').trim() || 'Auto'
    tts.enabled = Boolean(tts.enabled)
    const speed = Number(tts.speed)
    const pitch = Number(tts.pitch)
    const volume = Number(tts.volume)
    tts.speed = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1
    tts.pitch = Number.isFinite(pitch) ? Math.max(0.5, Math.min(2, pitch)) : 1
    tts.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1
    tts.autoPlay = Boolean(tts.autoPlay)
    tts.testText = String(tts.testText || '').trim() || '你好，这是一段本地 TTS 试听文本。'
    if (!Array.isArray(tts.localModels)) tts.localModels = []
  }

  if (!rawSettings.media) {
    rawSettings.media = {
      imageEnabled: false,
      videoEnabled: false,
      imageProviderId: '',
      videoProviderId: '',
      defaultImageModel: '',
      defaultImageSize: '1024x1024',
      defaultVideoModel: ''
    }
  } else if (rawSettings.media && typeof rawSettings.media === 'object') {
    if (!('imageProviderId' in rawSettings.media)) rawSettings.media.imageProviderId = ''
    if (!('videoProviderId' in rawSettings.media)) rawSettings.media.videoProviderId = ''
  }

  if (!Array.isArray(rawSettings.commandBlacklist)) {
    rawSettings.commandBlacklist = Array.isArray(rawSettings.commandBlacklistPatterns) ? rawSettings.commandBlacklistPatterns : []
  }
  if (!Array.isArray(rawSettings.commandWhitelist)) {
    rawSettings.commandWhitelist = Array.isArray(rawSettings.commandWhitelistPatterns) ? rawSettings.commandWhitelistPatterns : []
  }

  const normalizeCoderProfile = (raw: any): any => {
    const c = raw && typeof raw === 'object' ? raw : {}
    c.enabled = Boolean(c.enabled)
    c.name = String(c.name || '').trim() || 'Codex'
    c.backendKind = c.backendKind === 'cursor' ? 'cursor' : c.backendKind === 'custom' ? 'custom' : 'codex'
    c.backendLabel = String(c.backendLabel || '').trim()
    c.endpointType = c.endpointType === 'terminal' ? 'terminal' : 'desktop'
    c.transport = c.transport === 'acp' ? 'acp' : 'cdpbridge'
    c.autoStart = Boolean(c.autoStart)
    c.command = String(c.command || '').trim() || '/usr/bin/open'
    c.args = Array.isArray(c.args) ? c.args.map((x: any) => String(x)) : (c.transport === 'acp' ? ['--acp'] : ['-a', 'Codex', '--args', '--remote-debugging-port=9222'])
    c.cwd = String(c.cwd || '').trim()
    c.env = c.env && typeof c.env === 'object' ? c.env : {}
    const rd = Number(c.remoteDebuggingPort || 9222)
    c.remoteDebuggingPort = Number.isFinite(rd) && rd > 0 ? rd : 9222
    if (!c.commandTemplates || typeof c.commandTemplates !== 'object') {
      c.commandTemplates = {
        status: '',
        send: '',
        ask: 'codex exec "{prompt}"',
        read: '',
        new: 'codex',
        screenshot: ''
      }
    } else {
      const ct = c.commandTemplates
      ct.status = String(ct.status || '').trim()
      ct.send = String(ct.send || '').trim()
      ct.ask = String(ct.ask || '').trim() || 'codex exec "{prompt}"'
      ct.read = String(ct.read || '').trim()
      ct.new = String(ct.new || '').trim() || 'codex'
      ct.screenshot = String(ct.screenshot || '').trim()
    }
    if (
      c.transport === 'cdpbridge' &&
      c.command === 'codex' &&
      Array.isArray(c.args) &&
      c.args.some((x: string) => String(x).includes('--remote-debugging-port'))
    ) {
      c.command = '/usr/bin/open'
      c.args = ['-a', 'Codex', '--args', `--remote-debugging-port=${c.remoteDebuggingPort}`]
    }
    if (
      c.transport === 'cdpbridge' &&
      c.command === '/usr/bin/open' &&
      Array.isArray(c.args) &&
      c.args.length > 0 &&
      c.args[0] === '-n'
    ) {
      c.args = c.args.slice(1)
    }
    return c
  }

  if (!rawSettings.coder || typeof rawSettings.coder !== 'object') {
    rawSettings.coder = normalizeCoderProfile({
      enabled: false,
      name: 'Codex',
      backendKind: 'codex',
      backendLabel: '',
      endpointType: 'desktop',
      transport: 'cdpbridge',
      autoStart: false,
      command: '/usr/bin/open',
      args: ['-a', 'Codex', '--args', '--remote-debugging-port=9222'],
      cwd: '',
      env: {},
      remoteDebuggingPort: 9222,
      commandTemplates: {
        status: '',
        send: '',
        ask: 'codex exec "{prompt}"',
        read: '',
        new: 'codex',
        screenshot: ''
      }
    })
  } else {
    rawSettings.coder = normalizeCoderProfile(rawSettings.coder)
  }

  const profileList = Array.isArray(rawSettings.coderProfiles) ? rawSettings.coderProfiles : []
  const normalizedProfiles = profileList
    .map((profile: any, index: number) => {
      const normalized = normalizeCoderProfile(profile)
      normalized.id = String(profile?.id || '').trim() || `coder-${index + 1}`
      return normalized
    })
    .filter((profile: any) => String(profile.id || '').trim())
  if (normalizedProfiles.length === 0) {
    normalizedProfiles.push({
      id: 'codex-default',
      ...normalizeCoderProfile(rawSettings.coder)
    })
  }
  const activeIdRaw = String(rawSettings.activeCoderProfileId || '').trim()
  const hasActive = normalizedProfiles.some((profile: any) => profile.id === activeIdRaw)
  rawSettings.activeCoderProfileId = hasActive ? activeIdRaw : String(normalizedProfiles[0].id)
  rawSettings.coderProfiles = normalizedProfiles
  const activeProfile = normalizedProfiles.find((profile: any) => profile.id === rawSettings.activeCoderProfileId) || normalizedProfiles[0]
  rawSettings.coder = normalizeCoderProfile(activeProfile)

  const normalizeStatusIcon = (raw: any) => {
    const sizesRaw = raw?.sizes && typeof raw.sizes === 'object' ? raw.sizes : {}
    const nextSizes: Record<string, string> = {}
    for (const k of ['16', '18', '22']) {
      const p = String(sizesRaw[k] || '').trim()
      if (p) nextSizes[k] = p
    }
    const nextFrames = Array.isArray(raw?.frames) ? raw.frames.map((x: any) => String(x || '').trim()).filter(Boolean) : []
    return { sizes: nextSizes, frames: nextFrames }
  }

  const statusCenterRaw = rawSettings.statusCenter && typeof rawSettings.statusCenter === 'object' ? rawSettings.statusCenter : {}
  const trayRaw = statusCenterRaw.tray && typeof statusCenterRaw.tray === 'object' ? statusCenterRaw.tray : {}
  rawSettings.statusCenter = {
    tray: {
      enabled: trayRaw.enabled !== false,
      animated: trayRaw.animated !== false,
      frameIntervalMs: Number(trayRaw.frameIntervalMs || 260),
      fallbackToBuiltin: trayRaw.fallbackToBuiltin !== false,
      icons: {
        idle: normalizeStatusIcon(trayRaw.icons?.idle),
        running: normalizeStatusIcon(trayRaw.icons?.running),
        waiting_user: normalizeStatusIcon(trayRaw.icons?.waiting_user),
        done: normalizeStatusIcon(trayRaw.icons?.done),
        error: normalizeStatusIcon(trayRaw.icons?.error)
      }
    }
  }
  return rawSettings
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const now = Date.now()
      const initialChatId = nanoid()
      let lastMessageTimestamp = now
      const nextMessageTimestamp = (state: AppState): number => {
        const tailTs = Number((state.messages[state.messages.length - 1] as any)?.timestamp || 0)
        const nextTs = Math.max(Date.now(), lastMessageTimestamp + 1, tailTs + 1)
        lastMessageTimestamp = nextTs
        return nextTs
      }
      return {
        messages: [],
        chats: [
          {
            id: initialChatId,
            title: 'New Chat',
            createdAt: now,
            updatedAt: now,
            messages: []
          }
        ],
        activeChatId: initialChatId,
        configLoaded: false,
        configError: '',
        ui: createDefaultUi(),
        settings: null,
        providers: null,
        isSettingsOpen: false,
        activeTab: 'providers',
        voiceModelsInstalled: [],
        voiceDownloadByModelId: {},

      initApp: async () => {
        try {
          const chatsRaw = (await api.getChats()) as any[]
          const chats = chatsRaw.map((c: any) => ({
            ...c,
            todoState: c.meta?.todoState
          }))
          set({ chats })
           
          const state = get()
          const curSettings = state.settings
          const curProjects = Array.isArray(curSettings?.projects) ? (curSettings!.projects as Project[]) : []
          const hasAnyChats = chats.length > 0

          let nextProjects = curProjects
          if (!nextProjects.length && hasAnyChats) {
            const dir = String(curSettings?.workspaceDir || '').trim()
            const parts = dir.split(/[\\/]/).filter(Boolean)
            const name = (parts[parts.length - 1] || '').trim() || '历史项目'
            const pid = nanoid()
            const ts = Date.now()
            nextProjects = [{ id: pid, name, dir, pinned: false, createdAt: ts, updatedAt: ts }]
            set((s) => ({ ui: { ...s.ui, activeProjectId: pid } }))
            if (curSettings) get().updateSettings({ projects: nextProjects })
          }

          const uiActiveProjectId = String(state.ui.activeProjectId || '').trim()
          if (nextProjects.length && (!uiActiveProjectId || !nextProjects.some((p) => p.id === uiActiveProjectId))) {
            const pinned = nextProjects.find((p) => p.pinned)
            const pick = pinned || nextProjects[0]
            if (pick) set((s) => ({ ui: { ...s.ui, activeProjectId: pick.id } }))
          }

          if (nextProjects.length) {
            const fallbackPid = String((get().ui.activeProjectId || '').trim() || nextProjects[0].id)
            const toPatch: Array<{ id: string; meta: any }> = []
            for (const c of chats) {
              const meta = (c as any)?.meta
              const pid = String(meta?.projectId || '').trim()
              if (!pid) {
                const nextMeta = { ...(meta && typeof meta === 'object' ? meta : {}), projectId: fallbackPid }
                ;(c as any).meta = nextMeta
                toPatch.push({ id: String(c.id || ''), meta: nextMeta })
              }
            }
            if (toPatch.length) {
              set((s) => ({
                chats: s.chats.map((c) => {
                  const patched = toPatch.find((x) => x.id === c.id)
                  return patched ? ({ ...c, meta: patched.meta } as any) : c
                })
              }))
              for (const p of toPatch) {
                if (!p.id) continue
                api.updateChat(p.id, { meta: p.meta }).catch(console.error)
              }
            }
          }

          let activeId = state.activeChatId
          if (!activeId || (chats.length > 0 && !chats.find((c: any) => c.id === activeId))) {
             activeId = chats[0]?.id
          }
          
          if (activeId) {
             const chat = await api.getChat(activeId)
             if (chat) {
                set({ activeChatId: activeId, messages: chat.messages || [] })
                // Also update the chat in the list in case detail has more info
                set((s) => ({
                    chats: s.chats.map(c => c.id === activeId ? { ...c, ...chat, todoState: chat.meta?.todoState } : c)
                }))

                const pid = String(chat?.meta?.projectId || '').trim()
                if (pid) set((s) => ({ ui: { ...s.ui, activeProjectId: pid } }))
             }
          } else {
             set({ activeChatId: '', messages: [] })
          }
        } catch (e) {
            console.error(e)
        }
      },

      createChat: async () => {
        const pid = String(get().ui.activeProjectId || '').trim()
        if (!pid) return
        await get().createChatInProject(pid)
      },

      createChatInProject: async (projectId) => {
        const pid = String(projectId || '').trim()
        if (!pid) return
        const st = get()
        const projects = Array.isArray(st.settings?.projects) ? (st.settings!.projects as Project[]) : []
        if (!projects.some((p) => p.id === pid)) return

        const newChat = await api.createChat('New Chat')
        const nextMeta = { ...(newChat as any)?.meta, projectId: pid }
        await api.updateChat(newChat.id, { meta: nextMeta }).catch(console.error)
        const withMeta = { ...(newChat as any), meta: nextMeta }

        set((state) => ({
          activeChatId: withMeta.id,
          messages: [],
          ui: {
            ...state.ui,
            activeProjectId: pid,
            sidebarCollapsed: false,
            sidebarSearchOpen: false,
            sidebarSearchQuery: '',
            composer: createDefaultComposer()
          },
          chats: [withMeta, ...state.chats]
        }))
      },

      updateChat: async (chatId, updates) => {
        set((state) => ({
          chats: state.chats.map((c) => (c.id === chatId ? { ...c, ...updates } : c))
        }))
        
        const backendUpdates: any = { ...updates }
        if (updates.todoState) {
          backendUpdates.meta = { ...backendUpdates.meta, todoState: updates.todoState }
          delete backendUpdates.todoState
        }
        
        await api.updateChat(chatId, backendUpdates).catch(console.error)
      },

      setActiveChat: async (chatId) => {
        const chat = await api.getChat(chatId)
        if (!chat) return
        set((state) => ({
            activeChatId: chatId,
            messages: chat.messages || [],
            chats: state.chats.map(c => c.id === chatId ? { ...c, ...chat, todoState: chat.meta?.todoState } : c)
        }))
        const pid = String(chat?.meta?.projectId || '').trim()
        if (pid) set((s) => ({ ui: { ...s.ui, activeProjectId: pid } }))
      },

      addProject: async (dir, name) => {
        const rawDir = String(dir || '').trim()
        const parts = rawDir.split(/[\\/]/).filter(Boolean)
        const defaultName = (parts[parts.length - 1] || '').trim() || '项目'
        const nextName = String(name || '').trim() || defaultName
        const id = nanoid()
        const ts = Date.now()
        const nextProject: Project = { id, name: nextName, dir: rawDir, pinned: false, createdAt: ts, updatedAt: ts }
        const cur = get().settings
        if (!cur) return id
        const curProjects = Array.isArray(cur.projects) ? (cur.projects as Project[]) : []
        const nextProjects = [nextProject, ...curProjects]
        get().updateSettings({ projects: nextProjects })
        set((s) => ({ ui: { ...s.ui, activeProjectId: id, sidebarCollapsed: false } }))
        return id
      },

      renameProject: (projectId, name) => {
        const pid = String(projectId || '').trim()
        const nextName = String(name || '').trim()
        if (!pid || !nextName) return
        const cur = get().settings
        if (!cur) return
        const curProjects = Array.isArray(cur.projects) ? (cur.projects as Project[]) : []
        const nextProjects = curProjects.map((p) => (p.id === pid ? { ...p, name: nextName, updatedAt: Date.now() } : p))
        get().updateSettings({ projects: nextProjects })
      },

      togglePinProject: (projectId) => {
        const pid = String(projectId || '').trim()
        if (!pid) return
        const cur = get().settings
        if (!cur) return
        const curProjects = Array.isArray(cur.projects) ? (cur.projects as Project[]) : []
        const nextProjects = curProjects.map((p) => (p.id === pid ? { ...p, pinned: !p.pinned, updatedAt: Date.now() } : p))
        get().updateSettings({ projects: nextProjects })
      },

      setActiveProject: (projectId) => {
        const pid = String(projectId || '').trim()
        if (!pid) return
        set((s) => ({ ui: { ...s.ui, activeProjectId: pid } }))
        const st = get()
        const curChat = st.chats.find((c: any) => c.id === st.activeChatId)
        const curPid = String((curChat as any)?.meta?.projectId || '').trim()
        if (curPid && curPid !== pid) set({ activeChatId: '', messages: [] })
      },

      toggleProjectCollapsed: (projectId) => {
        const pid = String(projectId || '').trim()
        if (!pid) return
        set((s) => {
          const cur = Array.isArray(s.ui.collapsedProjectIds) ? s.ui.collapsedProjectIds : []
          const setIds = new Set(cur)
          if (setIds.has(pid)) setIds.delete(pid)
          else setIds.add(pid)
          return { ui: { ...s.ui, collapsedProjectIds: Array.from(setIds) } }
        })
      },

      deleteProject: async (projectId) => {
        const pid = String(projectId || '').trim()
        if (!pid) return
        const st = get()
        const cur = st.settings
        if (!cur) return
        const curProjects = Array.isArray(cur.projects) ? (cur.projects as Project[]) : []
        if (!curProjects.some((p) => p.id === pid)) return

        const nextProjects = curProjects.filter((p) => p.id !== pid)
        const idsToDelete = st.chats
          .filter((c: any) => String(c?.meta?.projectId || '').trim() === pid)
          .map((c) => String(c.id || '').trim())
          .filter(Boolean)
        const deleteSet = new Set(idsToDelete)
        const nextChats = st.chats.filter((c) => !deleteSet.has(String(c.id || '').trim()))

        const nextActiveProjectId = (() => {
          const curActive = String(st.ui.activeProjectId || '').trim()
          if (curActive && curActive !== pid) return curActive
          const pinned = nextProjects.find((p) => p.pinned)
          return (pinned || nextProjects[0])?.id || ''
        })()

        const nextCollapsedProjectIds = (Array.isArray(st.ui.collapsedProjectIds) ? st.ui.collapsedProjectIds : []).filter(
          (id) => id !== pid
        )

        const shouldClearActive = deleteSet.has(String(st.activeChatId || '').trim())
        set((s) => ({
          chats: nextChats,
          activeChatId: shouldClearActive ? '' : s.activeChatId,
          messages: shouldClearActive ? [] : s.messages,
          ui: { ...s.ui, activeProjectId: nextActiveProjectId, collapsedProjectIds: nextCollapsedProjectIds }
        }))

        get().updateSettings({ projects: nextProjects })

        for (const chatId of idsToDelete) {
          await api.deleteChat(chatId).catch(console.error)
        }
      },

      deleteChat: async (chatId) => {
        const state = get()
        const nextChats = state.chats.filter((c) => c.id !== chatId)
        
        // 1. If deleting inactive chat, just update list and sync backend
        if (state.activeChatId !== chatId) {
          set({ chats: nextChats })
          await api.deleteChat(chatId).catch(console.error)
          return
        }

        // 2. If deleting active chat
        // 2a. If no chats left, keep empty and let user create a new chat under a project
        if (nextChats.length === 0) {
          set({ chats: [], activeChatId: '', messages: [] })
          await api.deleteChat(chatId).catch(console.error)
          return
        }
        
        // 2b. Switch to next chat
        const nextChatId = nextChats[0].id
        // Optimistic update: switch to next chat immediately
        set({
          chats: nextChats,
          activeChatId: nextChatId,
          messages: [] // Clear messages while loading
        })
        
        await api.deleteChat(chatId).catch(console.error)
        
        try {
          const nextChat = await api.getChat(nextChatId)
          if (nextChat) {
             set({ messages: nextChat.messages || [] })
          }
        } catch (e) {
           console.error('Failed to load next chat', e)
        }
      },

      toggleSidebarCollapsed: () =>
        set((state) => {
          const nextCollapsed = !state.ui.sidebarCollapsed
          return {
            ui: {
              ...state.ui,
              sidebarCollapsed: nextCollapsed,
              sidebarSearchOpen: nextCollapsed ? false : state.ui.sidebarSearchOpen,
              sidebarSearchQuery: nextCollapsed ? '' : state.ui.sidebarSearchQuery
            }
          }
        }),

      toggleSidebarSearch: () =>
        set((state) => {
          const nextOpen = !state.ui.sidebarSearchOpen
          return {
            ui: {
              ...state.ui,
              sidebarCollapsed: nextOpen ? false : state.ui.sidebarCollapsed,
              sidebarSearchOpen: nextOpen,
              sidebarSearchQuery: nextOpen ? state.ui.sidebarSearchQuery : ''
            }
          }
        }),

      setSidebarSearchQuery: (query) => set((state) => ({ ui: { ...state.ui, sidebarSearchQuery: query } })),

      toggleRightSidebar: () =>
        set((state) => ({
          ui: {
            ...state.ui,
            rightSidebarOpen: !state.ui.rightSidebarOpen
          }
        })),

      setRightSidebarOpen: (isOpen) =>
        set((state) => ({
          ui: {
            ...state.ui,
            rightSidebarOpen: isOpen
          }
        })),

      setActiveRightPanel: (panel) =>
        set((state) => ({
          ui: {
            ...state.ui,
            activeRightPanel: panel,
            // Automatically open sidebar if a panel is selected (except null)
            rightSidebarOpen: panel !== null ? true : state.ui.rightSidebarOpen
          }
        })),

      setPreviewUrl: (url) =>
        set((state) => ({
          ui: {
            ...state.ui,
            previewUrl: url
          }
        })),

      openFileInExplorer: (rawPath) =>
        set((state) => {
          const text = String(rawPath || '').trim()
          if (!text) return {}
          const nextNonce = (state.ui.fileExplorerRequest?.nonce || 0) + 1
          return {
            ui: {
              ...state.ui,
              rightSidebarOpen: true,
              activeRightPanel: 'files',
              fileExplorerRequest: { path: text, nonce: nextNonce }
            }
          }
        }),

      updateComposer: (patch) =>
        set((state) => ({
          ui: {
            ...state.ui,
            composer: { ...state.ui.composer, ...patch }
          }
        })),

      resetComposer: () =>
        set((state) => ({
          ui: {
            ...state.ui,
            composer: createDefaultComposer()
          }
        })),

      addMessage: (msg, options) =>
        set((state) => {
          const now = Date.now()
          const createdTs = nextMessageTimestamp(state)
          const created = { id: nanoid(), ...msg, timestamp: createdTs }

          const activeChatId = state.activeChatId || state.chats[0]?.id || ''
          const shouldPersist = options?.persist !== false
          if (activeChatId) {
            if (shouldPersist) {
              api.addMessage(activeChatId, created).catch(console.error)
            }
            const chat = state.chats.find(c => c.id === activeChatId)
            if (chat && chat.title === 'New Chat' && created.role === 'user' && state.messages.length === 0) {
              const newTitle = created.content.trim().slice(0, 32) || 'New Chat'
              api.updateChat(activeChatId, { title: newTitle }).catch(console.error)
            }
          }

          if (!activeChatId) {
            return { messages: [...state.messages, created] }
          }

          const nextChats = state.chats.map((c) => {
            if (c.id !== activeChatId) return c
            const chatMessages = Array.isArray(c.messages) ? c.messages : []
            const nextTitle =
              c.title === 'New Chat' && created.role === 'user' && chatMessages.length === 0
                ? created.content.trim().slice(0, 32) || 'New Chat'
                : c.title
            return { ...c, title: nextTitle, updatedAt: now, messages: [...chatMessages, created] }
          })

          const activeChat = nextChats.find((c) => c.id === activeChatId)
          const reorderedChats = activeChat
            ? [activeChat, ...nextChats.filter((c) => c.id !== activeChatId)]
            : nextChats

          return {
            messages: [...state.messages, created],
            chats: reorderedChats,
            activeChatId
          }
        }),

      insertMessageBefore: (targetId, msg) =>
        set((state) => {
          const now = Date.now()
          const createdTs = nextMessageTimestamp(state)
          const created = { id: nanoid(), ...msg, timestamp: createdTs }
          const activeChatId = state.activeChatId
          
          if (!activeChatId) return {}

          const nextChats = state.chats.map((c) => {
            if (c.id !== activeChatId) return c
            const msgs = [...(c.messages || [])]
            const idx = msgs.findIndex(m => m.id === targetId)
            if (idx === -1) {
              msgs.push(created)
            } else {
              msgs.splice(idx, 0, created)
            }
            return { ...c, messages: msgs, updatedAt: now }
          })

          const activeChat = nextChats.find((c) => c.id === activeChatId)
          
          if (activeChat) {
             api.updateChat(activeChatId, { messages: activeChat.messages }).catch(console.error)
          }

          const nextMessages = activeChat ? activeChat.messages : state.messages

          return {
            chats: nextChats,
            messages: nextMessages
          }
        }),

      updateMessageById: (chatId, messageId, updates) =>
        set((state) => {
          const nextChats = state.chats.map((c) => {
            if (c.id !== chatId) return c
            const chatMessages = Array.isArray(c.messages) ? c.messages : []
            const msgs = chatMessages.map((m) => (m.id === messageId ? { ...m, ...updates } : m))
            return { ...c, messages: msgs }
          })

          const nextMessages =
            state.activeChatId === chatId
              ? state.messages.map((m) => (m.id === messageId ? { ...m, ...updates } : m))
              : state.messages

          return { chats: nextChats, messages: nextMessages }
        }),

      persistMessageById: async (chatId, messageId, content, meta) => {
        const state = get()
        state.updateMessageById(chatId, messageId, { content, meta })
        await api.updateMessage(chatId, messageId, { content, meta }).catch(console.error)
      },

      deleteMessagesByTurnId: (chatId, turnId) =>
        set((state) => {
          const nextChats = state.chats.map((c) => {
            if (c.id !== chatId) return c
            const msgs = c.messages.filter((m) => m.turnId !== turnId)
            return { ...c, messages: msgs }
          })

          const nextMessages =
            state.activeChatId === chatId
              ? state.messages.filter((m) => m.turnId !== turnId)
              : state.messages

          return { chats: nextChats, messages: nextMessages }
        }),


      updateLastMessage: (content, meta) =>
        set((state) => {
          const now = Date.now()
          const newMessages = [...state.messages]
          if (newMessages.length > 0) {
            newMessages[newMessages.length - 1] = {
              ...newMessages[newMessages.length - 1],
              content,
              meta: meta ?? newMessages[newMessages.length - 1].meta
            }
          }

          const activeChatId = state.activeChatId
          const nextChats = state.chats.map((c) => {
            if (c.id !== activeChatId) return c
            const existingChatMessages = Array.isArray(c.messages) ? c.messages : []
            const nextChatMessages = [...existingChatMessages]
            if (nextChatMessages.length > 0) {
              nextChatMessages[nextChatMessages.length - 1] = {
                ...nextChatMessages[nextChatMessages.length - 1],
                content,
                meta: meta ?? nextChatMessages[nextChatMessages.length - 1].meta
              }
            }
            return { ...c, updatedAt: now, messages: nextChatMessages }
          })

          return { messages: newMessages, chats: nextChats }
        }),

      persistLastMessage: async () => {
         const state = get()
         const activeChatId = state.activeChatId
         if (!activeChatId) return

         const lastMsg = state.messages[state.messages.length - 1]
         if (!lastMsg) return
         
         await api.updateMessage(activeChatId, lastMsg.id, {
             content: lastMsg.content,
             meta: lastMsg.meta,
             role: lastMsg.role
         })
      },

      clearMessages: () =>
        set((state) => {
          const activeChatId = state.activeChatId
          const nextChats = state.chats.map((c) =>
            c.id === activeChatId ? { ...c, updatedAt: Date.now(), messages: [] } : c
          )
          return { messages: [], chats: nextChats }
        }),

      loadRemoteConfig: async () => {
        const seq = ++loadRemoteConfigSeq
        try {
          const data = await fetchJson('/settings', { method: 'GET' })
          if (seq !== loadRemoteConfigSeq) return
          const rawSettings = (data as any)?.settings
          const rawProviders = (data as any)?.providers
          const rawVoiceModelsInstalled = (data as any)?.voiceModelsInstalled
          
          normalizeSettingsPayload(rawSettings)
          if (!rawSettings || typeof rawSettings !== 'object') throw new Error('Invalid settings payload')
          if (!Array.isArray(rawProviders)) throw new Error('Invalid providers payload')
          const mergedProviders = mergeLegacyAcpProviders(rawProviders as Provider[], rawSettings)
          set({
            settings: { ...rawSettings, themeColor: rawSettings.themeColor || 'zinc' } as Settings,
            providers: mergedProviders,
            voiceModelsInstalled: Array.isArray(rawVoiceModelsInstalled)
              ? (rawVoiceModelsInstalled as any[])
                  .map((m: any) => ({
                    id: String(m?.id || '').trim(),
                    name: String(m?.name || m?.id || '').trim(),
                    source: (m?.source === 'local' ? 'local' : 'remote') as VoiceModelSource,
                    path: m?.path ? String(m.path) : undefined
                  }))
                  .filter((m: VoiceModelEntry) => Boolean(m.id))
              : [],
            configLoaded: true,
            configError: ''
          })
          try {
            const coderSettings = (rawSettings as any)?.coder
            if (coderSettings) {
              void window.anima?.coder?.configure?.({ settings: coderSettings })
            }
            const statusCenterSettings = (rawSettings as any)?.statusCenter
            if (statusCenterSettings) {
              void window.anima?.statusCenter?.applySettings?.({ settings: statusCenterSettings })
            }
          } catch {
            //
          }
        } catch (e) {
          if (seq !== loadRemoteConfigSeq) return
          set({
            configLoaded: false,
            configError: e instanceof Error ? e.message : 'Failed to load remote config'
          })
          throw e
        }
      },

      refreshVoiceModelsInstalled: async () => {
        try {
          const res = await fetchJson('/settings', { method: 'GET' })
          const models = Array.isArray((res as any)?.voiceModelsInstalled)
            ? (res as any).voiceModelsInstalled
            : Array.isArray((res as any)?.models)
              ? (res as any).models
              : []
          const normalized: VoiceModelEntry[] = models
            .map((m: any) => ({
              id: String(m?.id || '').trim(),
              name: String(m?.name || m?.id || '').trim(),
              source: (m?.source === 'local' ? 'local' : 'remote') as VoiceModelSource,
              path: m?.path ? String(m.path) : undefined
            }))
            .filter((m: VoiceModelEntry) => Boolean(m.id))
          set({ voiceModelsInstalled: normalized })
        } catch {
          set({ voiceModelsInstalled: [] })
        }
      },

      startVoiceModelDownload: async (modelId: string) => {
        const id = String(modelId || '').trim()
        if (!id) return
        const cur = get().voiceDownloadByModelId[id]
        if (cur && (cur.status === 'starting' || cur.status === 'running' || cur.status === 'canceling')) return

        const clearTimer = () => {
          const t = voiceDownloadPollTimeoutByModelId[id]
          if (t) window.clearTimeout(t)
          delete voiceDownloadPollTimeoutByModelId[id]
        }
        clearTimer()

        set((s) => ({
          voiceDownloadByModelId: {
            ...s.voiceDownloadByModelId,
            [id]: { modelId: id, taskId: '', status: 'starting' }
          }
        }))

        let taskId = ''
        try {
          const res = await fetchJson('/voice/models/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
          })
          taskId = String((res as any)?.taskId || '').trim()
          if (!taskId) throw new Error('No taskId')

          set((s) => ({
            voiceDownloadByModelId: {
              ...s.voiceDownloadByModelId,
              [id]: { ...(s.voiceDownloadByModelId[id] || { modelId: id }), modelId: id, taskId, status: 'running' }
            }
          }))

          const poll = async () => {
            try {
              const st = await fetchJson(`/voice/models/download/status?taskId=${encodeURIComponent(taskId)}`, { method: 'GET' })
              const task = (st as any)?.task || {}
              const statusRaw = String(task.status || '').trim()
              const downloadedBytes = typeof task.downloadedBytes === 'number' ? task.downloadedBytes : undefined
              const totalBytes = typeof task.totalBytes === 'number' ? task.totalBytes : undefined
              const downloadedFiles = typeof task.downloadedFiles === 'number' ? task.downloadedFiles : undefined
              const totalFiles = typeof task.totalFiles === 'number' ? task.totalFiles : undefined
              const currentFile = String(task.currentFile || '').trim() || undefined
              const destDir = String(task.destDir || '').trim() || undefined
              const cancelRequested = Boolean(task.cancelRequested)

              const nextStatus: VoiceDownloadStatus =
                statusRaw === 'done'
                  ? 'done'
                  : statusRaw === 'error'
                    ? 'error'
                    : statusRaw === 'canceled'
                      ? 'canceled'
                      : cancelRequested
                        ? 'canceling'
                        : 'running'

              set((s) => ({
                voiceDownloadByModelId: {
                  ...s.voiceDownloadByModelId,
                  [id]: {
                    ...(s.voiceDownloadByModelId[id] || { modelId: id, taskId }),
                    modelId: id,
                    taskId,
                    status: nextStatus,
                    error: statusRaw === 'error' ? String(task.error || 'download failed') : undefined,
                    downloadedBytes,
                    totalBytes,
                    downloadedFiles,
                    totalFiles,
                    currentFile,
                    destDir,
                    cancelRequested
                  }
                }
              }))

              if (nextStatus === 'done') {
                clearTimer()
                await get().refreshVoiceModelsInstalled()
                const settings = get().settings
                const installed = new Set((get().voiceModelsInstalled || []).map((m) => String(m.id || '').trim()).filter(Boolean))
                const curVoice = (settings?.voice as any) || {
                  enabled: false,
                  model: '',
                  language: 'auto',
                  autoDetect: true,
                  localModels: []
                }
                const curSelected = String(curVoice.model || '').trim()
                if (!installed.has(curSelected) && installed.has(id)) {
                  get().updateSettings({ voice: { ...curVoice, enabled: true, model: id } })
                }
                return
              }
              if (nextStatus === 'error' || nextStatus === 'canceled') {
                clearTimer()
                return
              }
            } catch (e) {
              set((s) => ({
                voiceDownloadByModelId: {
                  ...s.voiceDownloadByModelId,
                  [id]: {
                    ...(s.voiceDownloadByModelId[id] || { modelId: id, taskId }),
                    modelId: id,
                    taskId,
                    status: 'error',
                    error: e instanceof Error ? e.message : 'download failed'
                  }
                }
              }))
              clearTimer()
              return
            }
            voiceDownloadPollTimeoutByModelId[id] = window.setTimeout(() => void poll(), 1200)
          }

          voiceDownloadPollTimeoutByModelId[id] = window.setTimeout(() => void poll(), 600)
        } catch (e) {
          if (taskId) clearTimer()
          set((s) => ({
            voiceDownloadByModelId: {
              ...s.voiceDownloadByModelId,
              [id]: { modelId: id, taskId, status: 'error', error: e instanceof Error ? e.message : 'download failed' }
            }
          }))
        }
      },

      cancelVoiceModelDownload: async (modelId: string) => {
        const id = String(modelId || '').trim()
        if (!id) return
        const taskId = String(get().voiceDownloadByModelId[id]?.taskId || '').trim()
        if (!taskId) return
        set((s) => ({
          voiceDownloadByModelId: {
            ...s.voiceDownloadByModelId,
            [id]: { ...(s.voiceDownloadByModelId[id] || { modelId: id, taskId }), modelId: id, taskId, status: 'canceling' }
          }
        }))
        try {
          await fetchJson('/voice/models/download/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId })
          })
        } catch (e) {
          set((s) => ({
            voiceDownloadByModelId: {
              ...s.voiceDownloadByModelId,
              [id]: {
                ...(s.voiceDownloadByModelId[id] || { modelId: id, taskId }),
                modelId: id,
                taskId,
                status: 'error',
                error: e instanceof Error ? e.message : 'cancel failed'
              }
            }
          }))
        }
      },

      updateSettings: (newSettings) => {
        const cur = get().settings
        if (!cur) return
        set({ settings: { ...cur, ...newSettings } })
        void fetchJson('/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: newSettings })
        })
          .then((merged: any) => {
            const rawSettings = merged?.settings
            const rawProviders = merged?.providers
            if (rawSettings && typeof rawSettings === 'object' && Array.isArray(rawProviders)) {
              normalizeSettingsPayload(rawSettings)
              loadRemoteConfigSeq++
              set((s) => ({
                ...s,
                settings: { ...(rawSettings as any), themeColor: (rawSettings as any).themeColor || 'zinc' } as any,
                providers: rawProviders as any,
                voiceModelsInstalled: Array.isArray((merged as any)?.voiceModelsInstalled)
                  ? ((merged as any).voiceModelsInstalled as any[])
                      .map((m: any) => ({
                        id: String(m?.id || '').trim(),
                        name: String(m?.name || m?.id || '').trim(),
                        source: (m?.source === 'local' ? 'local' : 'remote') as any,
                        path: m?.path ? String(m.path) : undefined
                      }))
                      .filter((m: any) => Boolean(m.id))
                  : s.voiceModelsInstalled
              }))
              try {
                const coderSettings = (rawSettings as any)?.coder
                if (coderSettings) {
                  void window.anima?.coder?.configure?.({ settings: coderSettings })
                }
                const statusCenterSettings = (rawSettings as any)?.statusCenter
                if (statusCenterSettings) {
                  void window.anima?.statusCenter?.applySettings?.({ settings: statusCenterSettings })
                }
              } catch {
                //
              }
            }
            bumpSettingsRevision()
          })
          .catch(() => {})
      },

      setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
      
      setActiveTab: (tab) => set({ activeTab: tab }),

      addProvider: (provider) => {
        let nextProviders: Provider[] = []
        set((state) => {
          const curProviders = state.providers || []
          const customId = String((provider as any)?.id || '').trim()
          const newProvider = { ...provider, id: customId || nanoid() }
          nextProviders = [...curProviders, newProvider]
          return { providers: nextProviders }
        })
        void fetchJson('/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providers: nextProviders })
        }).catch(() => {})
      },

      updateProvider: (id, updates) => {
        let nextProviders: Provider[] = []
        set((state) => {
          const curProviders = state.providers || []
          const configKeys = new Set([
            'apiKey',
            'baseUrl',
            'selectedModel',
            'models',
            'modelsFetched',
            'thinkingEnabled',
            'apiFormat',
            'useMaxCompletionTokens',
            'acp'
          ])
          nextProviders = curProviders.map((p) => {
            if (p.id !== id) return p
            if (Object.keys(updates).some((key) => configKeys.has(key))) {
              return { ...p, config: { ...p.config, ...updates } }
            }
            return { ...p, ...updates }
          })
          return { providers: nextProviders }
        })
        void fetchJson('/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providers: nextProviders })
        }).catch(() => {})
      },

      toggleProvider: (id, isEnabled) => {
        let nextProviders: Provider[] = []
        set((state) => {
          const curProviders = state.providers || []
          nextProviders = curProviders.map((p) => (p.id === id ? { ...p, isEnabled } : { ...p, isEnabled: false }))
          return { providers: nextProviders }
        })
        void fetchJson('/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providers: nextProviders })
        }).catch(() => {})
      },

      reorderProviders: (draggedId, targetId) => {
        const fromId = String(draggedId || '').trim()
        const toId = String(targetId || '').trim()
        if (!fromId || !toId || fromId === toId) return
        let nextProviders: Provider[] = []
        set((state) => {
          const curProviders = state.providers || []
          const fromIndex = curProviders.findIndex((p) => p.id === fromId)
          const toIndex = curProviders.findIndex((p) => p.id === toId)
          if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state
          nextProviders = [...curProviders]
          const [moved] = nextProviders.splice(fromIndex, 1)
          nextProviders.splice(toIndex, 0, moved)
          return { providers: nextProviders }
        })
        if (!nextProviders.length) return
        void fetchJson('/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providers: nextProviders })
        }).catch(() => {})
      },

      getActiveProvider: () => {
        return (get().providers || []).find((p) => p.isEnabled)
      },

      addMemory: (content) => {
        const cur = get().settings
        if (!cur) return
        const nextMemories = [...cur.memories, { id: nanoid(), content: content.trim(), isEnabled: true }].filter(
          (m) => m.content
        )
        get().updateSettings({ memories: nextMemories })
      },

      updateMemory: (id, updates) => {
        const cur = get().settings
        if (!cur) return
        const nextMemories = cur.memories.map((m) => (m.id === id ? { ...m, ...updates } : m))
        get().updateSettings({ memories: nextMemories })
      },

      deleteMemory: (id) => {
        const cur = get().settings
        if (!cur) return
        const nextMemories = cur.memories.filter((m) => m.id !== id)
        get().updateSettings({ memories: nextMemories })
      },

      updatePlugin: (id, updates) => {
        const cur = get().settings
        if (!cur) return
        const nextPlugins = cur.plugins.map((p) => (p.id === id ? { ...p, ...updates } : p))
        get().updateSettings({ plugins: nextPlugins })
      },

      addMcpServer: (server) => {
        const cur = get().settings
        if (!cur) return
        const nextServers = [...cur.mcpServers, { id: nanoid(), ...server }]
        get().updateSettings({ mcpServers: nextServers })
      },

      updateMcpServer: (id, updates) => {
        const cur = get().settings
        if (!cur) return
        const nextServers = cur.mcpServers.map((s) => (s.id === id ? { ...s, ...updates } : s))
        get().updateSettings({ mcpServers: nextServers })
      },

      deleteMcpServer: (id) => {
        const cur = get().settings
        if (!cur) return
        const nextServers = cur.mcpServers.filter((s) => s.id !== id)
        get().updateSettings({ mcpServers: nextServers })
      }
    }
    },
    {
      name: 'anima-storage-v3',
      storage: createJSONStorage(() => localStorage),
      version: 7,
      merge: (persistedState, currentState) => {
        const p = (persistedState as any) || {}
        const nextUi = p.ui && typeof p.ui === 'object' ? { ...createDefaultUi(), ...p.ui } : createDefaultUi()
        nextUi.composer = {
          ...createDefaultComposer(),
          ...(nextUi.composer && typeof nextUi.composer === 'object' ? nextUi.composer : {})
        }
        nextUi.composer.permissionMode = normalizeComposerPermissionMode(nextUi.composer.permissionMode)
        const activeChatId = typeof p.activeChatId === 'string' ? p.activeChatId : currentState.activeChatId
        return {
          ...currentState,
          activeChatId,
          ui: nextUi
        }
      },
      migrate: (persisted: any) => {
        if (!persisted) return persisted
        const defaultUi = createDefaultUi()
        const ui = persisted.ui && typeof persisted.ui === 'object' ? { ...defaultUi, ...persisted.ui } : defaultUi
        ui.composer = {
          ...createDefaultComposer(),
          ...(ui.composer && typeof ui.composer === 'object' ? ui.composer : {})
        }
        ui.composer.permissionMode = normalizeComposerPermissionMode(ui.composer.permissionMode)
        const activeChatId = typeof persisted.activeChatId === 'string' ? persisted.activeChatId : ''
        return {
          activeChatId,
          ui
        }
      },
      partialize: (state) => ({
        activeChatId: state.activeChatId,
        ui: state.ui
      })
    }
  )
)

if (typeof window !== 'undefined') {
  const w = window as unknown as { __animaStorageSyncInstalled?: boolean }
  if (!w.__animaStorageSyncInstalled) {
    w.__animaStorageSyncInstalled = true
    window.addEventListener('storage', (e) => {
      if (e.key !== 'anima-storage-v3') return
      void useStore.persist.rehydrate()
    })
  }
}
