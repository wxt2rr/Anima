import { 
  Settings, MessageSquare, Database, Globe, 
  Cpu, Search, Plus, Trash2, CheckCircle2, XCircle, RefreshCw,
  Copy, ChevronDown, ChevronRight, Eye, EyeOff, ExternalLink, Wand2, FolderOpen, Sparkles, Mic, Info
} from 'lucide-react'
import { resolveBackendBaseUrl, useStore, type Provider, type ProviderModel, type VoiceModelEntry } from '../store/useStore'
import { THEMES, ThemeColor } from '../lib/themes'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { UpdateDialog } from './UpdateDialog'
import { useUpdateStore } from '../store/useUpdateStore'

const EMPTY_PROVIDERS: Provider[] = []

const normalizeModels = (models: any[] | undefined): ProviderModel[] => {
  if (!Array.isArray(models)) return []
  return models.map(m => {
    if (typeof m === 'string') return { id: m, isEnabled: true, config: {} }
    return m
  })
}

function ModelConfigDialog({ 
  model, 
  open, 
  onOpenChange, 
  onSave 
}: { 
  model: ProviderModel, 
  open: boolean, 
  onOpenChange: (open: boolean) => void,
  onSave: (updates: Partial<ProviderModel['config']>) => void 
}) {
  const [contextWindow, setContextWindow] = useState(model.config.contextWindow?.toString() || '')
  const [maxOutputTokens, setMaxOutputTokens] = useState(model.config.maxOutputTokens?.toString() || '')
  const [jsonConfig, setJsonConfig] = useState(model.config.jsonConfig || '')

  useEffect(() => {
    if (open) {
      setContextWindow(model.config.contextWindow?.toString() || '')
      setMaxOutputTokens(model.config.maxOutputTokens?.toString() || '')
      setJsonConfig(model.config.jsonConfig || '')
    }
  }, [open, model])

  const handleSave = () => {
    onSave({
      contextWindow: contextWindow ? parseInt(contextWindow) : undefined,
      maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
      jsonConfig
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Configure Model: {model.id}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Context Window</Label>
            <Input 
              type="number" 
              value={contextWindow} 
              onChange={e => setContextWindow(e.target.value)} 
              placeholder="e.g. 128000"
            />
          </div>
          <div className="grid gap-2">
            <Label>Max Output Tokens</Label>
            <Input 
              type="number" 
              value={maxOutputTokens} 
              onChange={e => setMaxOutputTokens(e.target.value)} 
              placeholder="e.g. 4096"
            />
          </div>
          <div className="grid gap-2">
            <Label>Additional Config (JSON)</Label>
            <Textarea 
              value={jsonConfig} 
              onChange={e => setJsonConfig(e.target.value)} 
              placeholder="{}"
              className="font-mono text-xs"
              rows={5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CustomProviderDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const addProvider = useStore(s => s.addProvider)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiFormat, setApiFormat] = useState('chat_completions')
  const [useMaxCompletionTokens, setUseMaxCompletionTokens] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setBaseUrl('')
      setApiKey('')
      setApiFormat('chat_completions')
      setUseMaxCompletionTokens(false)
    }
  }, [open])

  const handleAdd = () => {
    if (!name.trim()) return
    if (!baseUrl.trim()) return

    try {
      new URL(baseUrl.trim())
    } catch {
      return
    }

    addProvider({
      name: name.trim(),
      type: 'openai_compatible', // Defaulting to openai_compatible as it's the most generic "Chat Completions" type
      isEnabled: true,
      config: {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        models: [],
        apiFormat,
        useMaxCompletionTokens
      }
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Custom Provider</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Provider Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Custom Provider"
            />
          </div>
          <div className="grid gap-2">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="grid gap-2">
            <Label>API Key</Label>
            <Input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="your-api-key"
              type="text" 
            />
          </div>
          <div className="grid gap-2">
            <Label>API Format</Label>
            <Select value={apiFormat} onValueChange={setApiFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat_completions">Chat Completions (/chat/completions)</SelectItem>
                <SelectItem value="responses">Responses (/responses)</SelectItem>
                <SelectItem value="anthropic_messages">Anthropic Messages (/v1/messages)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[0.8rem] text-muted-foreground">
              Choose the API endpoint format your provider uses
            </p>
          </div>
          <div className="flex items-center justify-between space-x-2">
            <div className="flex flex-col space-y-1">
              <Label>Use max_completion_tokens</Label>
              <p className="text-[0.8rem] text-muted-foreground max-w-[350px]">
                Enable for newer OpenAI models (o1, o3, etc.) that require max_completion_tokens instead of max_tokens
              </p>
            </div>
            <Switch
              checked={useMaxCompletionTokens}
              onCheckedChange={setUseMaxCompletionTokens}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd}>Add Provider</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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

function VoiceSettings({ t }: { t: any }) {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const voiceModelsInstalled = useStore(s => s.voiceModelsInstalled)
  const refreshVoiceModelsInstalled = useStore(s => s.refreshVoiceModelsInstalled)
  const [catalogStatus, setCatalogStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [catalogModels, setCatalogModels] = useState<Array<{ id: string; name: string; sizeBytes?: number | null }>>([])
  const [baseModelsDir, setBaseModelsDir] = useState<string>('')
  const downloadByModelId = useStore(s => s.voiceDownloadByModelId)
  const startVoiceModelDownload = useStore(s => s.startVoiceModelDownload)
  const cancelVoiceModelDownload = useStore(s => s.cancelVoiceModelDownload)

  const voice = ((settings?.voice as any) || {
    enabled: false,
    model: '',
    language: 'auto',
    autoDetect: true,
    localModels: []
  }) as {
    enabled: boolean
    model: string
    language: string
    autoDetect: boolean
    localModels?: Array<{ id: string; name: string; path: string }>
  }
  
  const handleUpdate = (updates: Partial<typeof voice>) => {
    updateSettings({
      voice: { ...voice, ...updates }
    })
  }

  const installedIds = new Set((voiceModelsInstalled || []).map((m) => String(m.id || '').trim()).filter(Boolean))

  const selectedModelId = installedIds.has(String(voice.model || '').trim()) ? String(voice.model || '').trim() : ''

  const localModels = Array.isArray(voice.localModels) ? voice.localModels : []

  const formatBytes = (bytes: number | undefined | null) => {
    const n = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0
    if (n <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = n
    let u = 0
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024
      u += 1
    }
    const digits = u === 0 ? 0 : u <= 2 ? 1 : 2
    return `${v.toFixed(digits)} ${units[u]}`
  }

  useEffect(() => {
    let cancelled = false
    void refreshVoiceModelsInstalled().catch(() => {})
    setCatalogStatus('loading')
    ;(async () => {
      try {
        const [catalogRes, baseDirRes] = await Promise.all([
          fetchBackendJson<{ ok: boolean; models?: Array<{ id: string; name: string; sizeBytes?: number | null }> }>('/voice/models/catalog', {
            method: 'GET'
          }),
          fetchBackendJson<{ ok: boolean; dir?: string }>('/voice/models/base_dir', { method: 'GET' }).catch(() => ({ ok: false } as any))
        ])
        if (cancelled) return
        const models = Array.isArray(catalogRes.models) ? catalogRes.models : []
        setBaseModelsDir(String((baseDirRes as any)?.dir || '').trim())
        setCatalogModels(
          models
            .map((m) => ({
              id: String(m?.id || '').trim(),
              name: String(m?.name || m?.id || '').trim(),
              sizeBytes: typeof (m as any)?.sizeBytes === 'number' ? (m as any).sizeBytes : null
            }))
            .filter((m) => m.id)
        )
        setCatalogStatus('ok')
      } catch {
        if (cancelled) return
        setCatalogStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshVoiceModelsInstalled])

  const startDownload = async (modelId: string) => {
    const id = String(modelId || '').trim()
    if (!id) return
    try {
      await startVoiceModelDownload(id)
    } catch (e) {
      return
    }
  }

  const cancelDownload = async (modelId: string) => {
    const id = String(modelId || '').trim()
    if (!id) return
    try {
      await cancelVoiceModelDownload(id)
    } catch (e) {
      return
    }
  }

  const addLocalModel = async () => {
    const res = await window.anima?.window?.pickDirectory?.()
    if (!res?.ok || res?.canceled) return
    const p = String(res.path || '').trim()
    if (!p) return
    const name = p.split('/').filter(Boolean).pop() || p
    const entry = { id: `local:${p}`, name, path: p }
    const next = [...localModels.filter((m) => String(m?.path || '').trim() !== p), entry]
    handleUpdate({ localModels: next, model: entry.id, enabled: true })
    await refreshVoiceModelsInstalled()
  }

  const removeLocalModel = async (path: string) => {
    const p = String(path || '').trim()
    const next = localModels.filter((m) => String(m?.path || '').trim() !== p)
    const nextSelected = selectedModelId === `local:${p}` ? '' : voice.model
    handleUpdate({ localModels: next, model: nextSelected })
    await refreshVoiceModelsInstalled()
  }

  // Use passed t.voice or fallback to avoid crash if t is incomplete
  const vt = t.voice || {
     enable: 'Enable Voice Input',
     enableHint: 'Enable voice typing in chat.',
     modelSettings: 'Model Settings',
     currentModel: 'Current Model',
     modelDesc: 'Select Whisper model.',
     language: 'Language',
     autoDetect: 'Auto Detect',
     langHint: 'Select recognition language.'
  }

  if (!settings) return null

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto custom-scrollbar">
       <Card>
          <CardContent className="pt-6">
             <div className="flex items-center justify-between">
                <div className="space-y-1">
                   <div className="font-medium">{vt.enable}</div>
                   <div className="text-sm text-muted-foreground">{vt.enableHint}</div>
                </div>
                <Switch 
                   checked={voice.enabled}
                   onCheckedChange={(c) => handleUpdate({ enabled: c })}
                />
             </div>
          </CardContent>
       </Card>

       <Card>
          <CardContent className="pt-6 space-y-4">
             <div className="font-medium">{vt.modelSettings}</div>
             <div className="space-y-2">
                <Label>{vt.currentModel}</Label>
                <Select 
                   value={selectedModelId}
                   onValueChange={(v) => handleUpdate({ model: v })}
                >
                   <SelectTrigger>
                      <SelectValue placeholder={vt.currentModel} />
                   </SelectTrigger>
                   <SelectContent>
                      {(voiceModelsInstalled || []).map((m: VoiceModelEntry) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name || m.id}
                        </SelectItem>
                      ))}
                   </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">{vt.modelDesc}</p>
                {!selectedModelId ? (
                  <div className="text-sm text-muted-foreground">{vt.downloadHint}</div>
                ) : null}
             </div>

             <div className="space-y-2">
                <Label>{vt.language}</Label>
                <Select 
                   value={voice.language} 
                   onValueChange={(v) => handleUpdate({ language: v })}
                >
                   <SelectTrigger>
                      <SelectValue placeholder={vt.language} />
                   </SelectTrigger>
                   <SelectContent>
                      <SelectItem value="auto">{vt.autoDetect}</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="zh">Chinese</SelectItem>
                      <SelectItem value="ja">Japanese</SelectItem>
                   </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">{vt.langHint}</p>
             </div>
          </CardContent>
       </Card>

       <Card>
         <CardContent className="pt-6 space-y-4">
           <div className="flex items-center justify-between gap-2">
             <div className="font-medium">{vt.availableModels}</div>
             <Button variant="outline" size="sm" onClick={() => void refreshVoiceModelsInstalled().catch(() => {})}>
               <RefreshCw className="w-4 h-4 mr-2" />
               刷新
             </Button>
           </div>
           <p className="text-sm text-muted-foreground">{vt.modelDesc}</p>
           <div className="space-y-2">
             {catalogStatus === 'loading' ? (
               <div className="text-sm text-muted-foreground">加载中…</div>
             ) : null}
             {catalogStatus === 'error' ? (
               <div className="text-sm text-destructive">加载失败</div>
             ) : null}
             {catalogModels.map((m) => {
               const isInstalled = installedIds.has(m.id)
               const dl = downloadByModelId[m.id]
              const isDownloading = dl?.status === 'starting' || dl?.status === 'running' || dl?.status === 'canceling'
               const isError = dl?.status === 'error'
              const isDone = dl?.status === 'done'
              const isCanceled = dl?.status === 'canceled'
              const totalForProgress =
                typeof dl?.totalBytes === 'number' && dl.totalBytes > 0
                  ? dl.totalBytes
                  : typeof m.sizeBytes === 'number' && m.sizeBytes > 0
                    ? m.sizeBytes
                    : 0
              const downloadedForProgress = typeof dl?.downloadedBytes === 'number' && dl.downloadedBytes > 0 ? dl.downloadedBytes : 0
              const percent =
                totalForProgress > 0 ? Math.max(0, Math.min(100, (downloadedForProgress / totalForProgress) * 100)) : 0

              const installedModel = (voiceModelsInstalled || []).find((x) => x.id === m.id)
              const modelPath = installedModel?.path || dl?.destDir

               return (
                <div key={m.id} className="border rounded-md px-3 py-2 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {m.name}
                        {modelPath ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground"
                            onClick={() => void window.anima?.shell?.openPath(modelPath)}
                            title={`打开文件夹: ${modelPath}`}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </Button>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{m.id}</div>
                      <div className="text-xs text-muted-foreground">大小：{formatBytes(m.sizeBytes ?? 0)}</div>
                      {(isInstalled || isDone) && modelPath ? (
                        <div className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                          <span className="shrink-0">位置：</span>
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs font-normal truncate"
                            onClick={() => void window.anima?.shell?.openPath(modelPath)}
                            title={`打开文件夹: ${modelPath}`}
                          >
                            {modelPath}
                          </Button>
                        </div>
                      ) : null}
                      {isError ? <div className="text-xs text-destructive truncate">{dl?.error || '下载失败'}</div> : null}
                    </div>
                    <div className="shrink-0 flex items-center gap-2 pt-0.5">
                      {isInstalled ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          已安装
                        </Badge>
                      ) : isDone ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          已完成
                        </Badge>
                      ) : isCanceled ? (
                        <Badge variant="secondary" className="gap-1">
                          <XCircle className="w-3.5 h-3.5" />
                          已取消
                        </Badge>
                      ) : isDownloading ? (
                        <Button size="sm" variant="outline" onClick={() => void cancelDownload(m.id)}>
                          取消
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => void startDownload(m.id)}>
                          下载
                        </Button>
                      )}
                    </div>
                  </div>
                  {isDownloading ? (
                    <div className="space-y-1.5">
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-2 bg-primary" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <div className="truncate">
                          {formatBytes(downloadedForProgress)} / {formatBytes(totalForProgress)}
                          {dl?.totalFiles ? `（${dl.downloadedFiles || 0}/${dl.totalFiles}）` : ''}
                        </div>
                        <div className="shrink-0">{totalForProgress > 0 ? `${percent.toFixed(1)}%` : ''}</div>
                      </div>
                      {dl?.currentFile ? <div className="text-xs text-muted-foreground truncate">当前：{dl.currentFile}</div> : null}
                      {dl?.destDir ? (
                        <div className="text-xs text-muted-foreground truncate">下载到：{dl.destDir}</div>
                      ) : baseModelsDir ? (
                        <div className="text-xs text-muted-foreground truncate">下载到：{baseModelsDir}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
               )
             })}
           </div>
         </CardContent>
       </Card>

       <Card>
         <CardContent className="pt-6 space-y-4">
           <div className="flex items-center justify-between gap-2">
             <div className="font-medium">本地模型</div>
             <Button variant="outline" size="sm" onClick={() => void addLocalModel()}>
               <FolderOpen className="w-4 h-4 mr-2" />
               选择目录
             </Button>
           </div>
           <div className="space-y-2">
             {localModels.length === 0 ? (
               <div className="text-sm text-muted-foreground">未添加本地模型</div>
             ) : null}
             {localModels.map((m) => (
               <div key={m.id} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
                 <div className="min-w-0">
                   <div className="text-sm font-medium truncate">{m.name || m.id}</div>
                   <div className="text-xs text-muted-foreground truncate">{m.path}</div>
                 </div>
                 <div className="shrink-0 flex items-center gap-2">
                   <Button size="sm" variant="outline" onClick={() => handleUpdate({ model: m.id, enabled: true })}>
                     选择
                   </Button>
                   <Button size="icon" variant="ghost" onClick={() => void removeLocalModel(m.path)}>
                     <Trash2 className="w-4 h-4" />
                   </Button>
                 </div>
               </div>
             ))}
           </div>
         </CardContent>
       </Card>
    </div>
  )
}

export const SettingsDialog = memo(function SettingsDialog() {
  const isSettingsOpen = useStore(s => s.isSettingsOpen)
  const setSettingsOpen = useStore(s => s.setSettingsOpen)
  const activeTab = useStore(s => s.activeTab)
  const setActiveTab = useStore(s => s.setActiveTab)
  const settings = useStore(s => s.settings)

  if (!isSettingsOpen) return null
  if (!settings) return null

  const t = (() => {
    const dict = {
      en: {
        settingsTitle: 'Settings',
        savedHint: 'All changes are saved automatically.',
        done: 'Done',
        tabs: {
          general: 'General',
          providers: 'Providers',
          chat: 'Chat',
          im: 'IM',
          memory: 'Memory',
          skills: 'Skills',
          network: 'Network',
          data: 'Data',
          voice: 'Voice',
          about: 'About'
        },
        voice: {
          title: 'Voice',
          desc: 'Enable voice typing using local Whisper models',
          enable: 'Enable Voice Input',
          enableHint: 'When enabled, you can use voice input in chat by clicking the microphone button.',
          modelSettings: 'Model Settings',
          currentModel: 'Current Model',
          downloadHint: 'Please download at least one model to enable voice input.',
          language: 'Recognition Language',
          autoDetect: 'Auto Detect',
          langHint: 'Select the language for speech recognition. Choose Auto Detect if you speak multiple languages.',
          availableModels: 'Available Models',
          modelDesc: 'Download Whisper models for local speech recognition. Larger models are more accurate but require more storage and processing power.'
        },
        providers: {
          search: 'Search providers...',
          addCustom: '+ Add Custom Provider',
          active: 'Active',
          inactive: 'Inactive',
          disable: 'Disable Provider',
          enable: 'Enable Provider',
          apiKey: 'API Key',
          baseUrl: 'Base URL',
          defaultModel: 'Default Model',
          enterApiKey: (name: string) => `Enter your ${name} API Key`
        },
        general: {
          language: 'Language',
          theme: 'Theme',
          density: 'UI Density',
          system: 'System',
          light: 'Light',
          dark: 'Dark',
          comfortable: 'Comfortable',
          compact: 'Compact'
        },
        network: {
          proxyUrl: 'Proxy URL',
          hint: 'Supports HTTP/HTTPS proxies (e.g. http://127.0.0.1:7890). Leave empty for direct.',
          apply: 'Apply',
          clear: 'Clear',
          proxyApplied: 'Proxy applied.',
          directApplied: 'Direct connection applied.',
          applyFailed: 'Failed to apply proxy.'
        },
        footer: {
          close: 'Close',
          save: 'Save'
        },
        chat: {
          systemPrompts: 'System Prompts',
          new: 'New',
          delete: 'Delete',
          selectedHint: 'The selected prompt is used as the base system message.',
          contextMessages: 'Context Messages',
          contextHint: 'Limits how many recent messages are sent.',
          temperature: 'Temperature',
          temperatureHint: 'Higher values make output more random.',
          memory: 'Memory',
          enable: 'Enable',
          add: 'Add',
          memoryPlaceholder: 'Add a memory item (e.g. Preferred writing style)',
          noMemory: 'No memory items yet.',
          plugins: 'Plugins',
          enabled: 'Enabled',
          mcpServers: 'MCP Servers',
          name: 'Name',
          urlHint: 'URL (GET test)',
          addServer: 'Add Server',
          noServers: 'No MCP servers configured.',
          test: 'Test'
        },
        data: {
          export: 'Export',
          exportHint: 'Exports settings, providers (without API keys), and chat history.',
          exportJson: 'Export JSON',
          import: 'Import',
          importHint: 'Imports settings, providers, and chat history from a JSON file.',
          importJson: 'Import JSON',
          importOk: 'Import completed.',
          importFailed: 'Import failed.',
          danger: 'Danger Zone',
          dangerHint: 'Clears chat history, memory, and deletes stored API keys.',
          clearAll: 'Clear All Data'
        }
      },
      zh: {
        settingsTitle: '设置',
        savedHint: '所有更改会自动保存。',
        done: '完成',
        tabs: {
          general: '通用',
          providers: '提供商',
          chat: '聊天',
          im: 'IM',
          memory: '记忆',
          skills: '技能',
          network: '网络',
          data: '数据',
          voice: '语音',
          about: '关于'
        },
        providers: {
          search: '搜索提供商…',
          addCustom: '+ 添加自定义提供商',
          active: '已启用',
          inactive: '未启用',
          disable: '停用提供商',
          enable: '启用提供商',
          apiKey: 'API Key',
          baseUrl: 'Base URL',
          defaultModel: '默认模型',
          enterApiKey: (name: string) => `输入 ${name} 的 API Key`
        },
        general: {
          language: '语言',
          theme: '主题',
          density: '界面密度',
          system: '跟随系统',
          light: '浅色',
          dark: '深色',
          comfortable: '舒适',
          compact: '紧凑'
        },
        network: {
          proxyUrl: '代理地址',
          hint: '支持 HTTP/HTTPS 代理（例如 http://127.0.0.1:7890）。留空为直连。',
          apply: '应用',
          clear: '清空',
          proxyApplied: '代理已应用。',
          directApplied: '已切换为直连。',
          applyFailed: '应用代理失败。'
        },
        footer: {
          close: '关闭',
          save: '保存'
        },
        chat: {
          systemPrompts: '系统提示词',
          new: '新建',
          delete: '删除',
          selectedHint: '当前选中的提示词会作为 system message 的基础内容。',
          contextMessages: '上下文消息数',
          contextHint: '限制发送给模型的最近消息数量。',
          temperature: '温度',
          temperatureHint: '数值越大输出越随机。',
          memory: '记忆',
          enable: '启用',
          add: '添加',
          memoryPlaceholder: '添加记忆（例如：偏好写作风格）',
          noMemory: '暂无记忆内容。',
          plugins: '插件',
          enabled: '启用',
          mcpServers: 'MCP 服务器',
          name: '名称',
          urlHint: 'URL（GET 测试）',
          addServer: '添加服务器',
          noServers: '尚未配置 MCP 服务器。',
          test: '测试'
        },
        data: {
          export: '导出',
          exportHint: '导出设置、提供商（不含 API Key）与聊天记录。',
          exportJson: '导出 JSON',
          import: '导入',
          importHint: '从 JSON 导入设置、提供商与聊天记录。',
          importJson: '导入 JSON',
          importOk: '导入完成。',
          importFailed: '导入失败。',
          danger: '危险区域',
          dangerHint: '清空聊天记录、记忆，并删除已保存的 API Key。',
          clearAll: '清空所有数据'
        },
        voice: {
          title: '语音',
          desc: '使用本地 Whisper 模型启用语音文字输入',
          enable: '启用语音输入',
          enableHint: '启用后，您可以通过点击麦克风按钮在聊天中使用语音输入。',
          modelSettings: '模型设置',
          currentModel: '当前模型',
          downloadHint: '请至少下载一个模型以启用语音输入。',
          language: '识别语言',
          autoDetect: '自动检测',
          langHint: '选择语音识别的语言。如果您使用多种语言，请选择「自动检测」。',
          availableModels: '可用模型',
          modelDesc: '下载 Whisper 模型以进行本地语音识别。较大的模型更准确，但需要更多存储空间和处理能力。'
        }
      },
      ja: {
        settingsTitle: '設定',
        savedHint: '変更は自動的に保存されます。',
        done: '完了',
        tabs: {
          general: '一般',
          providers: 'プロバイダー',
          chat: 'チャット',
          im: 'IM',
          memory: 'メモリー',
          skills: 'スキル',
          network: 'ネットワーク',
          data: 'データ',
          voice: '音声',
          about: '情報'
        },
        providers: {
          search: 'プロバイダー検索…',
          addCustom: '+ カスタム追加',
          active: '有効',
          inactive: '無効',
          disable: '無効化',
          enable: '有効化',
          apiKey: 'API Key',
          baseUrl: 'Base URL',
          defaultModel: '既定モデル',
          enterApiKey: (name: string) => `${name} の API Key を入力`
        },
        general: {
          language: '言語',
          theme: 'テーマ',
          density: '表示密度',
          system: 'システム',
          light: 'ライト',
          dark: 'ダーク',
          comfortable: '標準',
          compact: 'コンパクト'
        },
        network: {
          proxyUrl: 'プロキシURL',
          hint: 'HTTP/HTTPS プロキシ対応（例: http://127.0.0.1:7890）。空欄で直結。',
          apply: '適用',
          clear: 'クリア',
          proxyApplied: 'プロキシを適用しました。',
          directApplied: '直結に切り替えました。',
          applyFailed: 'プロキシ適用に失敗しました。'
        },
        footer: {
          close: '閉じる',
          save: '保存'
        },
        chat: {
          systemPrompts: 'システムプロンプト',
          new: '新規',
          delete: '削除',
          selectedHint: '選択中のプロンプトが system message のベースになります。',
          contextMessages: 'コンテキスト件数',
          contextHint: '送信する直近メッセージ数を制限します。',
          temperature: 'Temperature',
          temperatureHint: '高いほど出力がランダムになります。',
          memory: 'メモリー',
          enable: '有効',
          add: '追加',
          memoryPlaceholder: 'メモリーを追加（例: 文体の好み）',
          noMemory: 'メモリーはまだありません。',
          plugins: 'プラグイン',
          enabled: '有効',
          mcpServers: 'MCP サーバー',
          name: '名前',
          urlHint: 'URL（GET テスト）',
          addServer: 'サーバー追加',
          noServers: 'MCP サーバー未設定。',
          test: 'テスト'
        },
        data: {
          export: 'エクスポート',
          exportHint: '設定・プロバイダー（API Key除外）・履歴を出力します。',
          exportJson: 'JSON出力',
          import: 'インポート',
          importHint: 'JSON から設定・プロバイダー・履歴を読み込みます。',
          importJson: 'JSON読込',
          importOk: 'インポート完了。',
          importFailed: 'インポート失敗。',
          danger: '危険',
          dangerHint: '履歴・メモリー・保存済み API Key を削除します。',
          clearAll: '全データ削除'
        },
        voice: {
          title: '音声',
          desc: 'ローカルWhisperモデルを使用して音声入力を有効にします',
          enable: '音声入力を有効にする',
          enableHint: '有効にすると、チャットのマイクボタンをクリックして音声入力を使用できます。',
          modelSettings: 'モデル設定',
          currentModel: '現在のモデル',
          downloadHint: '音声入力を有効にするには、少なくとも1つのモデルをダウンロードしてください。',
          language: '認識言語',
          autoDetect: '自動検出',
          langHint: '音声認識の言語を選択します。複数の言語を話す場合は「自動検出」を選択してください。',
          availableModels: '利用可能なモデル',
          modelDesc: 'ローカル音声認識用のWhisperモデルをダウンロードします。大きなモデルほど正確ですが、より多くのストレージと処理能力が必要です。'
        }
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const tabs = [
    { id: 'general', label: t.tabs.general, icon: Settings },
    { id: 'providers', label: t.tabs.providers, icon: Cpu },
    { id: 'chat', label: t.tabs.chat, icon: MessageSquare },
    { id: 'im', label: t.tabs.im, icon: ExternalLink },
    { id: 'skills', label: t.tabs.skills, icon: Wand2 },
    { id: 'network', label: t.tabs.network, icon: Globe },
    { id: 'data', label: t.tabs.data, icon: Database },
    { id: 'voice', label: t.tabs.voice, icon: Mic },
    { id: 'about', label: t.tabs.about, icon: Info },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[720px] w-[1080px] overflow-hidden rounded-2xl bg-background border border-border shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans">
        
        {/* Sidebar */}
        <div className="w-60 border-r border-border bg-white flex flex-col py-6">
          <div className="px-6 mb-6">
             <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#FF5F57]" />
                <div className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
                <div className="w-3 h-3 rounded-full bg-[#28C840]" />
             </div>
          </div>
          <nav className="flex-1 px-3 space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <Button
                  key={tab.id}
                  variant={activeTab === tab.id ? "secondary" : "ghost"}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full justify-start gap-3 px-3 py-2.5 h-auto font-medium ${
                    activeTab === tab.id 
                      ? '' 
                      : 'text-muted-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </Button>
              )
            })}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col bg-[#F5F7FA]">
           {activeTab !== 'providers' && (
              <div className="flex items-center justify-between p-6 border-b border-border bg-white">
                <h2 className="font-semibold text-lg">
                  {tabs.find(t => t.id === activeTab)?.label}
                </h2>
              </div>
           )}
          
          <div className="flex-1 overflow-hidden relative">
            {activeTab === 'providers' && <ProvidersSettings />}
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'chat' && <ChatSettings />}
            {activeTab === 'im' && <ImSettings />}
            {activeTab === 'skills' && <SkillsSettings />}
            {activeTab === 'network' && <NetworkSettings />}
            {activeTab === 'data' && <DataSettings />}
            {activeTab === 'voice' && <VoiceSettings t={t} />}
            {activeTab === 'about' && <AboutSettings />}
          </div>
          
          <div className="h-16 px-8 border-t border-border bg-[#F5F7FA] flex justify-between items-center text-xs text-muted-foreground">
             <span>{t.savedHint}</span>
             <div className="flex items-center gap-3">
               <Button 
                  variant="outline"
                  onClick={() => setSettingsOpen(false)}
                >
                  {t.footer.close}
                </Button>
               <Button 
                  onClick={() => setSettingsOpen(false)}
                >
                  {t.footer.save}
                </Button>
             </div>
          </div>
        </div>
      </div>
    </div>
  )
})

export const SettingsWindow = memo(function SettingsWindow() {
  const activeTab = useStore(s => s.activeTab)
  const setActiveTab = useStore(s => s.setActiveTab)
  const settings = useStore(s => s.settings)

  const t = (() => {
    const dict = {
      en: {
        tabs: {
          general: 'General',
          providers: 'Providers',
          chat: 'Chat',
          im: 'IM',
          memory: 'Memory',
          skills: 'Skills',
          network: 'Network',
          data: 'Data',
          voice: 'Voice',
          about: 'About'
        },
        savedHint: 'All changes are saved automatically.',
        footer: { close: 'Close', save: 'Save' },
        voice: {
          title: 'Voice',
          desc: 'Enable voice typing using local Whisper models',
          enable: 'Enable Voice Input',
          enableHint: 'When enabled, you can use voice input in chat by clicking the microphone button.',
          modelSettings: 'Model Settings',
          currentModel: 'Current Model',
          downloadHint: 'Please download at least one model to enable voice input.',
          language: 'Recognition Language',
          autoDetect: 'Auto Detect',
          langHint: 'Select the language for speech recognition. Choose Auto Detect if you speak multiple languages.',
          availableModels: 'Available Models',
          modelDesc: 'Download Whisper models for local speech recognition. Larger models are more accurate but require more storage and processing power.'
        }
      },
      zh: {
        tabs: {
          general: '通用',
          providers: '提供商',
          chat: '聊天',
          im: 'IM',
          memory: '记忆',
          skills: '技能',
          network: '网络',
          data: '数据',
          voice: '语音',
          about: '关于'
        },
        savedHint: '所有更改会自动保存。',
        footer: { close: '关闭', save: '保存' },
        voice: {
          title: '语音',
          desc: '使用本地 Whisper 模型启用语音文字输入',
          enable: '启用语音输入',
          enableHint: '启用后，您可以通过点击麦克风按钮在聊天中使用语音输入。',
          modelSettings: '模型设置',
          currentModel: '当前模型',
          downloadHint: '请至少下载一个模型以启用语音输入。',
          language: '识别语言',
          autoDetect: '自动检测',
          langHint: '选择语音识别的语言。如果您使用多种语言，请选择「自动检测」。',
          availableModels: '可用模型',
          modelDesc: '下载 Whisper 模型以进行本地语音识别。较大的模型更准确，但需要更多存储空间和处理能力。'
        }
      },
      ja: {
        tabs: {
          general: '一般',
          providers: 'プロバイダー',
          chat: 'チャット',
          im: 'IM',
          memory: 'メモリー',
          skills: 'スキル',
          network: 'ネットワーク',
          data: 'データ',
          voice: '音声',
          about: '情報'
        },
        savedHint: '変更は自動的に保存されます。',
        footer: { close: '閉じる', save: '保存' },
        voice: {
          title: '音声',
          desc: 'ローカルWhisperモデルを使用して音声入力を有効にします',
          enable: '音声入力を有効にする',
          enableHint: '有効にすると、チャットのマイクボタンをクリックして音声入力を使用できます。',
          modelSettings: 'モデル設定',
          currentModel: '現在のモデル',
          downloadHint: '音声入力を有効にするには、少なくとも1つのモデルをダウンロードしてください。',
          language: '認識言語',
          autoDetect: '自動検出',
          langHint: '音声認識の言語を選択します。複数の言語を話す場合は「自動検出」を選択してください。',
          availableModels: '利用可能なモデル',
          modelDesc: 'ローカル音声認識用のWhisperモデルをダウンロードします。大きなモデルほど正確ですが、より多くのストレージと処理能力が必要です。'
        }
      }
    } as const
    const lang = (settings?.language || 'en') as keyof typeof dict
    return dict[lang] || dict.en
  })()

  const setUpdateState = useUpdateStore((s) => s.setState)
  const setUpdateDialogOpen = useUpdateStore((s) => s.setDialogOpen)

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

  if (!settings) return null

  const tabs = [
    { id: 'general', label: t.tabs.general, icon: Settings },
    { id: 'providers', label: t.tabs.providers, icon: Cpu },
    { id: 'chat', label: t.tabs.chat, icon: MessageSquare },
    { id: 'memory', label: t.tabs.memory, icon: Search },
    { id: 'im', label: t.tabs.im, icon: ExternalLink },
    { id: 'skills', label: t.tabs.skills, icon: Wand2 },
    { id: 'network', label: t.tabs.network, icon: Globe },
    { id: 'data', label: t.tabs.data, icon: Database },
    { id: 'voice', label: t.tabs.voice, icon: Mic },
    { id: 'about', label: t.tabs.about, icon: Info }
  ]

  const onClose = () => window.close()

  return (
    <div className="flex h-screen w-full bg-secondary/30 dark:bg-black/40 text-foreground transition-colors duration-300 overflow-hidden p-3 gap-3 font-sans relative">
      <div className="draggable absolute inset-x-0 top-0 h-3" />
      <UpdateDialog />
      <div className="w-64 bg-background rounded-2xl shadow-sm flex flex-col overflow-hidden shrink-0">
        <div className="h-[52px] flex items-center shrink-0 draggable select-none pl-[80px] border-b border-black/5 dark:border-white/5">
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto custom-scrollbar">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "secondary" : "ghost"}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full justify-start gap-3 px-3 py-2.5 h-auto font-medium ${
                  activeTab === tab.id 
                    ? '' 
                    : 'text-muted-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </Button>
            )
          })}
        </nav>
      </div>

      <div className="flex-1 bg-background rounded-2xl shadow-sm flex flex-col overflow-hidden min-w-0 border border-black/5 dark:border-white/5">
        <div className="h-[52px] flex items-center justify-between px-6 shrink-0 draggable border-b border-black/5 dark:border-white/5 select-none bg-background/50 backdrop-blur-sm">
          <h2 className="font-semibold text-lg cursor-default">
            {tabs.find((t) => t.id === activeTab)?.label}
          </h2>
        </div>

        <div className="flex-1 overflow-hidden relative no-drag bg-background">
          {activeTab === 'providers' && <ProvidersSettings />}
          {activeTab === 'general' && <GeneralSettings />}
          {activeTab === 'chat' && <ChatSettings />}
          {activeTab === 'memory' && <MemorySettings />}
          {activeTab === 'im' && <ImSettings />}
          {activeTab === 'skills' && <SkillsSettings />}
          {activeTab === 'network' && <NetworkSettings />}
          {activeTab === 'data' && <DataSettings />}
          {activeTab === 'voice' && <VoiceSettings t={t} />}
          {activeTab === 'about' && <AboutSettings onCheckUpdate={() => {
            const api = window.anima?.update
            if (!api?.check) return
            setUpdateDialogOpen(true)
            void api.check({ interactive: true })
          }} />}
        </div>

        <div className="h-14 px-6 border-t border-black/5 dark:border-white/5 bg-secondary/10 flex justify-between items-center text-xs text-muted-foreground shrink-0">
          <span>{t.savedHint}</span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={onClose}
            >
              {t.footer.close}
            </Button>
            <Button
              onClick={onClose}
            >
              {t.footer.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})

function AboutSettings({ onCheckUpdate }: { onCheckUpdate?: () => void }) {
  const settings = useStore(s => s.settings)
  const updateState = useUpdateStore((s) => s.state)
  const setUpdateDialogOpen = useUpdateStore((s) => s.setDialogOpen)
  const [info, setInfo] = useState<{ name?: string; version?: string; author?: string; repositoryUrl?: string }>({})
  const language = (settings?.language || 'en') as 'en' | 'zh' | 'ja'

  const t = useMemo(() => {
    const dict = {
      en: {
        name: 'Name',
        version: 'Version',
        author: 'Author',
        github: 'GitHub',
        open: 'Open',
        checkUpdate: 'Check for updates',
        status: {
          disabled: 'Updates are disabled in dev.',
          idle: 'Ready.',
          checking: 'Checking for updates…',
          available: 'Update available.',
          notAvailable: 'You are up to date.',
          downloading: 'Downloading…',
          downloaded: 'Downloaded. Ready to install.',
          error: 'Update error.'
        }
      },
      zh: {
        name: '名称',
        version: '版本号',
        author: '作者',
        github: 'GitHub',
        open: '打开',
        checkUpdate: '检查更新',
        status: {
          disabled: '开发环境不支持自动更新。',
          idle: '准备就绪。',
          checking: '正在检查更新…',
          available: '发现新版本可用。',
          notAvailable: '当前已是最新版本。',
          downloading: '正在下载…',
          downloaded: '下载完成，准备安装。',
          error: '更新失败。'
        }
      },
      ja: {
        name: '名称',
        version: 'バージョン',
        author: '作者',
        github: 'GitHub',
        open: '開く',
        checkUpdate: '更新を確認',
        status: {
          disabled: '開発環境では更新が無効です。',
          idle: '準備完了。',
          checking: '更新を確認中…',
          available: '新しいバージョンがあります。',
          notAvailable: '最新です。',
          downloading: 'ダウンロード中…',
          downloaded: 'ダウンロード完了。',
          error: '更新エラー。'
        }
      }
    } as const
    return dict[language] || dict.en
  }, [language])

  useEffect(() => {
    const api = window.anima?.app
    if (!api?.getInfo) return
    void api
      .getInfo()
      .then((res: any) => {
        if (res?.ok) {
          setInfo({
            name: res.name,
            version: res.version,
            author: res.author,
            repositoryUrl: res.repositoryUrl
          })
        }
      })
      .catch(() => {})
  }, [])

  const version = info.version || updateState?.currentVersion || ''
  const author = info.author || 'wangxt'
  const repoUrl = info.repositoryUrl || 'https://github.com/wxt2rr/Anima'
  const status = updateState?.status || 'idle'
  const percent = updateState?.progress?.percent

  const statusText = (() => {
    if (status === 'disabled') return t.status.disabled
    if (status === 'checking') return t.status.checking
    if (status === 'available') return t.status.available
    if (status === 'not-available') return t.status.notAvailable
    if (status === 'downloading') return `${t.status.downloading}${typeof percent === 'number' ? ` ${Math.max(0, Math.min(100, percent)).toFixed(0)}%` : ''}`
    if (status === 'downloaded') return t.status.downloaded
    if (status === 'error') return `${t.status.error}${updateState?.error ? ` ${String(updateState.error)}` : ''}`
    return t.status.idle
  })()

  const openExternal = async (url: string) => {
    const target = String(url || '').trim()
    if (!target) return
    if (window.anima?.preview?.openExternal) {
      await window.anima.preview.openExternal(target)
      return
    }
    window.open(target)
  }

  const handleCheckUpdate = () => {
    if (onCheckUpdate) {
      onCheckUpdate()
      return
    }
    const api = window.anima?.update
    if (!api?.check) return
    setUpdateDialogOpen(true)
    void api.check({ interactive: true })
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-3 gap-x-4 items-center">
            <div className="text-sm text-muted-foreground">{t.name}</div>
            <div className="text-sm font-medium">{info.name || 'Anima'}</div>

            <div className="text-sm text-muted-foreground">{t.version}</div>
            <div className="text-sm font-mono">{version || '--'}</div>

            <div className="text-sm text-muted-foreground">{t.author}</div>
            <div className="text-sm">{author}</div>

            <div className="text-sm text-muted-foreground">{t.github}</div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-sm font-mono truncate">{repoUrl}</div>
              <Button variant="outline" size="sm" onClick={() => void openExternal(repoUrl)}>
                {t.open}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">{statusText}</div>
            <Button
              onClick={handleCheckUpdate}
              disabled={status === 'disabled' || status === 'checking' || status === 'downloading'}
            >
              {t.checkUpdate}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ProvidersSettings() {
  const { providers: providers0, toggleProvider, updateProvider } = useStore()
  const { settings: settings0 } = useStore()
  const settings = settings0!
  const providers = providers0 ?? EMPTY_PROVIDERS
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => providers[0]?.id || '')
  const [searchQuery, setSearchQuery] = useState('')
  const [showProxyEndpoints, setShowProxyEndpoints] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [editingModel, setEditingModel] = useState<ProviderModel | null>(null)
  const [customProviderDialogOpen, setCustomProviderDialogOpen] = useState(false)

  useEffect(() => {
    if (selectedProviderId) return
    if (providers[0]?.id) setSelectedProviderId(providers[0].id)
  }, [providers, selectedProviderId])

  const getProviderIconUrl = (provider: { id?: string; type?: string; icon?: string; config?: { apiFormat?: string } }) => {
    if (provider.icon) return provider.icon
    const id = String(provider.id || '').toLowerCase()
    const type = String(provider.type || '').toLowerCase()
    const apiFormat = String(provider.config?.apiFormat || '').toLowerCase()
    
    // For custom providers, use apiFormat to determine icon
    if (type === 'openai_compatible') {
      if (apiFormat === 'anthropic_messages') return 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/anthropic.svg'
      if (apiFormat === 'responses') return 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg'
      // Default to generic or openai for chat_completions
      return 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg'
    }

    const slugById: Record<string, string> = {
      openai: 'openai',
      anthropic: 'anthropic',
      google: 'gemini',
      deepseek: 'deepseek',
      moonshot: 'moonshot',
      openrouter: 'openrouter',
      github: 'github',
      azure: 'microsoft-azure',
      aihubmix: 'aihubmix',
      zaicoding: 'zai'
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

  const t = (() => {
    const dict = {
      en: {
        search: 'Search providers...',
        addCustom: 'Add Custom Provider',
        addCustomAcp: 'Add Custom ACP Provider',
        active: 'Active',
        inactive: 'Inactive',
        apiKey: 'API Key',
        baseUrl: 'Base URL (Optional)',
        baseUrlHint: 'Leave empty to use the default API endpoint',
        thinkingMode: 'Thinking mode',
        thinkingModeHint: 'Enable reasoning_content output (DeepSeek).',
        models: 'Models',
        defaultModel: 'Default Model',
        manageModels: 'Manage Models',
        enterModelId: 'Enter model ID',
        enterApiKey: 'Enter your API key',
        getKey: (name: string) => `Get your API key from ${name} API Keys`,
        proxyEndpoints: 'API Proxy Endpoints',
        advanced: 'Advanced',
        proxyDesc: (name: string) => `Anima provides API proxy endpoints for ${name}. These endpoints convert API requests to Chat Completions format to be compatible with various AI tools.`,
        responsesProxy: 'Responses API Proxy',
        messagesProxy: 'Messages API Proxy',
        responsesProxyDesc: (name: string) => `Use this endpoint for tools requiring ${name} Responses API (like Codex). Requests will be converted to Chat Completions format.`,
        messagesProxyDesc: 'Use this endpoint for Anthropic compatible tools. Requests will be converted to Chat Completions format.',
        useWithClaude: 'Use with Claude Code',
        useWithClaudeDesc: 'You can use this provider with Claude Code by setting the following environment variables:',
        copy: 'Copy',
        copied: 'Copied'
      },
      zh: {
        search: '搜索提供商…',
        addCustom: 'Add Custom Provider',
        addCustomAcp: 'Add Custom ACP Provider',
        active: 'Active',
        inactive: 'Inactive',
        apiKey: 'API Key',
        baseUrl: 'Base URL (Optional)',
        baseUrlHint: 'Leave empty to use the default OpenAI API endpoint',
        thinkingMode: '思考模式',
        thinkingModeHint: '开启 reasoning_content 输出（DeepSeek）。',
        models: '模型',
        defaultModel: '默认模型',
        manageModels: '管理模型',
        enterModelId: '输入模型 ID',
        enterApiKey: 'Enter your API key',
        getKey: (name: string) => `Get your API key from ${name} API Keys`,
        proxyEndpoints: 'API 代理端点',
        advanced: '高级',
        proxyDesc: (name: string) => `Anima 为 ${name} 提供 API 代理端点。这些端点会将 API 请求转换为 Chat Completions 格式，以兼容各种 AI 工具。`,
        responsesProxy: 'OpenAI Responses API 代理',
        messagesProxy: 'Anthropic Messages API 代理',
        responsesProxyDesc: (name: string) => `将此端点用于需要 ${name} Responses API 的工具（如 Codex）。请求将被转换为 Chat Completions 格式。`,
        messagesProxyDesc: '将此端点用于 Anthropic 兼容的工具。请求将被转换为 Chat Completions 格式。',
        useWithClaude: '与 Claude Code 一起使用',
        useWithClaudeDesc: '您可以通过设置以下环境变量，将此提供商与 Claude Code 一起使用：',
        copy: '复制',
        copied: '已复制'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const activeProvider = providers.find(p => p.id === selectedProviderId)
  const hasFetchedModels = Boolean(activeProvider?.config?.modelsFetched)
  
  const filteredProviders = providers.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleAddModel = () => {
    if (!newModelId.trim() || !activeProvider) return
    const currentModels = normalizeModels(activeProvider.config.models)
    if (currentModels.some(m => m.id === newModelId.trim())) return
    
    updateProvider(activeProvider.id, { 
       models: [...currentModels, { id: newModelId.trim(), isEnabled: true, config: { id: newModelId.trim() } }]
    })
    setNewModelId('')
  }

  const handleFetchModels = async () => {
    if (!activeProvider) return
    if (!activeProvider.config.apiKey || !activeProvider.config.baseUrl) {
      alert(settings.language === 'zh' ? '请先填写 API Key 和 Base URL' : 'Please enter API Key and Base URL first')
      return
    }
    setIsFetchingModels(true)
    try {
      const res = await fetchBackendJson<{ ok: boolean; models?: any[] }>('/api/providers/fetch_models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: activeProvider.config.baseUrl || '',
          apiKey: activeProvider.config.apiKey || ''
        })
      })
      if (res.ok && Array.isArray(res.models)) {
        const existingModels = normalizeModels(activeProvider.config.models)
        const newModels = res.models.map((m: any) => {
          const id = typeof m === 'string' ? m : m.id
          const existing = existingModels.find(em => em.id === id)
          return existing || { id, isEnabled: true, config: { id } }
        })
        const enabledModels = newModels.filter((m: any) => m && m.isEnabled)
        const currentSelected = String(activeProvider.config.selectedModel || '').trim()
        const nextSelected =
          currentSelected && enabledModels.some((m: any) => m.id === currentSelected)
            ? currentSelected
            : String(enabledModels[0]?.id || '').trim()
        updateProvider(activeProvider.id, { models: newModels, modelsFetched: true, selectedModel: nextSelected })
      }
    } catch (e) {
      console.error('Failed to fetch models', e)
    } finally {
      setIsFetchingModels(false)
    }
  }

  const toggleModel = (modelId: string, enabled: boolean) => {
    if (!activeProvider) return
    const current = normalizeModels(activeProvider.config.models)
    const newModels = current.map(m => m.id === modelId ? { ...m, isEnabled: enabled } : m)
    updateProvider(activeProvider.id, { models: newModels })
  }

  return (
    <div className="flex h-full">
      {/* Providers List - Left Column */}
      <div className="w-64 border-r border-black/5 dark:border-white/5 p-4 flex flex-col gap-3 bg-secondary/10">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground z-10" />
          <Input
            type="text"
            placeholder={t.search}
            className="pl-9 bg-background"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
          {filteredProviders.map(provider => (
            <Button
              key={provider.id}
              variant={selectedProviderId === provider.id ? "secondary" : "ghost"}
              onClick={() => setSelectedProviderId(provider.id)}
              className={`w-full justify-between h-auto py-2.5 px-3 font-normal ${
                selectedProviderId === provider.id
                  ? 'bg-background shadow-sm border border-black/5 dark:border-white/5'
                  : ''
              }`}
            >
              <div className="flex items-center gap-3">
                 <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold border shrink-0 ${
                    selectedProviderId === provider.id ? 'bg-secondary border-transparent' : 'bg-background border-transparent'
                 }`}>
                    {getProviderIconUrl(provider) ? <img src={getProviderIconUrl(provider)} className="w-4 h-4" /> : provider.name[0]}
                 </div>
                 <span className="truncate max-w-[120px]">{provider.name}</span>
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${provider.isEnabled ? 'bg-green-500' : 'bg-gray-300'}`} />
            </Button>
          ))}
        </div>
      </div>

      {/* Provider Details - Right Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Actions Bar */}
        <div className="px-8 py-4">
          <div className="flex items-center justify-end gap-3 bg-secondary/10 border border-black/5 dark:border-white/5 rounded-xl px-4 py-3">
            <Button onClick={() => setCustomProviderDialogOpen(true)}>{t.addCustom}</Button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
          {activeProvider ? (
            <div className="max-w-3xl space-y-6 animate-in fade-in duration-300">
              
              {/* Header Card */}
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                       <h2 className="text-2xl font-semibold text-foreground">{activeProvider.name}</h2>
                       <Badge variant="outline" className={`font-medium border-0 ${
                          activeProvider.isEnabled 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-gray-100 text-gray-600'
                       }`}>
                         {activeProvider.isEnabled ? t.active : t.inactive}
                       </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                       <RefreshCw className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
                       <Switch 
                          checked={activeProvider.isEnabled}
                          onCheckedChange={(c) => toggleProvider(activeProvider.id, c)}
                       />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {activeProvider.description}
                  </p>
                </CardContent>
              </Card>

              {/* Advanced Proxy Settings */}
              <Card className="overflow-hidden">
                 <Button 
                    variant="ghost"
                    onClick={() => setShowProxyEndpoints(!showProxyEndpoints)}
                    className="w-full flex items-center justify-between px-6 py-4 h-auto hover:bg-secondary rounded-none"
                 >
                    <div className="flex items-center gap-2 font-medium text-sm">
                       <Cpu className="w-4 h-4" />
                       {t.proxyEndpoints}
                       <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 h-auto font-medium">{t.advanced}</Badge>
                    </div>
                    {showProxyEndpoints ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                 </Button>
                 
                 {showProxyEndpoints && (
                    <CardContent className="p-6 space-y-6 border-t border-border">
                       <p className="text-sm text-muted-foreground">
                          {t.proxyDesc(activeProvider.name)}
                       </p>

                       {/* Responses API Proxy */}
                       <div className="space-y-2">
                          <div className="flex items-center gap-2">
                             <Label>{t.responsesProxy}</Label>
                             <Badge variant="secondary" className="text-xs font-normal">OpenAI</Badge>
                          </div>
                          <div className="relative group">
                             <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                                <Button 
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => copyToClipboard('http://localhost:23001/proxy/openai/v1/responses')}
                                  className="h-8 w-8 hover:bg-secondary text-muted-foreground transition-colors"
                                >
                                   <Copy className="w-4 h-4" />
                                </Button>
                             </div>
                             <code className="block w-full bg-secondary rounded-lg px-4 py-3 text-sm font-mono text-muted-foreground break-all">
                                http://localhost:23001/proxy/openai/v1/responses
                             </code>
                          </div>
                          <p className="text-xs text-muted-foreground">{t.responsesProxyDesc(activeProvider.name)}</p>
                       </div>

                       {/* Messages API Proxy */}
                       <div className="space-y-2">
                          <div className="flex items-center gap-2">
                             <Label>{t.messagesProxy}</Label>
                             <Badge variant="secondary" className="text-xs font-normal">Anthropic</Badge>
                          </div>
                          <div className="relative group">
                             <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                                <Button 
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => copyToClipboard('http://localhost:23001/anthropic-proxy/openai/v1/messages')}
                                  className="h-8 w-8 hover:bg-secondary text-muted-foreground transition-colors"
                                >
                                   <Copy className="w-4 h-4" />
                                </Button>
                             </div>
                             <code className="block w-full bg-secondary rounded-lg px-4 py-3 text-sm font-mono text-muted-foreground break-all">
                                http://localhost:23001/anthropic-proxy/openai/v1/messages
                             </code>
                          </div>
                          <p className="text-xs text-muted-foreground">{t.messagesProxyDesc}</p>
                       </div>

                       {/* Claude Code Section */}
                      <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 space-y-3">
                         <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-primary font-medium text-sm">
                               <span>{'>_'}</span>
                               {t.useWithClaude}
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-primary/80 hover:text-primary hover:bg-primary/10">
                               <Copy className="w-4 h-4" />
                            </Button>
                         </div>
                         <p className="text-xs text-primary/80">
                            {t.useWithClaudeDesc}
                         </p>
                         <div className="bg-background/50 rounded border border-primary/10 p-3">
                            <pre className="text-xs font-mono text-primary/90 overflow-x-auto whitespace-pre-wrap">
export ANTHROPIC_BASE_URL=http://localhost:23001/anthropic-proxy/openai
export ANTHROPIC_MODEL={(hasFetchedModels && activeProvider.config.selectedModel) ? activeProvider.config.selectedModel : '<model-id>'}
export ANTHROPIC_SMALL_FAST_MODEL={hasFetchedModels ? (normalizeModels(activeProvider.config.models)[0]?.id || '<model-id>') : '<model-id>'}
export CLAUDE_CODE_SUBAGENT_MODEL={hasFetchedModels ? (normalizeModels(activeProvider.config.models)[0]?.id || '<model-id>') : '<model-id>'}
                             </pre>
                          </div>
                       </div>
                    </CardContent>
                 )}
              </Card>


              {/* API Key Section */}
              <Card>
                 <CardContent className="p-6 space-y-4">
                    <div className="space-y-1">
                       <Label>{t.apiKey}</Label>
                       <div className="relative">
                          <Input 
                            type={showApiKey ? "text" : "password"}
                            className="pr-10"
                            placeholder={t.enterApiKey}
                            value={activeProvider.config.apiKey || ''}
                            onChange={(e) => updateProvider(activeProvider.id, { apiKey: e.target.value })}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          >
                            {showApiKey ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                          </Button>
                       </div>
                       <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                          <span>{t.getKey(activeProvider.name)}</span>
                          <ExternalLink className="w-3 h-3" />
                       </div>
                    </div>
                 </CardContent>
              </Card>

              {/* Base URL Section */}
              <Card>
                 <CardContent className="p-6 space-y-4">
                    <div className="space-y-1">
                       <Label>{t.baseUrl}</Label>
                       <Input 
                         type="text"
                         placeholder="https://api.openai.com/v1"
                         value={activeProvider.config.baseUrl || ''}
                         onChange={(e) => updateProvider(activeProvider.id, { baseUrl: e.target.value })}
                       />
                       <p className="text-xs text-muted-foreground pt-1">{t.baseUrlHint}</p>
                    </div>

                    {/* API Format for Custom Providers */}
                    {activeProvider.type === 'openai_compatible' && (
                      <div className="space-y-1 pt-2">
                        <Label>API Format</Label>
                        <Select 
                          value={activeProvider.config.apiFormat || 'chat_completions'} 
                          onValueChange={(val) => updateProvider(activeProvider.id, { apiFormat: val })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="chat_completions">Chat Completions (/chat/completions)</SelectItem>
                            <SelectItem value="responses">Responses (/responses)</SelectItem>
                            <SelectItem value="anthropic_messages">Anthropic Messages (/v1/messages)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[0.8rem] text-muted-foreground">
                          Choose the API endpoint format your provider uses
                        </p>
                      </div>
                    )}
                 </CardContent>
              </Card>



              {/* Models Section */}
              <Card>
                 <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                       <Label>{t.models}</Label>
                       <Button 
                         variant="outline" 
                         size="sm" 
                         onClick={handleFetchModels}
                         disabled={isFetchingModels}
                         className="gap-2"
                       >
                         {isFetchingModels ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                         Fetch Models
                       </Button>
                    </div>

                    {hasFetchedModels ? (
                      <>
                        <div className="space-y-1">
                           <Label className="text-xs text-muted-foreground">{t.defaultModel}</Label>
                           <Select
                             value={activeProvider.config.selectedModel || ''}
                             onValueChange={(val) => updateProvider(activeProvider.id, { selectedModel: val })}
                           >
                             <SelectTrigger>
                               <SelectValue />
                             </SelectTrigger>
                             <SelectContent>
                               {normalizeModels(activeProvider.config.models).filter(m => m.isEnabled).map(m => (
                                 <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>
                               ))}
                             </SelectContent>
                           </Select>
                        </div>

                        <div className="space-y-2 pt-2">
                           <Label className="text-xs text-muted-foreground">{t.manageModels}</Label>
                           
                           <div className="border rounded-md divide-y max-h-[300px] overflow-y-auto">
                             {normalizeModels(activeProvider.config.models).map((model) => (
                               <div key={model.id} className="flex items-center justify-between p-3 text-sm">
                                 <div className="flex items-center gap-3">
                                   <Switch 
                                     checked={model.isEnabled}
                                     onCheckedChange={(c) => toggleModel(model.id, c)}
                                   />
                                   <span className={model.isEnabled ? 'font-medium' : 'text-muted-foreground'}>
                                     {model.id}
                                   </span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                   <Button
                                     variant="ghost"
                                     size="icon"
                                     onClick={() => setEditingModel(model)}
                                     className="h-8 w-8"
                                   >
                                     <Settings className="w-4 h-4" />
                                   </Button>
                                   <Button 
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        const current = normalizeModels(activeProvider.config.models)
                                        const newModels = current.filter(m => m.id !== model.id)
                                        updateProvider(activeProvider.id, { models: newModels })
                                        if (activeProvider.config.selectedModel === model.id && newModels.length > 0) {
                                           updateProvider(activeProvider.id, { selectedModel: newModels[0].id })
                                        }
                                      }}
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    >
                                       <Trash2 className="w-4 h-4" />
                                    </Button>
                                 </div>
                               </div>
                             ))}
                             {normalizeModels(activeProvider.config.models).length === 0 && (
                                <div className="p-4 text-center text-muted-foreground text-xs">
                                   No models configured.
                                </div>
                             )}
                           </div>
                           
                           <div className="flex gap-2 pt-2">
                              <Input 
                                type="text"
                                placeholder={t.enterModelId}
                                value={newModelId}
                                onChange={(e) => setNewModelId(e.target.value)}
                                onKeyDown={(e) => {
                                   if (e.key === 'Enter') handleAddModel()
                                }}
                              />
                              <Button 
                                 onClick={handleAddModel}
                                 variant="secondary"
                                 size="icon"
                              >
                                 <Plus className="w-4 h-4" />
                              </Button>
                           </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {settings.language === 'zh'
                          ? '默认不展示模型列表。点击 Fetch Models 后再进行选择与管理。'
                          : 'Models are hidden by default. Click Fetch Models to load and manage them.'}
                      </div>
                    )}
                 </CardContent>
              </Card>

              {/* Model Config Dialog */}
              {editingModel && (
                <ModelConfigDialog
                  model={editingModel}
                  open={!!editingModel}
                  onOpenChange={(open) => !open && setEditingModel(null)}
                  onSave={(updates) => {
                    const current = normalizeModels(activeProvider.config.models)
                    const newModels = current.map(m => 
                      m.id === editingModel.id 
                        ? { ...m, config: { ...m.config, ...updates } }
                        : m
                    )
                    updateProvider(activeProvider.id, { models: newModels })
                    setEditingModel(null)
                  }}
                />
              )}

            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p>Select a provider to configure</p>
            </div>
          )}
        </div>
      </div>
      
      <CustomProviderDialog 
        open={customProviderDialogOpen} 
        onOpenChange={setCustomProviderDialogOpen} 
      />
    </div>
  )
}

function GeneralSettings() {
  const { settings, updateSettings } = useStore()
  if (!settings) return null
  const t = (() => {
    const dict = {
      en: {
        language: 'Language',
        theme: 'Theme',
        themeColor: 'Theme Color',
        density: 'UI Density',
        system: 'System',
        light: 'Light',
        dark: 'Dark',
        comfortable: 'Comfortable',
        compact: 'Compact'
      },
      zh: {
        language: '语言',
        theme: '主题',
        themeColor: '主题色',
        density: '界面密度',
        system: '跟随系统',
        light: '浅色',
        dark: '深色',
        comfortable: '舒适',
        compact: '紧凑'
      },
      ja: {
        language: '言語',
        theme: 'テーマ',
        themeColor: 'テーマ色',
        density: '表示密度',
        system: 'システム',
        light: 'ライト',
        dark: 'ダーク',
        comfortable: '標準',
        compact: 'コンパクト'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()
  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label>{t.language}</Label>
            <Select 
              value={settings.language} 
              onValueChange={(val) => updateSettings({ language: val })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">Chinese (Simplified)</SelectItem>
                <SelectItem value="ja">Japanese</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>{t.theme}</Label>
            <Select 
              value={settings.theme} 
              onValueChange={(val) => updateSettings({ theme: val as any })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t.system}</SelectItem>
                <SelectItem value="light">{t.light}</SelectItem>
                <SelectItem value="dark">{t.dark}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t.density}</Label>
            <Select 
              value={settings.density} 
              onValueChange={(val) => updateSettings({ density: val as any })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comfortable">{t.comfortable}</SelectItem>
                <SelectItem value="compact">{t.compact}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 space-y-3 pt-2">
            <Label>{t.themeColor}</Label>
            <div className="flex flex-wrap gap-3">
              {(Object.entries(THEMES) as [ThemeColor, typeof THEMES[ThemeColor]][]).map(([key, theme]) => (
                <button
                  key={key}
                  onClick={() => updateSettings({ themeColor: key })}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    (settings.themeColor || 'zinc') === key 
                      ? 'border-primary ring-2 ring-primary/30 scale-110' 
                      : 'border-transparent hover:scale-110'
                  }`}
                  style={{ backgroundColor: theme.activeColor }}
                  title={theme.label}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function NetworkSettings() {
  const { settings: settings0, updateSettings } = useStore()
  const settings = settings0!
  const [status, setStatus] = useState<{ type: 'idle' | 'ok' | 'error'; text?: string }>({ type: 'idle' })
  const t = (() => {
    const dict = {
      en: {
        proxyUrl: 'Proxy URL',
        hint: 'Supports HTTP/HTTPS proxies (e.g. http://127.0.0.1:7890). Leave empty for direct.',
        apply: 'Apply',
        clear: 'Clear',
        proxyApplied: 'Proxy applied.',
        directApplied: 'Direct connection applied.',
        applyFailed: 'Failed to apply proxy.'
      },
      zh: {
        proxyUrl: '代理地址',
        hint: '支持 HTTP/HTTPS 代理（例如 http://127.0.0.1:7890）。留空为直连。',
        apply: '应用',
        clear: '清空',
        proxyApplied: '代理已应用。',
        directApplied: '已切换为直连。',
        applyFailed: '应用代理失败。'
      },
      ja: {
        proxyUrl: 'プロキシURL',
        hint: 'HTTP/HTTPS プロキシ対応（例: http://127.0.0.1:7890）。空欄で直結。',
        apply: '適用',
        clear: 'クリア',
        proxyApplied: 'プロキシを適用しました。',
        directApplied: '直結に切り替えました。',
        applyFailed: 'プロキシ適用に失敗しました。'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const onApply = async () => {
    setStatus({ type: 'ok', text: settings.proxyUrl?.trim() ? t.proxyApplied : t.directApplied })
  }

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <Card className="p-5 space-y-3">
        <Label>{t.proxyUrl}</Label>
        <Input 
          type="text"
          placeholder="http://127.0.0.1:7890"
          value={settings.proxyUrl || ''}
          onChange={(e) => updateSettings({ proxyUrl: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          {t.hint}
        </p>
        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={onApply}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t.apply}
          </Button>
          <Button
            variant="outline"
            onClick={() => updateSettings({ proxyUrl: '' })}
          >
            {t.clear}
          </Button>
          {status.type === 'ok' && (
            <span className="inline-flex items-center gap-1 text-xs text-green-500">
              <CheckCircle2 className="w-4 h-4" />
              {status.text}
            </span>
          )}
          {status.type === 'error' && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <XCircle className="w-4 h-4" />
              {status.text}
            </span>
          )}
        </div>
      </Card>
    </div>
  )
}

function ChatSettings() {
  const {
    settings: settings0,
    providers: providers0,
    updateSettings,
  } = useStore()
  const settings = settings0!
  const providers = providers0 ?? EMPTY_PROVIDERS
  const media = ((settings as any).media || {
    imageEnabled: false,
    videoEnabled: false,
    imageProviderId: '',
    videoProviderId: '',
    defaultImageModel: '',
    defaultImageSize: '1024x1024',
    defaultVideoModel: ''
  }) as {
    imageEnabled: boolean
    videoEnabled: boolean
    imageProviderId: string
    videoProviderId: string
    defaultImageModel: string
    defaultImageSize: string
    defaultVideoModel: string
  }
  const updateMedia = (updates: Partial<typeof media>) => updateSettings({ media: { ...media, ...updates } })
  const [cleanupStatus, setCleanupStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'error'; text: string }>({
    type: 'idle',
    text: ''
  })
  const t = (() => {
    const dict = {
      en: {
        systemPrompts: 'System Prompts',
        new: 'New',
        delete: 'Delete',
        selectedHint: 'The selected prompt is used as the base system message.',
        chatParams: 'Chat Parameters',
        temperature: 'Temperature',
        temperatureHint: 'Controls randomness: Lower is more deterministic, higher is more creative.',
        conservative: 'Conservative',
        balanced: 'Balanced',
        creative: 'Creative',
        maxTokens: 'Max Tokens',
        maxTokensHint: 'Maximum length limit for single response (1-8192)',
        responseSettings: 'Response Settings',
        streamingResponse: 'Enable Streaming Response',
        streamingResponseHint: 'Show response in real-time as it generates.',
        showTokenUsage: 'Show Token Usage',
        showTokenUsageHint: 'Display token consumption stats for each chat.',
        markdown: 'Enable Markdown Rendering',
        markdownHint: 'Automatically render Markdown content in responses.',
        singleDollarMath: 'Render Single Dollar Math',
        singleDollarMathHint: 'Enable inline math rendering with single dollar signs (e.g. $x = y$). Default off to avoid conflicts.',
        infoCard: 'Enable Info Card Visualization',
        infoCardHint: 'Injects info card prompt into system prompt to guide AI in generating visual content.',
        autoCompression: 'Auto Compression',
        enableAutoCompression: 'Enable Auto Compression',
        compressionDesc: 'Automatically compress history when context limit is reached. Allows infinite conversation without manual intervention.',
        compressionThreshold: 'Compression Threshold',
        early: 'Early',
        late: 'Late',
        compressionThresholdHint: 'Triggers compression when context usage exceeds this percentage.',
        keepRecentMessages: 'Keep Recent Messages',
        keepRecentMessagesHint: 'Number of recent messages to keep uncompressed (2-20).',
        name: 'Name',
        mediaSettings: 'Media Generation',
        imageGenEnabled: 'Enable Image Generation',
        imageGenProvider: 'Image Provider',
        videoGenEnabled: 'Enable Video Generation',
        videoGenProvider: 'Video Provider',
        defaultImageModel: 'Default Image Model',
        defaultImageSize: 'Default Image Size',
        defaultVideoModel: 'Default Video Model',
        useChatProvider: 'Use Chat Provider',
        artifactsCleanup: 'Artifacts Cleanup',
        cleanupArtifacts: 'Clean Up Artifacts',
        cleanupArtifactsHint: 'Deletes old artifacts under workspace/.anima/artifacts.',
        cleanupDone: 'Cleanup done.',
        cleanupFailed: 'Cleanup failed.',
      },
      zh: {
        systemPrompts: '系统提示词',
        new: '新建',
        delete: '删除',
        selectedHint: '当前选中的提示词会作为 system message 的基础内容。',
        chatParams: '聊天参数',
        temperature: '温度',
        temperatureHint: '控制回复的随机性。较低的值产生一致的回复，较高的值产生更有创意的回复。',
        conservative: '保守',
        balanced: '平衡',
        creative: '创意',
        maxTokens: '最大令牌数',
        maxTokensHint: '单次回复的最大长度限制 (1-8192)',
        responseSettings: '响应设置',
        streamingResponse: '启用流式响应',
        streamingResponseHint: '启用后，AI 回复将实时显示，否则等待完整回复后一次性显示',
        showTokenUsage: '显示令牌使用情况',
        showTokenUsageHint: '在聊天界面中显示每次对话的令牌消耗统计',
        markdown: '启用 Markdown 渲染',
        markdownHint: '自动渲染回复中的 Markdown 格式内容',
        singleDollarMath: '渲染单美元符号数学公式',
        singleDollarMathHint: '启用单美元符号内联数学公式渲染（例如 $x = y$）。默认关闭以避免与普通美元符号冲突。详见 https://github.com/vercel/streamdown/issues/108',
        infoCard: '启用信息图可视化',
        infoCardHint: '开启时会在 system prompt 中注入信息图相关提示，引导 AI 生成可视化内容。关闭仅移除该提示，不影响已有信息图块的渲染。',
        autoCompression: '自动压缩',
        enableAutoCompression: '启用自动压缩',
        compressionDesc: '当对话接近模型上下文窗口限制时，自动压缩历史消息。这使得对话可以无限延续，无需手动干预。',
        compressionThreshold: '压缩阈值',
        early: '提前',
        late: '延迟',
        compressionThresholdHint: '当上下文使用率超过此百分比时触发压缩。较低的值提供更多缓冲空间，较高的值保留更多原始内容。',
        keepRecentMessages: '保留最近消息数',
        keepRecentMessagesHint: '始终保留的最近消息数量，这些消息不会被压缩到摘要中 (2-20)。',
        name: '名称',
        mediaSettings: '媒体生成',
        imageGenEnabled: '启用生图',
        imageGenProvider: '生图 Provider',
        videoGenEnabled: '启用生视频',
        videoGenProvider: '生视频 Provider',
        defaultImageModel: '默认生图模型',
        defaultImageSize: '默认图片尺寸',
        defaultVideoModel: '默认生视频模型',
        useChatProvider: '使用聊天 Provider',
        artifactsCleanup: '产物清理',
        cleanupArtifacts: '清理产物',
        cleanupArtifactsHint: '清理 workspace/.anima/artifacts 下的旧产物。',
        cleanupDone: '清理完成。',
        cleanupFailed: '清理失败。',
      },
      ja: {
        systemPrompts: 'システムプロンプト',
        new: '新規',
        delete: '削除',
        selectedHint: '選択中のプロンプトが system message のベースになります。',
        chatParams: 'チャットパラメータ',
        temperature: '温度',
        temperatureHint: '応答のランダム性を制御します。',
        conservative: '保守的',
        balanced: 'バランス',
        creative: '創造的',
        maxTokens: '最大トークン数',
        maxTokensHint: '1回の応答の最大長制限 (1-8192)',
        responseSettings: '応答設定',
        streamingResponse: 'ストリーミング応答を有効化',
        streamingResponseHint: '応答を生成しながらリアルタイムで表示します。',
        showTokenUsage: 'トークン使用量を表示',
        showTokenUsageHint: 'チャットごとのトークン消費統計を表示します。',
        markdown: 'Markdown レンダリングを有効化',
        markdownHint: '応答内の Markdown コンテンツを自動的にレンダリングします。',
        mediaSettings: 'メディア生成',
        imageGenEnabled: '画像生成を有効化',
        imageGenProvider: '画像 Provider',
        videoGenEnabled: '動画生成を有効化',
        videoGenProvider: '動画 Provider',
        defaultImageModel: '既定の画像モデル',
        defaultImageSize: '既定の画像サイズ',
        defaultVideoModel: '既定の動画モデル',
        useChatProvider: 'チャット Provider を使用',
        artifactsCleanup: '成果物のクリーンアップ',
        cleanupArtifacts: '成果物を削除',
        cleanupArtifactsHint: 'workspace/.anima/artifacts の古い成果物を削除します。',
        cleanupDone: 'クリーンアップ完了。',
        cleanupFailed: 'クリーンアップ失敗。',
        singleDollarMath: '単一ドル記号の数式をレンダリング',
        singleDollarMathHint: '単一ドル記号によるインライン数式 ($x = y$など) を有効にします。',
        infoCard: '情報カードの可視化を有効化',
        infoCardHint: 'システムプロンプトに情報カードの指示を注入し、視覚的なコンテンツ生成を誘導します。',
        autoCompression: '自動圧縮',
        enableAutoCompression: '自動圧縮を有効化',
        compressionDesc: 'コンテキスト制限に近づくと履歴を自動圧縮します。',
        compressionThreshold: '圧縮しきい値',
        early: '早め',
        late: '遅め',
        compressionThresholdHint: 'コンテキスト使用率がこの割合を超えると圧縮をトリガーします。',
        keepRecentMessages: '直近メッセージ保持数',
        keepRecentMessagesHint: '圧縮せずに保持する直近メッセージ数 (2-20)。',
        name: '名前',
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()
  const imageProviderSelectValue = media.imageProviderId ? media.imageProviderId : '__chat__'
  const videoProviderSelectValue = media.videoProviderId ? media.videoProviderId : '__chat__'

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      {/* Chat Parameters */}
      <Card className="p-5 space-y-6">
        <div className="flex items-center gap-2">
           <h3 className="text-sm font-semibold">{t.chatParams}</h3>
        </div>

        <div className="space-y-4">
           <div className="space-y-3">
              <Label>{t.temperature}: {settings.temperature}</Label>
              <Slider 
                 min={0} max={2} step={0.1} 
                 value={[settings.temperature]} 
                 onValueChange={([v]) => updateSettings({ temperature: v })} 
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                 <span>{t.conservative} (0.0)</span>
                 <span>{t.balanced} (1.0)</span>
                 <span>{t.creative} (2.0)</span>
              </div>
              <p className="text-xs text-muted-foreground">{t.temperatureHint}</p>
           </div>

           <div className="space-y-2">
              <Label>{t.maxTokens}</Label>
              <Input
                 type="number"
                 value={settings.maxTokens}
                 onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{t.maxTokensHint}</p>
           </div>
        </div>
      </Card>

      {/* Response Settings */}
      <Card className="p-5 space-y-4">
         <h3 className="text-sm font-semibold">{t.responseSettings}</h3>
         
         <div className="space-y-4">
            <div className="flex items-start gap-3">
               <Checkbox 
                  id="streaming"
                  checked={settings.enableStreamingResponse}
                  onCheckedChange={(c) => updateSettings({ enableStreamingResponse: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="streaming" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.streamingResponse}</label>
                  <p className="text-xs text-muted-foreground">{t.streamingResponseHint}</p>
               </div>
            </div>

            <div className="flex items-start gap-3">
               <Checkbox 
                  id="tokenUsage"
                  checked={settings.showTokenUsage}
                  onCheckedChange={(c) => updateSettings({ showTokenUsage: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="tokenUsage" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.showTokenUsage}</label>
                  <p className="text-xs text-muted-foreground">{t.showTokenUsageHint}</p>
               </div>
            </div>

            <div className="flex items-start gap-3">
               <Checkbox 
                  id="markdown"
                  checked={settings.enableMarkdown}
                  onCheckedChange={(c) => updateSettings({ enableMarkdown: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="markdown" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.markdown}</label>
                  <p className="text-xs text-muted-foreground">{t.markdownHint}</p>
               </div>
            </div>

            <div className="flex items-start gap-3 pl-6">
               <Checkbox 
                  id="math"
                  checked={settings.renderSingleDollarMath}
                  disabled={!settings.enableMarkdown}
                  onCheckedChange={(c) => updateSettings({ renderSingleDollarMath: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="math" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.singleDollarMath}</label>
                  <p className="text-xs text-muted-foreground">{t.singleDollarMathHint}</p>
               </div>
            </div>

            <div className="flex items-start gap-3">
               <Checkbox 
                  id="infoCard"
                  checked={settings.enableInfoCardVisualization}
                  onCheckedChange={(c) => updateSettings({ enableInfoCardVisualization: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="infoCard" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.infoCard}</label>
                  <p className="text-xs text-muted-foreground">{t.infoCardHint}</p>
               </div>
            </div>
         </div>
      </Card>

      {/* Media */}
      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold">{t.mediaSettings}</h3>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="imageGenEnabled"
              checked={media.imageEnabled}
              onCheckedChange={(c) => updateMedia({ imageEnabled: c as boolean })}
            />
            <div className="grid gap-1.5 leading-none">
              <label htmlFor="imageGenEnabled" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                {t.imageGenEnabled}
              </label>
            </div>
          </div>

          <div className="space-y-2 pl-7">
            <Label>{t.imageGenProvider}</Label>
            <Select
              value={imageProviderSelectValue}
              onValueChange={(val) => updateMedia({ imageProviderId: val === '__chat__' ? '' : val })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__chat__">{t.useChatProvider}</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 pl-7">
            <Label>{t.defaultImageModel}</Label>
            <Input value={media.defaultImageModel} onChange={(e) => updateMedia({ defaultImageModel: e.target.value })} />
          </div>

          <div className="space-y-2 pl-7">
            <Label>{t.defaultImageSize}</Label>
            <Input value={media.defaultImageSize} onChange={(e) => updateMedia({ defaultImageSize: e.target.value })} />
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="videoGenEnabled"
              checked={media.videoEnabled}
              onCheckedChange={(c) => updateMedia({ videoEnabled: c as boolean })}
            />
            <div className="grid gap-1.5 leading-none">
              <label htmlFor="videoGenEnabled" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                {t.videoGenEnabled}
              </label>
            </div>
          </div>

          <div className="space-y-2 pl-7">
            <Label>{t.videoGenProvider}</Label>
            <Select
              value={videoProviderSelectValue}
              onValueChange={(val) => updateMedia({ videoProviderId: val === '__chat__' ? '' : val })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__chat__">{t.useChatProvider}</SelectItem>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 pl-7">
            <Label>{t.defaultVideoModel}</Label>
            <Input value={media.defaultVideoModel} onChange={(e) => updateMedia({ defaultVideoModel: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h3 className="text-sm font-semibold">{t.artifactsCleanup}</h3>
        <p className="text-xs text-muted-foreground">{t.cleanupArtifactsHint}</p>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={cleanupStatus.type === 'loading'}
            onClick={async () => {
              try {
                setCleanupStatus({ type: 'loading', text: '' })
                const res = await fetchBackendJson<{ ok: boolean; deletedCount?: number; freedBytes?: number }>('/api/artifacts/cleanup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    workspaceDir: settings.workspaceDir,
                    maxAgeDays: 14,
                    maxTotalBytes: 1024 * 1024 * 1024
                  })
                })
                if (res?.ok) {
                  const deleted = Number(res.deletedCount || 0)
                  const freed = Number(res.freedBytes || 0)
                  setCleanupStatus({ type: 'ok', text: `${t.cleanupDone} deleted=${deleted} freedBytes=${freed}` })
                } else {
                  setCleanupStatus({ type: 'error', text: t.cleanupFailed })
                }
              } catch (e) {
                setCleanupStatus({ type: 'error', text: (e instanceof Error ? e.message : t.cleanupFailed) })
              }
            }}
          >
            {t.cleanupArtifacts}
          </Button>
          {cleanupStatus.type === 'ok' && <span className="text-xs text-green-500">{cleanupStatus.text}</span>}
          {cleanupStatus.type === 'error' && <span className="text-xs text-destructive">{cleanupStatus.text}</span>}
        </div>
      </Card>

      <Card className="p-5 space-y-6">
         <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">{t.autoCompression}</h3>
         </div>

         <div className="space-y-4">
             <div className="flex items-start gap-3">
               <Checkbox 
                  id="compression"
                  checked={settings.enableAutoCompression}
                  onCheckedChange={(c) => updateSettings({ enableAutoCompression: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="compression" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.enableAutoCompression}</label>
                  <p className="text-xs text-muted-foreground leading-relaxed pt-1">{t.compressionDesc}</p>
               </div>
            </div>

            <div className="space-y-3 pl-7">
               <Label>{t.compressionThreshold}: {settings.compressionThreshold}%</Label>
               <Slider 
                  min={0} max={100} step={1} 
                  value={[settings.compressionThreshold]} 
                  onValueChange={([v]) => updateSettings({ compressionThreshold: v })} 
               />
               <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t.early} (5%)</span>
                  <span>{t.late} (95%)</span>
               </div>
               <p className="text-xs text-muted-foreground">{t.compressionThresholdHint}</p>
            </div>

            <div className="space-y-2 pl-7">
               <Label>{t.keepRecentMessages}</Label>
               <Input
                  className="w-24"
                  type="number"
                  min={2}
                  max={20}
                  value={settings.keepRecentMessages}
                  onChange={(e) => updateSettings({ keepRecentMessages: Number(e.target.value) })}
               />
               <p className="text-xs text-muted-foreground">{t.keepRecentMessagesHint}</p>
            </div>
         </div>
      </Card>
    </div>
  )
}

function ImSettings() {
  const { settings: settings0, updateSettings } = useStore()
  const settings = settings0!
  const [showToken, setShowToken] = useState(false)
  const providers = useStore((s) => s.providers)

  const t = (() => {
    const dict = {
      en: {
        provider: 'IM Provider',
        telegram: 'Telegram',
        enableTelegram: 'Enable Telegram',
        botToken: 'Bot Token',
        botTokenHint: 'Telegram Bot token, e.g. 123:ABC...',
        allowedUserIds: 'Allowed User IDs',
        allowedUserIdsHint: 'Comma or newline separated. At least one is required.',
        allowGroups: 'Allow Groups',
        allowGroupsHint: 'Default off for safety.',
        pollingIntervalMs: 'Polling Interval (ms)',
        pollingIntervalHint: 'Lower is more responsive but uses more requests.',
        chatProvider: 'Chat Provider',
        chatProviderHint: 'Optional. Use a specific provider/model for Telegram.',
        chatModel: 'Chat Model',
        chatModelHint: 'Optional. Overrides the provider default model.',
        followDefault: 'Follow desktop default',
        openclaw: 'OpenClaw',
        enableOpenclaw: 'Enable OpenClaw',
        enableHeartbeat: 'Enable Heartbeat',
        heartbeatChatId: 'Heartbeat Chat ID',
        heartbeatChatIdHint: 'Telegram chat ID to receive heartbeat messages.',
        workspaceDir: 'Workspace Directory',
        workspaceDirHint: 'Used by OpenClaw and workspace-based tools.',
        selectFolder: 'Select Folder'
      },
      zh: {
        provider: 'IM 服务商',
        telegram: 'Telegram',
        enableTelegram: '启用 Telegram',
        botToken: 'Bot Token',
        botTokenHint: 'Telegram 机器人 Token，例如 123:ABC...',
        allowedUserIds: '允许的用户 ID',
        allowedUserIdsHint: '用逗号或换行分隔，至少填写 1 个。',
        allowGroups: '允许群聊',
        allowGroupsHint: '默认关闭以保证安全。',
        pollingIntervalMs: '轮询间隔（毫秒）',
        pollingIntervalHint: '越小越及时，但请求次数更多。',
        chatProvider: '聊天提供商',
        chatProviderHint: '可选。为 Telegram 单独指定 provider / model。',
        chatModel: '聊天模型',
        chatModelHint: '可选。覆盖 provider 的默认模型。',
        followDefault: '跟随桌面默认',
        openclaw: 'OpenClaw',
        enableOpenclaw: '启用 OpenClaw',
        enableHeartbeat: '启用 Heartbeat',
        heartbeatChatId: 'Heartbeat Chat ID',
        heartbeatChatIdHint: '用于接收心跳消息的 Telegram chat id。',
        workspaceDir: '工作区目录',
        workspaceDirHint: '供 OpenClaw 与工作区相关工具使用。',
        selectFolder: '选择文件夹'
      },
      ja: {
        provider: 'IM プロバイダー',
        telegram: 'Telegram',
        enableTelegram: 'Telegram を有効化',
        botToken: 'Bot Token',
        botTokenHint: 'Telegram Bot token（例: 123:ABC...）',
        allowedUserIds: '許可ユーザーID',
        allowedUserIdsHint: 'カンマ/改行区切り。最低1つ必要です。',
        allowGroups: 'グループを許可',
        allowGroupsHint: '安全のため既定はオフ。',
        pollingIntervalMs: 'ポーリング間隔（ms）',
        pollingIntervalHint: '小さいほど応答が速いが、リクエストが増えます。',
        chatProvider: 'チャットプロバイダー',
        chatProviderHint: '任意。Telegram 用に provider/model を指定できます。',
        chatModel: 'チャットモデル',
        chatModelHint: '任意。プロバイダー既定モデルを上書きします。',
        followDefault: 'デスクトップ既定に従う',
        openclaw: 'OpenClaw',
        enableOpenclaw: 'OpenClaw を有効化',
        enableHeartbeat: 'Heartbeat を有効化',
        heartbeatChatId: 'Heartbeat Chat ID',
        heartbeatChatIdHint: 'Heartbeat メッセージを受信する Telegram chat id。',
        workspaceDir: 'ワークスペースディレクトリ',
        workspaceDirHint: 'OpenClaw とワークスペース系ツールで使用します。',
        selectFolder: 'フォルダーを選択'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const provider = (settings.im?.provider || 'telegram') as 'telegram'
  const tg = settings.im?.telegram || {}
  const enabled = Boolean(tg.enabled)
  const botToken = String(tg.botToken || '')
  const allowedUserIds = Array.isArray(tg.allowedUserIds) ? tg.allowedUserIds.map(String) : []
  const allowGroups = Boolean(tg.allowGroups)
  const pollingIntervalMs = Number.isFinite(tg.pollingIntervalMs as any) ? Number(tg.pollingIntervalMs) : 1500
  const telegramProviderOverrideId = String((tg as any).providerOverrideId || '').trim()
  const telegramModelOverride = String((tg as any).modelOverride || '').trim()

  const availableProviders = useMemo(() => {
    const list = Array.isArray(providers) ? providers.filter((p) => p && p.isEnabled) : []
    list.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    return list
  }, [providers])

  const selectedProvider = useMemo(() => {
    if (!telegramProviderOverrideId) return undefined
    return availableProviders.find((p) => p.id === telegramProviderOverrideId)
  }, [availableProviders, telegramProviderOverrideId])

  const availableModels = useMemo(() => {
    const p = selectedProvider || availableProviders.find((x) => x.isEnabled)
    const models = Array.isArray(p?.config?.models) ? p?.config?.models : []
    return models
      .map((m: any) => (typeof m === 'string' ? m : m?.id))
      .filter((id: any) => typeof id === 'string' && id.trim())
  }, [availableProviders, selectedProvider])

  const openclaw = settings.openclaw || {}
  const openclawEnabled = Boolean(openclaw.enabled)
  const heartbeatEnabled = Boolean(openclaw.heartbeatEnabled)
  const heartbeatTelegramChatId = String(openclaw.heartbeatTelegramChatId || '')
  const workspaceDir = String(settings.workspaceDir || '')

  const allowedText = allowedUserIds.join('\n')

  const updateTelegram = (updates: Partial<NonNullable<typeof settings.im>['telegram']>) => {
    updateSettings({
      im: {
        provider: 'telegram',
        telegram: { ...tg, ...updates }
      }
    } as any)
  }

  const updateOpenclaw = (updates: Partial<NonNullable<typeof settings.openclaw>>) => {
    updateSettings({ openclaw: { ...openclaw, ...updates } })
  }

  const handlePickWorkspaceDir = async () => {
    const res = await window.anima?.window?.pickDirectory?.()
    if (!res?.ok || res.canceled) return
    const dir = String(res.path || '').trim()
    if (!dir) return
    updateSettings({ workspaceDir: dir })
  }

  const parseAllowed = (raw: string) => {
    const items = raw
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter(Boolean)
    return Array.from(new Set(items))
  }

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <Card className="p-5 space-y-4">
        <div className="space-y-2">
          <Label>{t.provider}</Label>
          <Select
            value={provider}
            onValueChange={(val) => updateSettings({ im: { provider: val, telegram: tg } } as any)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="telegram">{t.telegram}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start gap-3">
          <Switch checked={enabled} onCheckedChange={(c) => updateTelegram({ enabled: c as boolean })} />
          <div className="grid gap-1.5 leading-none">
            <div className="text-sm font-medium leading-none">{t.enableTelegram}</div>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="space-y-2">
          <Label>{t.botToken}</Label>
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              value={botToken}
              onChange={(e) => updateTelegram({ botToken: e.target.value })}
              placeholder={t.botTokenHint}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? 'Hide' : 'Show'}
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="text-xs text-muted-foreground">{t.botTokenHint}</div>
        </div>

        <div className="space-y-2">
          <Label>{t.allowedUserIds}</Label>
          <Textarea
            value={allowedText}
            onChange={(e) => updateTelegram({ allowedUserIds: parseAllowed(e.target.value) })}
            placeholder="123456789"
            className="min-h-[120px]"
          />
          <div className="text-xs text-muted-foreground">{t.allowedUserIdsHint}</div>
        </div>

        <div className="flex items-start gap-3">
          <Switch checked={allowGroups} onCheckedChange={(c) => updateTelegram({ allowGroups: c as boolean })} />
          <div className="grid gap-1.5 leading-none">
            <div className="text-sm font-medium leading-none">{t.allowGroups}</div>
            <div className="text-xs text-muted-foreground">{t.allowGroupsHint}</div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t.pollingIntervalMs}</Label>
          <Input
            className="w-40"
            type="number"
            min={200}
            max={10000}
            value={pollingIntervalMs}
            onChange={(e) => updateTelegram({ pollingIntervalMs: Number(e.target.value) })}
          />
          <div className="text-xs text-muted-foreground">{t.pollingIntervalHint}</div>
        </div>

        <div className="space-y-2">
          <Label>{t.chatProvider}</Label>
          <Select
            value={telegramProviderOverrideId ? telegramProviderOverrideId : ' '}
            onValueChange={(val) => updateTelegram({ providerOverrideId: val.trim() ? val : '', modelOverride: '' } as any)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t.followDefault} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=" ">{t.followDefault}</SelectItem>
              {availableProviders.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name || p.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">{t.chatProviderHint}</div>
        </div>

        <div className="space-y-2">
          <Label>{t.chatModel}</Label>
          <Select
            value={telegramModelOverride ? telegramModelOverride : ' '}
            onValueChange={(val) => updateTelegram({ modelOverride: val.trim() ? val : '' } as any)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t.followDefault} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=" ">{t.followDefault}</SelectItem>
              {availableModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">{t.chatModelHint}</div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="text-sm font-semibold">{t.openclaw}</div>

        <div className="flex items-start gap-3">
          <Switch checked={openclawEnabled} onCheckedChange={(c) => updateOpenclaw({ enabled: c as boolean })} />
          <div className="grid gap-1.5 leading-none">
            <div className="text-sm font-medium leading-none">{t.enableOpenclaw}</div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Switch checked={heartbeatEnabled} onCheckedChange={(c) => updateOpenclaw({ heartbeatEnabled: c as boolean })} />
          <div className="grid gap-1.5 leading-none">
            <div className="text-sm font-medium leading-none">{t.enableHeartbeat}</div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t.heartbeatChatId}</Label>
          <Input
            value={heartbeatTelegramChatId}
            onChange={(e) => updateOpenclaw({ heartbeatTelegramChatId: e.target.value })}
            placeholder="123456789"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="text-xs text-muted-foreground">{t.heartbeatChatIdHint}</div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="text-sm font-semibold">{t.workspaceDir}</div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={workspaceDir}
              onChange={(e) => updateSettings({ workspaceDir: e.target.value })}
              placeholder="/path/to/workspace"
              autoComplete="off"
              spellCheck={false}
            />
            <Button variant="outline" size="sm" onClick={() => void handlePickWorkspaceDir()}>
              {t.selectFolder}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">{t.workspaceDirHint}</div>
        </div>
      </Card>
    </div>
  )
}

function SkillsSettings() {
  const { settings: settings0, updateSettings } = useStore()
  const settings = settings0!
  const [dir, setDir] = useState('')
  const [skills, setSkills] = useState<
    Array<{
      id: string
      name: string
      description: string
      dir: string
      file: string
      updatedAt: number
      isValid?: boolean
      errors?: string[]
    }>
  >([])
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'error'; text?: string }>({ type: 'idle' })

  const t = (() => {
    const dict = {
      en: {
        notFound: 'No skills found',
        found: (n: number) => `${n} skills`,
        refresh: 'Refresh',
        openFolder: 'Open folder',
        emptyTitle: 'No skills installed',
        emptyHint: (p: string) => `Place folders containing SKILL.md into ${p} to add skills.`,
        enabled: 'Enabled',
        disabled: 'Disabled',
        followChatDefaults: 'Follows Chat → Default skill selection.'
      },
      zh: {
        notFound: '未找到技能',
        found: (n: number) => `已找到 ${n} 个技能`,
        refresh: '刷新',
        openFolder: '打开文件夹',
        emptyTitle: '尚未安装技能',
        emptyHint: (p: string) => `将包含 SKILL.md 的文件夹放入 ${p} 来添加技能`,
        enabled: '已启用',
        disabled: '未启用',
        followChatDefaults: '遵循「聊天 → 默认技能选择」。'
      },
      ja: {
        notFound: 'スキルが見つかりません',
        found: (n: number) => `${n} 件`,
        refresh: '更新',
        openFolder: 'フォルダーを開く',
        emptyTitle: 'スキル未インストール',
        emptyHint: (p: string) => `SKILL.md を含むフォルダーを ${p} に置いて追加します。`,
        enabled: '有効',
        disabled: '無効',
        followChatDefaults: 'チャット → 既定スキル選択に従います。'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const displayPath = useMemo(() => {
    if (dir) return dir
    return joinPath('~', '.config', 'anima', 'skills')
  }, [dir])

  const refresh = useCallback(async () => {
    setStatus({ type: 'loading' })
    try {
      const res = await fetchBackendJson<{
        ok: boolean
        dir?: string
        skills?: Array<{
          id: string
          name: string
          description: string
          dir: string
          file: string
          updatedAt: number
          isValid?: boolean
          errors?: string[]
        }>
      }>('/skills/list', { method: 'GET' })
      if (!res?.ok) {
        setStatus({ type: 'error', text: 'Failed' })
        return
      }
      setDir(res.dir || '')
      const nextSkills = Array.isArray(res.skills) ? res.skills : []
      setSkills(nextSkills)
      setStatus({ type: 'ok' })
      const curSettings = useStore.getState().settings
      const current = Array.isArray(curSettings?.skillsEnabledIds) ? curSettings.skillsEnabledIds : []
      const valid = new Set(nextSkills.filter((s) => s.isValid !== false).map((s) => s.id))
      const next = current.filter((id) => valid.has(id))
      if (next.length !== current.length) {
        updateSettings({ skillsEnabledIds: next })
      }
    } catch (e: any) {
      setStatus({ type: 'error', text: e?.message || 'Failed' })
    }
  }, [updateSettings])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openFolder = async () => {
    await fetchBackendJson('/skills/openDir', { method: 'POST' })
    await refresh()
  }

  const enabledIds = useMemo(() => {
    const arr = Array.isArray(settings.skillsEnabledIds) ? settings.skillsEnabledIds : []
    return new Set(arr)
  }, [settings])

  const toggleEnabled = (id: string, enabled: boolean) => {
    const arr = Array.isArray(settings.skillsEnabledIds) ? settings.skillsEnabledIds : []
    const next = enabled ? Array.from(new Set([...arr, id])) : arr.filter((x) => x !== id)
    updateSettings({ skillsEnabledIds: next })
  }

  return (
      <div className="p-6 h-full overflow-hidden flex flex-col">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{skills.length === 0 ? t.notFound : t.found(skills.length)}</div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void refresh()}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${status.type === 'loading' ? 'animate-spin' : ''}`} />
            {t.refresh}
          </Button>
          <Button
            variant="outline"
            onClick={() => void openFolder()}
            className="gap-2"
          >
            <FolderOpen className="w-4 h-4" />
            {t.openFolder}
          </Button>
        </div>
      </div>

      {skills.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-20 h-20 rounded-full bg-white border border-border shadow-sm flex items-center justify-center">
              <Sparkles className="w-9 h-9 text-muted-foreground" />
            </div>
            <div className="text-sm font-semibold text-foreground">{t.emptyTitle}</div>
            <div className="text-xs text-muted-foreground max-w-[520px] leading-5">{t.emptyHint(displayPath)}</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto mt-4 space-y-3 custom-scrollbar pr-1">
          <div className="text-xs text-muted-foreground">{t.followChatDefaults}</div>
          {skills
            .slice()
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .map((s) => {
              const isEnabled = enabledIds.has(s.id)
              return (
                <Card key={s.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold">{s.name}</div>
                      {s.description ? <div className="text-xs text-muted-foreground">{s.description}</div> : null}
                      {s.isValid === false ? (
                        <div className="text-xs text-destructive">
                          {Array.isArray(s.errors) && s.errors.length ? s.errors.join(', ') : 'invalid'}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={isEnabled}
                        disabled={s.isValid === false}
                        onCheckedChange={(c) => toggleEnabled(s.id, c)}
                      />
                      <span className="text-sm">{isEnabled ? t.enabled : t.disabled}</span>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground break-all">{s.dir}</div>
                </Card>
              )
            })}
        </div>
      )}
    </div>
  )
}

function joinPath(...parts: string[]) {
  return parts.join('/').replace(/\/+/g, '/')
}

function MemorySettings() {
  const { settings: settings0, updateSettings, addMemory, updateMemory, deleteMemory, providers: providers0 } = useStore()
  const settings = settings0!
  const providers = providers0 ?? EMPTY_PROVIDERS
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const t = (() => {
    const dict = {
      en: {
        feature: 'Memory',
        featureDesc: 'Store persistent facts and preferences for future chats.',
        enableMemory: 'Enable memory',
        retrieval: 'Memory retrieval',
        enableRetrieval: 'Enable retrieval',
        maxRetrieve: 'Max retrieved memories',
        similarity: 'Similarity threshold',
        summary: 'Memory summary',
        enableSummary: 'Auto summarize',
        toolModel: 'Memory tool model',
        toolModelHint: 'Used for memory-related tasks such as summarization.',
        followChatModel: 'Follow chat model',
        embedding: 'Embedding model',
        embeddingHint: 'Used to convert text to vectors for retrieval.',
        stats: 'Stats',
        total: 'Total',
        enabled: 'Enabled',
        disabled: 'Disabled',
        addMemory: 'Add memory',
        add: 'Add',
        addPlaceholder: 'Add a memory item…',
        searchMemory: 'Search memory',
        searchPlaceholder: 'Search memories…',
        memoryList: 'Memory list',
        clearAll: 'Clear all',
        empty: 'No memories yet.'
      },
      zh: {
        feature: '记忆功能',
        featureDesc: '保存长期偏好与事实，用于后续对话。',
        enableMemory: '启用记忆',
        retrieval: '记忆检索',
        enableRetrieval: '启用检索',
        maxRetrieve: '最大检索记忆',
        similarity: '相似度阈值',
        summary: '记忆总结',
        enableSummary: '自动总结',
        toolModel: '记忆工具模型',
        toolModelHint: '用于总结等记忆相关任务。',
        followChatModel: '跟随聊天模型',
        embedding: '嵌入模型',
        embeddingHint: '用于将文本转换为向量，以支持检索。',
        stats: '统计',
        total: '记忆数量',
        enabled: '启用数量',
        disabled: '停用数量',
        addMemory: '添加记忆',
        add: '添加',
        addPlaceholder: '写下你想长期记住的内容…',
        searchMemory: '搜索记忆',
        searchPlaceholder: '输入关键词搜索…',
        memoryList: '记忆列表',
        clearAll: '全部清空',
        empty: '暂无记忆内容。'
      },
      ja: {
        feature: 'メモリー',
        featureDesc: '今後のチャットのために事実や好みを保存します。',
        enableMemory: '有効化',
        retrieval: 'メモリー検索',
        enableRetrieval: '検索を有効化',
        maxRetrieve: '最大取得数',
        similarity: '類似度しきい値',
        summary: 'メモリー要約',
        enableSummary: '自動要約',
        toolModel: 'メモリーツールモデル',
        toolModelHint: '要約などメモリー関連タスクに使用します。',
        followChatModel: 'チャットモデルに従う',
        embedding: '埋め込みモデル',
        embeddingHint: '検索のためにテキストをベクトル化します。',
        stats: '統計',
        total: '合計',
        enabled: '有効',
        disabled: '無効',
        addMemory: '追加',
        add: '追加',
        addPlaceholder: 'メモリーを追加…',
        searchMemory: '検索',
        searchPlaceholder: 'キーワードで検索…',
        memoryList: '一覧',
        clearAll: '全て削除',
        empty: 'メモリーはまだありません。'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const stats = useMemo(() => {
    const total = settings.memories.length
    const enabled = settings.memories.filter((m) => m.isEnabled).length
    return { total, enabled, disabled: total - enabled }
  }, [settings.memories])

  const availableModels = useMemo(() => {
    const models = providers
      .filter((p) => p.isEnabled && Boolean((p as any)?.config?.modelsFetched))
      .flatMap((p) => {
        if (!Array.isArray(p.config.models)) return []
        return p.config.models.map((m: any) => (typeof m === 'string' ? m : m.id))
      })
      .filter(Boolean)
    return Array.from(new Set(models)).sort()
  }, [providers])

  const filteredMemories = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return settings.memories
    return settings.memories.filter((m) => m.content.toLowerCase().includes(q))
  }, [query, settings.memories])

  const thresholdPercent = Math.round(Math.min(1, Math.max(0, settings.memorySimilarityThreshold || 0)) * 100)

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <div className="text-sm font-semibold">{t.feature}</div>
            <div className="text-xs text-muted-foreground">{t.featureDesc}</div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={settings.memoryEnabled}
              onCheckedChange={(c) => updateSettings({ memoryEnabled: c })}
            />
            <Label>{t.enableMemory}</Label>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <div className="text-sm font-semibold">{t.retrieval}</div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={settings.memoryRetrievalEnabled}
              onCheckedChange={(c) => updateSettings({ memoryRetrievalEnabled: c })}
            />
            <Label>{t.enableRetrieval}</Label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t.maxRetrieve}</Label>
            <Input
              type="number"
              min={0}
              value={settings.memoryMaxRetrieveCount}
              onChange={(e) => updateSettings({ memoryMaxRetrieveCount: Math.max(0, Number(e.target.value || 0)) })}
            />
          </div>

          <div className="space-y-2">
            <Label>
              {t.similarity} {thresholdPercent}%
            </Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={thresholdPercent}
              onChange={(e) => updateSettings({ memorySimilarityThreshold: Math.min(1, Math.max(0, Number(e.target.value || 0) / 100)) })}
            />
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="text-sm font-semibold">{t.summary}</div>
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t.enableSummary}</span>
          </div>
          <Switch
            checked={settings.memoryAutoSummarizeEnabled}
            onCheckedChange={(c) => updateSettings({ memoryAutoSummarizeEnabled: c })}
          />
        </div>
      </Card>

      <Card className="p-5 space-y-2">
        <div className="text-sm font-semibold">{t.toolModel}</div>
        <div className="space-y-2">
          <Select
            value={settings.memoryToolModelId}
            onValueChange={(val) => updateSettings({ memoryToolModelId: val })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t.followChatModel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=" ">{t.followChatModel}</SelectItem>
              {availableModels.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">{t.toolModelHint}</div>
        </div>
      </Card>

      <Card className="p-5 space-y-2">
        <div className="text-sm font-semibold">{t.embedding}</div>
        <div className="space-y-2">
          <Input
            list="anima-embedding-models"
            value={settings.memoryEmbeddingModelId}
            onChange={(e) => updateSettings({ memoryEmbeddingModelId: e.target.value })}
          />
          <datalist id="anima-embedding-models">
            <option value="text-embedding-3-small" />
            <option value="text-embedding-3-large" />
            <option value="text-embedding-ada-002" />
          </datalist>
          <div className="text-xs text-muted-foreground">{t.embeddingHint}</div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-sm font-semibold">{t.stats}</div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <div className="text-xs text-muted-foreground">{t.total}</div>
            <div className="text-xl font-semibold">{stats.total}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <div className="text-xs text-muted-foreground">{t.enabled}</div>
            <div className="text-xl font-semibold">{stats.enabled}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <div className="text-xs text-muted-foreground">{t.disabled}</div>
            <div className="text-xl font-semibold">{stats.disabled}</div>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-sm font-semibold">{t.addMemory}</div>
        <Textarea
          className="min-h-[100px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.addPlaceholder}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => {
              const content = draft.trim()
              if (!content) return
              addMemory(content)
              setDraft('')
            }}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            {t.add}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-sm font-semibold">{t.searchMemory}</div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
          />
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">{t.memoryList}</div>
          <Button
            variant="outline"
            onClick={() => updateSettings({ memories: [] })}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            {t.clearAll}
          </Button>
        </div>

        <div className="space-y-2">
          {filteredMemories.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t.empty}</div>
          ) : (
            filteredMemories.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <Checkbox
                  checked={m.isEnabled}
                  onCheckedChange={(c) => updateMemory(m.id, { isEnabled: c as boolean })}
                />
                <Input
                  className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 px-0 h-auto py-0"
                  value={m.content}
                  onChange={(e) => updateMemory(m.id, { content: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMemory(m.id)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}

function DataSettings() {
  const { settings: settings0, loadRemoteConfig } = useStore()
  const settings = settings0!
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importStatus, setImportStatus] = useState<{ type: 'idle' | 'ok' | 'error'; text?: string }>({ type: 'idle' })
  const [dbPath, setDbPath] = useState('')

  useEffect(() => {
    let mounted = true
    void fetchBackendJson<{ path: string }>('/api/db/path')
      .then((res) => {
        if (!mounted) return
        setDbPath(String(res?.path || ''))
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  const downloadJson = useCallback(async () => {
    const exported = await fetchBackendJson<any>('/api/db/export', { method: 'GET' })
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `anima-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const onImportFile = async (file: File) => {
    setImportStatus({ type: 'idle' })
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data || typeof data !== 'object') throw new Error('Invalid JSON')
      await fetchBackendJson('/api/db/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      await loadRemoteConfig()
      await useStore.getState().initApp()
      setImportStatus({ type: 'ok', text: t.importOk })
    } catch (e: any) {
      setImportStatus({ type: 'error', text: e?.message || t.importFailed })
    }
  }

  const clearAll = async () => {
    await fetchBackendJson('/api/db/clear', { method: 'POST' })
    await loadRemoteConfig()
    await useStore.getState().initApp()
  }

  const t = (() => {
    const dict = {
      en: {
        dbPath: 'Database',
        dbPathHint: 'Current SQLite database path.',
        export: 'Export',
        exportHint: 'Exports settings, providers (without API keys), and chat history.',
        exportJson: 'Export JSON',
        import: 'Import',
        importHint: 'Imports settings, providers, and chat history from a JSON file.',
        importJson: 'Import JSON',
        importOk: 'Import completed.',
        importFailed: 'Import failed.',
        danger: 'Danger Zone',
        dangerHint: 'Clears chat history, memory, and deletes stored API keys.',
        clearAll: 'Clear All Data'
      },
      zh: {
        dbPath: '数据库',
        dbPathHint: '当前 SQLite 数据库路径。',
        export: '导出',
        exportHint: '导出设置、提供商（不含 API Key）与聊天记录。',
        exportJson: '导出 JSON',
        import: '导入',
        importHint: '从 JSON 导入设置、提供商与聊天记录。',
        importJson: '导入 JSON',
        importOk: '导入完成。',
        importFailed: '导入失败。',
        danger: '危险区域',
        dangerHint: '清空聊天记录、记忆，并删除已保存的 API Key。',
        clearAll: '清空所有数据'
      },
      ja: {
        dbPath: 'データベース',
        dbPathHint: '現在の SQLite データベースパス。',
        export: 'エクスポート',
        exportHint: '設定・プロバイダー（API Key除外）・履歴を出力します。',
        exportJson: 'JSON出力',
        import: 'インポート',
        importHint: 'JSON から設定・プロバイダー・履歴を読み込みます。',
        importJson: 'JSON読込',
        importOk: 'インポート完了。',
        importFailed: 'インポート失敗。',
        danger: '危険',
        dangerHint: '履歴・メモリー・保存済み API Key を削除します。',
        clearAll: '全データ削除'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold">{t.dbPath}</h3>
        <p className="text-sm text-muted-foreground">{t.dbPathHint}</p>
        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground break-all">
          {dbPath || '-'}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold">{t.export}</h3>
        <p className="text-sm text-muted-foreground">{t.exportHint}</p>
        <Button
          onClick={() => void downloadJson()}
          className="gap-2"
        >
          {t.exportJson}
        </Button>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold">{t.import}</h3>
        <p className="text-sm text-muted-foreground">{t.importHint}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onImportFile(f)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            {t.importJson}
          </Button>
          {importStatus.type === 'ok' && (
            <div className="inline-flex items-center gap-1 text-xs text-green-500">
              <CheckCircle2 className="w-4 h-4" />
              {importStatus.text}
            </div>
          )}
          {importStatus.type === 'error' && (
            <div className="inline-flex items-center gap-1 text-xs text-destructive">
              <XCircle className="w-4 h-4" />
              {importStatus.text}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5 space-y-3 border-destructive/20">
        <h3 className="text-sm font-semibold text-destructive">{t.danger}</h3>
        <p className="text-sm text-muted-foreground">{t.dangerHint}</p>
        <Button
          variant="destructive"
          onClick={() => void clearAll()}
          className="gap-2"
        >
          <Trash2 className="w-4 h-4" />
          {t.clearAll}
        </Button>
      </Card>
    </div>
  )
}
