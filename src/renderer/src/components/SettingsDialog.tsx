import { 
  Settings, MessageSquare, Database, Globe, 
  Cpu, Search, Plus, Trash2, CheckCircle2, XCircle, RefreshCw,
  Copy, ChevronDown, ChevronRight, ChevronLeft, Eye, EyeOff, ExternalLink, Wand2, FolderOpen, Sparkles, Mic, Info, Keyboard, X, Bell, Clock3, Play
} from 'lucide-react'
import { resolveBackendBaseUrl, useStore, type Provider, type ProviderModel, type VoiceModelEntry } from '../store/useStore'
import { THEMES, ThemeColor } from '../lib/themes'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { SHORTCUTS, isMacLike, type ShortcutId, normalizeBinding, bindingId, formatBindingParts } from '@/lib/shortcuts'
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
import { AppShellLeftPane } from '@/components/layout/AppShellLeftPane'

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
  onOpenChange,
  initialMode
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMode?: 'api' | 'acp'
}) {
  const addProvider = useStore(s => s.addProvider)
  const settings = useStore(s => s.settings)
  const [providerMode, setProviderMode] = useState<'api' | 'acp'>(initialMode || 'api')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiFormat, setApiFormat] = useState('chat_completions')
  const [useMaxCompletionTokens, setUseMaxCompletionTokens] = useState(false)
  const [acpKind, setAcpKind] = useState<'native_acp' | 'adapter' | 'acpx_bridge'>('native_acp')
  const [acpCommand, setAcpCommand] = useState('')
  const [acpArgs, setAcpArgs] = useState('')
  const [acpFraming, setAcpFraming] = useState<'auto' | 'jsonl' | 'content_length'>('jsonl')
  const [acpApprovalMode, setAcpApprovalMode] = useState<'per_action' | 'per_project' | 'always'>('per_action')
  const [acpEnv, setAcpEnv] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const t = (() => {
    const dict = {
      en: {
        title: 'Add Custom Provider',
        providerType: 'Provider Type',
        apiProvider: 'API Provider',
        acpProvider: 'ACP Provider',
        providerName: 'Provider Name',
        providerNamePlaceholder: 'My Custom Provider',
        baseUrl: 'Base URL',
        apiKey: 'API Key',
        apiFormat: 'API Format',
        apiFormatHint: 'Choose the API endpoint format your provider uses',
        useMaxCompletionTokens: 'Use max_completion_tokens',
        useMaxCompletionTokensHint: 'Enable for newer OpenAI models (o1, o3, etc.) that require max_completion_tokens instead of max_tokens',
        command: 'Command',
        args: 'Args',
        kind: 'Kind',
        framing: 'Framing',
        approvalMode: 'Approval Mode',
        defaultModel: 'Default Model',
        env: 'Env (KEY=VALUE)',
        cancel: 'Cancel',
        addProvider: 'Add Provider'
      },
      zh: {
        title: '添加自定义 Provider',
        providerType: 'Provider 类型',
        apiProvider: 'API Provider',
        acpProvider: 'ACP Provider',
        providerName: 'Provider 名称',
        providerNamePlaceholder: '我的自定义 Provider',
        baseUrl: 'Base URL',
        apiKey: 'API Key',
        apiFormat: 'API 格式',
        apiFormatHint: '选择该 Provider 使用的 API 端点格式',
        useMaxCompletionTokens: '使用 max_completion_tokens',
        useMaxCompletionTokensHint: '新版本 OpenAI 模型（o1、o3 等）需使用 max_completion_tokens 替代 max_tokens',
        command: '命令',
        args: '参数',
        kind: '类型',
        framing: '分帧',
        approvalMode: '审批模式',
        defaultModel: '默认模型',
        env: '环境变量（KEY=VALUE）',
        cancel: '取消',
        addProvider: '添加 Provider'
      },
      ja: {
        title: 'カスタム Provider を追加',
        providerType: 'Provider タイプ',
        apiProvider: 'API Provider',
        acpProvider: 'ACP Provider',
        providerName: 'Provider 名',
        providerNamePlaceholder: 'カスタム Provider',
        baseUrl: 'Base URL',
        apiKey: 'API Key',
        apiFormat: 'API 形式',
        apiFormatHint: 'この Provider が使う API エンドポイント形式を選択します',
        useMaxCompletionTokens: 'max_completion_tokens を使用',
        useMaxCompletionTokensHint: '新しい OpenAI モデル（o1、o3 など）では max_tokens ではなく max_completion_tokens が必要です',
        command: 'コマンド',
        args: '引数',
        kind: '種別',
        framing: 'フレーミング',
        approvalMode: '承認モード',
        defaultModel: 'デフォルトモデル',
        env: '環境変数（KEY=VALUE）',
        cancel: 'キャンセル',
        addProvider: 'Provider を追加'
      }
    } as const
    const lang = (settings?.language || 'en') as keyof typeof dict
    return dict[lang] || dict.en
  })()

  useEffect(() => {
    if (open) {
      setProviderMode(initialMode || 'api')
      setName('')
      setBaseUrl('')
      setApiKey('')
      setApiFormat('chat_completions')
      setUseMaxCompletionTokens(false)
      setAcpKind('native_acp')
      setAcpCommand('')
      setAcpArgs('')
      setAcpFraming('jsonl')
      setAcpApprovalMode('per_action')
      setAcpEnv('')
      setDefaultModel('')
    }
  }, [open, initialMode])

  const handleAdd = () => {
    if (!name.trim()) return
    if (providerMode === 'api') {
      if (!baseUrl.trim()) return
      try {
        new URL(baseUrl.trim())
      } catch {
        return
      }
      addProvider({
        name: name.trim(),
        type: 'openai_compatible',
        isEnabled: true,
        config: {
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          models: [],
          apiFormat,
          useMaxCompletionTokens
        }
      })
    } else {
      if (!acpCommand.trim()) return
      const env: Record<string, string> = {}
      for (const line of acpEnv.split(/\r?\n/)) {
        const raw = String(line || '').trim()
        if (!raw) continue
        const idx = raw.indexOf('=')
        if (idx <= 0) continue
        env[raw.slice(0, idx).trim()] = raw.slice(idx + 1)
      }
      const modelId = String(defaultModel || name).trim()
      addProvider({
        name: name.trim(),
        type: 'acp',
        isEnabled: true,
        config: {
          models: [{ id: modelId, isEnabled: true, config: { id: modelId } }],
          selectedModel: modelId,
          acp: {
            kind: acpKind,
            command: acpCommand.trim(),
            args: String(acpArgs || '').trim() ? String(acpArgs || '').trim().split(/\s+/) : [],
            env,
            framing: acpFraming,
            approvalMode: acpApprovalMode
          }
        }
      })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4 overflow-y-auto pr-1 custom-scrollbar">
          <div className="grid gap-2">
            <Label>{t.providerType}</Label>
            <Select value={providerMode} onValueChange={(v) => setProviderMode(v as 'api' | 'acp')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api">{t.apiProvider}</SelectItem>
                <SelectItem value="acp">{t.acpProvider}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>{t.providerName}</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t.providerNamePlaceholder}
            />
          </div>
          {providerMode === 'api' ? (
            <>
              <div className="grid gap-2">
                <Label>{t.baseUrl}</Label>
                <Input
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>
              <div className="grid gap-2">
                <Label>{t.apiKey}</Label>
                <Input
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="your-api-key"
                  type="text" 
                />
              </div>
              <div className="grid gap-2">
                <Label>{t.apiFormat}</Label>
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
                  {t.apiFormatHint}
                </p>
              </div>
              <div className="flex items-center justify-between space-x-2">
                <div className="flex flex-col space-y-1">
                  <Label>{t.useMaxCompletionTokens}</Label>
                  <p className="text-[0.8rem] text-muted-foreground max-w-[350px]">
                    {t.useMaxCompletionTokensHint}
                  </p>
                </div>
                <Switch
                  checked={useMaxCompletionTokens}
                  onCheckedChange={setUseMaxCompletionTokens}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label>{t.command}</Label>
                <Input value={acpCommand} onChange={e => setAcpCommand(e.target.value)} placeholder="codex-acp" />
              </div>
              <div className="grid gap-2">
                <Label>{t.args}</Label>
                <Input value={acpArgs} onChange={e => setAcpArgs(e.target.value)} placeholder="--flag value" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>{t.kind}</Label>
                  <Select value={acpKind} onValueChange={v => setAcpKind(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="native_acp">native_acp</SelectItem>
                      <SelectItem value="adapter">adapter</SelectItem>
                      <SelectItem value="acpx_bridge">acpx_bridge</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>{t.framing}</Label>
                  <Select value={acpFraming} onValueChange={v => setAcpFraming(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">auto</SelectItem>
                      <SelectItem value="jsonl">jsonl</SelectItem>
                      <SelectItem value="content_length">content_length</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>{t.approvalMode}</Label>
                <Select value={acpApprovalMode} onValueChange={v => setAcpApprovalMode(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_action">per_action</SelectItem>
                    <SelectItem value="per_project">per_project</SelectItem>
                    <SelectItem value="always">always</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t.defaultModel}</Label>
                <Input value={defaultModel} onChange={e => setDefaultModel(e.target.value)} placeholder="codex-acp" />
              </div>
              <div className="grid gap-2">
                <Label>{t.env}</Label>
                <Textarea value={acpEnv} onChange={e => setAcpEnv(e.target.value)} rows={4} className="font-mono text-xs" />
              </div>
            </>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.cancel}</Button>
          <Button onClick={handleAdd}>{t.addProvider}</Button>
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
  const [catalogModels, setCatalogModels] = useState<
    Array<{ id: string; name: string; desc?: any; badges?: any; capabilities?: any; sizeBytes?: number | null }>
  >([])
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
          fetchBackendJson<{
            ok: boolean
            models?: Array<{ id: string; name: string; desc?: any; badges?: any; capabilities?: any; sizeBytes?: number | null }>
          }>('/voice/models/catalog', {
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
              desc: (m as any)?.desc,
              badges: (m as any)?.badges,
              capabilities: (m as any)?.capabilities,
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

  const modelMetaById = useMemo(() => {
    const dict: Record<
      string,
      { desc?: { zh?: string; en?: string }; badges?: { zh?: string[]; en?: string[] }; capabilities?: any; name?: string }
    > = {}
    for (const m of catalogModels) {
      const id = String((m as any)?.id || '').trim()
      if (!id) continue
      const d = (m as any)?.desc
      const b = (m as any)?.badges
      dict[id] = {
        name: String((m as any)?.name || '').trim() || undefined,
        desc:
          d && typeof d === 'object'
            ? { zh: typeof d.zh === 'string' ? d.zh : undefined, en: typeof d.en === 'string' ? d.en : undefined }
            : undefined,
        badges:
          b && typeof b === 'object'
            ? {
                zh: Array.isArray(b.zh) ? b.zh.map((x: any) => String(x || '').trim()).filter(Boolean) : undefined,
                en: Array.isArray(b.en) ? b.en.map((x: any) => String(x || '').trim()).filter(Boolean) : undefined
              }
            : undefined,
        capabilities: (m as any)?.capabilities
      }
    }
    return dict
  }, [catalogModels])

  const lang = String(settings?.language || 'en')
  const pickModelDesc = (id: string) => {
    const meta = modelMetaById[String(id || '').trim()]
    const d = meta?.desc
    if (!d) return ''
    if (lang === 'zh') return String(d.zh || d.en || '').trim()
    if (lang === 'ja') return String(d.en || d.zh || '').trim()
    return String(d.en || d.zh || '').trim()
  }
  const pickModelBadges = (id: string) => {
    const meta = modelMetaById[String(id || '').trim()]
    const b = meta?.badges
    if (!b) return [] as string[]
    if (lang === 'zh') return Array.isArray(b.zh) && b.zh.length ? b.zh : Array.isArray(b.en) ? b.en : []
    if (lang === 'ja') return Array.isArray(b.en) && b.en.length ? b.en : Array.isArray(b.zh) ? b.zh : []
    return Array.isArray(b.en) && b.en.length ? b.en : Array.isArray(b.zh) ? b.zh : []
  }
  const pickModelLangLine = (id: string) => {
    const meta = modelMetaById[String(id || '').trim()]
    const cap = meta?.capabilities
    const supported = String(cap?.supportedLanguages || '').trim()
    const opts = Array.isArray(cap?.uiLanguageOptions) ? cap.uiLanguageOptions.map((x: any) => String(x || '').trim()).filter(Boolean) : []
    const multi = cap?.multilingual === true
    if (!multi && !opts.length) return ''
    if (lang === 'zh') {
      const head = `语言：${multi ? '多语言' : ''}${supported ? `（${supported}）` : ''}`
      const tail = opts.length ? `；界面可选：${opts.join('/')}` : ''
      return `${head}${tail}`
    }
    const head = `Languages: ${multi ? 'multilingual' : ''}${supported ? ` (${supported})` : ''}`
    const tail = opts.length ? `; UI options: ${opts.join('/')}` : ''
    return `${head}${tail}`
  }
  const formatModelName = (id: string, fallbackName: string) => {
    const name = String(modelMetaById[String(id || '').trim()]?.name || fallbackName || '').trim() || id
    const badges = pickModelBadges(id).slice(0, 3)
    if (!badges.length) return name
    return `${name} · ${badges.join(' · ')}`
  }

  if (!settings) return null

  return (
    <div className="p-6 space-y-6">
       <Card>
          <CardContent className="pt-6">
             <div className="flex items-center justify-between">
                <div className="space-y-1">
                   <div className="font-medium">{vt.enable}</div>
                   <div className="text-[13px] text-muted-foreground">{vt.enableHint}</div>
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
                          {formatModelName(m.id, m.name || m.id)}
                        </SelectItem>
                      ))}
                   </SelectContent>
                </Select>
                <p className="text-[13px] text-muted-foreground">{vt.modelDesc}</p>
                {selectedModelId ? (
                  <div className="text-xs text-muted-foreground">
                    {pickModelLangLine(selectedModelId)}
                  </div>
                ) : null}
                {!selectedModelId ? (
                  <div className="text-[13px] text-muted-foreground">{vt.downloadHint}</div>
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
                <p className="text-[13px] text-muted-foreground">{vt.langHint}</p>
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
           <p className="text-[13px] text-muted-foreground">{vt.modelDesc}</p>
           <div className="text-[13px] text-muted-foreground">
             {lang === 'zh'
               ? '建议：一般场景选 Medium；在噪声大/口音重时选 Large；设备性能较弱选 Small/Base；仅试用选 Tiny。'
               : 'Suggestion: Medium for most cases; Large for noisy speech; Small/Base for low-end devices; Tiny for quick trials.'}
           </div>
           <div className="space-y-2">
             {catalogStatus === 'loading' ? (
               <div className="text-[13px] text-muted-foreground">加载中…</div>
             ) : null}
             {catalogStatus === 'error' ? (
               <div className="text-[13px] text-destructive">加载失败</div>
             ) : null}
             {catalogModels.map((m) => {
               const isInstalled = installedIds.has(m.id)
               const dl = downloadByModelId[m.id]
              const isDownloading = dl?.status === 'starting' || dl?.status === 'running' || dl?.status === 'canceling'
               const isError = dl?.status === 'error'
              const isDone = dl?.status === 'done'
              const isCanceled = dl?.status === 'canceled'
              const desc = pickModelDesc(m.id)
              const badges = pickModelBadges(m.id).slice(0, 3)
              const langLine = pickModelLangLine(m.id)
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
                      <div className="text-[13px] font-medium truncate flex items-center gap-2">
                        <span className="truncate">{m.name}</span>
                        {badges.length ? (
                          <span className="flex items-center gap-1 shrink-0">
                            {badges.map((b) => (
                              <Badge key={b} variant="secondary" className="text-[10px] font-normal px-1.5 py-0.5">
                                {b}
                              </Badge>
                            ))}
                          </span>
                        ) : null}
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
                      {desc ? <div className="text-xs text-muted-foreground mt-1">{desc}</div> : null}
                      {langLine ? <div className="text-xs text-muted-foreground mt-1">{langLine}</div> : null}
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
               <div className="text-[13px] text-muted-foreground">未添加本地模型</div>
             ) : null}
             {localModels.map((m) => (
               <div key={m.id} className="flex items-center justify-between gap-3 border rounded-md px-3 py-2">
                 <div className="min-w-0">
                   <div className="text-[13px] font-medium truncate">{m.name || m.id}</div>
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

function TtsSettings({ t }: { t: any }) {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const [isTesting, setIsTesting] = useState(false)
  const tts = ((settings as any)?.tts || {
    enabled: false,
    provider: 'macos_say',
    model: 'Samantha',
    endpoint: '',
    apiKey: '',
    qwenModel: 'qwen3-tts-flash',
    qwenLanguageType: 'Auto',
    qwenMode: 'endpoint',
    qwenLocalModelId: 'qwen3-tts-flash',
    qwenLocalEndpoint: 'http://127.0.0.1:8000/v1/audio/speech',
    qwenLocalModelsInstalled: [],
    speed: 1,
    pitch: 1,
    volume: 1,
    autoPlay: false,
    testText: '你好，这是一段本地 TTS 试听文本。',
    localModels: []
  }) as any

  const lang = String(settings?.language || 'en')
  const tx = {
    en: {
      title: 'TTS',
      desc: 'Configure local text-to-speech provider and model.',
      enabled: 'Enable TTS',
      provider: 'Provider',
      model: 'Model / Voice',
      qwenModel: 'Qwen Model',
      qwenLanguageType: 'Qwen Language',
      qwenMode: 'Qwen Mode',
      qwenModeLocal: 'Local Managed',
      qwenModeEndpoint: 'Endpoint',
      qwenLocalModel: 'Local Model',
      qwenDownload: 'Download Model',
      qwenDownloaded: 'Installed',
      qwenDownloading: 'Downloading…',
      qwenServiceStatus: 'Local service status',
      qwenServiceRunning: 'Running',
      qwenServiceStopped: 'Stopped',
      qwenRefresh: 'Refresh',
      endpoint: 'Endpoint',
      apiKey: 'API Key (Optional)',
      speed: 'Speed',
      pitch: 'Pitch',
      volume: 'Volume',
      autoPlay: 'Auto play after response',
      testText: 'Test text',
      testPlay: 'Play Test',
      localModels: 'Local model files',
      addLocal: 'Add local model path',
      remove: 'Remove',
      hint: 'macOS `say` needs no download. Piper/Kokoro require local model files.'
    },
    zh: {
      title: 'TTS',
      desc: '配置本地文本转语音（TTS）服务商和模型。',
      enabled: '启用 TTS',
      provider: '服务商',
      model: '模型 / 音色',
      qwenModel: 'Qwen 模型',
      qwenLanguageType: 'Qwen 语言',
      qwenMode: 'Qwen 模式',
      qwenModeLocal: '本地托管',
      qwenModeEndpoint: 'Endpoint',
      qwenLocalModel: '本地模型',
      qwenDownload: '下载模型',
      qwenDownloaded: '已安装',
      qwenDownloading: '下载中…',
      qwenServiceStatus: '本地服务状态',
      qwenServiceRunning: '运行中',
      qwenServiceStopped: '未运行',
      qwenRefresh: '刷新',
      endpoint: '服务地址',
      apiKey: 'API Key（可选）',
      speed: '语速',
      pitch: '音高',
      volume: '音量',
      autoPlay: '回复后自动播放',
      testText: '试听文本',
      testPlay: '试听',
      localModels: '本地模型文件',
      addLocal: '添加本地模型路径',
      remove: '删除',
      hint: 'macOS `say` 无需下载。Piper/Kokoro 需要本地模型文件。'
    },
    ja: {
      title: 'TTS',
      desc: 'ローカル TTS のプロバイダーとモデルを設定します。',
      enabled: 'TTS を有効化',
      provider: 'プロバイダー',
      model: 'モデル / 音声',
      qwenModel: 'Qwen モデル',
      qwenLanguageType: 'Qwen 言語',
      qwenMode: 'Qwen モード',
      qwenModeLocal: 'ローカル管理',
      qwenModeEndpoint: 'Endpoint',
      qwenLocalModel: 'ローカルモデル',
      qwenDownload: 'モデルをダウンロード',
      qwenDownloaded: 'インストール済み',
      qwenDownloading: 'ダウンロード中…',
      qwenServiceStatus: 'ローカルサービス状態',
      qwenServiceRunning: '稼働中',
      qwenServiceStopped: '停止中',
      qwenRefresh: '更新',
      endpoint: 'エンドポイント',
      apiKey: 'API Key（任意）',
      speed: '速度',
      pitch: 'ピッチ',
      volume: '音量',
      autoPlay: '応答後に自動再生',
      testText: 'テスト文',
      testPlay: '試聴',
      localModels: 'ローカルモデルファイル',
      addLocal: 'ローカルモデルパスを追加',
      remove: '削除',
      hint: 'macOS `say` はダウンロード不要。Piper/Kokoro はローカルモデルが必要です。'
    }
  } as const
  const tt = (tx as any)[lang] || tx.en
  const [qwenLocalCatalog, setQwenLocalCatalog] = useState<Array<{ id: string; name?: string }>>([])
  const [qwenInstalledIds, setQwenInstalledIds] = useState<string[]>([])
  const [qwenDownloadingId, setQwenDownloadingId] = useState('')
  const [qwenServiceRunning, setQwenServiceRunning] = useState(false)

  const setTts = (patch: Record<string, any>) => {
    updateSettings({ tts: { ...tts, ...patch } } as any)
  }
  const handleTestTts = async () => {
    if (!String(tts.testText || '').trim()) return
    setIsTesting(true)
    try {
      await fetchBackendJson<{ ok: boolean }>('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: String(tts.provider || 'macos_say'),
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
          text: String(tts.testText || ''),
          localModels: Array.isArray(tts.localModels) ? tts.localModels : []
        })
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'TTS preview failed')
      alert(msg)
    } finally {
      setIsTesting(false)
    }
  }

  const provider = String(tts.provider || 'macos_say')
  const qwenMode = String(tts.qwenMode || 'endpoint') === 'local' ? 'local' : 'endpoint'
  const localModels = Array.isArray(tts.localModels) ? tts.localModels : []
  const defaultVoices: Record<string, string[]> = {
    macos_say: ['Samantha', 'Tingting', 'Alex', 'Victoria'],
    piper: ['zh_CN-huayan-medium', 'en_US-lessac-medium'],
    kokoro_onnx: ['Kokoro-82M-en', 'Kokoro-82M-zh'],
    custom_http: []
  }
  const voiceOptions = defaultVoices[provider] || []

  const refreshQwenLocalState = useCallback(async () => {
    try {
      const [catalogRes, installedRes, serviceRes] = await Promise.all([
        fetchBackendJson<{ ok: boolean; models?: Array<{ id: string; name?: string }> }>('/api/tts/qwen/local/catalog', { method: 'GET' }),
        fetchBackendJson<{ ok: boolean; models?: Array<{ id: string }> }>('/api/tts/qwen/local/installed', { method: 'GET' }),
        fetchBackendJson<{ ok: boolean; running?: boolean }>('/api/tts/qwen/local/service/status', { method: 'GET' }),
      ])
      setQwenLocalCatalog(Array.isArray(catalogRes.models) ? catalogRes.models : [])
      setQwenInstalledIds(
        Array.isArray(installedRes.models)
          ? installedRes.models.map((m: any) => String(m?.id || '').trim()).filter(Boolean)
          : []
      )
      setQwenServiceRunning(Boolean(serviceRes.running))
    } catch {
      setQwenLocalCatalog([])
      setQwenInstalledIds([])
      setQwenServiceRunning(false)
    }
  }, [])

  const handleDownloadQwenLocalModel = useCallback(async (modelId: string) => {
    if (!modelId) return
    setQwenDownloadingId(modelId)
    try {
      const res = await fetchBackendJson<{ ok: boolean; taskId?: string }>('/api/tts/qwen/local/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      })
      const taskId = String(res.taskId || '').trim()
      if (!taskId) throw new Error('taskId missing')
      let done = false
      while (!done) {
        await new Promise((r) => setTimeout(r, 900))
        const st = await fetchBackendJson<{ ok: boolean; task?: any }>(`/api/tts/qwen/local/download/status?taskId=${encodeURIComponent(taskId)}`, { method: 'GET' })
        const status = String(st?.task?.status || '')
        if (status === 'done') {
          done = true
        } else if (status === 'error' || status === 'canceled') {
          const err = String(st?.task?.error || 'download failed')
          throw new Error(err)
        }
      }
      await refreshQwenLocalState()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || 'download failed')
      alert(msg)
    } finally {
      setQwenDownloadingId('')
    }
  }, [refreshQwenLocalState])

  useEffect(() => {
    if (provider !== 'qwen_tts' || qwenMode !== 'local') return
    void refreshQwenLocalState()
  }, [provider, qwenMode, refreshQwenLocalState])

  return (
    <div className="p-6 space-y-5">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1">
            <div className="text-[13px] font-semibold">{tt.title}</div>
            <div className="text-xs text-muted-foreground">{tt.desc}</div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
            <Label>{tt.enabled}</Label>
            <Switch checked={Boolean(tts.enabled)} onCheckedChange={(c) => setTts({ enabled: Boolean(c) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{tt.provider}</Label>
              <Select value={provider} onValueChange={(v) => setTts({ provider: v, model: '' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="macos_say">macOS `say`</SelectItem>
                  <SelectItem value="piper">Piper</SelectItem>
                  <SelectItem value="kokoro_onnx">Kokoro ONNX</SelectItem>
                  <SelectItem value="qwen_tts">Qwen TTS</SelectItem>
                  <SelectItem value="custom_http">Custom HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{tt.model}</Label>
              {voiceOptions.length ? (
                <Select value={String(tts.model || '')} onValueChange={(v) => setTts({ model: v })}>
                  <SelectTrigger><SelectValue placeholder={tt.model} /></SelectTrigger>
                  <SelectContent>
                    {voiceOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={String(tts.model || '')} onChange={(e) => setTts({ model: e.target.value })} placeholder={tt.model} />
              )}
            </div>
          </div>
          {provider === 'qwen_tts' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{tt.qwenMode}</Label>
                <Select value={qwenMode} onValueChange={(v) => setTts({ qwenMode: v === 'local' ? 'local' : 'endpoint' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">{tt.qwenModeLocal}</SelectItem>
                    <SelectItem value="endpoint">{tt.qwenModeEndpoint}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{tt.qwenModel}</Label>
                <Input value={String(tts.qwenModel || '')} onChange={(e) => setTts({ qwenModel: e.target.value })} placeholder="qwen3-tts-flash" />
              </div>
              <div className="space-y-1">
                <Label>{tt.qwenLanguageType}</Label>
                <Select value={String(tts.qwenLanguageType || 'Auto')} onValueChange={(v) => setTts({ qwenLanguageType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Auto">Auto</SelectItem>
                    <SelectItem value="Chinese">Chinese</SelectItem>
                    <SelectItem value="English">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          {(provider === 'qwen_tts' && qwenMode === 'local') ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{tt.qwenLocalModel}</Label>
                  <Select value={String(tts.qwenLocalModelId || '')} onValueChange={(v) => setTts({ qwenLocalModelId: v, qwenModel: v })}>
                    <SelectTrigger><SelectValue placeholder={tt.qwenLocalModel} /></SelectTrigger>
                    <SelectContent>
                      {(qwenLocalCatalog || []).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{tt.qwenServiceStatus}</Label>
                  <div className="flex h-10 items-center justify-between rounded-md border border-border bg-background px-3 text-sm">
                    <span>{qwenServiceRunning ? tt.qwenServiceRunning : tt.qwenServiceStopped}</span>
                    <Button size="sm" variant="ghost" onClick={() => void refreshQwenLocalState()}>{tt.qwenRefresh}</Button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={!String(tts.qwenLocalModelId || '').trim() || qwenDownloadingId === String(tts.qwenLocalModelId || '') || qwenInstalledIds.includes(String(tts.qwenLocalModelId || ''))}
                  onClick={() => void handleDownloadQwenLocalModel(String(tts.qwenLocalModelId || ''))}
                >
                  {qwenInstalledIds.includes(String(tts.qwenLocalModelId || ''))
                    ? tt.qwenDownloaded
                    : qwenDownloadingId === String(tts.qwenLocalModelId || '')
                      ? tt.qwenDownloading
                      : tt.qwenDownload}
                </Button>
                <div className="text-xs text-muted-foreground">{String(tts.qwenLocalEndpoint || 'http://127.0.0.1:8000/v1/audio/speech')}</div>
              </div>
            </div>
          ) : null}
          {(provider === 'custom_http' || provider === 'kokoro_onnx') ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{tt.endpoint}</Label>
                <Input value={String(tts.endpoint || '')} onChange={(e) => setTts({ endpoint: e.target.value })} placeholder="http://127.0.0.1:8000/tts" />
              </div>
              <div className="space-y-1">
                <Label>{tt.apiKey}</Label>
                <Input value={String(tts.apiKey || '')} onChange={(e) => setTts({ apiKey: e.target.value })} placeholder="optional" />
              </div>
            </div>
          ) : null}
          {(provider === 'qwen_tts' && qwenMode === 'endpoint') ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{tt.endpoint}</Label>
                <Input value={String(tts.endpoint || '')} onChange={(e) => setTts({ endpoint: e.target.value })} placeholder="http://127.0.0.1:8000/v1/audio/speech 或 DashScope endpoint" />
              </div>
              <div className="space-y-1">
                <Label>{tt.apiKey}</Label>
                <Input value={String(tts.apiKey || '')} onChange={(e) => setTts({ apiKey: e.target.value })} placeholder="DashScope API Key" />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>{tt.speed}</Label>
              <Input type="number" min={0.5} max={2} step={0.1} value={Number(tts.speed || 1)} onChange={(e) => setTts({ speed: Number(e.target.value || 1) || 1 })} />
            </div>
            <div className="space-y-1">
              <Label>{tt.pitch}</Label>
              <Input type="number" min={0.5} max={2} step={0.1} value={Number(tts.pitch || 1)} onChange={(e) => setTts({ pitch: Number(e.target.value || 1) || 1 })} />
            </div>
            <div className="space-y-1">
              <Label>{tt.volume}</Label>
              <Input type="number" min={0} max={1} step={0.1} value={Number(tts.volume || 1)} onChange={(e) => setTts({ volume: Number(e.target.value || 1) || 1 })} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
            <Label>{tt.autoPlay}</Label>
            <Switch checked={Boolean(tts.autoPlay)} onCheckedChange={(c) => setTts({ autoPlay: Boolean(c) })} />
          </div>
          <div className="space-y-1">
            <Label>{tt.testText}</Label>
            <Textarea
              rows={3}
              value={String(tts.testText || '')}
              onChange={(e) => setTts({ testText: e.target.value })}
            />
            <div className="pt-2">
              <Button variant="outline" onClick={handleTestTts} disabled={isTesting || !String(tts.testText || '').trim()}>
                {isTesting ? '...' : tt.testPlay}
              </Button>
            </div>
          </div>
          {(provider === 'piper' || provider === 'kokoro_onnx') ? (
            <div className="space-y-2">
              <Label>{tt.localModels}</Label>
              <div className="space-y-2">
                {localModels.map((m: any, i: number) => (
                  <div key={`${m.id || i}`} className="flex items-center gap-2">
                    <Input
                      value={String(m.path || '')}
                      onChange={(e) => {
                        const next = [...localModels]
                        next[i] = { ...(next[i] || {}), id: String(next[i]?.id || `local_${i}`), name: String(next[i]?.name || `local_${i}`), path: e.target.value }
                        setTts({ localModels: next })
                      }}
                      placeholder="/path/to/model.onnx"
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        const next = localModels.filter((_: any, idx: number) => idx !== i)
                        setTts({ localModels: next })
                      }}
                    >
                      {tt.remove}
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={() => setTts({ localModels: [...localModels, { id: `local_${Date.now()}`, name: `local_${localModels.length + 1}`, path: '' }] })}
              >
                {tt.addLocal}
              </Button>
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">
            {provider === 'qwen_tts'
              ? (lang === 'zh'
                  ? (qwenMode === 'local'
                      ? '本地托管模式会自动拉起本地服务并使用所选模型；请先下载模型后试听。'
                      : 'Endpoint 模式支持 DashScope 或自建服务地址。')
                  : lang === 'ja'
                    ? (qwenMode === 'local'
                        ? 'ローカル管理モードは選択モデルでローカルサービスを自動起動します。先にモデルをダウンロードしてください。'
                        : 'Endpoint モードでは DashScope または自前 endpoint を利用できます。')
                    : (qwenMode === 'local'
                        ? 'Local managed mode auto-starts local TTS service with selected model. Download model before testing.'
                        : 'Endpoint mode supports DashScope or your own endpoint.'))
              : tt.hint}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ShortcutsSettings() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const lang = String(settings?.language || 'en')
  const isMac = isMacLike()
  const overrides = useMemo(
    () => ((settings?.shortcuts?.bindings || {}) as Partial<Record<ShortcutId, any>>),
    [settings?.shortcuts?.bindings]
  )
  const [editing, setEditing] = useState<ShortcutId | null>(null)
  const [captureHint, setCaptureHint] = useState('')

  const t = useMemo(() => {
    const dict = {
      en: {
        title: 'Keyboard shortcuts',
        hint: 'Shortcuts work globally. Some may be overridden by the system.',
        columns: { action: 'Action', keys: 'Keys' },
        edit: 'Edit',
        reset: 'Reset',
        disable: 'Disable',
        disabled: 'Disabled',
        default: 'Default',
        custom: 'Custom',
        captureTitle: 'Set shortcut',
        captureDesc: 'Press a new shortcut (must include Ctrl/⌘).',
        conflict: (x: string) => `Conflict with: ${x}`,
        invalid: 'Invalid shortcut.',
        requirePrimary: 'Please include Ctrl (Windows/Linux) or ⌘ (macOS).'
      },
      zh: {
        title: '快捷键',
        hint: '快捷键为全局生效，部分组合键可能被系统占用。',
        columns: { action: '操作', keys: '按键' },
        edit: '更改',
        reset: '恢复默认',
        disable: '禁用',
        disabled: '已禁用',
        default: '默认',
        custom: '自定义',
        captureTitle: '设置快捷键',
        captureDesc: '按下新的快捷键（必须包含 Ctrl/⌘）。',
        conflict: (x: string) => `与「${x}」冲突`,
        invalid: '无效快捷键。',
        requirePrimary: '请包含 Ctrl（Windows/Linux）或 ⌘（macOS）。'
      },
      ja: {
        title: 'ショートカット',
        hint: 'ショートカットは全体で有効です。一部はOSにより上書きされる場合があります。',
        columns: { action: '操作', keys: 'キー' },
        edit: '変更',
        reset: 'デフォルトに戻す',
        disable: '無効化',
        disabled: '無効',
        default: 'デフォルト',
        custom: 'カスタム',
        captureTitle: 'ショートカット設定',
        captureDesc: '新しいショートカットを押してください（Ctrl/⌘ 必須）。',
        conflict: (x: string) => `競合: ${x}`,
        invalid: '無効なショートカットです。',
        requirePrimary: 'Ctrl（Windows/Linux）または ⌘（macOS）を含めてください。'
      }
    } as const
    const key = (lang || 'en') as keyof typeof dict
    return dict[key] || dict.en
  }, [lang])

  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of SHORTCUTS) {
      const title = lang === 'zh' ? s.title.zh : lang === 'ja' ? s.title.ja : s.title.en
      m.set(s.id, title)
    }
    return m
  }, [lang])

  const effectiveBindingById = useMemo(() => {
    const out: Partial<Record<ShortcutId, { binding: any; state: 'default' | 'custom' | 'disabled' }>> = {}
    for (const s of SHORTCUTS) {
      const raw = (overrides as any)[s.id]
      if (raw === null) {
        out[s.id] = { binding: null, state: 'disabled' }
        continue
      }
      const b = raw ? normalizeBinding(raw) : null
      if (b) out[s.id] = { binding: b, state: 'custom' }
      else out[s.id] = { binding: s.binding, state: 'default' }
    }
    return out
  }, [overrides])

  const bindingToOwners = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of SHORTCUTS) {
      const eff = (effectiveBindingById as any)[s.id]
      const b = eff?.binding
      if (!b) continue
      const id = bindingId(b)
      const prev = m.get(id) || []
      m.set(id, [...prev, s.id])
    }
    return m
  }, [effectiveBindingById])

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof SHORTCUTS>()
    for (const s of SHORTCUTS) {
      const k = lang === 'zh' ? s.category.zh : lang === 'ja' ? s.category.ja : s.category.en
      const prev = groups.get(k) || []
      groups.set(k, [...prev, s])
    }
    return Array.from(groups.entries())
  }, [lang])

  const renderKeys = (parts: string[]) => {
    return (
      <div className="flex items-center justify-end gap-1 flex-wrap">
        {parts.map((p, idx) => (
          <kbd
            key={`${p}:${idx}`}
            className="px-1.5 py-0.5 rounded-md border border-border bg-muted/30 text-[11px] text-foreground/80"
          >
            {p}
          </kbd>
        ))}
      </div>
    )
  }

  const saveOverride = useCallback(
    (id: ShortcutId, next: any) => {
    const cur = (settings?.shortcuts?.bindings || {}) as any
    const nextBindings = { ...cur }
    if (next === undefined) delete nextBindings[id]
    else nextBindings[id] = next
    updateSettings({ shortcuts: { ...(settings?.shortcuts || {}), bindings: nextBindings } } as any)
    },
    [settings?.shortcuts, updateSettings]
  )

  useEffect(() => {
    if (!editing) return
    setCaptureHint('')
    const isMacLocal = isMacLike()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      const key = String(e.key || '')
      if (key === 'Escape') {
        setEditing(null)
        return
      }
      const lower = key.toLowerCase()
      if (lower === 'shift' || lower === 'alt' || lower === 'meta' || lower === 'control') return
      const primary = isMacLocal ? e.metaKey : e.ctrlKey
      if (!primary) {
        setCaptureHint(t.requirePrimary)
        return
      }
      if (!lower || lower.length > 2 || /\s/.test(lower)) {
        setCaptureHint(t.invalid)
        return
      }
      const b = normalizeBinding({ key: lower, primary: true, shift: e.shiftKey, alt: e.altKey })
      if (!b) {
        setCaptureHint(t.invalid)
        return
      }
      const bid = bindingId(b)
      const owners = (bindingToOwners.get(bid) || []).filter((x) => x !== editing)
      if (owners.length) {
        const first = titleById.get(owners[0]) || owners[0]
        setCaptureHint(t.conflict(first))
        return
      }
      saveOverride(editing, b)
      setEditing(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [bindingToOwners, editing, saveOverride, t, titleById])

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardContent className="p-6 space-y-2">
          <div className="text-[13px] font-semibold">{t.title}</div>
          <div className="text-xs text-muted-foreground">{t.hint}</div>
        </CardContent>
      </Card>

      {grouped.map(([groupName, items]) => (
        <Card key={groupName}>
          <CardContent className="p-6 space-y-3">
            <div className="text-[13px] font-semibold">{groupName}</div>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div>{t.columns.action}</div>
                <div>{t.columns.keys}</div>
              </div>
              <div className="h-px bg-border/60" />
              {items.map((s) => {
                const title = lang === 'zh' ? s.title.zh : lang === 'ja' ? s.title.ja : s.title.en
                const eff = (effectiveBindingById as any)[s.id]
                const state = eff?.state as 'default' | 'custom' | 'disabled'
                const binding = eff?.binding
                const parts = binding ? formatBindingParts(binding, isMac) : [t.disabled]
                return (
                  <div key={s.id} className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="text-[13px] text-foreground/90 truncate">{title}</div>
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {state === 'default' ? t.default : state === 'custom' ? t.custom : t.disabled}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {renderKeys(parts)}
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(s.id as ShortcutId)}>
                        {t.edit}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => (o ? null : setEditing(null))}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t.captureTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-[13px] text-muted-foreground">{t.captureDesc}</div>
            {editing ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 space-y-2">
                <div className="text-[13px] font-medium">{titleById.get(editing) || editing}</div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">Current</div>
                  <div className="flex items-center gap-1">
                    {(() => {
                      const eff = (effectiveBindingById as any)[editing]
                      const binding = eff?.binding
                      const parts = binding ? formatBindingParts(binding, isMac) : [t.disabled]
                      return renderKeys(parts)
                    })()}
                  </div>
                </div>
              </div>
            ) : null}
            {captureHint ? <div className="text-[13px] text-destructive">{captureHint}</div> : null}
          </div>
          <DialogFooter className="gap-2">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    saveOverride(editing, undefined)
                    setEditing(null)
                  }}
                >
                  {t.reset}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    saveOverride(editing, null)
                    setEditing(null)
                  }}
                >
                  {t.disable}
                </Button>
              </>
            ) : null}
            <Button variant="default" onClick={() => setEditing(null)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          mcp: 'MCP',
          coder: 'Coder',
          automation: 'Automation',
          im: 'IM',
          memory: 'Memory',
          knowledgeBase: 'Knowledge Base',
          skills: 'Skills',
          network: 'Network',
          data: 'Data',
          statusCenter: 'Status Center',
          voice: 'Voice',
          tts: 'TTS',
          shortcuts: 'Shortcuts',
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
          mcp: 'MCP',
          coder: 'Coder',
          automation: '自动化',
          im: 'IM',
          memory: '记忆',
          knowledgeBase: '知识库',
          skills: '技能',
          network: '网络',
          data: '数据',
          statusCenter: '状态中心',
          voice: '语音',
          tts: 'TTS',
          shortcuts: '快捷键',
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
          mcp: 'MCP',
          coder: 'Coder',
          automation: '自動化',
          im: 'IM',
          memory: 'メモリー',
          knowledgeBase: 'ナレッジベース',
          skills: 'スキル',
          network: 'ネットワーク',
          data: 'データ',
          statusCenter: 'ステータスセンター',
          voice: '音声',
          tts: 'TTS',
          shortcuts: 'ショートカット',
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
    { id: 'mcp', label: t.tabs.mcp, icon: Database },
    { id: 'coder', label: t.tabs.coder, icon: Sparkles },
    { id: 'knowledgeBase', label: t.tabs.knowledgeBase, icon: Search },
    { id: 'memory', label: t.tabs.memory, icon: Search },
    { id: 'im', label: t.tabs.im, icon: ExternalLink },
    { id: 'skills', label: t.tabs.skills, icon: Wand2 },
    { id: 'network', label: t.tabs.network, icon: Globe },
    { id: 'data', label: t.tabs.data, icon: Database },
    { id: 'statusCenter', label: t.tabs.statusCenter, icon: Bell },
    { id: 'voice', label: t.tabs.voice, icon: Mic },
    { id: 'tts', label: t.tabs.tts, icon: Mic },
    { id: 'shortcuts', label: t.tabs.shortcuts, icon: Keyboard },
    { id: 'about', label: t.tabs.about, icon: Info },
  ]
  const isDenseLayoutTab = activeTab === 'providers' || activeTab === 'coder'
  const renderActiveTab = () => {
    if (activeTab === 'providers') return <ProvidersSettings />
    if (activeTab === 'general') return <GeneralSettings />
    if (activeTab === 'chat') return <ChatSettings />
    if (activeTab === 'mcp') return <McpSettings />
    if (activeTab === 'coder') return <CoderSettings />
    if (activeTab === 'knowledgeBase') return <KnowledgeBaseSettings />
    if (activeTab === 'memory') return <MemorySettings />
    if (activeTab === 'im') return <ImSettings />
    if (activeTab === 'skills') return <SkillsSettings />
    if (activeTab === 'network') return <NetworkSettings />
    if (activeTab === 'data') return <DataSettings />
    if (activeTab === 'statusCenter') return <StatusCenterSettings />
    if (activeTab === 'voice') return <VoiceSettings t={t} />
    if (activeTab === 'tts') return <TtsSettings t={t} />
    if (activeTab === 'shortcuts') return <ShortcutsSettings />
    if (activeTab === 'about') return <AboutSettings />
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="relative flex h-[min(88vh,900px)] w-[min(94vw,1280px)] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200 font-sans text-[13px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,hsl(var(--primary)/0.08),transparent_34%),radial-gradient(circle_at_90%_100%,hsl(var(--foreground)/0.05),transparent_42%)]" />

        {/* Sidebar */}
        <AppShellLeftPane showResizeHandle={false} className="z-10">
          <nav className="flex-1 px-[var(--app-left-pane-pad-x)] py-5 space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <Button
                  key={tab.id}
                  variant="ghost"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full justify-start gap-3 px-3 py-2.5 h-auto text-[13px] font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'rounded-xl bg-black/5 text-foreground'
                      : 'rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </Button>
              )
            })}
          </nav>
        </AppShellLeftPane>

        {/* Content Area */}
        <div className="relative z-10 flex-1 flex flex-col bg-transparent">
           <div className="flex items-center justify-between px-7 py-5 border-b border-border/80 bg-card/50 backdrop-blur">
             <h2 className="font-semibold text-lg tracking-tight">
               {tabs.find(t => t.id === activeTab)?.label}
             </h2>
           </div>
          
          <div className="flex-1 overflow-hidden relative">
            {isDenseLayoutTab ? (
              renderActiveTab()
            ) : (
              <div className="h-full overflow-y-auto custom-scrollbar">
                <div className="mx-auto w-full max-w-[880px]">
                  {renderActiveTab()}
                </div>
              </div>
            )}
          </div>
          
          <div className="h-16 px-7 border-t border-border/80 bg-card/40 backdrop-blur flex justify-between items-center text-[13px] text-muted-foreground">
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
          mcp: 'MCP',
          coder: 'Coder',
          automation: 'Automation',
          im: 'IM',
          memory: 'Memory',
          knowledgeBase: 'Knowledge Base',
          skills: 'Skills',
          network: 'Network',
          data: 'Data',
          statusCenter: 'Status Center',
          voice: 'Voice',
          tts: 'TTS',
          shortcuts: 'Shortcuts',
          about: 'About'
        },
        savedHint: 'All changes are saved automatically.',
        backToApp: 'Back',
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
          mcp: 'MCP',
          coder: 'Coder',
          automation: '自动化',
          im: 'IM',
          memory: '记忆',
          knowledgeBase: '知识库',
          skills: '技能',
          network: '网络',
          data: '数据',
          statusCenter: '状态中心',
          voice: '语音',
          tts: 'TTS',
          shortcuts: '快捷键',
          about: '关于'
        },
        savedHint: '所有更改会自动保存。',
        backToApp: '返回',
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
          mcp: 'MCP',
          coder: 'Coder',
          automation: '自動化',
          im: 'IM',
          memory: 'メモリー',
          knowledgeBase: 'ナレッジベース',
          skills: 'スキル',
          network: 'ネットワーク',
          data: 'データ',
          statusCenter: 'ステータスセンター',
          voice: '音声',
          tts: 'TTS',
          shortcuts: 'ショートカット',
          about: '情報'
        },
        savedHint: '変更は自動的に保存されます。',
        backToApp: '戻る',
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
    { id: 'mcp', label: t.tabs.mcp, icon: Database },
    { id: 'coder', label: t.tabs.coder, icon: Sparkles },
    { id: 'automation', label: t.tabs.automation, icon: Clock3 },
    { id: 'knowledgeBase', label: t.tabs.knowledgeBase, icon: Search },
    { id: 'memory', label: t.tabs.memory, icon: Search },
    { id: 'im', label: t.tabs.im, icon: ExternalLink },
    { id: 'skills', label: t.tabs.skills, icon: Wand2 },
    { id: 'network', label: t.tabs.network, icon: Globe },
    { id: 'data', label: t.tabs.data, icon: Database },
    { id: 'statusCenter', label: t.tabs.statusCenter, icon: Bell },
    { id: 'voice', label: t.tabs.voice, icon: Mic },
    { id: 'tts', label: t.tabs.tts, icon: Mic },
    { id: 'shortcuts', label: t.tabs.shortcuts, icon: Keyboard },
    { id: 'about', label: t.tabs.about, icon: Info }
  ]
  const isDenseLayoutTab = activeTab === 'providers' || activeTab === 'coder'
  const renderActiveTab = () => {
    if (activeTab === 'providers') return <ProvidersSettings />
    if (activeTab === 'general') return <GeneralSettings />
    if (activeTab === 'chat') return <ChatSettings />
    if (activeTab === 'mcp') return <McpSettings />
    if (activeTab === 'coder') return <CoderSettings />
    if (activeTab === 'automation') return <AutomationSettings />
    if (activeTab === 'knowledgeBase') return <KnowledgeBaseSettings />
    if (activeTab === 'memory') return <MemorySettings />
    if (activeTab === 'im') return <ImSettings />
    if (activeTab === 'skills') return <SkillsSettings />
    if (activeTab === 'network') return <NetworkSettings />
    if (activeTab === 'data') return <DataSettings />
    if (activeTab === 'statusCenter') return <StatusCenterSettings />
    if (activeTab === 'voice') return <VoiceSettings t={t} />
    if (activeTab === 'tts') return <TtsSettings t={t} />
    if (activeTab === 'shortcuts') return <ShortcutsSettings />
    if (activeTab === 'about') return <AboutSettings />
    return null
  }

  const onClose = () => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#/settings')) {
      window.location.hash = ''
      return
    }
    window.close()
  }

  return (
    <div className="settings-font-unified flex h-full w-full bg-background text-foreground transition-colors duration-300 overflow-hidden gap-0 font-sans text-[13px] relative">
      <div className="draggable absolute inset-x-0 top-0 h-3" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_6%,hsl(var(--primary)/0.08),transparent_35%),radial-gradient(circle_at_88%_100%,hsl(var(--foreground)/0.05),transparent_45%)]" />
      <UpdateDialog />
      <AppShellLeftPane bleedPx={12} showResizeHandle resizeInteractive={false} className="z-10">
        <div className="h-[var(--app-left-pane-header-height)] shrink-0 draggable select-none pr-[var(--app-left-pane-pad-x)] relative">
          <div
            className="absolute left-[var(--app-left-pane-leading-safe)] flex items-center no-drag"
            style={{
              top: 'var(--app-left-pane-traffic-row-top)',
              height: 'var(--app-left-pane-traffic-row-height)'
            }}
          >
            <button
              type="button"
              className="inline-flex min-w-[78px] items-center justify-center gap-1.5 rounded-[var(--app-left-pane-header-btn-radius)] px-3 text-[13px] font-medium leading-[14px] text-muted-foreground/90 transition-colors hover:bg-background/55 hover:text-foreground"
              style={{ height: 'var(--app-left-pane-traffic-row-height)' }}
              onClick={onClose}
            >
              <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
              <span className="block leading-[14px]">{t.backToApp}</span>
            </button>
          </div>
        </div>

        <nav className="flex-1 px-[var(--app-left-pane-pad-x)] py-[var(--app-left-pane-pad-x)] space-y-1 overflow-y-auto custom-scrollbar">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <Button
                key={tab.id}
                variant="ghost"
                onClick={() => setActiveTab(tab.id)}
                className={`w-full justify-start gap-3 px-3 py-2.5 h-auto text-[13px] font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'rounded-xl bg-black/5 text-foreground'
                    : 'rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </Button>
            )
          })}
        </nav>
      </AppShellLeftPane>

      <div className="relative z-10 flex-1 bg-[var(--app-shell-content-bg)] flex flex-col h-full overflow-hidden min-w-0">
        <div className="px-7 py-5 border-b border-border/80 bg-card/50 backdrop-blur">
          <h2 className="font-semibold text-lg tracking-tight cursor-default">
            {tabs.find((t) => t.id === activeTab)?.label}
          </h2>
        </div>
        {isDenseLayoutTab ? (
          <div className="flex-1 overflow-hidden relative no-drag bg-transparent">
            {renderActiveTab()}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto relative no-drag bg-transparent custom-scrollbar">
            <div className="max-w-[880px] mx-auto w-full">
              {renderActiveTab()}
            </div>
          </div>
        )}

        <div className="h-14 px-6 border-t border-border/80 bg-card/30 backdrop-blur flex justify-between items-center text-[13px] text-muted-foreground shrink-0">
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

function CoderSettings() {
  const settings = useStore(s => s.settings)
  const updateSettings = useStore(s => s.updateSettings)
  const [status, setStatus] = useState<{ running?: boolean; pid?: number | null; lastError?: string; debugPortReady?: boolean }>({})
  const [busy, setBusy] = useState(false)

  const language = (settings?.language || 'en') as 'en' | 'zh' | 'ja'
  const t = useMemo(() => {
    const dict = {
      en: {
        title: 'Coder',
        desc: 'Configure coder endpoint and transport. After saving, Anima can delegate coding tasks to coder and verify completion.',
        enabled: 'Enable Coder Delegation',
        name: 'Name',
        backend: 'Coder Backend',
        backendCodex: 'Codex',
        backendCursor: 'Cursor',
        backendCustom: 'Custom',
        backendCustomLabel: 'Custom Backend Name',
        endpoint: 'Endpoint Type',
        transport: 'Transport',
        autoStart: 'Auto Start',
        command: 'Launch Command',
        args: 'Launch Args',
        cwd: 'Working Directory (optional)',
        remoteDebuggingPort: 'Remote Debugging Port',
        refresh: 'Refresh',
        start: 'Start',
        stop: 'Stop',
        running: 'Running',
        stopped: 'Stopped',
        debugReady: 'Debug Port Ready',
        debugNotReady: 'Debug Port Not Ready',
        terminal: 'Terminal',
        desktop: 'Desktop',
        acp: 'ACP',
        cdpbridge: 'CDPBridge'
        ,
        profileList: 'Coders',
        addProfile: 'Add Coder',
        duplicateProfile: 'Duplicate',
        deleteProfile: 'Delete',
        commandTemplates: 'Command Templates',
        cmdStatus: 'status',
        cmdSend: 'send',
        cmdAsk: 'ask',
        cmdRead: 'read',
        cmdNew: 'new',
        cmdScreenshot: 'screenshot'
      },
      zh: {
        title: 'Coder',
        desc: '配置 coder 的端类型和通信方式。保存后，Anima 可将编码任务委托给 coder，并负责验收完成情况。',
        enabled: '启用 Coder 委托',
        name: '名称',
        backend: 'Coder 底层',
        backendCodex: 'Codex',
        backendCursor: 'Cursor',
        backendCustom: '自定义',
        backendCustomLabel: '自定义底层名称',
        endpoint: '端类型',
        transport: '通信方式',
        autoStart: '自动启动',
        command: '启动命令',
        args: '启动参数',
        cwd: '工作目录（可选）',
        remoteDebuggingPort: '远程调试端口',
        refresh: '刷新状态',
        start: '启动',
        stop: '停止',
        running: '运行中',
        stopped: '未运行',
        debugReady: '调试端口可用',
        debugNotReady: '调试端口不可用',
        terminal: '终端',
        desktop: '桌面端',
        acp: 'ACP',
        cdpbridge: 'CDPBridge',
        profileList: 'Coders',
        addProfile: '新增 Coder',
        duplicateProfile: '复制',
        deleteProfile: '删除',
        commandTemplates: '命令模板',
        cmdStatus: 'status',
        cmdSend: 'send',
        cmdAsk: 'ask',
        cmdRead: 'read',
        cmdNew: 'new',
        cmdScreenshot: 'screenshot'
      },
      ja: {
        title: 'Coder',
        desc: 'coder のエンドポイントと通信方式を設定します。保存後、Anima はコーディング作業を coder に委任し、完了検証に集中できます。',
        enabled: 'Coder 委任を有効化',
        name: '名前',
        backend: 'Coder バックエンド',
        backendCodex: 'Codex',
        backendCursor: 'Cursor',
        backendCustom: 'カスタム',
        backendCustomLabel: 'カスタムバックエンド名',
        endpoint: 'エンドポイント種別',
        transport: '通信方式',
        autoStart: '自動起動',
        command: '起動コマンド',
        args: '起動引数',
        cwd: '作業ディレクトリ（任意）',
        remoteDebuggingPort: 'リモートデバッグポート',
        refresh: '状態更新',
        start: '起動',
        stop: '停止',
        running: '起動中',
        stopped: '停止中',
        debugReady: 'デバッグポート接続可',
        debugNotReady: 'デバッグポート未接続',
        terminal: 'ターミナル',
        desktop: 'デスクトップ',
        acp: 'ACP',
        cdpbridge: 'CDPBridge',
        profileList: 'Coders',
        addProfile: 'Coderを追加',
        duplicateProfile: '複製',
        deleteProfile: '削除',
        commandTemplates: 'コマンドテンプレート',
        cmdStatus: 'status',
        cmdSend: 'send',
        cmdAsk: 'ask',
        cmdRead: 'read',
        cmdNew: 'new',
        cmdScreenshot: 'screenshot'
      }
    } as const
    return dict[language] || dict.en
  }, [language])

  const defaultCoder = {
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
  } as any

  const normalizeCoder = useCallback((raw: any) => {
    const next = { ...defaultCoder, ...(raw && typeof raw === 'object' ? raw : {}) }
    next.name = String(next.name || '').trim() || 'Codex'
    next.backendKind = next.backendKind === 'cursor' ? 'cursor' : next.backendKind === 'custom' ? 'custom' : 'codex'
    next.backendLabel = String(next.backendLabel || '').trim()
    next.endpointType = next.endpointType === 'terminal' ? 'terminal' : 'desktop'
    next.transport = next.transport === 'acp' ? 'acp' : 'cdpbridge'
    next.command = String(next.command || '').trim() || '/usr/bin/open'
    next.cwd = String(next.cwd || '').trim()
    next.env = next.env && typeof next.env === 'object' ? next.env : {}
    const rd = Number(next.remoteDebuggingPort || 9222)
    next.remoteDebuggingPort = Number.isFinite(rd) && rd > 0 ? rd : 9222
    next.commandTemplates = {
      status: String(next.commandTemplates?.status || '').trim(),
      send: String(next.commandTemplates?.send || '').trim(),
      ask: String(next.commandTemplates?.ask || '').trim() || 'codex exec "{prompt}"',
      read: String(next.commandTemplates?.read || '').trim(),
      new: String(next.commandTemplates?.new || '').trim() || 'codex',
      screenshot: String(next.commandTemplates?.screenshot || '').trim()
    }
    next.args = Array.isArray(next.args)
      ? next.args.map((x: any) => String(x))
      : (next.transport === 'acp' ? ['--acp'] : ['-a', 'Codex', '--args', `--remote-debugging-port=${next.remoteDebuggingPort}`])
    if (next.transport === 'acp' && (!Array.isArray(next.args) || next.args.length === 0)) {
      next.args = ['--acp']
    }
    if (next.transport === 'cdpbridge' && (!Array.isArray(next.args) || next.args.length === 0)) {
      next.args = ['-a', 'Codex', '--args', `--remote-debugging-port=${Number(next.remoteDebuggingPort || 9222)}`]
    }
    if (
      next.transport === 'cdpbridge' &&
      next.command === 'codex' &&
      next.args.some((x: string) => String(x).includes('--remote-debugging-port'))
    ) {
      next.command = '/usr/bin/open'
      next.args = ['-a', 'Codex', '--args', `--remote-debugging-port=${next.remoteDebuggingPort}`]
    }
    return next
  }, [])

  const rawProfiles = Array.isArray((settings as any)?.coderProfiles) ? (settings as any).coderProfiles : []
  const profiles = useMemo(() => {
    const seed = rawProfiles.length > 0 ? rawProfiles : [{ id: 'codex-default', ...(settings?.coder || defaultCoder) }]
    return seed
      .map((profile: any, index: number) => {
        const normalized = normalizeCoder(profile)
        normalized.id = String(profile?.id || '').trim() || `coder-${index + 1}`
        return normalized
      })
      .filter((profile: any) => String(profile.id || '').trim())
  }, [defaultCoder, normalizeCoder, rawProfiles, settings?.coder])
  const activeId = String((settings as any)?.activeCoderProfileId || '').trim() || String(profiles[0]?.id || '')
  const activeProfile = profiles.find((profile: any) => profile.id === activeId) || profiles[0]

  const persistProfiles = useCallback((nextProfilesRaw: any[], nextActiveIdRaw?: string) => {
    const nextProfiles = nextProfilesRaw
      .map((profile: any, index: number) => {
        const normalized = normalizeCoder(profile)
        normalized.id = String(profile?.id || '').trim() || `coder-${index + 1}`
        return normalized
      })
      .filter((profile: any) => String(profile.id || '').trim())
    if (nextProfiles.length === 0) return
    const targetId = String(nextActiveIdRaw || '').trim()
    const active = nextProfiles.find((profile: any) => profile.id === targetId) || nextProfiles[0]
    updateSettings({
      coderProfiles: nextProfiles,
      activeCoderProfileId: String(active.id),
      coder: normalizeCoder(active)
    } as any)
  }, [normalizeCoder, updateSettings])

  const selectProfile = useCallback((id: string) => {
    persistProfiles(profiles, id)
  }, [persistProfiles, profiles])

  const updateActiveProfile = useCallback((patch: Record<string, any>) => {
    if (!activeProfile) return
    const nextProfiles = profiles.map((profile: any) => {
      if (profile.id !== activeProfile.id) return profile
      return normalizeCoder({ ...profile, ...patch })
    })
    persistProfiles(nextProfiles, activeProfile.id)
  }, [activeProfile, normalizeCoder, persistProfiles, profiles])

  const addProfile = useCallback(() => {
    const base = normalizeCoder(activeProfile || defaultCoder)
    const baseName = String(base.name || 'Coder').trim() || 'Coder'
    const exists = new Set(profiles.map((profile: any) => String(profile.name || '').trim().toLowerCase()))
    let index = 2
    let nextName = `${baseName} ${index}`
    while (exists.has(nextName.toLowerCase())) {
      index += 1
      nextName = `${baseName} ${index}`
    }
    const id = `coder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const nextProfile = normalizeCoder({ ...base, id, name: nextName })
    persistProfiles([...profiles, nextProfile], id)
  }, [activeProfile, defaultCoder, normalizeCoder, persistProfiles, profiles])

  const duplicateProfile = useCallback(() => {
    if (!activeProfile) return
    const baseName = String(activeProfile.name || 'Coder').trim() || 'Coder'
    const exists = new Set(profiles.map((profile: any) => String(profile.name || '').trim().toLowerCase()))
    let index = 2
    let nextName = `${baseName} ${index}`
    while (exists.has(nextName.toLowerCase())) {
      index += 1
      nextName = `${baseName} ${index}`
    }
    const id = `coder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const nextProfile = normalizeCoder({ ...activeProfile, id, name: nextName })
    persistProfiles([...profiles, nextProfile], id)
  }, [activeProfile, normalizeCoder, persistProfiles, profiles])

  const deleteProfile = useCallback(() => {
    if (!activeProfile || profiles.length <= 1) return
    const nextProfiles = profiles.filter((profile: any) => profile.id !== activeProfile.id)
    const nextActive = nextProfiles[0]?.id
    persistProfiles(nextProfiles, nextActive)
  }, [activeProfile, persistProfiles, profiles])

  const refreshStatus = useCallback(async () => {
    const api = window.anima?.coder
    if (!api?.status) return
    try {
      const res = await api.status()
      if (res?.ok) {
        setStatus({
          running: Boolean(res.running),
          pid: res.pid ?? null,
          lastError: String(res.lastError || '').trim(),
          debugPortReady: Boolean(res.debugPortReady)
        })
      }
    } catch {
      //
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [refreshStatus])

  const startCoder = async () => {
    const api = window.anima?.coder
    if (!api?.start) return
    if (!activeProfile) return
    setBusy(true)
    try {
      await api.start({ settings: normalizeCoder(activeProfile) })
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  const stopCoder = async () => {
    const api = window.anima?.coder
    if (!api?.stop) return
    setBusy(true)
    try {
      await api.stop()
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  const argsText = Array.isArray(activeProfile?.args) ? activeProfile.args.join(' ') : ''

  return (
    <div className="flex h-full">
      <div className="w-72 border-r border-border/60 p-4 pr-5 flex flex-col gap-3 bg-card/35">
        <div className="space-y-1">
          <div className="text-[12px] uppercase tracking-wide text-muted-foreground">{t.profileList}</div>
          <div className="text-xs text-muted-foreground">{t.desc}</div>
        </div>
        <Button variant="outline" className="justify-start gap-2" onClick={addProfile}>
          <Plus className="w-4 h-4" />
          {t.addProfile}
        </Button>
        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-1">
          {profiles.map((profile: any) => {
            const selected = activeProfile?.id === profile.id
            const backendName =
              profile.backendKind === 'cursor'
                ? t.backendCursor
                : profile.backendKind === 'custom'
                  ? (String(profile.backendLabel || '').trim() || t.backendCustom)
                  : t.backendCodex
            return (
              <Button
                key={profile.id}
                variant={selected ? 'secondary' : 'ghost'}
                className={`w-full justify-between h-auto py-2.5 px-3 rounded-lg ${selected ? 'bg-card border border-border/70 shadow-none' : ''}`}
                onClick={() => selectProfile(String(profile.id))}
              >
                <div className="min-w-0 text-left">
                  <div className="truncate">{String(profile.name || 'Coder')}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{backendName}</div>
                </div>
                <div className={`w-2 h-2 rounded-full shrink-0 ${profile.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
              </Button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 pt-5 custom-scrollbar">
        {!activeProfile ? null : (
          <div className="max-w-[860px] space-y-5 animate-in fade-in duration-200">
            <Card className="border-border/60 bg-background/40 shadow-none">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-semibold text-foreground">{String(activeProfile.name || t.title)}</h2>
                    <p className="text-[13px] text-muted-foreground">{t.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={duplicateProfile}>
                      <Copy className="w-3.5 h-3.5" />
                      {t.duplicateProfile}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={deleteProfile} disabled={profiles.length <= 1}>
                      <Trash2 className="w-3.5 h-3.5" />
                      {t.deleteProfile}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="text-[13px]">{t.enabled}</div>
                  <Switch checked={Boolean(activeProfile.enabled)} onCheckedChange={(v) => updateActiveProfile({ enabled: Boolean(v) })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.name}</Label>
                    <Input value={String(activeProfile.name || '')} onChange={(e) => updateActiveProfile({ name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.backend}</Label>
                    <Select
                      value={String(activeProfile.backendKind || 'codex')}
                      onValueChange={(v) => updateActiveProfile({ backendKind: v === 'cursor' ? 'cursor' : v === 'custom' ? 'custom' : 'codex' })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="codex">{t.backendCodex}</SelectItem>
                        <SelectItem value="cursor">{t.backendCursor}</SelectItem>
                        <SelectItem value="custom">{t.backendCustom}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.autoStart}</Label>
                    <div className="h-10 rounded-md border px-3 flex items-center justify-end">
                      <Switch checked={Boolean(activeProfile.autoStart)} onCheckedChange={(v) => updateActiveProfile({ autoStart: Boolean(v) })} />
                    </div>
                  </div>
                  {String(activeProfile.backendKind || '') === 'custom' ? (
                    <div className="space-y-2">
                      <Label className="text-[13px]">{t.backendCustomLabel}</Label>
                      <Input value={String(activeProfile.backendLabel || '')} onChange={(e) => updateActiveProfile({ backendLabel: e.target.value })} />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.endpoint}</Label>
                    <Select value={String(activeProfile.endpointType || 'desktop')} onValueChange={(v) => updateActiveProfile({ endpointType: v === 'terminal' ? 'terminal' : 'desktop' })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="terminal">{t.terminal}</SelectItem>
                        <SelectItem value="desktop">{t.desktop}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.transport}</Label>
                    <Select value={String(activeProfile.transport || 'cdpbridge')} onValueChange={(v) => updateActiveProfile({ transport: v === 'acp' ? 'acp' : 'cdpbridge' })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="acp">{t.acp}</SelectItem>
                        <SelectItem value="cdpbridge">{t.cdpbridge}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.command}</Label>
                    <Input value={String(activeProfile.command || '')} onChange={(e) => updateActiveProfile({ command: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.args}</Label>
                    <Input
                      value={argsText}
                      onChange={(e) => {
                        const text = String(e.target.value || '')
                        const parts = text.split(' ').map((x) => x.trim()).filter(Boolean)
                        updateActiveProfile({ args: parts })
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.cwd}</Label>
                    <Input value={String(activeProfile.cwd || '')} onChange={(e) => updateActiveProfile({ cwd: e.target.value })} />
                  </div>
                  {String(activeProfile.transport || '') === 'cdpbridge' ? (
                    <div className="space-y-2">
                      <Label className="text-[13px]">{t.remoteDebuggingPort}</Label>
                      <Input
                        type="number"
                        value={String(activeProfile.remoteDebuggingPort || 9222)}
                        onChange={(e) => updateActiveProfile({ remoteDebuggingPort: Number(e.target.value || 9222) || 9222 })}
                      />
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 space-y-4">
                <h3 className="text-[13px] font-semibold">{t.commandTemplates}</h3>
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.cmdStatus}</Label>
                    <Input
                      value={String(activeProfile.commandTemplates?.status || '')}
                      onChange={(e) => updateActiveProfile({ commandTemplates: { ...activeProfile.commandTemplates, status: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.cmdSend}</Label>
                    <Input
                      value={String(activeProfile.commandTemplates?.send || '')}
                      onChange={(e) => updateActiveProfile({ commandTemplates: { ...activeProfile.commandTemplates, send: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.cmdAsk}</Label>
                    <Input
                      value={String(activeProfile.commandTemplates?.ask || '')}
                      onChange={(e) => updateActiveProfile({ commandTemplates: { ...activeProfile.commandTemplates, ask: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.cmdRead}</Label>
                    <Input
                      value={String(activeProfile.commandTemplates?.read || '')}
                      onChange={(e) => updateActiveProfile({ commandTemplates: { ...activeProfile.commandTemplates, read: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.cmdNew}</Label>
                    <Input
                      value={String(activeProfile.commandTemplates?.new || '')}
                      onChange={(e) => updateActiveProfile({ commandTemplates: { ...activeProfile.commandTemplates, new: e.target.value } })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[13px]">{t.cmdScreenshot}</Label>
                    <Input
                      value={String(activeProfile.commandTemplates?.screenshot || '')}
                      onChange={(e) => updateActiveProfile({ commandTemplates: { ...activeProfile.commandTemplates, screenshot: e.target.value } })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant={status.running ? 'default' : 'secondary'}>{status.running ? t.running : t.stopped}</Badge>
                  <Badge variant={status.debugPortReady ? 'default' : 'secondary'}>
                    {status.debugPortReady ? t.debugReady : t.debugNotReady}
                  </Badge>
                  {status.pid ? <Badge variant="outline">PID {status.pid}</Badge> : null}
                  {status.lastError ? <div className="text-[12px] text-destructive truncate">{status.lastError}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => void refreshStatus()} disabled={busy} className="gap-2">
                    <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
                    {t.refresh}
                  </Button>
                  <Button onClick={() => void startCoder()} disabled={busy}>{t.start}</Button>
                  <Button variant="destructive" onClick={() => void stopCoder()} disabled={busy}>{t.stop}</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusCenterSettings() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [busyKey, setBusyKey] = useState('')
  const [backendBaseUrl, setBackendBaseUrl] = useState('')
  const language = (settings?.language || 'en') as 'en' | 'zh' | 'ja'

  useEffect(() => {
    let canceled = false
    void resolveBackendBaseUrl()
      .then((url) => {
        if (!canceled) setBackendBaseUrl(String(url || '').trim())
      })
      .catch(() => {
        if (!canceled) setBackendBaseUrl('')
      })
    return () => {
      canceled = true
    }
  }, [])
  const t = useMemo(() => {
    const dict = {
      en: {
        title: 'Status Center',
        desc: 'Configure menu bar tray icons and runtime state display.',
        trayEnabled: 'Enable Menu Bar Icon',
        trayAnimated: 'Enable State Animation',
        frameInterval: 'Animation Interval (ms)',
        states: 'State Icons',
        test: 'Test State',
        upload: 'Upload',
        idle: 'Idle',
        running: 'Running',
        waiting: 'Waiting User',
        done: 'Done',
        error: 'Error',
        frames: 'Image Slots (max 5)',
        firstAsIcon: 'The first image is used as the icon',
        iconBadge: 'Icon'
      },
      zh: {
        title: '状态中心',
        desc: '配置菜单栏图标与运行状态显示。',
        trayEnabled: '启用菜单栏图标',
        trayAnimated: '启用状态动画',
        frameInterval: '动画间隔 (ms)',
        states: '状态图标',
        test: '测试状态',
        upload: '上传',
        idle: '空闲',
        running: '运行中',
        waiting: '等待用户',
        done: '完成',
        error: '错误',
        frames: '图片槽位（最多 5 张）',
        firstAsIcon: '第 1 张默认作为图标',
        iconBadge: '图标'
      },
      ja: {
        title: 'ステータスセンター',
        desc: 'メニューバーアイコンと実行状態表示を設定します。',
        trayEnabled: 'メニューバーアイコンを有効化',
        trayAnimated: '状態アニメーションを有効化',
        frameInterval: 'アニメ間隔 (ms)',
        states: '状態アイコン',
        test: '状態テスト',
        upload: 'アップロード',
        idle: '待機',
        running: '実行中',
        waiting: 'ユーザー待ち',
        done: '完了',
        error: 'エラー',
        frames: '画像スロット（最大5枚）',
        firstAsIcon: '1枚目をアイコンとして使用',
        iconBadge: 'アイコン'
      }
    } as const
    return dict[language] || dict.en
  }, [language])

  const normalize = useCallback((raw: any) => {
    const trayRaw = raw?.tray && typeof raw.tray === 'object' ? raw.tray : {}
    const icon = (entry: any) => {
      const sizesRaw = entry?.sizes && typeof entry.sizes === 'object' ? entry.sizes : {}
      return {
        sizes: {
          '16': String(sizesRaw['16'] || '').trim(),
          '18': String(sizesRaw['18'] || '').trim(),
          '22': String(sizesRaw['22'] || '').trim()
        },
        frames: Array.isArray(entry?.frames) ? entry.frames.slice(0, 5).map((x: any) => String(x || '').trim()) : []
      }
    }
    return {
      tray: {
        enabled: trayRaw.enabled !== false,
        animated: trayRaw.animated !== false,
        frameIntervalMs: Number(trayRaw.frameIntervalMs || 260),
        fallbackToBuiltin: true,
        icons: {
          idle: icon(trayRaw.icons?.idle),
          running: icon(trayRaw.icons?.running),
          waiting_user: icon(trayRaw.icons?.waiting_user),
          done: icon(trayRaw.icons?.done),
          error: icon(trayRaw.icons?.error)
        }
      }
    }
  }, [])

  const statusCenter = useMemo(() => normalize((settings as any)?.statusCenter), [normalize, settings])

  const saveStatusCenter = useCallback(
    (next: any) => {
      updateSettings({ statusCenter: next } as any)
      void window.anima?.statusCenter?.applySettings?.({ settings: next })
    },
    [updateSettings]
  )

  const updateTray = useCallback((patch: Record<string, any>) => {
    const next = normalize(statusCenter)
    next.tray = { ...next.tray, ...patch }
    saveStatusCenter(next)
  }, [normalize, saveStatusCenter, statusCenter])

  const readStateFrames = useCallback((stateKey: 'idle' | 'running' | 'waiting_user' | 'done' | 'error') => {
    const raw = Array.isArray(statusCenter.tray.icons[stateKey].frames) ? statusCenter.tray.icons[stateKey].frames : []
    const list = raw.slice(0, 5).map((x: any) => String(x || '').trim())
    while (list.length < 5) list.push('')
    return list
  }, [statusCenter])

  const saveStateFrames = useCallback((stateKey: 'idle' | 'running' | 'waiting_user' | 'done' | 'error', frames: string[]) => {
    const next = normalize(statusCenter)
    next.tray.icons[stateKey].frames = frames.slice(0, 5).map((x: any) => String(x || '').trim())
    next.tray.icons[stateKey].sizes['22'] = ''
    saveStatusCenter(next)
    void window.anima?.statusCenter?.reloadIcons?.()
  }, [normalize, saveStatusCenter, statusCenter])

  const uploadFrameAt = useCallback(async (stateKey: 'idle' | 'running' | 'waiting_user' | 'done' | 'error', idx: number) => {
    const picker = await window.anima?.window?.pickFiles?.()
    if (!picker?.ok || picker.canceled || !picker.paths?.length) return
    const sourcePath = String(picker.paths[0] || '').trim()
    if (!sourcePath) return
    const busyTag = `${stateKey}:slot:${idx}`
    setBusyKey(busyTag)
    try {
      const saved = await window.anima?.statusCenter?.uploadTrayFrame?.({ state: stateKey, sourcePath })
      if (!saved?.ok || !saved.path) return
      const slots = readStateFrames(stateKey)
      slots[idx] = String(saved.path)
      saveStateFrames(stateKey, slots)
    } finally {
      setBusyKey('')
    }
  }, [readStateFrames, saveStateFrames])

  const removeFrameAt = useCallback((stateKey: 'idle' | 'running' | 'waiting_user' | 'done' | 'error', idx: number) => {
    const slots = readStateFrames(stateKey)
    slots[idx] = ''
    saveStateFrames(stateKey, slots)
  }, [readStateFrames, saveStateFrames])

  const testState = useCallback((state: 'idle' | 'running' | 'waiting_user' | 'done' | 'error') => {
    const titleByState: Record<'idle' | 'running' | 'waiting_user' | 'done' | 'error', string> = {
      idle: t.idle,
      running: t.running,
      waiting_user: t.waiting,
      done: t.done,
      error: t.error
    }
    void window.anima?.statusCenter?.setState?.({ state, title: titleByState[state] || state })
  }, [t])

  const stateRows: Array<{ key: 'running' | 'waiting_user' | 'done' | 'error'; label: string }> = [
    { key: 'running', label: t.running },
    { key: 'waiting_user', label: t.waiting },
    { key: 'done', label: t.done },
    { key: 'error', label: t.error }
  ]

  const stateFrames = (stateKey: 'idle' | 'running' | 'waiting_user' | 'done' | 'error') => readStateFrames(stateKey)
  const frameName = (path: string) => {
    const text = String(path || '').trim()
    if (!text) return ''
    const parts = text.split(/[\\/]/)
    return parts[parts.length - 1] || text
  }
  const frameSrc = (path: string) => {
    const text = String(path || '').trim()
    if (!text) return ''
    if (/^(https?:|data:|blob:)/i.test(text)) return text
    if (backendBaseUrl) return `${backendBaseUrl}/api/attachments/file?path=${encodeURIComponent(text)}`
    return ''
  }

  return (
    <div className="p-7 space-y-5">
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div>
            <h3 className="text-[13px] font-semibold">{t.title}</h3>
            <p className="text-[13px] text-muted-foreground">{t.desc}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
              <Label>{t.trayEnabled}</Label>
              <Switch checked={Boolean(statusCenter.tray.enabled)} onCheckedChange={(v) => updateTray({ enabled: Boolean(v) })} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
              <Label>{t.trayAnimated}</Label>
              <Switch checked={Boolean(statusCenter.tray.animated)} onCheckedChange={(v) => updateTray({ animated: Boolean(v) })} />
            </div>
            <div className="space-y-2">
              <Label>{t.frameInterval}</Label>
              <Input
                value={String(statusCenter.tray.frameIntervalMs || 260)}
                onChange={(e) => updateTray({ frameIntervalMs: Number(e.target.value || 260) })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label>{t.test}</Label>
            <Button size="sm" variant="outline" onClick={() => testState('running')}>{t.running}</Button>
            <Button size="sm" variant="outline" onClick={() => testState('waiting_user')}>{t.waiting}</Button>
            <Button size="sm" variant="outline" onClick={() => testState('done')}>{t.done}</Button>
            <Button size="sm" variant="outline" onClick={() => testState('error')}>{t.error}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 space-y-4">
          <h3 className="text-[13px] font-semibold">{t.states}</h3>
          <div className="text-[11px] text-muted-foreground">{t.firstAsIcon}</div>
          {stateRows.map((row) => (
            <div key={row.key} className="rounded-md border border-border bg-background p-3 space-y-2">
              <div className="font-medium">{row.label}</div>
              <div className="rounded-md border border-border px-2 py-2 space-y-2">
                <div className="text-xs text-muted-foreground">{t.frames}</div>
                <div className="flex flex-wrap gap-2">
                  {stateFrames(row.key).map((p: string, idx: number) => (
                    <div
                      key={`${row.key}-slot-${idx}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void uploadFrameAt(row.key, idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void uploadFrameAt(row.key, idx)
                        }
                      }}
                      className={`group relative h-16 w-16 rounded-md border ${p ? 'border-border bg-muted/40' : 'border-dashed border-border bg-background'} p-2 cursor-pointer overflow-hidden`}
                    >
                      {p ? (
                        <>
                          <img src={frameSrc(p)} alt={frameName(p)} className="h-full w-full rounded object-cover" />
                          <button
                            type="button"
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-background/95 border border-black/10 shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center"
                            disabled={busyKey === `${row.key}:slot:${idx}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              removeFrameAt(row.key, idx)
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                          <Plus className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function AboutSettings() {
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
        checkUpdate: 'Update now',
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
        checkUpdate: '立即更新',
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
        checkUpdate: '今すぐ更新',
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
  const hasUpdate = status === 'available' || status === 'downloading' || status === 'downloaded'

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
    const api = window.anima?.update
    if (!api) return
    setUpdateDialogOpen(true)
    if (status === 'available' && api.download) {
      void api.download()
    }
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-[120px_1fr] gap-y-3 gap-x-4 items-center">
            <div className="text-[13px] text-muted-foreground">{t.name}</div>
            <div className="text-[13px] font-medium">{info.name || 'Anima'}</div>

            <div className="text-[13px] text-muted-foreground">{t.version}</div>
            <div className="text-[13px] font-mono">{version || '--'}</div>

            <div className="text-[13px] text-muted-foreground">{t.author}</div>
            <div className="text-[13px]">{author}</div>

            <div className="text-[13px] text-muted-foreground">{t.github}</div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="text-[13px] font-mono truncate">{repoUrl}</div>
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
            <div className="text-[13px] text-muted-foreground">{statusText}</div>
            {hasUpdate ? (
              <Button onClick={handleCheckUpdate}>{t.checkUpdate}</Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ProvidersSettings() {
  const { providers: providers0, toggleProvider, updateProvider, reorderProviders, addProvider, updateSettings } = useStore()
  const { settings: settings0 } = useStore()
  const loadRemoteConfig = useStore(s => s.loadRemoteConfig)
  const settings = settings0!
  const providers = providers0 ?? EMPTY_PROVIDERS
  const visibleProviders = providers.filter((p) => !p.hiddenInSettings)
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => visibleProviders[0]?.id || providers[0]?.id || '')
  const [searchQuery, setSearchQuery] = useState('')
  const [showProxyEndpoints, setShowProxyEndpoints] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [editingModel, setEditingModel] = useState<ProviderModel | null>(null)
  const [customProviderDialogOpen, setCustomProviderDialogOpen] = useState(false)
  const [customProviderMode, setCustomProviderMode] = useState<'api' | 'acp'>('api')
  const [draggedProviderId, setDraggedProviderId] = useState('')
  const [dragOverProviderId, setDragOverProviderId] = useState('')
  const [qwenAuthProfiles, setQwenAuthProfiles] = useState<Array<{ profileId: string; state: string; expiresAt?: number | null }>>([])
  const [codexAuthProfiles, setCodexAuthProfiles] = useState<Array<{ profileId: string; state: string; expiresAt?: number | null; email?: string }>>([])
  const [qwenLogin, setQwenLogin] = useState<{
    open: boolean
    providerRecordId: string
    flowId: string
    verificationUrl: string
    userCode: string
    expiresAt: number
    pollIntervalMs: number
    state: 'idle' | 'pending' | 'success' | 'error'
    error?: string
  }>({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', userCode: '', expiresAt: 0, pollIntervalMs: 2000, state: 'idle' })
  const [codexLogin, setCodexLogin] = useState<{
    open: boolean
    providerRecordId: string
    flowId: string
    verificationUrl: string
    expiresAt: number
    pollIntervalMs: number
    state: 'idle' | 'pending' | 'success' | 'error'
    error?: string
  }>({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', expiresAt: 0, pollIntervalMs: 1000, state: 'idle' })
  const [codexSyncing, setCodexSyncing] = useState(false)
  const [fetchModelsError, setFetchModelsError] = useState<{ open: boolean; message: string }>({ open: false, message: '' })

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
      openai_codex: 'openai',
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
        addLocalOllama: 'Add Ollama (Local)',
        addLocalLmStudio: 'Add LM Studio (Local)',
        detectLocalModels: 'Detect Local Models',
        localProviderHint: 'Local provider does not require API key.',
        active: 'Active',
        inactive: 'Inactive',
        default: 'Default',
        setDefault: 'Set Default',
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
        copied: 'Copied',
        fillBaseUrlFirst: 'Please enter Base URL first',
        fillApiKeyFirst: 'Please enter API Key first',
        detectLocalFailedHint: 'Failed to detect local models. Please ensure local server is running: Ollama http://127.0.0.1:11434 , LM Studio http://127.0.0.1:1234.',
        qwenOAuthDesc: 'Device code login; credentials stay in local backend',
        codexOAuthDesc: 'Browser login; credentials stay in local backend',
        codexAuthRootDir: 'Codex auth root dir',
        codexAuthRootDirHint: 'Default is ~/.codex. Sync reads auth.json from this directory.',
        syncAccount: 'Sync account',
        syncing: 'Syncing...',
        signIn: 'Sign in',
        logout: 'Logout',
        profile: 'Profile',
        email: 'Email',
        status: 'Status',
        loggedIn: 'Logged in',
        expired: 'Expired',
        notLoggedIn: 'Not logged in',
        acpKind: 'ACP Kind',
        framing: 'Framing',
        command: 'Command',
        args: 'Args',
        approvalMode: 'Approval Mode',
        env: 'Env (KEY=VALUE)',
        testAcp: 'Test ACP',
        resetApprovals: 'Reset approvals',
        apiFormatHint: 'Choose the API endpoint format your provider uses',
        fetchModels: 'Fetch Models',
        noModelsConfigured: 'No models configured.',
        hiddenModelsHint: 'Models are hidden by default. Click Fetch Models to load and manage them.',
        selectProviderHint: 'Select a provider to configure',
        openAuthLink: 'Open the authorization link',
        openAuthLinkLocalRedirect: 'Open the authorization link (redirects back to localhost)',
        openInBrowser: 'Open in browser',
        userCodeIfPrompted: 'User code (if prompted)',
        waitingForApproval: 'Waiting for approval…',
        oauthFailed: 'OAuth failed',
        oauthSuccess: 'Success',
        close: 'Close'
      },
      zh: {
        search: '搜索提供商…',
        addCustom: '添加自定义 Provider',
        addCustomAcp: '添加自定义 ACP Provider',
        addLocalOllama: '添加 Ollama（本地）',
        addLocalLmStudio: '添加 LM Studio（本地）',
        detectLocalModels: '探测本地模型',
        localProviderHint: '本地 provider 不需要 API Key。',
        active: '启用',
        inactive: '未启用',
        default: '默认',
        setDefault: '设为默认',
        apiKey: 'API Key',
        baseUrl: 'Base URL (Optional)',
        baseUrlHint: '留空则使用默认 OpenAI API 端点',
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
        copied: '已复制',
        fillBaseUrlFirst: '请先填写 Base URL',
        fillApiKeyFirst: '请先填写 API Key',
        detectLocalFailedHint: '本地模型探测失败。请确认本地服务已启动：Ollama http://127.0.0.1:11434 ，LM Studio http://127.0.0.1:1234。',
        qwenOAuthDesc: '使用设备码登录，凭据仅保存在本地后端',
        codexOAuthDesc: '浏览器登录，凭据仅保存在本地后端',
        codexAuthRootDir: 'Codex 授权根目录',
        codexAuthRootDirHint: '默认是 ~/.codex。同步账号会读取该目录下的 auth.json。',
        syncAccount: '同步账号',
        syncing: '同步中...',
        signIn: '登录',
        logout: '退出',
        profile: 'Profile',
        email: '邮箱',
        status: '状态',
        loggedIn: '已登录',
        expired: '已过期',
        notLoggedIn: '未登录',
        acpKind: 'ACP 类型',
        framing: '分帧',
        command: '命令',
        args: '参数',
        approvalMode: '审批模式',
        env: '环境变量（KEY=VALUE）',
        testAcp: '测试 ACP',
        resetApprovals: '重置审批',
        apiFormatHint: '选择该 Provider 使用的 API 端点格式',
        fetchModels: '拉取模型',
        noModelsConfigured: '暂无已配置模型。',
        hiddenModelsHint: '默认不展示模型列表。点击“拉取模型”后再进行选择与管理。',
        selectProviderHint: '请选择要配置的 Provider',
        openAuthLink: '打开链接授权',
        openAuthLinkLocalRedirect: '打开链接授权（会回调到本机）',
        openInBrowser: '在浏览器打开',
        userCodeIfPrompted: '验证码（如提示）',
        waitingForApproval: '等待授权完成…',
        oauthFailed: 'OAuth 失败',
        oauthSuccess: '登录成功',
        close: '关闭'
      },
      ja: {
        search: 'Provider を検索…',
        addCustom: 'カスタム Provider を追加',
        addCustomAcp: 'カスタム ACP Provider を追加',
        addLocalOllama: 'Ollama（ローカル）を追加',
        addLocalLmStudio: 'LM Studio（ローカル）を追加',
        detectLocalModels: 'ローカルモデルを検出',
        localProviderHint: 'ローカル Provider では API Key は不要です。',
        active: '有効',
        inactive: '無効',
        default: 'デフォルト',
        setDefault: 'デフォルトに設定',
        apiKey: 'API Key',
        baseUrl: 'Base URL（任意）',
        baseUrlHint: '空欄の場合は既定の API エンドポイントを使用します',
        thinkingMode: '思考モード',
        thinkingModeHint: 'reasoning_content 出力を有効化（DeepSeek）。',
        models: 'モデル',
        defaultModel: 'デフォルトモデル',
        manageModels: 'モデル管理',
        enterModelId: 'モデル ID を入力',
        enterApiKey: 'API Key を入力',
        getKey: (name: string) => `${name} の API Keys で API Key を取得`,
        proxyEndpoints: 'API プロキシエンドポイント',
        advanced: '詳細',
        proxyDesc: (name: string) => `Anima は ${name} 向けに API プロキシを提供します。リクエストは Chat Completions 形式に変換され、さまざまな AI ツールと互換になります。`,
        responsesProxy: 'Responses API プロキシ',
        messagesProxy: 'Messages API プロキシ',
        responsesProxyDesc: (name: string) => `${name} Responses API（Codex など）が必要なツール向けのエンドポイントです。リクエストは Chat Completions 形式に変換されます。`,
        messagesProxyDesc: 'Anthropic 互換ツール向けのエンドポイントです。リクエストは Chat Completions 形式に変換されます。',
        useWithClaude: 'Claude Code で使用',
        useWithClaudeDesc: '次の環境変数を設定すると、この Provider を Claude Code で使えます。',
        copy: 'コピー',
        copied: 'コピーしました',
        fillBaseUrlFirst: '先に Base URL を入力してください',
        fillApiKeyFirst: '先に API Key を入力してください',
        detectLocalFailedHint: 'ローカルモデルの検出に失敗しました。ローカルサーバーが起動していることを確認してください: Ollama http://127.0.0.1:11434 , LM Studio http://127.0.0.1:1234.',
        qwenOAuthDesc: 'デバイスコードでログイン。認証情報はローカルバックエンドのみに保存されます',
        codexOAuthDesc: 'ブラウザログイン。認証情報はローカルバックエンドのみに保存されます',
        codexAuthRootDir: 'Codex 認証ルート',
        codexAuthRootDirHint: '既定値は ~/.codex。このディレクトリの auth.json を同期します。',
        syncAccount: 'アカウント同期',
        syncing: '同期中...',
        signIn: 'ログイン',
        logout: 'ログアウト',
        profile: 'Profile',
        email: 'メール',
        status: '状態',
        loggedIn: 'ログイン済み',
        expired: '期限切れ',
        notLoggedIn: '未ログイン',
        acpKind: 'ACP 種別',
        framing: 'フレーミング',
        command: 'コマンド',
        args: '引数',
        approvalMode: '承認モード',
        env: '環境変数（KEY=VALUE）',
        testAcp: 'ACP テスト',
        resetApprovals: '承認をリセット',
        apiFormatHint: 'この Provider が使う API エンドポイント形式を選択します',
        fetchModels: 'モデル取得',
        noModelsConfigured: 'モデルが設定されていません。',
        hiddenModelsHint: 'モデル一覧は初期状態で非表示です。「モデル取得」をクリックして読み込み・管理してください。',
        selectProviderHint: '設定する Provider を選択してください',
        openAuthLink: '認可リンクを開く',
        openAuthLinkLocalRedirect: '認可リンクを開く（localhost にリダイレクト）',
        openInBrowser: 'ブラウザで開く',
        userCodeIfPrompted: 'ユーザーコード（必要な場合）',
        waitingForApproval: '認可完了を待機中…',
        oauthFailed: 'OAuth 失敗',
        oauthSuccess: '成功',
        close: '閉じる'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const activeProvider = providers.find(p => p.id === selectedProviderId)
  const defaultProviderId = String((settings as any).defaultProviderId || '').trim()
  const isDefaultProvider = Boolean(activeProvider && String(activeProvider.id || '').trim() === defaultProviderId)
  const hasFetchedModels = Boolean(activeProvider?.config?.modelsFetched)
  const activeProviderIdLower = String(activeProvider?.id || '').toLowerCase()
  const activeProviderNameLower = String(activeProvider?.name || '').toLowerCase()
  const activeProviderAuthModeLower = String(activeProvider?.auth?.mode || '').toLowerCase()
  const isAcp = Boolean(activeProvider && String(activeProvider.type || '').toLowerCase() === 'acp')
  const isLocalProvider = Boolean(
    activeProvider &&
      ['ollama_local', 'lmstudio_local'].includes(String(activeProvider.id || '').toLowerCase())
  )
  const isQwen = Boolean(
    activeProvider &&
      (
        activeProviderAuthModeLower === 'oauth_device_code' &&
        (
          ['qwen_auth', 'qwen-portal', 'qwen-auth'].includes(activeProviderIdLower) ||
          activeProviderNameLower.includes('qwen')
        )
      )
  )
  const isCodex = Boolean(activeProvider && (String(activeProvider.type || '').toLowerCase() === 'openai_codex' || activeProviderNameLower.includes('codex')))
  const isOAuthProvider = !isAcp && (isQwen || isCodex)
  const qwenProfileId = String(activeProvider?.auth?.profileId || 'default').trim() || 'default'
  const codexProfileId = String(activeProvider?.auth?.profileId || 'default').trim() || 'default'
  const codexAuthRootDir = String((activeProvider?.config as any)?.authRootDir || '~/.codex').trim() || '~/.codex'
  const acpConfig = ((activeProvider?.config as any)?.acp || {}) as any
  
  const filteredProviders = visibleProviders.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  useEffect(() => {
    if (!selectedProviderId) {
      if (visibleProviders[0]?.id) setSelectedProviderId(visibleProviders[0].id)
      return
    }
    const selected = providers.find((p) => p.id === selectedProviderId)
    if (!selected || selected.hiddenInSettings) {
      if (visibleProviders[0]?.id) setSelectedProviderId(visibleProviders[0].id)
    }
  }, [providers, selectedProviderId, visibleProviders])

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
    if (isAcp) return
    if (!activeProvider.config.baseUrl) {
      alert(t.fillBaseUrlFirst)
      return
    }
    if (!isOAuthProvider && !isLocalProvider && !activeProvider.config.apiKey) {
      alert(t.fillApiKeyFirst)
      return
    }
    setIsFetchingModels(true)
    try {
      const res = await fetchBackendJson<{ ok: boolean; models?: any[] }>('/api/providers/fetch_models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: isOAuthProvider ? activeProvider.id : undefined,
          profileId: isQwen ? qwenProfileId : (isCodex ? codexProfileId : undefined),
          useQwenOAuth: isQwen ? true : undefined,
          useCodexOAuth: isCodex ? true : undefined,
          baseUrl: activeProvider.config.baseUrl || '',
          apiKey: isOAuthProvider ? undefined : (activeProvider.config.apiKey || '')
        })
      })
      if (res.ok && Array.isArray(res.models)) {
        const existingModels = normalizeModels(activeProvider.config.models)
        const newModels = res.models.map((m: any) => {
          const id = typeof m === 'string' ? m : m.id
          const existing = existingModels.find(em => em.id === id)
          if (existing) return existing
          if (m && typeof m === 'object') {
            const cfg = m.config && typeof m.config === 'object' ? m.config : {}
            return { id, isEnabled: m.isEnabled !== false, config: { id, ...cfg } }
          }
          return { id, isEnabled: true, config: { id } }
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
      const raw = e instanceof Error ? e.message : String(e || 'Failed to fetch models')
      if (isLocalProvider) {
        const hint = t.detectLocalFailedHint
        setFetchModelsError({ open: true, message: `${raw}\n\n${hint}` })
      } else {
        setFetchModelsError({ open: true, message: raw })
      }
    } finally {
      setIsFetchingModels(false)
    }
  }

  const refreshQwenProfiles = useCallback(async () => {
    if (!isQwen) return
    const res = await fetchBackendJson<{ ok: boolean; profiles?: Array<{ profileId: string; state: string; expiresAt?: number | null }> }>(
      '/api/providers/auth/profiles',
      { method: 'GET' }
    )
    const profiles = Array.isArray(res?.profiles) ? res.profiles : []
    setQwenAuthProfiles(
      profiles
        .map((p: any) => ({
          profileId: String(p?.profileId || '').trim(),
          state: String(p?.state || '').trim(),
          expiresAt: p?.expiresAt == null ? null : Number(p.expiresAt)
        }))
        .filter((p: any) => Boolean(p.profileId))
    )
  }, [isQwen])

  useEffect(() => {
    void refreshQwenProfiles().catch(() => {})
  }, [refreshQwenProfiles, selectedProviderId])

  const startQwenLogin = useCallback(async () => {
    if (!activeProvider) return
    setQwenLogin({
      open: true,
      providerRecordId: activeProvider.id,
      flowId: '',
      verificationUrl: '',
      userCode: '',
      expiresAt: 0,
      pollIntervalMs: 2000,
      state: 'pending'
    })
    const res = await fetchBackendJson<{
      ok: boolean
      flowId: string
      verificationUrl: string
      userCode: string
      expiresAt: number
      pollIntervalMs: number
    }>('/api/providers/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: activeProvider.id, profileId: qwenProfileId })
    })
    setQwenLogin({
      open: true,
      providerRecordId: activeProvider.id,
      flowId: String(res.flowId || ''),
      verificationUrl: String(res.verificationUrl || ''),
      userCode: String(res.userCode || ''),
      expiresAt: Number(res.expiresAt || 0),
      pollIntervalMs: Number(res.pollIntervalMs || 2000),
      state: 'pending'
    })
  }, [activeProvider, qwenProfileId])

  const logoutQwen = useCallback(async () => {
    if (!activeProvider) return
    await fetchBackendJson<{ ok: boolean }>('/api/providers/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: activeProvider.id, profileId: qwenProfileId })
    })
    await refreshQwenProfiles().catch(() => {})
    updateProvider(activeProvider.id, { auth: { mode: 'oauth_device_code', profileId: qwenProfileId } })
  }, [activeProvider, qwenProfileId, refreshQwenProfiles, updateProvider])

  useEffect(() => {
    if (!qwenLogin.open || !qwenLogin.flowId) return
    if (qwenLogin.state !== 'pending') return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const res = await fetchBackendJson<any>(`/api/providers/auth/status?flowId=${encodeURIComponent(qwenLogin.flowId)}`, {
          method: 'GET'
        })
        const state = String(res?.state || '').trim()
        if (state === 'pending') {
          return
        }
        if (state === 'error') {
          setQwenLogin((s) => ({ ...s, state: 'error', error: String(res?.error || 'OAuth failed') }))
          return
        }
        if (state === 'success') {
          const patch = res?.configPatch || {}
          const providerRecordId = qwenLogin.providerRecordId
          if (providerRecordId) {
            updateProvider(providerRecordId, { auth: { mode: 'oauth_device_code', profileId: qwenProfileId } })
            updateProvider(providerRecordId, {
              baseUrl: patch.baseUrl || (activeProvider?.config?.baseUrl || ''),
              models: Array.isArray(patch.models) ? patch.models : (activeProvider?.config?.models || []),
              selectedModel: patch.selectedModel || (activeProvider?.config?.selectedModel || ''),
              modelsFetched: true,
              apiKey: ''
            })
          }
          setQwenLogin((s) => ({ ...s, state: 'success' }))
          await refreshQwenProfiles().catch(() => {})
          await loadRemoteConfig().catch(() => {})
          setQwenLogin({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', userCode: '', expiresAt: 0, pollIntervalMs: 2000, state: 'idle' })
        }
      } catch (e) {
        setQwenLogin((s) => ({ ...s, state: 'error', error: e instanceof Error ? e.message : 'OAuth failed' }))
      }
    }
    const timer = window.setInterval(tick, Math.max(500, qwenLogin.pollIntervalMs || 2000))
    void tick()
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [qwenLogin.open, qwenLogin.flowId, qwenLogin.pollIntervalMs, qwenLogin.state, qwenLogin.providerRecordId, qwenProfileId, activeProvider, loadRemoteConfig, refreshQwenProfiles, updateProvider])

  const refreshCodexProfiles = useCallback(async () => {
    if (!isCodex || !activeProvider) return
    const res = await fetchBackendJson<{ ok: boolean; profiles?: Array<{ profileId: string; state: string; expiresAt?: number | null; email?: string | null }> }>(
      `/api/providers/auth/profiles?providerId=${encodeURIComponent(activeProvider.id)}`,
      { method: 'GET' }
    )
    const profiles = Array.isArray(res?.profiles) ? res.profiles : []
    setCodexAuthProfiles(
      profiles
        .map((p: any) => ({
          profileId: String(p?.profileId || '').trim(),
          state: String(p?.state || '').trim(),
          expiresAt: p?.expiresAt == null ? null : Number(p.expiresAt),
          email: String(p?.email || '').trim() || undefined
        }))
        .filter((p: any) => Boolean(p.profileId))
    )
  }, [activeProvider, isCodex])

  useEffect(() => {
    void refreshCodexProfiles().catch(() => {})
  }, [refreshCodexProfiles, selectedProviderId])

  const startCodexLogin = useCallback(async () => {
    if (!activeProvider) return
    setCodexLogin({
      open: true,
      providerRecordId: activeProvider.id,
      flowId: '',
      verificationUrl: '',
      expiresAt: 0,
      pollIntervalMs: 1000,
      state: 'pending'
    })
    const res = await fetchBackendJson<{
      ok: boolean
      flowId: string
      verificationUrl: string
      expiresAt: number
      pollIntervalMs: number
    }>('/api/providers/auth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: activeProvider.id, profileId: codexProfileId })
    })
    setCodexLogin({
      open: true,
      providerRecordId: activeProvider.id,
      flowId: String(res.flowId || ''),
      verificationUrl: String(res.verificationUrl || ''),
      expiresAt: Number(res.expiresAt || 0),
      pollIntervalMs: Number(res.pollIntervalMs || 1000),
      state: 'pending'
    })
  }, [activeProvider, codexProfileId])

  const logoutCodex = useCallback(async () => {
    if (!activeProvider) return
    await fetchBackendJson<{ ok: boolean }>('/api/providers/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: activeProvider.id, profileId: codexProfileId })
    })
    await refreshCodexProfiles().catch(() => {})
    updateProvider(activeProvider.id, { auth: { mode: 'oauth_openai_codex', profileId: codexProfileId } })
  }, [activeProvider, codexProfileId, refreshCodexProfiles, updateProvider])

  const syncCodexAccount = useCallback(async () => {
    if (!activeProvider) return
    setCodexSyncing(true)
    try {
      const res = await fetchBackendJson<any>('/api/providers/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: activeProvider.id,
          profileId: codexProfileId,
          authRootDir: codexAuthRootDir
        })
      })
      const patch = res?.configPatch || {}
      updateProvider(activeProvider.id, { auth: { mode: 'oauth_openai_codex', profileId: codexProfileId } })
      updateProvider(activeProvider.id, {
        baseUrl: patch.baseUrl || (activeProvider?.config?.baseUrl || ''),
        models: Array.isArray(patch.models) ? patch.models : (activeProvider?.config?.models || []),
        selectedModel: patch.selectedModel || (activeProvider?.config?.selectedModel || ''),
        modelsFetched: true,
        authRootDir: String(res?.source?.authRootDir || codexAuthRootDir).trim() || codexAuthRootDir,
        apiKey: ''
      } as any)
      await refreshCodexProfiles().catch(() => {})
      await loadRemoteConfig().catch(() => {})
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e || 'Sync failed')
      setFetchModelsError({ open: true, message: raw })
    } finally {
      setCodexSyncing(false)
    }
  }, [activeProvider, codexProfileId, codexAuthRootDir, refreshCodexProfiles, loadRemoteConfig, updateProvider])

  useEffect(() => {
    if (!codexLogin.open || !codexLogin.flowId) return
    if (codexLogin.state !== 'pending') return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const res = await fetchBackendJson<any>(`/api/providers/auth/status?flowId=${encodeURIComponent(codexLogin.flowId)}`, {
          method: 'GET'
        })
        const state = String(res?.state || '').trim()
        if (state === 'pending') return
        if (state === 'error') {
          setCodexLogin((s) => ({ ...s, state: 'error', error: String(res?.error || 'OAuth failed') }))
          return
        }
        if (state === 'success') {
          const patch = res?.configPatch || {}
          const providerRecordId = codexLogin.providerRecordId
          if (providerRecordId) {
            updateProvider(providerRecordId, { auth: { mode: 'oauth_openai_codex', profileId: codexProfileId } })
            updateProvider(providerRecordId, {
              baseUrl: patch.baseUrl || (activeProvider?.config?.baseUrl || ''),
              models: Array.isArray(patch.models) ? patch.models : (activeProvider?.config?.models || []),
              selectedModel: patch.selectedModel || (activeProvider?.config?.selectedModel || ''),
              modelsFetched: true,
              apiKey: ''
            })
          }
          setCodexLogin((s) => ({ ...s, state: 'success' }))
          await refreshCodexProfiles().catch(() => {})
          await loadRemoteConfig().catch(() => {})
          setCodexLogin({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', expiresAt: 0, pollIntervalMs: 1000, state: 'idle' })
        }
      } catch (e) {
        setCodexLogin((s) => ({ ...s, state: 'error', error: e instanceof Error ? e.message : 'OAuth failed' }))
      }
    }
    const timer = window.setInterval(tick, Math.max(500, codexLogin.pollIntervalMs || 1000))
    void tick()
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [codexLogin.open, codexLogin.flowId, codexLogin.pollIntervalMs, codexLogin.state, codexLogin.providerRecordId, codexProfileId, activeProvider, loadRemoteConfig, refreshCodexProfiles, updateProvider])

  const toggleModel = (modelId: string, enabled: boolean) => {
    if (!activeProvider) return
    const current = normalizeModels(activeProvider.config.models)
    const newModels = current.map(m => m.id === modelId ? { ...m, isEnabled: enabled } : m)
    updateProvider(activeProvider.id, { models: newModels })
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Providers List - Left Column */}
      <div className="w-64 min-w-64 shrink-0 border-r border-border/60 p-4 pr-5 flex flex-col gap-3 bg-card/35">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground z-10" />
          <Input
            type="text"
            placeholder={t.search}
            className="pl-9 bg-background/80"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
          {filteredProviders.map(provider => (
            <div
              key={provider.id}
              draggable
              onDragStart={(e) => {
                setDraggedProviderId(provider.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', provider.id)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (draggedProviderId && draggedProviderId !== provider.id) setDragOverProviderId(provider.id)
              }}
              onDragLeave={() => {
                if (dragOverProviderId === provider.id) setDragOverProviderId('')
              }}
              onDrop={(e) => {
                e.preventDefault()
                const sourceId = String(e.dataTransfer.getData('text/plain') || draggedProviderId).trim()
                if (sourceId && sourceId !== provider.id) reorderProviders(sourceId, provider.id)
                setDraggedProviderId('')
                setDragOverProviderId('')
              }}
              onDragEnd={() => {
                setDraggedProviderId('')
                setDragOverProviderId('')
              }}
              className={`rounded-lg transition-colors ${
                dragOverProviderId === provider.id ? 'bg-primary/10' : ''
              } ${draggedProviderId === provider.id ? 'opacity-60' : ''}`}
            >
              <Button
                variant={selectedProviderId === provider.id ? "secondary" : "ghost"}
                onClick={() => setSelectedProviderId(provider.id)}
                className={`w-full justify-between h-auto py-2.5 px-3 font-normal rounded-lg hover:bg-muted/50 cursor-grab active:cursor-grabbing ${
                  selectedProviderId === provider.id
                    ? 'bg-card border border-border/70 shadow-none'
                    : ''
                }`}
              >
                <div className="flex items-center gap-3">
                   <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${
                      selectedProviderId === provider.id ? 'bg-secondary/70' : 'bg-transparent'
                   }`}>
                      {getProviderIconUrl(provider) ? <img src={getProviderIconUrl(provider)} className="w-4 h-4" /> : provider.name[0]}
                   </div>
                   <span className="truncate max-w-[120px]">{provider.name}</span>
                </div>
                <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${provider.isEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Provider Details - Right Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Actions Bar */}
        <div className="px-6 pt-3 pb-3 border-b border-border/60">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              className="h-9 rounded-full px-4 shrink-0 whitespace-nowrap"
              onClick={() => {
                setCustomProviderMode('api')
                setCustomProviderDialogOpen(true)
              }}
            >
              {t.addCustom}
            </Button>
            <Button
              variant="outline"
              className="h-9 rounded-full px-4 bg-card/70 shrink-0 whitespace-nowrap"
              onClick={() => {
                setCustomProviderMode('acp')
                setCustomProviderDialogOpen(true)
              }}
            >
              {t.addCustomAcp}
            </Button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 pb-8 pt-1 custom-scrollbar">
          {activeProvider ? (
            <div className="max-w-[820px] space-y-5 animate-in fade-in duration-300">
              {isLocalProvider ? (
                <div className="text-[12px] text-muted-foreground rounded-md border border-border bg-background px-3 py-2">
                  {t.localProviderHint}
                </div>
              ) : null}
              
              {/* Header Card */}
              <Card className="border-border/60 bg-background/40 shadow-none">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                       <h2 className="text-2xl font-semibold text-foreground">{activeProvider.name}</h2>
                       <Badge variant="outline" className={`font-medium border-0 ${
                          activeProvider.isEnabled 
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground'
                       }`}>
                         {activeProvider.isEnabled ? t.active : t.inactive}
                       </Badge>
                       {isDefaultProvider ? (
                         <Badge variant="outline" className="font-medium border-0 bg-primary/10 text-primary">
                           {t.default}
                         </Badge>
                       ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                       <Button
                          type="button"
                          variant={isDefaultProvider ? 'secondary' : 'outline'}
                          size="sm"
                          disabled={!activeProvider.isEnabled || isDefaultProvider}
                          onClick={() => updateSettings({ defaultProviderId: String(activeProvider.id || '').trim() } as any)}
                       >
                          {isDefaultProvider ? t.default : t.setDefault}
                       </Button>
                       <Switch 
                          checked={activeProvider.isEnabled}
                          onCheckedChange={(c) => toggleProvider(activeProvider.id, c)}
                       />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-[13px] leading-relaxed">
                    {activeProvider.description}
                  </p>
                </CardContent>
              </Card>

              {!isAcp && (
              <Card className="overflow-hidden">
                 <Button 
                    variant="ghost"
                    onClick={() => setShowProxyEndpoints(!showProxyEndpoints)}
                    className="w-full flex items-center justify-between px-6 py-4 h-auto hover:bg-secondary rounded-none"
                 >
                    <div className="flex items-center gap-2 font-medium text-[13px]">
                       <Cpu className="w-4 h-4" />
                       {t.proxyEndpoints}
                       <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 h-auto font-medium">{t.advanced}</Badge>
                    </div>
                    {showProxyEndpoints ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                 </Button>
                 
                 {showProxyEndpoints && (
                    <CardContent className="p-6 space-y-6 border-t border-border">
                       <p className="text-[13px] text-muted-foreground">
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
                             <code className="block w-full bg-secondary rounded-lg px-4 py-3 text-[13px] font-mono text-muted-foreground break-all">
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
                             <code className="block w-full bg-secondary rounded-lg px-4 py-3 text-[13px] font-mono text-muted-foreground break-all">
                                http://localhost:23001/anthropic-proxy/openai/v1/messages
                             </code>
                          </div>
                          <p className="text-xs text-muted-foreground">{t.messagesProxyDesc}</p>
                       </div>

                       {/* Claude Code Section */}
                      <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 space-y-3">
                         <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-primary font-medium text-[13px]">
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
              )}


              {!isAcp && !isOAuthProvider && (
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
              )}

              {!isAcp && isQwen && (
                <Card>
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>Qwen OAuth</Label>
                        <p className="text-xs text-muted-foreground">
                          {t.qwenOAuthDesc}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => void startQwenLogin()}>
                          {t.signIn}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void logoutQwen()}>
                          {t.logout}
                        </Button>
                      </div>
                    </div>

                    <div className="text-[13px]">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t.profile}</span>
                        <span className="font-mono">{qwenProfileId}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t.status}</span>
                        <span>
                          {(() => {
                            const p = qwenAuthProfiles.find(x => x.profileId === qwenProfileId) || qwenAuthProfiles[0]
                            const st = String(p?.state || 'not_logged_in')
                            if (st === 'valid') return t.loggedIn
                            if (st === 'expired') return t.expired
                            return t.notLoggedIn
                          })()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!isAcp && isCodex && (
                <Card>
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label>OpenAI Codex OAuth</Label>
                        <p className="text-xs text-muted-foreground">
                          {t.codexOAuthDesc}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => void startCodexLogin()}>
                          {t.signIn}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => void syncCodexAccount()} disabled={codexSyncing}>
                          {codexSyncing ? t.syncing : t.syncAccount}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void logoutCodex()}>
                          {t.logout}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label>{t.codexAuthRootDir}</Label>
                      <Input
                        value={codexAuthRootDir}
                        onChange={(e) => updateProvider(activeProvider.id, { authRootDir: e.target.value } as any)}
                        placeholder="~/.codex"
                      />
                      <p className="text-xs text-muted-foreground">{t.codexAuthRootDirHint}</p>
                    </div>

                    <div className="text-[13px]">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t.profile}</span>
                        <span className="font-mono">{codexProfileId}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t.email}</span>
                        <span className="font-mono">
                          {(() => {
                            const p = codexAuthProfiles.find(x => x.profileId === codexProfileId) || codexAuthProfiles[0]
                            return String(p?.email || '--')
                          })()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t.status}</span>
                        <span>
                          {(() => {
                            const p = codexAuthProfiles.find(x => x.profileId === codexProfileId) || codexAuthProfiles[0]
                            const st = String(p?.state || 'not_logged_in')
                            if (st === 'valid') return t.loggedIn
                            if (st === 'expired') return t.expired
                            return t.notLoggedIn
                          })()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {isAcp ? (
                <Card className="border-border/60 shadow-none">
                  <CardContent className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label>{t.acpKind}</Label>
                        <Select
                          value={String(acpConfig.kind || 'native_acp')}
                          onValueChange={(val) => updateProvider(activeProvider.id, { acp: { ...acpConfig, kind: val } } as any)}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="native_acp">native_acp</SelectItem>
                            <SelectItem value="adapter">adapter</SelectItem>
                            <SelectItem value="acpx_bridge">acpx_bridge</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>{t.framing}</Label>
                        <Select
                          value={String(acpConfig.framing || 'auto')}
                          onValueChange={(val) => updateProvider(activeProvider.id, { acp: { ...acpConfig, framing: val } } as any)}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">auto</SelectItem>
                            <SelectItem value="jsonl">jsonl</SelectItem>
                            <SelectItem value="content_length">content_length</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>{t.command}</Label>
                      <Input
                        value={String(acpConfig.command || '')}
                        onChange={(e) => updateProvider(activeProvider.id, { acp: { ...acpConfig, command: e.target.value } } as any)}
                        placeholder="codex-acp"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t.args}</Label>
                      <Input
                        value={Array.isArray(acpConfig.args) ? acpConfig.args.join(' ') : String(acpConfig.args || '')}
                        onChange={(e) => updateProvider(activeProvider.id, { acp: { ...acpConfig, args: String(e.target.value || '').trim() ? String(e.target.value || '').trim().split(/\s+/) : [] } } as any)}
                        placeholder="--flag value"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t.approvalMode}</Label>
                      <Select
                        value={String(acpConfig.approvalMode || 'per_action')}
                        onValueChange={(val) => updateProvider(activeProvider.id, { acp: { ...acpConfig, approvalMode: val } } as any)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="per_action">per_action</SelectItem>
                          <SelectItem value="per_project">per_project</SelectItem>
                          <SelectItem value="always">always</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>{t.env}</Label>
                      <Textarea
                        className="font-mono text-xs"
                        rows={4}
                        value={
                          acpConfig.env && typeof acpConfig.env === 'object'
                            ? Object.entries(acpConfig.env as Record<string, any>).map(([k, v]) => `${String(k)}=${String(v ?? '')}`).join('\n')
                            : ''
                        }
                        onChange={(e) => {
                          const env: Record<string, string> = {}
                          for (const line of String(e.target.value || '').split(/\r?\n/)) {
                            const raw = String(line || '').trim()
                            if (!raw) continue
                            const idx = raw.indexOf('=')
                            if (idx <= 0) continue
                            env[raw.slice(0, idx).trim()] = raw.slice(idx + 1)
                          }
                          updateProvider(activeProvider.id, { acp: { ...acpConfig, env } } as any)
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const api = window.anima?.acp
                          if (!api) return
                          const workspaceDir = String((settings as any)?.workspaceDir || '').trim()
                          if (!workspaceDir) return
                          const res = await api.createSession({
                            workspaceDir,
                            threadId: `acp_test_${Date.now()}`,
                            approvalMode: String(acpConfig.approvalMode || 'per_action') as any,
                            agent: {
                              id: activeProvider.id,
                              name: activeProvider.name,
                              kind: String(acpConfig.kind || 'native_acp') as any,
                              command: String(acpConfig.command || ''),
                              args: Array.isArray(acpConfig.args) ? acpConfig.args : [],
                              env: acpConfig.env && typeof acpConfig.env === 'object' ? acpConfig.env : {},
                              framing: String(acpConfig.framing || 'auto') as any
                            }
                          })
                          if (res?.ok && res.sessionId) await api.close({ sessionId: String(res.sessionId) })
                        }}
                      >
                        {t.testAcp}
                      </Button>
                      <Button variant="outline" size="sm" onClick={async () => {
                        const res = await window.anima.acp.resetApprovals()
                        if (!res?.ok) throw new Error(String((res as any)?.error || 'reset failed'))
                      }}>
                        {t.resetApprovals}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
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
                          {t.apiFormatHint}
                        </p>
                      </div>
                    )}
                 </CardContent>
              </Card>
              )}



              {/* Models Section */}
              <Card>
                 <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                       <Label>{t.models}</Label>
                       <Button 
                         variant="outline" 
                         size="sm" 
                         onClick={handleFetchModels}
                         disabled={isFetchingModels || isAcp}
                         className="gap-2"
                       >
                         {isFetchingModels ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                         {isLocalProvider ? t.detectLocalModels : t.fetchModels}
                       </Button>
                    </div>

                    {isAcp || hasFetchedModels ? (
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
                               <div key={model.id} className="flex items-center justify-between p-3 text-[13px]">
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
                                   {t.noModelsConfigured}
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
                        {t.hiddenModelsHint}
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
              <p>{t.selectProviderHint}</p>
            </div>
          )}
        </div>
      </div>
      
      <Dialog
        open={qwenLogin.open}
        onOpenChange={(open) => {
          if (open) return
          setQwenLogin({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', userCode: '', expiresAt: 0, pollIntervalMs: 2000, state: 'idle' })
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Qwen OAuth</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.openAuthLink}</Label>
              <div className="relative group">
                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(qwenLogin.verificationUrl)}
                    className="h-8 w-8 hover:bg-secondary text-muted-foreground transition-colors"
                    disabled={!qwenLogin.verificationUrl}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <code className="block w-full bg-secondary rounded-lg px-4 py-3 text-[13px] font-mono text-muted-foreground break-all">
                  {qwenLogin.verificationUrl || '-'}
                </code>
              </div>
              {qwenLogin.verificationUrl && (
                <a
                  href={qwenLogin.verificationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  {t.openInBrowser}
                </a>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t.userCodeIfPrompted}</Label>
              <div className="flex items-center justify-between gap-3 bg-secondary rounded-lg px-4 py-3">
                <span className="font-mono text-[13px]">{qwenLogin.userCode || '-'}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(qwenLogin.userCode)}
                  disabled={!qwenLogin.userCode}
                >
                  {t.copy}
                </Button>
              </div>
            </div>

            <div className="text-[13px]">
              {qwenLogin.state === 'pending' && (
                <span className="text-muted-foreground">
                  {t.waitingForApproval}
                </span>
              )}
              {qwenLogin.state === 'error' && <span className="text-destructive">{qwenLogin.error || t.oauthFailed}</span>}
              {qwenLogin.state === 'success' && (
                <span className="text-emerald-600 dark:text-emerald-400">{t.oauthSuccess}</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQwenLogin({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', userCode: '', expiresAt: 0, pollIntervalMs: 2000, state: 'idle' })}
            >
              {t.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={codexLogin.open}
        onOpenChange={(open) => {
          if (open) return
          setCodexLogin({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', expiresAt: 0, pollIntervalMs: 1000, state: 'idle' })
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>OpenAI Codex OAuth</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.openAuthLinkLocalRedirect}</Label>
              <div className="relative group">
                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(codexLogin.verificationUrl)}
                    className="h-8 w-8 hover:bg-secondary text-muted-foreground transition-colors"
                    disabled={!codexLogin.verificationUrl}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <code className="block w-full bg-secondary rounded-lg px-4 py-3 text-[13px] font-mono text-muted-foreground break-all">
                  {codexLogin.verificationUrl || '-'}
                </code>
              </div>
              {codexLogin.verificationUrl && (
                <a
                  href={codexLogin.verificationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline"
                >
                  {t.openInBrowser}
                </a>
              )}
            </div>

            <div className="text-[13px]">
              {codexLogin.state === 'pending' && (
                <span className="text-muted-foreground">
                  {t.waitingForApproval}
                </span>
              )}
              {codexLogin.state === 'error' && <span className="text-destructive">{codexLogin.error || t.oauthFailed}</span>}
              {codexLogin.state === 'success' && (
                <span className="text-emerald-600 dark:text-emerald-400">{t.oauthSuccess}</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCodexLogin({ open: false, providerRecordId: '', flowId: '', verificationUrl: '', expiresAt: 0, pollIntervalMs: 1000, state: 'idle' })}
            >
              {t.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={fetchModelsError.open}
        onOpenChange={(open) => {
          if (open) return
          setFetchModelsError({ open: false, message: '' })
        }}
      >
        <DialogContent className="sm:max-w-[560px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{t.fetchModels}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-lg bg-secondary px-4 py-3">
            <pre className="whitespace-pre-wrap break-all text-[12px] leading-5 text-foreground font-mono">
              {fetchModelsError.message}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFetchModelsError({ open: false, message: '' })}>
              {t.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CustomProviderDialog 
        open={customProviderDialogOpen} 
        onOpenChange={setCustomProviderDialogOpen}
        initialMode={customProviderMode}
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
    <div className="p-6 space-y-6">
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
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
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

function McpSettings() {
  const settings = useStore(s => s.settings)!
  const [mcpScope, setMcpScope] = useState<'user' | 'project'>('user')
  const [mcpConfigText, setMcpConfigText] = useState('')
  const [mcpServerId, setMcpServerId] = useState('')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpStatus, setMcpStatus] = useState<{ type: 'idle' | 'ok' | 'error'; text: string }>({ type: 'idle', text: '' })
  const [mcpErrors, setMcpErrors] = useState<Array<{ path?: string; code?: string; message?: string }>>([])
  const [mcpCatalogText, setMcpCatalogText] = useState('')
  const t = (() => {
    const dict = {
      en: {
        mcpConfig: 'MCP Config (JSON)',
        mcpConfigHint: 'Manage MCP servers using JSON. Use ${input:...} or ${env:...} for secrets.',
        mcpScope: 'MCP Scope',
        mcpScopeUser: 'User',
        mcpScopeProject: 'Project',
        mcpLoad: 'Load',
        mcpValidate: 'Validate',
        mcpSave: 'Save',
        mcpTest: 'Test',
        mcpCatalog: 'Catalog',
        mcpServerId: 'Server ID',
        mcpServerIdHint: 'Input a server id for test/catalog.',
        mcpValidationPassed: 'Validation passed.',
        mcpValidationFailed: 'Validation failed.',
        mcpSaveDone: 'Saved.',
        mcpLoadDone: 'Loaded.',
        mcpTestDone: 'Test passed.',
        mcpCatalogDone: 'Catalog loaded.',
        mcpWorkspaceRequired: 'Project scope requires workspaceDir.',
        mcpErrors: 'Validation Errors',
        mcpCatalogTitle: 'Catalog Preview',
      },
      zh: {
        mcpConfig: 'MCP 配置（JSON）',
        mcpConfigHint: '通过 JSON 管理 MCP 服务器。敏感信息请使用 ${input:...} 或 ${env:...}。',
        mcpScope: 'MCP 范围',
        mcpScopeUser: '用户级',
        mcpScopeProject: '项目级',
        mcpLoad: '加载',
        mcpValidate: '校验',
        mcpSave: '保存',
        mcpTest: '测试',
        mcpCatalog: '目录',
        mcpServerId: 'Server ID',
        mcpServerIdHint: '输入 server id 以执行测试或读取目录。',
        mcpValidationPassed: '校验通过。',
        mcpValidationFailed: '校验失败。',
        mcpSaveDone: '保存成功。',
        mcpLoadDone: '加载成功。',
        mcpTestDone: '测试通过。',
        mcpCatalogDone: '目录已加载。',
        mcpWorkspaceRequired: '项目级作用域需要 workspaceDir。',
        mcpErrors: '校验错误',
        mcpCatalogTitle: '目录预览',
      },
      ja: {
        mcpConfig: 'MCP 設定 (JSON)',
        mcpConfigHint: 'JSON で MCP サーバーを管理します。機密値は ${input:...} または ${env:...} を使用してください。',
        mcpScope: 'MCP スコープ',
        mcpScopeUser: 'ユーザー',
        mcpScopeProject: 'プロジェクト',
        mcpLoad: '読み込み',
        mcpValidate: '検証',
        mcpSave: '保存',
        mcpTest: 'テスト',
        mcpCatalog: 'カタログ',
        mcpServerId: 'Server ID',
        mcpServerIdHint: 'テスト/カタログ取得に使う server id を入力します。',
        mcpValidationPassed: '検証に成功しました。',
        mcpValidationFailed: '検証に失敗しました。',
        mcpSaveDone: '保存しました。',
        mcpLoadDone: '読み込みました。',
        mcpTestDone: 'テスト成功。',
        mcpCatalogDone: 'カタログを取得しました。',
        mcpWorkspaceRequired: 'project スコープでは workspaceDir が必要です。',
        mcpErrors: '検証エラー',
        mcpCatalogTitle: 'カタログプレビュー',
      }
    } as const
    const lang = (settings?.language || 'en') as keyof typeof dict
    return dict[lang] || dict.en
  })()

  const mcpWorkspaceDir = mcpScope === 'project' ? String(settings.workspaceDir || '').trim() : ''
  const mcpScopePayload = () => {
    if (mcpScope === 'project' && !mcpWorkspaceDir) throw new Error(t.mcpWorkspaceRequired)
    return {
      scope: mcpScope,
      workspaceDir: mcpWorkspaceDir
    }
  }
  const loadMcpConfig = async () => {
    setMcpBusy(true)
    try {
      const payload = mcpScopePayload()
      const q = new URLSearchParams()
      q.set('scope', payload.scope)
      if (payload.workspaceDir) q.set('workspaceDir', payload.workspaceDir)
      const res = await fetchBackendJson<{ ok: boolean; config?: any }>(`/api/mcp/config?${q.toString()}`, { method: 'GET' })
      const cfg = res?.config && typeof res.config === 'object' ? res.config : {}
      setMcpConfigText(JSON.stringify(cfg, null, 2))
      setMcpStatus({ type: 'ok', text: t.mcpLoadDone })
      setMcpErrors([])
    } catch (e) {
      setMcpStatus({ type: 'error', text: e instanceof Error ? e.message : 'load failed' })
    } finally {
      setMcpBusy(false)
    }
  }
  const validateMcpConfig = async () => {
    setMcpBusy(true)
    try {
      const baseUrl = await resolveBackendBaseUrl()
      const res = await fetch(`${baseUrl}/api/mcp/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: mcpConfigText })
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
      const errs = Array.isArray((data as any)?.errors) ? ((data as any).errors as Array<any>) : []
      if (errs.length) {
        setMcpErrors(errs.map((x) => ({ path: String(x?.path || ''), code: String(x?.code || ''), message: String(x?.message || '') })))
      } else {
        setMcpErrors([])
      }
      if (!res.ok) {
        const msg = String((data as any)?.error || t.mcpValidationFailed)
        setMcpStatus({ type: 'error', text: msg })
        return
      }
      if (errs.length) {
        setMcpStatus({ type: 'error', text: t.mcpValidationFailed })
      } else {
        setMcpStatus({ type: 'ok', text: t.mcpValidationPassed })
      }
    } catch (e) {
      setMcpStatus({ type: 'error', text: e instanceof Error ? e.message : t.mcpValidationFailed })
    } finally {
      setMcpBusy(false)
    }
  }
  const saveMcpConfig = async () => {
    setMcpBusy(true)
    try {
      const payload = mcpScopePayload()
      await fetchBackendJson<{ ok: boolean }>('/api/mcp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, text: mcpConfigText })
      })
      setMcpStatus({ type: 'ok', text: t.mcpSaveDone })
      setMcpErrors([])
    } catch (e) {
      setMcpStatus({ type: 'error', text: e instanceof Error ? e.message : 'save failed' })
    } finally {
      setMcpBusy(false)
    }
  }
  const testMcpServer = async () => {
    const serverId = String(mcpServerId || '').trim()
    if (!serverId) return
    setMcpBusy(true)
    try {
      const payload = mcpScopePayload()
      await fetchBackendJson<{ ok: boolean; result?: any }>('/api/mcp/servers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, serverId })
      })
      setMcpStatus({ type: 'ok', text: t.mcpTestDone })
    } catch (e) {
      setMcpStatus({ type: 'error', text: e instanceof Error ? e.message : 'test failed' })
    } finally {
      setMcpBusy(false)
    }
  }
  const loadMcpCatalog = async () => {
    const serverId = String(mcpServerId || '').trim()
    if (!serverId) return
    setMcpBusy(true)
    try {
      const payload = mcpScopePayload()
      const q = new URLSearchParams()
      q.set('scope', payload.scope)
      if (payload.workspaceDir) q.set('workspaceDir', payload.workspaceDir)
      const res = await fetchBackendJson<{ ok: boolean; catalog?: any }>(`/api/mcp/servers/${encodeURIComponent(serverId)}/catalog?${q.toString()}`, {
        method: 'GET'
      })
      setMcpCatalogText(JSON.stringify(res?.catalog || {}, null, 2))
      setMcpStatus({ type: 'ok', text: t.mcpCatalogDone })
    } catch (e) {
      setMcpStatus({ type: 'error', text: e instanceof Error ? e.message : 'catalog failed' })
    } finally {
      setMcpBusy(false)
    }
  }

  useEffect(() => {
    void loadMcpConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpScope])

  return (
    <div className="p-6 space-y-6">
      <Card className="p-5 space-y-4">
        <h3 className="text-[13px] font-semibold">{t.mcpConfig}</h3>
        <p className="text-xs text-muted-foreground">{t.mcpConfigHint}</p>

        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t.mcpScope}</Label>
              <Select value={mcpScope} onValueChange={(v) => setMcpScope(v as 'user' | 'project')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t.mcpScopeUser}</SelectItem>
                  <SelectItem value="project">{t.mcpScopeProject}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.mcpServerId}</Label>
              <Input value={mcpServerId} onChange={(e) => setMcpServerId(e.target.value)} placeholder="my-server" />
              <p className="text-xs text-muted-foreground">{t.mcpServerIdHint}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Textarea
              value={mcpConfigText}
              onChange={(e) => setMcpConfigText(e.target.value)}
              placeholder='{"mcpServers": {}}'
              rows={14}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={mcpBusy} onClick={() => void loadMcpConfig()}>
              {mcpBusy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t.mcpLoad}
            </Button>
            <Button type="button" variant="outline" disabled={mcpBusy} onClick={() => void validateMcpConfig()}>
              {mcpBusy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t.mcpValidate}
            </Button>
            <Button type="button" disabled={mcpBusy} onClick={() => void saveMcpConfig()}>
              {mcpBusy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t.mcpSave}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={mcpBusy || !String(mcpServerId || '').trim()}
              onClick={() => void testMcpServer()}
            >
              {mcpBusy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t.mcpTest}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={mcpBusy || !String(mcpServerId || '').trim()}
              onClick={() => void loadMcpCatalog()}
            >
              {mcpBusy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t.mcpCatalog}
            </Button>
          </div>

          {mcpStatus.type !== 'idle' && (
            <div className={mcpStatus.type === 'ok' ? 'text-xs text-emerald-600 dark:text-emerald-400' : 'text-xs text-destructive'}>
              {mcpStatus.type === 'ok' ? <CheckCircle2 className="mr-1 inline h-4 w-4" /> : <XCircle className="mr-1 inline h-4 w-4" />}
              {mcpStatus.text}
            </div>
          )}

          {mcpErrors.length > 0 && (
            <div className="space-y-2">
              <Label>{t.mcpErrors}</Label>
              <div className="max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 text-xs">
                {mcpErrors.map((err, idx) => (
                  <div key={`${err.path || 'root'}-${idx}`} className="py-1">
                    [{err.code || 'error'}] {err.path || '/'}: {err.message || ''}
                  </div>
                ))}
              </div>
            </div>
          )}

          {mcpCatalogText ? (
            <div className="space-y-2">
              <Label>{t.mcpCatalogTitle}</Label>
              <Textarea value={mcpCatalogText} readOnly rows={8} className="font-mono text-xs" />
            </div>
          ) : null}
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
  const [commandBlacklistInput, setCommandBlacklistInput] = useState('')
  const [commandWhitelistInput, setCommandWhitelistInput] = useState('')
  const t = (() => {
    const dict = {
      en: {
        systemPrompts: 'System Prompts',
        new: 'New',
        delete: 'Delete',
        clear: 'Clear',
        selectedHint: 'The selected prompt is used as the base system message.',
        chatParams: 'Chat Parameters',
        temperature: 'Temperature',
        temperatureHint: 'Controls randomness: Lower is more deterministic, higher is more creative.',
        conservative: 'Conservative',
        balanced: 'Balanced',
        creative: 'Creative',
        maxTokens: 'Max Tokens',
        maxTokensHint: 'Maximum length limit for single response (1-8192)',
        orchestrationForce: 'Force Worker Orchestration',
        orchestrationForceHint: 'Always enable multi-worker planning/execution for each chat request (for debugging and parallel runs).',
        commandBlacklist: 'Command Blacklist',
        commandBlacklistHint: 'Input command entries (e.g. rm, curl). Under default permission, matched commands require manual approval.',
        commandWhitelist: 'Command Whitelist',
        commandWhitelistHint: 'Input command entries to bypass blacklist checks.',
        addCommand: 'Add',
        commandPlaceholder: 'Enter command',
        tabCompletionModelTitle: 'Tab Completion Model',
        tabCompletionProvider: 'Provider',
        tabCompletionModel: 'Model',
        tabCompletionFollowChat: 'Follow current chat model',
        tabCompletionProviderDefault: 'Use provider default model',
        tabCompletionProviderHint: 'Choose a provider for Tab completion only.',
        tabCompletionModelHint: 'Choose the model used by Tab completion.',
        responseSettings: 'Response Settings',
        collapseHistoricalProcess: 'Collapse historical process by default',
        collapseHistoricalProcessHint: 'For all turns except the latest one, hide thinking/tool/skill process and keep final assistant reply only.',
        streamingResponse: 'Enable Streaming Response',
        streamingResponseHint: 'Show response in real-time as it generates.',
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
        acpSettings: 'ACP Agents',
        acpEnable: 'Enable ACP Agents',
        acpEnableHint: 'Run external ACP coding agents (e.g. Qwen Code, codex-acp) instead of the built-in provider runtime.',
        acpApprovalMode: 'Approval mode',
        acpApprovalPerAction: 'Ask every time',
        acpApprovalPerProject: 'Remember per project',
        acpApprovalAlways: 'Always allow',
        acpDefaultAgent: 'Default agent',
        acpAgents: 'Agents',
        acpAgentId: 'ID',
        acpAgentName: 'Name',
        acpAgentKind: 'Kind',
        acpCommand: 'Command',
        acpArgs: 'Args',
        acpEnv: 'Env (KEY=VALUE)',
        acpFraming: 'Framing',
        acpFramingAuto: 'Auto',
        acpFramingJsonl: 'JSONL (newline)',
        acpFramingContentLength: 'Content-Length',
        acpAddAgent: 'Add agent',
        acpDeleteAgent: 'Delete',
        acpAddFromTemplate: 'Add from template',
        acpTemplateQwen: 'Qwen Code (ACP)',
        acpTemplateCodexAcp: 'Codex (codex-acp)',
        acpTemplateCodexNpx: 'Codex (npx @zed-industries/codex-acp)',
        acpTestAgent: 'Test',
        acpTestOk: 'OK',
        acpTestFailed: 'Failed',
        acpResetApprovals: 'Reset approvals',
        acpResetApprovalsHint: 'Clears remembered approvals for ACP actions.',
        acpResetApprovalsDone: 'Approvals reset.',
        acpResetApprovalsFailed: 'Reset failed.'
      },
      zh: {
        systemPrompts: '系统提示词',
        new: '新建',
        delete: '删除',
        clear: '清空',
        selectedHint: '当前选中的提示词会作为 system message 的基础内容。',
        chatParams: '聊天参数',
        temperature: '温度',
        temperatureHint: '控制回复的随机性。较低的值产生一致的回复，较高的值产生更有创意的回复。',
        conservative: '保守',
        balanced: '平衡',
        creative: '创意',
        maxTokens: '最大令牌数',
        maxTokensHint: '单次回复的最大长度限制 (1-8192)',
        orchestrationForce: '强制多代理编排',
        orchestrationForceHint: '为每次聊天请求都启用 worker 规划/执行（用于调试与并行任务验证）。',
        commandBlacklist: '命令黑名单',
        commandBlacklistHint: '输入命令词条（例如 rm、curl）。默认权限下命中会触发人工确认。',
        commandWhitelist: '命令白名单',
        commandWhitelistHint: '输入命令词条，可绕过黑名单检查。',
        addCommand: '添加',
        commandPlaceholder: '请输入命令',
        tabCompletionModelTitle: 'Tab 补全模型',
        tabCompletionProvider: 'Provider',
        tabCompletionModel: '模型',
        tabCompletionFollowChat: '跟随当前聊天模型',
        tabCompletionProviderDefault: '使用 Provider 默认模型',
        tabCompletionProviderHint: '仅用于 Tab 补全，不影响常规聊天模型。',
        tabCompletionModelHint: '选择 Tab 补全时使用的模型。',
        responseSettings: '响应设置',
        collapseHistoricalProcess: '默认折叠历史过程',
        collapseHistoricalProcessHint: '除最后一条消息外，默认折叠思考/工具/skill过程，仅保留最终 AI 回复内容。',
        streamingResponse: '启用流式响应',
        streamingResponseHint: '启用后，AI 回复将实时显示，否则等待完整回复后一次性显示',
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
        acpSettings: 'ACP Agents',
        acpEnable: '启用 ACP Agents',
        acpEnableHint: '使用外部 ACP 编码代理（例如 Qwen Code、codex-acp）作为运行时，而不是内置 Provider 运行时。',
        acpApprovalMode: '授权模式',
        acpApprovalPerAction: '每次询问',
        acpApprovalPerProject: '按项目记住',
        acpApprovalAlways: '始终允许',
        acpDefaultAgent: '默认 Agent',
        acpAgents: 'Agents',
        acpAgentId: 'ID',
        acpAgentName: '名称',
        acpAgentKind: '类型',
        acpCommand: '命令',
        acpArgs: '参数',
        acpEnv: '环境变量（KEY=VALUE）',
        acpFraming: '分帧',
        acpFramingAuto: '自动',
        acpFramingJsonl: 'JSONL（换行）',
        acpFramingContentLength: 'Content-Length',
        acpAddAgent: '添加 Agent',
        acpDeleteAgent: '删除',
        acpAddFromTemplate: '按模板添加',
        acpTemplateQwen: 'Qwen Code（ACP）',
        acpTemplateCodexAcp: 'Codex（codex-acp）',
        acpTemplateCodexNpx: 'Codex（npx @zed-industries/codex-acp）',
        acpTestAgent: '测试',
        acpTestOk: '正常',
        acpTestFailed: '失败',
        acpResetApprovals: '重置授权',
        acpResetApprovalsHint: '清空 ACP 动作的“记住授权”。',
        acpResetApprovalsDone: '已重置授权。',
        acpResetApprovalsFailed: '重置失败。'
      },
      ja: {
        systemPrompts: 'システムプロンプト',
        new: '新規',
        delete: '削除',
        clear: 'クリア',
        selectedHint: '選択中のプロンプトが system message のベースになります。',
        chatParams: 'チャットパラメータ',
        temperature: '温度',
        temperatureHint: '応答のランダム性を制御します。',
        conservative: '保守的',
        balanced: 'バランス',
        creative: '創造的',
        maxTokens: '最大トークン数',
        maxTokensHint: '1回の応答の最大長制限 (1-8192)',
        orchestrationForce: 'Worker 編成を強制',
        orchestrationForceHint: '各チャット要求で常にマルチ worker の計画/実行を有効化します（デバッグ用）。',
        commandBlacklist: 'コマンドブラックリスト',
        commandBlacklistHint: 'コマンド項目（例: rm、curl）を入力します。既定権限では一致時に手動承認が必要です。',
        commandWhitelist: 'コマンドホワイトリスト',
        commandWhitelistHint: 'ブラックリスト判定を回避するコマンド項目を入力します。',
        addCommand: '追加',
        commandPlaceholder: 'コマンドを入力',
        tabCompletionModelTitle: 'Tab 補完モデル',
        tabCompletionProvider: 'Provider',
        tabCompletionModel: 'モデル',
        tabCompletionFollowChat: '現在のチャットモデルに従う',
        tabCompletionProviderDefault: 'Provider の既定モデルを使用',
        tabCompletionProviderHint: 'Tab 補完専用の Provider を選択します。',
        tabCompletionModelHint: 'Tab 補完で使うモデルを選択します。',
        responseSettings: '応答設定',
        collapseHistoricalProcess: '履歴プロセスを既定で折りたたむ',
        collapseHistoricalProcessHint: '最新メッセージ以外では、思考/ツール/スキル過程を折りたたみ、最終のAI応答のみ表示します。',
        streamingResponse: 'ストリーミング応答を有効化',
        streamingResponseHint: '応答を生成しながらリアルタイムで表示します。',
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
        acpSettings: 'ACP Agents',
        acpEnable: 'ACP Agents を有効化',
        acpEnableHint: '外部 ACP コーディングエージェント（例: Qwen Code、codex-acp）を実行します。',
        acpApprovalMode: 'Approval mode',
        acpApprovalPerAction: 'Ask every time',
        acpApprovalPerProject: 'Remember per project',
        acpApprovalAlways: 'Always allow',
        acpDefaultAgent: 'Default agent',
        acpAgents: 'Agents',
        acpAgentId: 'ID',
        acpAgentName: 'Name',
        acpAgentKind: 'Kind',
        acpCommand: 'Command',
        acpArgs: 'Args',
        acpEnv: 'Env (KEY=VALUE)',
        acpAddAgent: 'Add agent',
        acpDeleteAgent: 'Delete',
        acpFraming: 'Framing',
        acpFramingAuto: 'Auto',
        acpFramingJsonl: 'JSONL (newline)',
        acpFramingContentLength: 'Content-Length',
        acpAddFromTemplate: 'Add from template',
        acpTemplateQwen: 'Qwen Code (ACP)',
        acpTemplateCodexAcp: 'Codex (codex-acp)',
        acpTemplateCodexNpx: 'Codex (npx @zed-industries/codex-acp)',
        acpTestAgent: 'Test',
        acpTestOk: 'OK',
        acpTestFailed: 'Failed',
        acpResetApprovals: 'Reset approvals',
        acpResetApprovalsHint: 'Clears remembered approvals for ACP actions.',
        acpResetApprovalsDone: 'Approvals reset.',
        acpResetApprovalsFailed: 'Reset failed.',
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
  const commandBlacklist = Array.isArray((settings as any).commandBlacklist) ? (settings as any).commandBlacklist.map((x: any) => String(x)) : []
  const commandWhitelist = Array.isArray((settings as any).commandWhitelist) ? (settings as any).commandWhitelist.map((x: any) => String(x)) : []
  const addCommandEntry = (kind: 'blacklist' | 'whitelist') => {
    const raw = kind === 'blacklist' ? commandBlacklistInput : commandWhitelistInput
    const value = String(raw || '').trim().toLowerCase()
    if (!value) return
    if (kind === 'blacklist') {
      const next = Array.from(new Set([...(commandBlacklist || []), value]))
      updateSettings({ commandBlacklist: next } as any)
      setCommandBlacklistInput('')
      return
    }
    const next = Array.from(new Set([...(commandWhitelist || []), value]))
    updateSettings({ commandWhitelist: next } as any)
    setCommandWhitelistInput('')
  }
  const removeCommandEntry = (kind: 'blacklist' | 'whitelist', entry: string) => {
    if (kind === 'blacklist') {
      updateSettings({ commandBlacklist: commandBlacklist.filter((x: string) => x !== entry) } as any)
      return
    }
    updateSettings({ commandWhitelist: commandWhitelist.filter((x: string) => x !== entry) } as any)
  }
  const completionProviderOptions = useMemo(() => {
    return providers
      .filter((p) => Boolean((p as any)?.isEnabled))
      .map((p) => {
        const models = Array.isArray((p as any)?.config?.models) ? (p as any).config.models : []
        const modelIds = models
          .map((m: any) => {
            if (typeof m === 'string') return m.trim()
            if (m && m.isEnabled === false) return ''
            return String(m?.id || '').trim()
          })
          .filter((id: string) => Boolean(id))
        if (!modelIds.length) return null
        return { id: String(p.id || '').trim(), name: String(p.name || p.id || '').trim(), modelIds }
      })
      .filter((item): item is { id: string; name: string; modelIds: string[] } => Boolean(item?.id))
  }, [providers])
  const completionProviderId = String((settings as any).tabCompletionProviderId || '').trim()
  const completionModelId = String((settings as any).tabCompletionModelId || '').trim()
  const completionProviderValue = completionProviderId || '__follow_chat__'
  const completionProviderOption = completionProviderOptions.find((p) => p.id === completionProviderId)
  const completionModelOptions = completionProviderOption?.modelIds || []
  const completionModelValue =
    completionModelId && completionModelOptions.includes(completionModelId)
      ? completionModelId
      : '__provider_default__'
  const onTabCompletionProviderChange = (nextValue: string) => {
    if (nextValue === '__follow_chat__') {
      updateSettings({ tabCompletionProviderId: '', tabCompletionModelId: '' } as any)
      return
    }
    const nextProvider = completionProviderOptions.find((item) => item.id === nextValue)
    if (!nextProvider) {
      updateSettings({ tabCompletionProviderId: '', tabCompletionModelId: '' } as any)
      return
    }
    const nextModel =
      completionModelId && nextProvider.modelIds.includes(completionModelId) ? completionModelId : ''
    updateSettings({ tabCompletionProviderId: nextProvider.id, tabCompletionModelId: nextModel } as any)
  }
  const imageProviderSelectValue = media.imageProviderId ? media.imageProviderId : '__chat__'
  const videoProviderSelectValue = media.videoProviderId ? media.videoProviderId : '__chat__'

  return (
    <div className="p-6 space-y-6">
      {/* Chat Parameters */}
      <Card className="p-5 space-y-6">
        <div className="flex items-center gap-2">
           <h3 className="text-[13px] font-semibold">{t.chatParams}</h3>
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

           <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <Label>{t.tabCompletionModelTitle}</Label>
                <p className="text-xs text-muted-foreground">{t.tabCompletionProviderHint}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t.tabCompletionProvider}</Label>
                  <Select value={completionProviderValue} onValueChange={onTabCompletionProviderChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__follow_chat__">{t.tabCompletionFollowChat}</SelectItem>
                      {completionProviderOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t.tabCompletionModel}</Label>
                  <Select
                    value={completionModelValue}
                    disabled={completionProviderValue === '__follow_chat__' || !completionModelOptions.length}
                    onValueChange={(v) => updateSettings({ tabCompletionModelId: v === '__provider_default__' ? '' : v } as any)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {completionModelOptions.length ? (
                        <>
                          <SelectItem value="__provider_default__">{t.tabCompletionProviderDefault}</SelectItem>
                          {completionModelOptions.map((modelId) => (
                            <SelectItem key={modelId} value={modelId}>
                              {modelId}
                            </SelectItem>
                          ))}
                        </>
                      ) : (
                        <SelectItem value="__none__" disabled>
                          -
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t.tabCompletionModelHint}</p>
                </div>
              </div>
           </div>

           <div className="flex items-start gap-3">
              <Checkbox
                 id="orchestrationForce"
                 checked={Boolean((settings as any).orchestrationForce)}
                 onCheckedChange={(c) => updateSettings({ orchestrationForce: c as boolean } as any)}
              />
              <div className="grid gap-1.5 leading-none">
                 <label htmlFor="orchestrationForce" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.orchestrationForce}</label>
                 <p className="text-xs text-muted-foreground">{t.orchestrationForceHint}</p>
              </div>
           </div>

           <div className="space-y-2">
              <Label>{t.commandBlacklist}</Label>
              <div className="flex items-center gap-2">
                 <Input
                    value={commandBlacklistInput}
                    onChange={(e) => setCommandBlacklistInput(e.target.value)}
                    placeholder={t.commandPlaceholder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCommandEntry('blacklist')
                      }
                    }}
                 />
                 <Button type="button" variant="outline" size="icon" onClick={() => addCommandEntry('blacklist')}>
                    <Plus className="w-4 h-4" />
                 </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                 {commandBlacklist.map((item: string) => (
                    <Badge key={`black-${item}`} variant="secondary" className="gap-1">
                      {item}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={() => removeCommandEntry('blacklist', item)}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                 ))}
              </div>
              <p className="text-xs text-muted-foreground">{t.commandBlacklistHint}</p>
           </div>

           <div className="space-y-2">
              <Label>{t.commandWhitelist}</Label>
              <div className="flex items-center gap-2">
                 <Input
                    value={commandWhitelistInput}
                    onChange={(e) => setCommandWhitelistInput(e.target.value)}
                    placeholder={t.commandPlaceholder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCommandEntry('whitelist')
                      }
                    }}
                 />
                 <Button type="button" variant="outline" size="icon" onClick={() => addCommandEntry('whitelist')}>
                    <Plus className="w-4 h-4" />
                 </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                 {commandWhitelist.map((item: string) => (
                    <Badge key={`white-${item}`} variant="secondary" className="gap-1">
                      {item}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={() => removeCommandEntry('whitelist', item)}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                 ))}
              </div>
              <p className="text-xs text-muted-foreground">{t.commandWhitelistHint}</p>
           </div>
        </div>
      </Card>

      {/* Response Settings */}
      <Card className="p-5 space-y-4">
         <h3 className="text-[13px] font-semibold">{t.responseSettings}</h3>
         
         <div className="space-y-4">
            <div className="flex items-start gap-3">
               <Checkbox
                  id="collapseHistoricalProcess"
                  checked={settings.collapseHistoricalProcess !== false}
                  onCheckedChange={(c) => updateSettings({ collapseHistoricalProcess: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="collapseHistoricalProcess" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.collapseHistoricalProcess}</label>
                  <p className="text-xs text-muted-foreground">{t.collapseHistoricalProcessHint}</p>
               </div>
            </div>

            <div className="flex items-start gap-3">
               <Checkbox 
                  id="streaming"
                  checked={settings.enableStreamingResponse}
                  onCheckedChange={(c) => updateSettings({ enableStreamingResponse: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="streaming" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.streamingResponse}</label>
                  <p className="text-xs text-muted-foreground">{t.streamingResponseHint}</p>
               </div>
            </div>

            <div className="flex items-start gap-3">
               <Checkbox 
                  id="markdown"
                  checked={settings.enableMarkdown}
                  onCheckedChange={(c) => updateSettings({ enableMarkdown: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="markdown" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.markdown}</label>
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
                  <label htmlFor="math" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.singleDollarMath}</label>
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
                  <label htmlFor="infoCard" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.infoCard}</label>
                  <p className="text-xs text-muted-foreground">{t.infoCardHint}</p>
               </div>
            </div>
         </div>
      </Card>

      {/* Media */}
      <Card className="p-5 space-y-4">
        <h3 className="text-[13px] font-semibold">{t.mediaSettings}</h3>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="imageGenEnabled"
              checked={media.imageEnabled}
              onCheckedChange={(c) => updateMedia({ imageEnabled: c as boolean })}
            />
            <div className="grid gap-1.5 leading-none">
              <label htmlFor="imageGenEnabled" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
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
              <label htmlFor="videoGenEnabled" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
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
        <h3 className="text-[13px] font-semibold">{t.artifactsCleanup}</h3>
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
          {cleanupStatus.type === 'ok' && <span className="text-xs text-emerald-600 dark:text-emerald-400">{cleanupStatus.text}</span>}
          {cleanupStatus.type === 'error' && <span className="text-xs text-destructive">{cleanupStatus.text}</span>}
        </div>
      </Card>

      <Card className="p-5 space-y-6">
         <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-[13px] font-semibold">{t.autoCompression}</h3>
         </div>

         <div className="space-y-4">
             <div className="flex items-start gap-3">
               <Checkbox 
                  id="compression"
                  checked={settings.enableAutoCompression}
                  onCheckedChange={(c) => updateSettings({ enableAutoCompression: c as boolean })}
               />
               <div className="grid gap-1.5 leading-none">
                  <label htmlFor="compression" className="text-[13px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">{t.enableAutoCompression}</label>
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

function AutomationSettings() {
  const { settings: settings0, updateSettings } = useStore()
  const settings = settings0!
  const providers = useStore((s) => s.providers)
  const activeProjectId = useStore((s) => s.ui.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const setActiveChat = useStore((s) => s.setActiveChat)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState('')
  const [status, setStatus] = useState<{ type: 'idle' | 'ok' | 'error'; text?: string }>({ type: 'idle' })
  const [draft, setDraft] = useState<any>({
    id: '',
    name: '',
    enabled: true,
    schedule: { kind: 'every', everyMs: 3600000, expr: '0 9 * * *', tz: 'Asia/Shanghai', atMs: 0 },
    payload: {
      kind: 'run',
      run: {
        threadId: '',
        threadMode: 'fixed',
        composer: { projectId: '', workspaceDir: '', providerOverrideId: '', modelOverride: '' },
        messages: [{ role: 'user', content: '' }]
      },
      chatId: '',
      text: '',
      ifNonEmpty: true
    },
    delivery: { kind: '', chatId: '', ifNonEmpty: true }
  })

  const t = (() => {
    const dict = {
      en: {
        title: 'Automation',
        desc: 'Create scheduled AI tasks around projects, prompts, and models.',
        serviceTitle: 'Cron Service',
        serviceDesc: 'This service drives all local scheduled jobs.',
        serviceCompactHint: 'Disable to stop all local automation. Default check interval: 500ms.',
        cronEnable: 'Enable Cron Service',
        cronEnableHint: 'When disabled, local scheduled jobs will not run.',
        pollInterval: 'Check Interval (ms)',
        pollIntervalHint: 'How often Cron checks whether any task is due. Default 500ms.',
        allowAgentManage: 'Allow Agent Manage Cron',
        allowAgentManageHint: 'Enables cron_list / cron_upsert / cron_delete / cron_run tools for agents.',
        jobsTitle: 'Scheduled Jobs',
        refresh: 'Refresh',
        newJob: 'New Job',
        edit: 'Edit',
        saveJob: 'Save Job',
        deleteJob: 'Delete Job',
        deleteShort: 'Delete',
        runNow: 'Run Now',
        empty: 'No scheduled jobs yet.',
        jobName: 'Job Name',
        enabled: 'Enabled',
        disabled: 'Disabled',
        close: 'Close',
        scheduleKind: 'Schedule Type',
        scheduleAt: 'At',
        scheduleEvery: 'Every',
        scheduleCron: 'Cron',
        atTime: 'Run At',
        everyMs: 'Every (ms)',
        cronExpr: 'Cron Expression',
        cronTz: 'Cron Timezone',
        payloadKind: 'Payload Type',
        payloadRun: 'Run Task',
        payloadTelegram: 'Telegram Message',
        threadMode: 'Conversation Mode',
        threadModeFixed: 'Fixed thread',
        threadModeNewChat: 'New chat every run',
        project: 'Project',
        noProject: 'No project',
        provider: 'Provider',
        model: 'Model',
        followDefault: 'Follow default',
        prompt: 'Prompt',
        telegramChatId: 'Telegram Chat ID',
        telegramText: 'Telegram Text',
        ifNonEmpty: 'Only send when non-empty',
        deliveryTitle: 'Run Result Delivery',
        deliveryKind: 'Delivery Type',
        deliveryNone: 'None',
        deliveryTelegram: 'Telegram',
        saved: 'Saved.',
        deleted: 'Deleted.',
        triggered: 'Triggered.',
        failedLoad: 'Failed to load jobs.',
        failedSave: 'Failed to save job.',
        failedDelete: 'Failed to delete job.',
        failedRun: 'Failed to run job.',
        nextRun: 'Next Run',
        lastStatus: 'Last Status',
        historyTitle: 'Execution History',
        historyEmpty: 'No execution records yet.',
        historyStarted: 'Started',
        historyDuration: 'Duration',
        historyOutput: 'Output',
        historyError: 'Error',
        openThread: 'Open thread',
        listTitle: 'Tasks',
        listHint: 'Review status, next run, and schedule at a glance. Click a task to edit it.',
        editorEmpty: 'Select a task on the left to edit it.',
        sectionTask: '1. Task',
        sectionContext: '2. Context',
        sectionSchedule: '3. Schedule',
        sectionDelivery: '4. Delivery',
        sectionHistory: '5. Recent runs',
        promptHint: 'Describe the outcome you want the model to produce each time this task runs.',
        projectHint: 'Bind the task to a project so the run can reuse its workspace and conversations.',
        threadModeHint: 'Fixed thread keeps context across runs. New chat creates a fresh conversation each time.',
        scheduleHint: 'Choose when this task should run.',
        telegramHint: 'Send the result summary to Telegram after the run completes.',
        taskTypeHint: 'Run task is the main flow. Telegram message is kept for simple message-only jobs.',
        lastRunEmpty: 'Never run'
      },
      zh: {
        title: '自动化',
        desc: '围绕项目、提示词和模型创建定时 AI 任务。',
        serviceTitle: 'Cron 服务',
        serviceDesc: '这个服务负责驱动所有本地定时任务。',
        serviceCompactHint: '关闭后将停止所有本地自动执行。默认检查间隔为 500 毫秒。',
        cronEnable: '启用 Cron 服务',
        cronEnableHint: '关闭后，本地定时任务不会自动执行。',
        pollInterval: '检查间隔（毫秒）',
        pollIntervalHint: 'Cron 服务每隔多久检查一次是否有到期任务。默认 500 毫秒。',
        allowAgentManage: '允许 Agent 管理 Cron',
        allowAgentManageHint: '开启后，Agent 可使用 cron_list / cron_upsert / cron_delete / cron_run 工具。',
        jobsTitle: '定时任务',
        refresh: '刷新',
        newJob: '新建任务',
        edit: '编辑',
        saveJob: '保存任务',
        deleteJob: '删除任务',
        deleteShort: '删除',
        runNow: '立即执行',
        empty: '暂无定时任务。',
        jobName: '任务名称',
        enabled: '启用',
        disabled: '停用',
        close: '关闭',
        scheduleKind: '调度类型',
        scheduleAt: '单次',
        scheduleEvery: '间隔',
        scheduleCron: 'Cron',
        atTime: '执行时间',
        everyMs: '间隔（毫秒）',
        cronExpr: 'Cron 表达式',
        cronTz: 'Cron 时区',
        payloadKind: '任务类型',
        payloadRun: '运行任务',
        payloadTelegram: '发送 Telegram 消息',
        threadMode: '对话模式',
        threadModeFixed: '固定线程',
        threadModeNewChat: '每次新建对话',
        project: '项目',
        noProject: '不绑定项目',
        provider: 'Provider',
        model: '模型',
        followDefault: '跟随默认',
        prompt: '提示词',
        telegramChatId: 'Telegram Chat ID',
        telegramText: 'Telegram 文本',
        ifNonEmpty: '仅在内容非空时发送',
        deliveryTitle: '运行结果投递',
        deliveryKind: '投递方式',
        deliveryNone: '不投递',
        deliveryTelegram: 'Telegram',
        saved: '已保存。',
        deleted: '已删除。',
        triggered: '已触发执行。',
        failedLoad: '加载任务失败。',
        failedSave: '保存任务失败。',
        failedDelete: '删除任务失败。',
        failedRun: '执行任务失败。',
        nextRun: '下次执行',
        lastStatus: '最近状态',
        historyTitle: '执行记录',
        historyEmpty: '暂无执行记录。',
        historyStarted: '开始时间',
        historyDuration: '耗时',
        historyOutput: '输出摘要',
        historyError: '错误',
        openThread: '打开对话',
        listTitle: '任务列表',
        listHint: '这里展示最近状态、下次执行和调度摘要。点击任务后再编辑。',
        editorEmpty: '先在左侧选择一个任务。',
        sectionTask: '1. 任务内容',
        sectionContext: '2. 执行上下文',
        sectionSchedule: '3. 调度',
        sectionDelivery: '4. 结果处理',
        sectionHistory: '5. 最近执行',
        promptHint: '写清楚每次定时执行时，希望模型完成什么结果。',
        projectHint: '绑定项目后，任务会复用该项目的工作区和对话。',
        threadModeHint: '固定线程会延续上下文；每次新建对话会为每次执行创建新会话。',
        scheduleHint: '设置这个任务何时自动运行。',
        telegramHint: '任务完成后，把结果摘要投递到 Telegram。',
        taskTypeHint: '运行任务是主流程；发送 Telegram 消息保留给简单的消息类任务。',
        lastRunEmpty: '尚未执行'
      },
      ja: {
        title: '自動化',
        desc: 'プロジェクト・プロンプト・モデルを軸に定期 AI タスクを管理します。',
        serviceTitle: 'Cron サービス',
        serviceDesc: 'このサービスがローカル定期ジョブを動かします。',
        serviceCompactHint: '無効化するとローカル自動実行を停止します。既定の確認間隔は 500ms です。',
        cronEnable: 'Cron サービスを有効化',
        cronEnableHint: '無効時はローカル定期ジョブが実行されません。',
        pollInterval: '確認間隔（ms）',
        pollIntervalHint: 'Cron が実行時刻に達したタスクを確認する間隔です。既定値は 500ms です。',
        allowAgentManage: 'Agent に Cron 管理を許可',
        allowAgentManageHint: '有効時、Agent が cron_list / cron_upsert / cron_delete / cron_run を使えます。',
        jobsTitle: '定期ジョブ',
        refresh: '更新',
        newJob: '新規ジョブ',
        edit: '編集',
        saveJob: '保存',
        deleteJob: '削除',
        deleteShort: '削除',
        runNow: '今すぐ実行',
        empty: '定期ジョブはまだありません。',
        jobName: 'ジョブ名',
        enabled: '有効',
        disabled: '無効',
        close: '閉じる',
        scheduleKind: 'スケジュール種別',
        scheduleAt: '単発',
        scheduleEvery: '間隔',
        scheduleCron: 'Cron',
        atTime: '実行時刻',
        everyMs: '間隔（ms）',
        cronExpr: 'Cron 式',
        cronTz: 'Cron タイムゾーン',
        payloadKind: '処理種別',
        payloadRun: 'Run タスク',
        payloadTelegram: 'Telegram メッセージ',
        threadMode: '会話モード',
        threadModeFixed: '固定スレッド',
        threadModeNewChat: '毎回新しい会話',
        project: 'プロジェクト',
        noProject: 'プロジェクトなし',
        provider: 'Provider',
        model: 'モデル',
        followDefault: '既定に従う',
        prompt: 'プロンプト',
        telegramChatId: 'Telegram Chat ID',
        telegramText: 'Telegram テキスト',
        ifNonEmpty: '非空時のみ送信',
        deliveryTitle: '実行結果の配送',
        deliveryKind: '配送方式',
        deliveryNone: 'なし',
        deliveryTelegram: 'Telegram',
        saved: '保存しました。',
        deleted: '削除しました。',
        triggered: '実行を開始しました。',
        failedLoad: 'ジョブの読み込みに失敗しました。',
        failedSave: 'ジョブの保存に失敗しました。',
        failedDelete: 'ジョブの削除に失敗しました。',
        failedRun: 'ジョブの実行に失敗しました。',
        nextRun: '次回実行',
        lastStatus: '前回状態',
        historyTitle: '実行履歴',
        historyEmpty: '実行履歴はまだありません。',
        historyStarted: '開始時刻',
        historyDuration: '所要時間',
        historyOutput: '出力概要',
        historyError: 'エラー',
        openThread: 'スレッドを開く',
        listTitle: 'タスク一覧',
        listHint: '状態・次回実行・スケジュール概要を確認できます。クリックすると編集します。',
        editorEmpty: '左側でタスクを選択してください。',
        sectionTask: '1. タスク内容',
        sectionContext: '2. 実行コンテキスト',
        sectionSchedule: '3. スケジュール',
        sectionDelivery: '4. 配送',
        sectionHistory: '5. 最近の実行',
        promptHint: '毎回の実行でモデルに達成してほしい結果を記述します。',
        projectHint: 'プロジェクトに紐付けると、ワークスペースと会話を再利用します。',
        threadModeHint: '固定スレッドは文脈を維持し、毎回新しい会話は毎回新規スレッドを作成します。',
        scheduleHint: 'このタスクをいつ実行するか設定します。',
        telegramHint: '実行完了後に結果概要を Telegram に送ります。',
        taskTypeHint: 'Run タスクが主な用途です。Telegram メッセージは単純な通知向けです。',
        lastRunEmpty: '未実行'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const cron = (settings as any).cron || {}
  const projects = Array.isArray(settings.projects) ? settings.projects : []

  const availableProviders = useMemo(() => {
    const list = Array.isArray(providers) ? providers.filter((p) => p && p.isEnabled) : []
    list.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    return list
  }, [providers])

  const selectedProvider = useMemo(() => {
    const providerId = String(draft.payload?.run?.composer?.providerOverrideId || '').trim()
    if (!providerId) return undefined
    return availableProviders.find((p) => p.id === providerId)
  }, [availableProviders, draft.payload?.run?.composer?.providerOverrideId])

  const availableModels = useMemo(() => {
    const models = Array.isArray(selectedProvider?.config?.models) ? selectedProvider?.config?.models : []
    return models
      .map((m: any) => (typeof m === 'string' ? m : m?.id))
      .filter((id: any) => typeof id === 'string' && id.trim())
  }, [selectedProvider])

  const selectedJob = useMemo(
    () => jobs.find((job) => String(job?.id || '') === String(selectedJobId || draft.id || '').trim()),
    [draft.id, jobs, selectedJobId]
  )
  const runHistory = Array.isArray((selectedJob as any)?.runHistory) ? (selectedJob as any).runHistory : []
  const currentJobId = String(draft.id || selectedJobId || '').trim()
  const payloadKind = String(draft.payload?.kind || 'run')
  const scheduleKind = String(draft.schedule?.kind || 'every')

  const resolveProjectDir = useCallback(
    (projectId: string) => {
      const pid = String(projectId || '').trim()
      if (!pid) return String(settings.workspaceDir || '').trim()
      const found = projects.find((p: any) => String(p?.id || '').trim() === pid)
      return String(found?.dir || settings.workspaceDir || '').trim()
    },
    [projects, settings.workspaceDir]
  )

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchBackendJson<{ ok: boolean; store?: { jobs?: any[] } }>('/api/cron/jobs', { method: 'GET' })
      const nextJobs = Array.isArray(res?.store?.jobs) ? res.store.jobs : []
      setJobs(nextJobs)
      setStatus((prev) => (prev.type === 'error' ? { type: 'idle' } : prev))
    } catch (e) {
      setStatus({ type: 'error', text: e instanceof Error ? e.message : t.failedLoad })
    } finally {
      setLoading(false)
    }
  }, [t.failedLoad])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  useEffect(() => {
    if (status.type !== 'ok') return
    const timer = window.setTimeout(() => {
      setStatus((prev) => (prev.type === 'ok' ? { type: 'idle' } : prev))
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [status.type])

  useEffect(() => {
    if (!selectedJobId) return
    const selected = jobs.find((job) => String(job?.id || '') === selectedJobId)
    if (!selected) {
      setSelectedJobId('')
      return
    }
    const schedule = selected.schedule && typeof selected.schedule === 'object' ? selected.schedule : {}
    const payload = selected.payload && typeof selected.payload === 'object' ? selected.payload : {}
    const run = payload.run && typeof payload.run === 'object' ? payload.run : {}
    const composer = run.composer && typeof run.composer === 'object' ? run.composer : {}
    const messages = Array.isArray(run.messages) ? run.messages : []
    const firstMessage = messages.find((m: any) => m && String(m.role || '') === 'user')
    const delivery = selected.delivery && typeof selected.delivery === 'object' ? selected.delivery : {}
    setDraft({
      id: String(selected.id || ''),
      name: String(selected.name || ''),
      enabled: Boolean(selected.enabled),
      schedule: {
        kind: String(schedule.kind || 'every'),
        everyMs: Number(schedule.everyMs || 3600000),
        expr: String(schedule.expr || '0 9 * * *'),
        tz: String(schedule.tz || 'Asia/Shanghai'),
        atMs: Number(schedule.atMs || 0)
      },
      payload: {
        kind: String(payload.kind || 'run'),
        run: {
          threadId: String(run.threadId || ''),
          threadMode: String(run.threadMode || 'fixed'),
          composer: {
            projectId: String(composer.projectId || ''),
            workspaceDir: String(composer.workspaceDir || ''),
            providerOverrideId: String(composer.providerOverrideId || ''),
            modelOverride: String(composer.modelOverride || '')
          },
          messages: [{ role: 'user', content: String((firstMessage as any)?.content || '') }]
        },
        chatId: String(payload.chatId || ''),
        text: String(payload.text || ''),
        ifNonEmpty: Boolean(payload.ifNonEmpty)
      },
      delivery: {
        kind: String(delivery.kind || ''),
        chatId: String(delivery.chatId || ''),
        ifNonEmpty: delivery.ifNonEmpty !== false
      }
    })
  }, [jobs, selectedJobId])

  const updateDraft = (patch: any) => {
    setDraft((prev: any) => ({ ...prev, ...patch }))
  }

  const createNewJob = (openEditor = true) => {
    setSelectedJobId('')
    setDraft({
      id: '',
      name: '',
      enabled: true,
      schedule: { kind: 'every', everyMs: 3600000, expr: '0 9 * * *', tz: 'Asia/Shanghai', atMs: 0 },
      payload: {
        kind: 'run',
        run: {
          threadId: '',
          threadMode: 'fixed',
          composer: {
            projectId: activeProjectId || '',
            workspaceDir: resolveProjectDir(activeProjectId || ''),
            providerOverrideId: '',
            modelOverride: ''
          },
          messages: [{ role: 'user', content: '' }]
        },
        chatId: '',
        text: '',
        ifNonEmpty: true
      },
      delivery: { kind: '', chatId: '', ifNonEmpty: true }
    })
    setEditorOpen(openEditor)
  }

  const openJobEditor = (jobId: string) => {
    setSelectedJobId(String(jobId || '').trim())
    setEditorOpen(true)
  }

  useEffect(() => {
    if (!selectedJobId && !String(draft.name || '').trim()) createNewJob(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveJob = async () => {
    setSaving(true)
    try {
      const scheduleKind = String(draft.schedule?.kind || 'every')
      const payloadKind = String(draft.payload?.kind || 'run')
      const job: any = {
        id: String(draft.id || '').trim() || undefined,
        name: String(draft.name || '').trim(),
        enabled: Boolean(draft.enabled),
        schedule: { kind: scheduleKind },
        payload: { kind: payloadKind }
      }
      if (scheduleKind === 'at') {
        job.schedule.atMs = Number(draft.schedule?.atMs || 0)
      } else if (scheduleKind === 'cron') {
        job.schedule.expr = String(draft.schedule?.expr || '').trim()
        job.schedule.tz = String(draft.schedule?.tz || 'Asia/Shanghai').trim() || 'Asia/Shanghai'
      } else {
        job.schedule.everyMs = Math.max(1000, Number(draft.schedule?.everyMs || 0))
      }

      if (payloadKind === 'telegramMessage') {
        job.payload.chatId = String(draft.payload?.chatId || '').trim()
        job.payload.text = String(draft.payload?.text || '')
        job.payload.ifNonEmpty = Boolean(draft.payload?.ifNonEmpty)
      } else {
        const projectId = String(draft.payload?.run?.composer?.projectId || '').trim()
        const providerOverrideId = String(draft.payload?.run?.composer?.providerOverrideId || '').trim()
        const modelOverride = String(draft.payload?.run?.composer?.modelOverride || '').trim()
        const threadMode = String(draft.payload?.run?.threadMode || 'fixed').trim() || 'fixed'
        job.payload.run = {
          threadId: threadMode === 'fixed' ? String(draft.payload?.run?.threadId || '').trim() : '',
          threadMode,
          composer: {
            projectId,
            workspaceDir: resolveProjectDir(projectId),
            providerOverrideId,
            modelOverride
          },
          messages: [{ role: 'user', content: String(draft.payload?.run?.messages?.[0]?.content || '') }]
        }
        const deliveryKind = String(draft.delivery?.kind || '').trim()
        if (deliveryKind === 'telegram') {
          job.delivery = {
            kind: 'telegram',
            chatId: String(draft.delivery?.chatId || '').trim(),
            ifNonEmpty: Boolean(draft.delivery?.ifNonEmpty)
          }
        }
      }

      const res = await fetchBackendJson<{ ok: boolean; job?: any; store?: { jobs?: any[] } }>('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', job })
      })
      const nextJobs = Array.isArray(res?.store?.jobs) ? res.store.jobs : jobs
      setJobs(nextJobs)
      const savedId = String(res?.job?.id || job.id || '').trim()
      if (savedId) setSelectedJobId(savedId)
      setStatus({ type: 'ok', text: t.saved })
    } catch (e) {
      setStatus({ type: 'error', text: e instanceof Error ? e.message : t.failedSave })
    } finally {
      setSaving(false)
    }
  }

  const deleteJob = async (targetId?: string) => {
    const id = String(targetId || draft.id || selectedJobId || '').trim()
    if (!id) return
    try {
      await fetchBackendJson('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id })
      })
      setJobs((prev) => prev.filter((job) => String(job?.id || '') !== id))
      if (String(selectedJobId || '').trim() === id || String(draft.id || '').trim() === id) {
        setSelectedJobId('')
        createNewJob(false)
        setEditorOpen(false)
      }
      setStatus({ type: 'ok', text: t.deleted })
    } catch (e) {
      setStatus({ type: 'error', text: e instanceof Error ? e.message : t.failedDelete })
    }
  }

  const runJobNow = async (id: string) => {
    if (!id) return
    try {
      await fetchBackendJson('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', id })
      })
      setStatus({ type: 'ok', text: t.triggered })
      await loadJobs()
    } catch (e) {
      setStatus({ type: 'error', text: e instanceof Error ? e.message : t.failedRun })
    }
  }

  const formatDateTime = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '-'
    return new Date(value).toLocaleString()
  }

  const formatDuration = (value: number) => {
    const ms = Number(value || 0)
    if (!Number.isFinite(ms) || ms <= 0) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60_000).toFixed(1)}m`
  }

  const toInputDateTimeValue = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return ''
    const d = new Date(value)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
  }

  const formatScheduleSummary = (job: any) => {
    const schedule = job?.schedule && typeof job.schedule === 'object' ? job.schedule : {}
    const kind = String(schedule.kind || '')
    if (kind === 'at') return `${t.scheduleAt} · ${formatDateTime(Number(schedule.atMs || 0))}`
    if (kind === 'cron') return `${t.scheduleCron} · ${String(schedule.expr || '0 9 * * *')}`
    return `${t.scheduleEvery} · ${formatDuration(Number(schedule.everyMs || 0))}`
  }

  const formatContextSummary = (job: any) => {
    const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {}
    if (String(payload.kind || 'run') !== 'run') return t.payloadTelegram
    const run = payload.run && typeof payload.run === 'object' ? payload.run : {}
    const composer = run.composer && typeof run.composer === 'object' ? run.composer : {}
    const projectId = String(composer.projectId || '').trim()
    const providerOverrideId = String(composer.providerOverrideId || '').trim()
    const modelOverride = String(composer.modelOverride || '').trim()
    const threadMode = String(run.threadMode || 'fixed')
    const projectName = projectId
      ? String(
          projects.find((project: any) => String(project?.id || '').trim() === projectId)?.name ||
          projects.find((project: any) => String(project?.id || '').trim() === projectId)?.id ||
          projectId
        )
      : t.noProject
    const parts = [projectName, threadMode === 'new_chat' ? t.threadModeNewChat : t.threadModeFixed]
    if (modelOverride) parts.push(modelOverride)
    else if (providerOverrideId) {
      const providerName = availableProviders.find((provider) => provider.id === providerOverrideId)?.name || providerOverrideId
      parts.push(String(providerName))
    }
    return parts.filter(Boolean).join(' · ')
  }

  const formatJobStatusVariant = (statusValue: string) => {
    if (statusValue === 'succeeded') return 'default' as const
    if (statusValue === 'failed') return 'destructive' as const
    return 'secondary' as const
  }

  const openHistoryThread = async (threadId: string, projectId: string) => {
    const tid = String(threadId || '').trim()
    if (!tid) return
    const pid = String(projectId || '').trim()
    if (pid) setActiveProject(pid)
    await setActiveChat(tid)
    setSettingsOpen(false)
  }

  return (
    <div className="p-6 space-y-6">
      {status.type !== 'idle' ? (
        <div className={`rounded-xl border px-3 py-2 text-xs ${
          status.type === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
            : 'border-destructive/30 bg-destructive/5 text-destructive'
        }`}>
          {status.text}
        </div>
      ) : null}

      <Card className="border-border/70">
        <CardContent className="space-y-3 p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold">{t.serviceTitle}</div>
              <Badge variant={Boolean(cron.enabled) ? 'default' : 'secondary'}>
                {Boolean(cron.enabled) ? t.enabled : t.disabled}
              </Badge>
            </div>
            <div className="text-[11px] leading-5 text-muted-foreground">{t.serviceCompactHint}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_184px_auto]">
              <div className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/[0.08] px-3">
                <span className="text-xs font-medium">{t.cronEnable}</span>
                <Switch checked={Boolean(cron.enabled)} onCheckedChange={(c) => updateSettings({ cron: { ...cron, enabled: c } } as any)} />
              </div>
              <div className="flex h-10 items-center gap-2 rounded-lg border border-border/70 bg-muted/[0.08] px-3">
                <Label className="shrink-0 text-xs font-medium">{t.pollInterval}</Label>
                <Input
                  className="h-7 border-0 bg-transparent px-0 text-right shadow-none focus-visible:ring-0"
                  type="number"
                  min={200}
                  max={30000}
                  value={Number(cron.pollIntervalMs || 500)}
                  onChange={(e) => updateSettings({ cron: { ...cron, pollIntervalMs: Number(e.target.value || 500) } } as any)}
                />
              </div>
              <div className="flex h-10 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/[0.08] px-3">
                <span className="text-xs font-medium">{t.allowAgentManage}</span>
                <Switch checked={Boolean(cron.allowAgentManage)} onCheckedChange={(c) => updateSettings({ cron: { ...cron, allowAgentManage: c } } as any)} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="text-base font-semibold">{t.listTitle}</div>
              <div className="text-sm text-muted-foreground">{t.listHint}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void loadJobs()} disabled={loading}>
                <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {t.refresh}
              </Button>
              <Button size="sm" onClick={() => createNewJob()}>
                <Plus className="mr-1 h-4 w-4" />
                {t.newJob}
              </Button>
            </div>
          </div>

          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-5 py-8 text-center">
              <div className="text-sm font-medium">{t.empty}</div>
              <div className="mt-2 text-xs text-muted-foreground">{t.cronEnableHint}</div>
              <Button size="sm" className="mt-4" onClick={() => createNewJob()}>
                <Plus className="mr-1 h-4 w-4" />
                {t.newJob}
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
              {jobs.map((job) => {
                const jobId = String(job?.id || '')
                const lastStatus = String(job?.lastStatus || '')
                return (
                  <div
                    key={jobId}
                    className="w-full border-b border-border/70 px-4 py-3 last:border-b-0 transition-colors hover:bg-muted/[0.06]"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="truncate text-sm font-medium">{String(job?.name || jobId || '-')}</div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{t.nextRun}: {formatDateTime(Number(job?.nextRunAtMs || 0))}</span>
                          <span className="text-border">/</span>
                          <span>{formatScheduleSummary(job)}</span>
                          <span className="text-border">/</span>
                          <span>{formatContextSummary(job)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <Badge variant={Boolean(job?.enabled) ? 'default' : 'secondary'}>
                          {Boolean(job?.enabled) ? t.enabled : t.disabled}
                        </Badge>
                        <Badge variant={formatJobStatusVariant(lastStatus)}>
                          {lastStatus || t.lastRunEmpty}
                        </Badge>
                        <Button size="sm" variant="outline" className="h-8 px-3 rounded-full" onClick={() => openJobEditor(jobId)}>
                          {t.edit}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-3 rounded-full text-muted-foreground hover:text-foreground" onClick={() => void deleteJob(jobId)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          {t.deleteShort}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden border border-border/70 bg-background p-0 shadow-xl sm:max-w-[1024px] sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b border-border/70 px-6 py-5">
            <DialogTitle>{String(draft.name || '').trim() || t.newJob}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
            <div className="space-y-5">
              <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-background p-5">
                <div className="min-w-0 space-y-2">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{String(draft.id || '').trim() ? t.jobName : t.newJob}</div>
                    <div className="text-xs text-muted-foreground">{t.promptHint}</div>
                  </div>
                  <Input
                    value={String(draft.name || '')}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    className="h-10 rounded-xl border-border/70 bg-background text-sm font-medium"
                    placeholder={t.jobName}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{t.nextRun}: {formatDateTime(Number(selectedJob?.nextRunAtMs || 0))}</span>
                    <span>{t.lastStatus}: {String(selectedJob?.lastStatus || t.lastRunEmpty)}</span>
                  </div>
                </div>
              </div>
              

              <section className="space-y-4 rounded-2xl border border-border/70 bg-background p-5">
              <div className="space-y-1">
                <div className="text-sm font-semibold">{t.sectionTask}</div>
                <div className="text-xs text-muted-foreground">{t.promptHint}</div>
              </div>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-2">
                  <Textarea
                    value={payloadKind === 'run' ? String(draft.payload?.run?.messages?.[0]?.content || '') : String(draft.payload?.text || '')}
                    onChange={(e) =>
                      payloadKind === 'run'
                        ? updateDraft({ payload: { ...draft.payload, run: { ...draft.payload.run, messages: [{ role: 'user', content: e.target.value }] } } })
                        : updateDraft({ payload: { ...draft.payload, text: e.target.value } })
                    }
                    rows={11}
                    className="min-h-[240px] rounded-xl border-border/70 bg-background px-3 py-2 text-sm leading-6"
                    placeholder={t.prompt}
                  />
                </div>
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/70 bg-muted/[0.08] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{t.enabled}</span>
                      <Switch checked={Boolean(draft.enabled)} onCheckedChange={(c) => updateDraft({ enabled: c })} />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-xl border border-border/70 bg-muted/[0.08] p-4">
                    <Label>{t.payloadKind}</Label>
                    <Select value={payloadKind} onValueChange={(val) => updateDraft({ payload: { ...draft.payload, kind: val } })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="run">{t.payloadRun}</SelectItem>
                        <SelectItem value="telegramMessage">{t.payloadTelegram}</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">{t.taskTypeHint}</div>
                  </div>
                  {payloadKind === 'telegramMessage' ? (
                    <>
                      <div className="space-y-2 rounded-xl border border-border/70 bg-muted/[0.08] p-4">
                        <Label>{t.telegramChatId}</Label>
                        <Input value={String(draft.payload?.chatId || '')} onChange={(e) => updateDraft({ payload: { ...draft.payload, chatId: e.target.value } })} />
                      </div>
                      <div className="rounded-xl border border-border/70 bg-muted/[0.08] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{t.ifNonEmpty}</span>
                          <Switch checked={Boolean(draft.payload?.ifNonEmpty)} onCheckedChange={(c) => updateDraft({ payload: { ...draft.payload, ifNonEmpty: c } })} />
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
              </section>

              {payloadKind === 'run' ? (
                <>
                  <section className="space-y-4 rounded-2xl border border-border/70 bg-background p-5">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{t.sectionContext}</div>
                    <div className="text-xs text-muted-foreground">{t.projectHint}</div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-2">
                      <Label>{t.project}</Label>
                      <Select
                        value={String(draft.payload?.run?.composer?.projectId || '') || ' '}
                        onValueChange={(val) => {
                          const nextProjectId = val.trim() ? val : ''
                          updateDraft({
                            payload: {
                              ...draft.payload,
                              run: {
                                ...draft.payload.run,
                                composer: {
                                  ...draft.payload.run.composer,
                                  projectId: nextProjectId,
                                  workspaceDir: resolveProjectDir(nextProjectId)
                                }
                              }
                            }
                          })
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder={t.noProject} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value=" ">{t.noProject}</SelectItem>
                          {projects.map((p: any) => (
                            <SelectItem key={String(p?.id || '')} value={String(p?.id || '')}>
                              {String(p?.name || p?.id || '')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t.provider}</Label>
                      <Select
                        value={String(draft.payload?.run?.composer?.providerOverrideId || '') || ' '}
                        onValueChange={(val) =>
                          updateDraft({
                            payload: {
                              ...draft.payload,
                              run: {
                                ...draft.payload.run,
                                composer: {
                                  ...draft.payload.run.composer,
                                  providerOverrideId: val.trim() ? val : '',
                                  modelOverride: ''
                                }
                              }
                            }
                          })
                        }
                      >
                        <SelectTrigger><SelectValue placeholder={t.followDefault} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value=" ">{t.followDefault}</SelectItem>
                          {availableProviders.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name || p.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t.model}</Label>
                      <Select
                        value={String(draft.payload?.run?.composer?.modelOverride || '') || ' '}
                        onValueChange={(val) =>
                          updateDraft({
                            payload: {
                              ...draft.payload,
                              run: {
                                ...draft.payload.run,
                                composer: {
                                  ...draft.payload.run.composer,
                                  modelOverride: val.trim() ? val : ''
                                }
                              }
                            }
                          })
                        }
                      >
                        <SelectTrigger><SelectValue placeholder={t.followDefault} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value=" ">{t.followDefault}</SelectItem>
                          {availableModels.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t.threadMode}</Label>
                      <Select
                        value={String(draft.payload?.run?.threadMode || 'fixed')}
                        onValueChange={(val) =>
                          updateDraft({
                            payload: {
                              ...draft.payload,
                              run: {
                                ...draft.payload.run,
                                threadMode: val,
                                threadId: val === 'fixed' ? String(draft.payload?.run?.threadId || '') : ''
                              }
                            }
                          })
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">{t.threadModeFixed}</SelectItem>
                          <SelectItem value="new_chat">{t.threadModeNewChat}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{t.threadModeHint}</div>
                  </section>

                  <section className="space-y-4 rounded-2xl border border-border/70 bg-background p-5">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{t.sectionSchedule}</div>
                    <div className="text-xs text-muted-foreground">{t.scheduleHint}</div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-2">
                      <Label>{t.scheduleKind}</Label>
                      <Select value={scheduleKind} onValueChange={(val) => updateDraft({ schedule: { ...draft.schedule, kind: val } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="at">{t.scheduleAt}</SelectItem>
                          <SelectItem value="every">{t.scheduleEvery}</SelectItem>
                          <SelectItem value="cron">{t.scheduleCron}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {scheduleKind === 'at' ? (
                      <div className="space-y-2">
                        <Label>{t.atTime}</Label>
                        <Input
                          type="datetime-local"
                          value={toInputDateTimeValue(Number(draft.schedule?.atMs || 0))}
                          onChange={(e) => updateDraft({ schedule: { ...draft.schedule, atMs: e.target.value ? new Date(e.target.value).getTime() : 0 } })}
                        />
                      </div>
                    ) : null}
                    {scheduleKind === 'every' ? (
                      <div className="space-y-2">
                        <Label>{t.everyMs}</Label>
                        <Input
                          type="number"
                          min={1000}
                          value={Number(draft.schedule?.everyMs || 0)}
                          onChange={(e) => updateDraft({ schedule: { ...draft.schedule, everyMs: Number(e.target.value || 0) } })}
                        />
                      </div>
                    ) : null}
                    {scheduleKind === 'cron' ? (
                      <>
                        <div className="space-y-2">
                          <Label>{t.cronExpr}</Label>
                          <Input value={String(draft.schedule?.expr || '')} onChange={(e) => updateDraft({ schedule: { ...draft.schedule, expr: e.target.value } })} placeholder="0 9 * * *" />
                        </div>
                        <div className="space-y-2">
                          <Label>{t.cronTz}</Label>
                          <Input value={String(draft.schedule?.tz || '')} onChange={(e) => updateDraft({ schedule: { ...draft.schedule, tz: e.target.value } })} placeholder="Asia/Shanghai" />
                        </div>
                      </>
                    ) : null}
                  </div>
                  </section>

                  <section className="space-y-4 rounded-2xl border border-border/70 bg-background p-5">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold">{t.sectionDelivery}</div>
                    <div className="text-xs text-muted-foreground">{t.telegramHint}</div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[220px_minmax(0,1fr)_180px]">
                    <div className="space-y-2">
                      <Label>{t.deliveryKind}</Label>
                      <Select value={String(draft.delivery?.kind || '') || 'none'} onValueChange={(val) => updateDraft({ delivery: { ...draft.delivery, kind: val === 'none' ? '' : val } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t.deliveryNone}</SelectItem>
                          <SelectItem value="telegram">{t.deliveryTelegram}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {String(draft.delivery?.kind || '') === 'telegram' ? (
                      <>
                        <div className="space-y-2">
                          <Label>{t.telegramChatId}</Label>
                          <Input value={String(draft.delivery?.chatId || '')} onChange={(e) => updateDraft({ delivery: { ...draft.delivery, chatId: e.target.value } })} />
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/[0.08] px-4 py-3 md:mt-7">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{t.ifNonEmpty}</span>
                            <Switch checked={Boolean(draft.delivery?.ifNonEmpty)} onCheckedChange={(c) => updateDraft({ delivery: { ...draft.delivery, ifNonEmpty: c } })} />
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                  </section>
                </>
              ) : (
                <section className="space-y-4 rounded-2xl border border-border/70 bg-background p-5">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">{t.sectionSchedule}</div>
                  <div className="text-xs text-muted-foreground">{t.scheduleHint}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>{t.scheduleKind}</Label>
                    <Select value={scheduleKind} onValueChange={(val) => updateDraft({ schedule: { ...draft.schedule, kind: val } })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="at">{t.scheduleAt}</SelectItem>
                        <SelectItem value="every">{t.scheduleEvery}</SelectItem>
                        <SelectItem value="cron">{t.scheduleCron}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scheduleKind === 'at' ? (
                    <div className="space-y-2">
                      <Label>{t.atTime}</Label>
                      <Input
                        type="datetime-local"
                        value={toInputDateTimeValue(Number(draft.schedule?.atMs || 0))}
                        onChange={(e) => updateDraft({ schedule: { ...draft.schedule, atMs: e.target.value ? new Date(e.target.value).getTime() : 0 } })}
                      />
                    </div>
                  ) : null}
                  {scheduleKind === 'every' ? (
                    <div className="space-y-2">
                      <Label>{t.everyMs}</Label>
                      <Input
                        type="number"
                        min={1000}
                        value={Number(draft.schedule?.everyMs || 0)}
                        onChange={(e) => updateDraft({ schedule: { ...draft.schedule, everyMs: Number(e.target.value || 0) } })}
                      />
                    </div>
                  ) : null}
                  {scheduleKind === 'cron' ? (
                    <>
                      <div className="space-y-2">
                        <Label>{t.cronExpr}</Label>
                        <Input value={String(draft.schedule?.expr || '')} onChange={(e) => updateDraft({ schedule: { ...draft.schedule, expr: e.target.value } })} placeholder="0 9 * * *" />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.cronTz}</Label>
                        <Input value={String(draft.schedule?.tz || '')} onChange={(e) => updateDraft({ schedule: { ...draft.schedule, tz: e.target.value } })} placeholder="Asia/Shanghai" />
                      </div>
                    </>
                    ) : null}
                  </div>
                </section>
              )}

              <section className="space-y-4 rounded-2xl border border-border/70 bg-background p-5">
              <div className="space-y-1">
                <div className="text-sm font-semibold">{t.sectionHistory}</div>
                <div className="text-xs text-muted-foreground">{t.historyTitle}</div>
              </div>
              {runHistory.length === 0 ? (
                <div className="text-xs text-muted-foreground">{t.historyEmpty}</div>
              ) : (
                <div className="space-y-3">
                  {runHistory.map((item: any) => (
                    <div key={String(item?.id || '')} className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={String(item?.status || '') === 'succeeded' ? 'default' : 'destructive'}>
                            {String(item?.status || '-')}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{t.historyStarted}: {formatDateTime(Number(item?.startedAtMs || 0))}</span>
                          <span className="text-xs text-muted-foreground">{t.historyDuration}: {formatDuration(Number(item?.durationMs || 0))}</span>
                        </div>
                        {String(item?.threadId || '').trim() ? (
                          <Button variant="ghost" size="sm" onClick={() => void openHistoryThread(String(item?.threadId || ''), String(item?.projectId || ''))}>
                            <ExternalLink className="mr-1 h-4 w-4" />
                            {t.openThread}
                          </Button>
                        ) : null}
                      </div>
                      {String(item?.outputPreview || '').trim() ? (
                        <div className="mt-3 text-xs">
                          <span className="text-muted-foreground">{t.historyOutput}: </span>
                          <span>{String(item?.outputPreview || '')}</span>
                        </div>
                      ) : null}
                      {String(item?.error || '').trim() ? (
                        <div className="mt-2 text-xs text-destructive">{t.historyError}: {String(item?.error || '')}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              </section>
            </div>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border/70 bg-background px-6 py-3 sm:justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => void runJobNow(currentJobId)} disabled={!currentJobId}>
                <Play className="mr-1 h-4 w-4" />
                {t.runNow}
              </Button>
              <Button variant="destructive" onClick={() => void deleteJob()} disabled={!currentJobId}>
                <Trash2 className="mr-1 h-4 w-4" />
                {t.deleteJob}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setEditorOpen(false)}>{t.close}</Button>
              <Button onClick={() => void saveJob()} disabled={saving}>{t.saveJob}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        telegramProject: 'Project',
        telegramProjectHint: 'Bind Telegram to a project workspace directory.',
        telegramProjectAll: 'All projects (no project binding)',
        chatProvider: 'Chat Provider',
        chatProviderHint: 'Optional. Use a specific provider/model for Telegram.',
        chatModel: 'Chat Model',
        chatModelHint: 'Optional. Overrides the provider default model.',
        followDefault: 'Follow desktop default'
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
        telegramProject: '项目',
        telegramProjectHint: '为 Telegram 绑定一个项目的工作目录。',
        telegramProjectAll: '所有项目（不绑定项目）',
        chatProvider: '聊天提供商',
        chatProviderHint: '可选。为 Telegram 单独指定 provider / model。',
        chatModel: '聊天模型',
        chatModelHint: '可选。覆盖 provider 的默认模型。',
        followDefault: '跟随桌面默认'
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
        telegramProject: 'プロジェクト',
        telegramProjectHint: 'Telegram 用のプロジェクト作業ディレクトリを設定します。',
        telegramProjectAll: '全プロジェクト（プロジェクト未バインド）',
        chatProvider: 'チャットプロバイダー',
        chatProviderHint: '任意。Telegram 用に provider/model を指定できます。',
        chatModel: 'チャットモデル',
        chatModelHint: '任意。プロバイダー既定モデルを上書きします。',
        followDefault: 'デスクトップ既定に従う'
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
  const telegramProjectId = String((tg as any).projectId || '').trim()
  const telegramProviderOverrideId = String((tg as any).providerOverrideId || '').trim()
  const telegramModelOverride = String((tg as any).modelOverride || '').trim()
  const projects = Array.isArray(settings.projects) ? settings.projects : []

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

  const allowedText = allowedUserIds.join('\n')

  const updateTelegram = (updates: Partial<NonNullable<typeof settings.im>['telegram']>) => {
    updateSettings({
      im: {
        provider: 'telegram',
        telegram: { ...tg, ...updates }
      }
    } as any)
  }

  const parseAllowed = (raw: string) => {
    const items = raw
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter(Boolean)
    return Array.from(new Set(items))
  }

  return (
    <div className="p-6 space-y-6">
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
            <div className="text-[13px] font-medium leading-none">{t.enableTelegram}</div>
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
            <div className="text-[13px] font-medium leading-none">{t.allowGroups}</div>
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
          <Label>{t.telegramProject}</Label>
          <Select
            value={telegramProjectId ? telegramProjectId : ' '}
            onValueChange={(val) => updateTelegram({ projectId: val.trim() ? val : '' } as any)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t.telegramProjectAll} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=" ">{t.telegramProjectAll}</SelectItem>
              {projects.map((p: any) => (
                <SelectItem key={String(p.id || '')} value={String(p.id || '')}>
                  {String(p.name || p.id || '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground">{t.telegramProjectHint}</div>
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
      }>(`/skills/list?t=${Date.now()}`, { method: 'GET', cache: 'no-store' })
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
        <div className="text-[13px] text-muted-foreground">{skills.length === 0 ? t.notFound : t.found(skills.length)}</div>
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
            <div className="group w-20 h-20 rounded-full bg-card border border-border shadow-sm flex items-center justify-center transition-colors">
              <div className="relative">
                <div className="absolute -inset-4 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.18),transparent_60%)] opacity-0 blur-sm transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
                <Sparkles className="relative w-9 h-9 text-muted-foreground motion-safe:anima-float group-hover:text-foreground transition-colors motion-reduce:transition-none" />
              </div>
            </div>
            <div className="text-[13px] font-semibold text-foreground">{t.emptyTitle}</div>
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
                <Card key={s.id} className="p-4">
                  <div className="grid grid-cols-[1fr_140px] items-start gap-x-4 gap-y-2">
                    <div className="min-w-0 space-y-1">
                      <div className="text-[13px] font-semibold">{s.name}</div>
                      {s.description ? <div className="text-xs text-muted-foreground break-words">{s.description}</div> : null}
                      {s.isValid === false ? (
                        <div className="text-xs text-destructive">
                          {Array.isArray(s.errors) && s.errors.length ? s.errors.join(', ') : 'invalid'}
                        </div>
                      ) : null}
                    </div>

                    <div className="w-[140px] flex items-center justify-end gap-2 whitespace-nowrap">
                      <Switch
                        checked={isEnabled}
                        disabled={s.isValid === false}
                        onCheckedChange={(c) => toggleEnabled(s.id, c)}
                      />
                      <span className="text-[13px] whitespace-nowrap">{isEnabled ? t.enabled : t.disabled}</span>
                    </div>

                    <div className="text-[11px] text-muted-foreground break-all min-w-0">{s.dir}</div>
                    <div />
                  </div>
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

function KnowledgeBaseSettings() {
  const { settings: settings0, updateSettings, ui } = useStore()
  const settings = settings0!
  const [kbDocs, setKbDocs] = useState<Array<{ id: string; path: string; fileName: string; chunkCount: number; updatedAt: number }>>([])
  const [kbStats, setKbStats] = useState<{ documents: number; chunks: number }>({ documents: 0, chunks: 0 })
  const [kbLoading, setKbLoading] = useState(false)
  const [kbBusy, setKbBusy] = useState(false)
  const [kbError, setKbError] = useState('')
  const [kbImportProgress, setKbImportProgress] = useState(0)
  const [kbImportMessage, setKbImportMessage] = useState('')
  const [kbTestQuery, setKbTestQuery] = useState('')
  const [kbTestLoading, setKbTestLoading] = useState(false)
  const [kbTestError, setKbTestError] = useState('')
  const [kbTestItems, setKbTestItems] = useState<
    Array<{ id: string; fileName: string; documentPath: string; headerPath: string; content: string; score: number; similarity: number }>
  >([])
  const kbImportPollRef = useRef<number | null>(null)

  const t = (() => {
    const dict = {
      en: {
        feature: 'Knowledge Base (Markdown RAG)',
        featureDesc: 'Import markdown files and inject retrieved chunks into chat context.',
        enabled: 'Enable knowledge base retrieval',
        autoQuery: 'Auto query on each user message',
        hybrid: 'Hybrid retrieval (vector + keyword)',
        maxRetrieve: 'Max retrieved chunks',
        similarity: 'Similarity threshold',
        chunkSize: 'Chunk size',
        chunkOverlap: 'Chunk overlap',
        import: 'Import Markdown',
        refresh: 'Refresh',
        empty: 'No markdown documents imported.',
        docCount: 'Documents',
        chunkCount: 'Chunks',
        failedLoad: 'Failed to load knowledge base',
        failedImport: 'Failed to import markdown files',
        failedDelete: 'Failed to delete markdown file',
        workspaceRequiredToManage: 'Please select a workspace before managing knowledge base.',
        loading: 'Loading…',
        noMarkdownPicked: 'No markdown files selected.',
        importSummary: (i: number, s: number, f: number) => `Import finished: imported ${i}, skipped ${s}, failed ${f}`,
        importing: 'Importing markdown files...',
        testTitle: 'Retrieval test',
        testPlaceholder: 'Input a query to test retrieval...',
        testAction: 'Run retrieval',
        testEmpty: 'No retrieval result.',
        failedTest: 'Failed to run retrieval test',
        testScoreLabel: 'Score',
        testSimilarityLabel: 'Similarity'
      },
      zh: {
        feature: '知识库（Markdown RAG）',
        featureDesc: '导入 Markdown 文件，检索后自动注入到对话上下文。',
        enabled: '启用知识库检索',
        autoQuery: '每次提问自动检索',
        hybrid: '混合检索（向量 + 关键词）',
        maxRetrieve: '最大检索分块数',
        similarity: '相似度阈值',
        chunkSize: '分块大小',
        chunkOverlap: '分块重叠',
        import: '导入 Markdown',
        refresh: '刷新',
        empty: '暂无已导入的 Markdown 文档。',
        docCount: '文档数',
        chunkCount: '分块数',
        failedLoad: '加载知识库失败',
        failedImport: '导入 Markdown 失败',
        failedDelete: '删除 Markdown 失败',
        workspaceRequiredToManage: '请先选择工作区后再管理知识库。',
        loading: '加载中…',
        noMarkdownPicked: '未选择 Markdown 文件。',
        importSummary: (i: number, s: number, f: number) => `导入完成：成功 ${i}，跳过 ${s}，失败 ${f}`,
        importing: '正在导入 Markdown 文件...',
        testTitle: '检索测试',
        testPlaceholder: '输入问题后测试检索结果...',
        testAction: '测试检索',
        testEmpty: '没有检索结果。',
        failedTest: '检索测试失败',
        testScoreLabel: '综合分',
        testSimilarityLabel: '相似度'
      },
      ja: {
        feature: 'ナレッジベース（Markdown RAG）',
        featureDesc: 'Markdown を取り込み、検索結果を会話コンテキストへ注入します。',
        enabled: 'ナレッジベース検索を有効化',
        autoQuery: '各ユーザーメッセージで自動検索',
        hybrid: 'ハイブリッド検索（ベクトル + キーワード）',
        maxRetrieve: '最大取得チャンク数',
        similarity: '類似度しきい値',
        chunkSize: 'チャンクサイズ',
        chunkOverlap: 'チャンクオーバーラップ',
        import: 'Markdown を取り込む',
        refresh: '再読み込み',
        empty: '取り込み済み Markdown はありません。',
        docCount: 'ドキュメント数',
        chunkCount: 'チャンク数',
        failedLoad: 'ナレッジベースの読み込みに失敗しました',
        failedImport: 'Markdown の取り込みに失敗しました',
        failedDelete: 'Markdown の削除に失敗しました',
        workspaceRequiredToManage: 'ナレッジベース管理の前にワークスペースを選択してください。',
        loading: '読み込み中…',
        noMarkdownPicked: 'Markdown ファイルが選択されていません。',
        importSummary: (i: number, s: number, f: number) => `取り込み完了: 成功 ${i} / スキップ ${s} / 失敗 ${f}`,
        importing: 'Markdown を取り込み中...',
        testTitle: '検索テスト',
        testPlaceholder: 'クエリを入力して検索結果を確認...',
        testAction: '検索をテスト',
        testEmpty: '検索結果がありません。',
        failedTest: '検索テストに失敗しました',
        testScoreLabel: 'スコア',
        testSimilarityLabel: '類似度'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  const workspaceDir = useMemo(() => {
    const projects = Array.isArray((settings as any)?.projects) ? (settings as any).projects : []
    const pid = String((ui as any)?.activeProjectId || '').trim()
    const p = pid ? projects.find((x: any) => String(x?.id || '').trim() === pid) : null
    const dir = String((p as any)?.dir || '').trim()
    if (dir) return dir
    return String((settings as any)?.workspaceDir || '').trim()
  }, [settings, ui])

  const loadKbDocuments = useCallback(async () => {
    if (!workspaceDir) {
      setKbDocs([])
      setKbStats({ documents: 0, chunks: 0 })
      return
    }
    setKbLoading(true)
    setKbError('')
    try {
      const q = new URLSearchParams({ workspaceDir, limit: '500' })
      const res = await fetchBackendJson<{ ok: boolean; items?: Array<any>; stats?: any }>(`/kb/documents?${q.toString()}`, { method: 'GET' })
      const items = Array.isArray(res.items) ? res.items : []
      setKbDocs(
        items
          .map((it) => ({
            id: String((it as any)?.id || '').trim(),
            path: String((it as any)?.path || '').trim(),
            fileName: String((it as any)?.fileName || '').trim(),
            chunkCount: Number((it as any)?.chunkCount || 0),
            updatedAt: Number((it as any)?.updatedAt || 0)
          }))
          .filter((it) => Boolean(it.id))
      )
      const s = (res as any)?.stats || {}
      setKbStats({
        documents: Number(s.documents || 0),
        chunks: Number(s.chunks || 0)
      })
    } catch (e) {
      setKbError(e instanceof Error ? e.message : t.failedLoad)
    } finally {
      setKbLoading(false)
    }
  }, [workspaceDir, t.failedLoad])

  useEffect(() => {
    void loadKbDocuments()
  }, [loadKbDocuments])

  useEffect(() => {
    return () => {
      const timer = kbImportPollRef.current
      if (timer) window.clearTimeout(timer)
      kbImportPollRef.current = null
    }
  }, [])

  const pollKbImportTask = useCallback(
    (taskId: string) => {
      const tick = async () => {
        try {
          const res = await fetchBackendJson<{ ok: boolean; task?: any }>(`/kb/import/status?taskId=${encodeURIComponent(taskId)}`, { method: 'GET' })
          const task = (res as any)?.task || {}
          const status = String(task.status || '').trim()
          const percent = Math.max(0, Math.min(100, Number(task.percent || 0)))
          setKbImportProgress(percent)
          const curFile = String(task.currentFile || '').trim()
          setKbImportMessage(curFile ? `${t.importing} ${curFile}` : t.importing)
          if (status === 'done') {
            const rr = task.result || {}
            setKbImportProgress(100)
            setKbImportMessage(t.importSummary(Number(rr.imported || 0), Number(rr.skipped || 0), Number(rr.failed || 0)))
            await loadKbDocuments()
            setKbBusy(false)
            kbImportPollRef.current = window.setTimeout(() => setKbImportProgress(0), 1200)
            return
          }
          if (status === 'error') {
            setKbBusy(false)
            setKbImportProgress(0)
            setKbImportMessage('')
            setKbError(String(task.error || t.failedImport))
            return
          }
        } catch (e) {
          setKbBusy(false)
          setKbImportProgress(0)
          setKbImportMessage('')
          setKbError(e instanceof Error ? e.message : t.failedImport)
          return
        }
        kbImportPollRef.current = window.setTimeout(() => void tick(), 700)
      }
      kbImportPollRef.current = window.setTimeout(() => void tick(), 300)
    },
    [loadKbDocuments, t]
  )

  const importKbMarkdown = useCallback(async () => {
    if (!workspaceDir) {
      setKbError(t.workspaceRequiredToManage)
      return
    }
    const picked = await window.anima?.window?.pickFiles?.()
    if (!picked?.ok || picked.canceled) return
    const allPaths = (Array.isArray(picked.paths) ? picked.paths : []).map((p: any) => String(p || '').trim()).filter(Boolean)
    const paths = allPaths.filter((p) => /\.md$/i.test(p) || /\.markdown$/i.test(p))
    if (!paths.length) {
      setKbError(t.noMarkdownPicked)
      return
    }
    if (kbImportPollRef.current) {
      window.clearTimeout(kbImportPollRef.current)
      kbImportPollRef.current = null
    }
    setKbBusy(true)
    setKbError('')
    setKbImportProgress(2)
    setKbImportMessage(t.importing)
    try {
      const res = await fetchBackendJson<{ ok: boolean; taskId?: string }>('/kb/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceDir,
          paths,
          chunkSize: Number((settings as any).kbChunkSize || 1200),
          chunkOverlap: Number((settings as any).kbChunkOverlap || 200)
        })
      })
      const taskId = String((res as any)?.taskId || '').trim()
      if (!taskId) throw new Error(t.failedImport)
      pollKbImportTask(taskId)
    } catch (e) {
      setKbBusy(false)
      setKbImportProgress(0)
      setKbImportMessage('')
      setKbError(e instanceof Error ? e.message : t.failedImport)
    }
  }, [workspaceDir, settings, t, pollKbImportTask])

  const deleteKbDoc = useCallback(async (id: string) => {
    const docId = String(id || '').trim()
    if (!workspaceDir || !docId) return
    setKbBusy(true)
    setKbError('')
    try {
      await fetchBackendJson('/kb/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceDir, ids: [docId] })
      })
      await loadKbDocuments()
    } catch (e) {
      setKbError(e instanceof Error ? e.message : t.failedDelete)
    } finally {
      setKbBusy(false)
    }
  }, [workspaceDir, loadKbDocuments, t.failedDelete])

  const runKbRetrievalTest = useCallback(async () => {
    const query = String(kbTestQuery || '').trim()
    if (!query) {
      setKbTestItems([])
      setKbTestError('')
      return
    }
    if (!workspaceDir) {
      setKbTestItems([])
      setKbTestError(t.workspaceRequiredToManage)
      return
    }
    setKbTestLoading(true)
    setKbTestError('')
    try {
      const res = await fetchBackendJson<{ ok: boolean; items?: Array<any> }>('/kb/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceDir,
          query,
          topK: Number((settings as any).kbMaxRetrieveCount || 6),
          threshold: Number((settings as any).kbSimilarityThreshold ?? 0.35),
          hybridEnabled: Boolean((settings as any).kbHybridEnabled ?? true),
          keywordTopK: Math.max(20, Number((settings as any).kbMaxRetrieveCount || 6) * 5),
          maxContentChars: 420
        })
      })
      const rows = Array.isArray(res.items) ? res.items : []
      setKbTestItems(
        rows
          .map((it) => ({
            id: String((it as any)?.id || '').trim(),
            fileName: String((it as any)?.fileName || '').trim(),
            documentPath: String((it as any)?.documentPath || '').trim(),
            headerPath: String((it as any)?.headerPath || '').trim(),
            content: String((it as any)?.content || '').trim(),
            score: Number((it as any)?.score || 0),
            similarity: Number((it as any)?.similarity || 0)
          }))
          .filter((it) => Boolean(it.id))
      )
    } catch (e) {
      setKbTestItems([])
      setKbTestError(e instanceof Error ? e.message : t.failedTest)
    } finally {
      setKbTestLoading(false)
    }
  }, [kbTestQuery, workspaceDir, settings, t.workspaceRequiredToManage, t.failedTest])

  const kbThresholdPercent = Math.round(Math.min(1, Math.max(0, Number((settings as any).kbSimilarityThreshold || 0))) * 100)

  return (
    <div className="p-6 space-y-6">
      <Card className="p-5 space-y-4">
        <div className="space-y-1">
          <div className="text-[13px] font-semibold">{t.feature}</div>
          <div className="text-xs text-muted-foreground">{t.featureDesc}</div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <Label>{t.enabled}</Label>
          <Switch checked={Boolean((settings as any).kbEnabled ?? true)} onCheckedChange={(c) => updateSettings({ kbEnabled: Boolean(c) } as any)} />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <Label>{t.autoQuery}</Label>
          <Switch checked={Boolean((settings as any).kbAutoQueryEnabled ?? true)} onCheckedChange={(c) => updateSettings({ kbAutoQueryEnabled: Boolean(c) } as any)} />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <Label>{t.hybrid}</Label>
          <Switch checked={Boolean((settings as any).kbHybridEnabled ?? true)} onCheckedChange={(c) => updateSettings({ kbHybridEnabled: Boolean(c) } as any)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{t.maxRetrieve}</Label>
            <Input type="number" min={1} max={20} value={Number((settings as any).kbMaxRetrieveCount || 6)} onChange={(e) => updateSettings({ kbMaxRetrieveCount: Math.max(1, Math.min(20, Number(e.target.value || 6))) } as any)} />
          </div>
          <div className="space-y-1">
            <Label>{t.similarity} {kbThresholdPercent}%</Label>
            <Input type="number" min={0} max={100} value={kbThresholdPercent} onChange={(e) => updateSettings({ kbSimilarityThreshold: Math.min(1, Math.max(0, Number(e.target.value || 0) / 100)) } as any)} />
          </div>
          <div className="space-y-1">
            <Label>{t.chunkSize}</Label>
            <Input type="number" min={200} max={4000} value={Number((settings as any).kbChunkSize || 1200)} onChange={(e) => updateSettings({ kbChunkSize: Math.max(200, Math.min(4000, Number(e.target.value || 1200))) } as any)} />
          </div>
          <div className="space-y-1">
            <Label>{t.chunkOverlap}</Label>
            <Input type="number" min={0} max={1000} value={Number((settings as any).kbChunkOverlap || 200)} onChange={(e) => updateSettings({ kbChunkOverlap: Math.max(0, Math.min(1000, Number(e.target.value || 200))) } as any)} />
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-[13px] font-semibold">{t.testTitle}</div>
        <div className="flex items-center gap-2">
          <Input value={kbTestQuery} onChange={(e) => setKbTestQuery(e.target.value)} placeholder={t.testPlaceholder} />
          <Button size="sm" className="gap-2" onClick={() => void runKbRetrievalTest()} disabled={kbTestLoading || kbBusy}>
            <Play className="w-4 h-4" />
            {t.testAction}
          </Button>
        </div>
        {kbTestError ? <div className="text-[12px] text-destructive">{kbTestError}</div> : null}
        <div className="space-y-2">
          {kbTestLoading ? (
            <div className="text-[13px] text-muted-foreground">{t.loading}</div>
          ) : kbTestItems.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">{t.testEmpty}</div>
          ) : (
            kbTestItems.map((it) => (
              <div key={it.id} className="rounded-md border border-border bg-background px-3 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-medium truncate">{it.fileName || it.documentPath}</div>
                  <div className="text-[11px] text-muted-foreground shrink-0">
                    {t.testScoreLabel} {(it.score || 0).toFixed(3)} / {t.testSimilarityLabel} {(it.similarity || 0).toFixed(3)}
                  </div>
                </div>
                {it.headerPath ? <div className="text-[11px] text-muted-foreground truncate">{it.headerPath}</div> : null}
                <div className="text-[12px] whitespace-pre-wrap break-words">{it.content}</div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid grid-cols-2 gap-3 flex-1">
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <div className="text-xs text-muted-foreground">{t.docCount}</div>
              <div className="text-xl font-semibold">{kbStats.documents}</div>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <div className="text-xs text-muted-foreground">{t.chunkCount}</div>
              <div className="text-xl font-semibold">{kbStats.chunks}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadKbDocuments()} disabled={kbLoading || kbBusy}>
              <RefreshCw className="w-4 h-4" />
              {t.refresh}
            </Button>
            <Button size="sm" className="gap-2" onClick={() => void importKbMarkdown()} disabled={kbBusy}>
              <FolderOpen className="w-4 h-4" />
              {t.import}
            </Button>
          </div>
        </div>

        {kbError ? <div className="text-[12px] text-destructive">{kbError}</div> : null}
        {kbImportProgress > 0 ? (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, kbImportProgress))}%` }} />
            </div>
            <div className="text-[12px] text-muted-foreground">{kbImportMessage || t.loading}</div>
          </div>
        ) : null}
        {!kbBusy && kbImportMessage ? <div className="text-[12px] text-muted-foreground">{kbImportMessage}</div> : null}
        {!workspaceDir ? <div className="text-[13px] text-muted-foreground">{t.workspaceRequiredToManage}</div> : null}

        <div className="space-y-2">
          {kbLoading ? (
            <div className="text-[13px] text-muted-foreground">{t.loading}</div>
          ) : kbDocs.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">{t.empty}</div>
          ) : (
            kbDocs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] truncate">{doc.fileName || doc.path}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{doc.path}</div>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0.5">
                  {doc.chunkCount}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void deleteKbDoc(doc.id)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  disabled={kbBusy}
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

function MemorySettings() {
  const { settings: settings0, updateSettings, providers: providers0, ui } = useStore()
  const settings = settings0!
  const providers = providers0 ?? EMPTY_PROVIDERS
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [memoryItems, setMemoryItems] = useState<Array<{ id: string; content: string; isEnabled: boolean; status: string; scope: 'workspace' | 'global' }>>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryError, setMemoryError] = useState('')
  const [memoryTestQuery, setMemoryTestQuery] = useState('')
  const [memoryTestLoading, setMemoryTestLoading] = useState(false)
  const [memoryTestError, setMemoryTestError] = useState('')
  const [memoryTestItems, setMemoryTestItems] = useState<
    Array<{ id: string; scope: 'workspace' | 'global'; type: string; content: string; score: number; similarity: number }>
  >([])
  const [editingContentById, setEditingContentById] = useState<Record<string, string>>({})
  const [addScope, setAddScope] = useState<'workspace' | 'global' | 'auto'>('workspace')
  const [listScopeFilter, setListScopeFilter] = useState<'all' | 'workspace' | 'global'>('all')
  const [embeddingCatalog, setEmbeddingCatalog] = useState<Array<{ id: string; name: string; sizeBytes?: number | null }>>([])
  const [embeddingInstalledIds, setEmbeddingInstalledIds] = useState<string[]>([])
  const [embeddingDownloadByModelId, setEmbeddingDownloadByModelId] = useState<
    Record<
      string,
      {
        taskId: string
        status: 'starting' | 'running' | 'canceling' | 'done' | 'error' | 'canceled'
        error?: string
        downloadedBytes?: number
        totalBytes?: number
      }
    >
  >({})
  const embeddingPollTimersRef = useRef<Record<string, number>>({})

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
        embeddingSource: 'Embedding source',
        embeddingProvider: 'Provider model',
        embeddingLocal: 'Local model',
        embeddingDownload: 'Download',
        embeddingCancel: 'Cancel',
        embeddingInstalled: 'Installed',
        embeddingDownloading: 'Downloading',
        embeddingDownloadError: 'Download failed',
        globalMemory: 'Global memory',
        enableGlobalMemory: 'Enable global memory',
        enableGlobalWrite: 'Allow global writes',
        globalTopK: 'Global retrieve count',
        writePolicy: 'Write policy',
        autoScope: 'Auto scope decision',
        defaultScope: 'Default write scope',
        addScope: 'Add scope',
        scopeAuto: 'Auto',
        scopeWorkspace: 'Workspace',
        scopeGlobal: 'Global',
        scopeAll: 'All',
        listScopeFilter: 'Scope filter',
        stats: 'Stats',
        total: 'Total',
        enabled: 'Enabled',
        disabled: 'Disabled',
        addMemory: 'Add memory',
        add: 'Add',
        addPlaceholder: 'Add a memory item…',
        searchMemory: 'Search memory',
        searchPlaceholder: 'Search memories…',
        testTitle: 'Retrieval test',
        testPlaceholder: 'Input a query to test retrieval...',
        testAction: 'Run retrieval',
        testEmpty: 'No retrieval result.',
        memoryList: 'Memory list',
        clearAll: 'Clear all',
        empty: 'No memories yet.',
        scopeAutoNoWorkspace: 'No workspace and global memory is disabled. Cannot auto decide memory scope.',
        workspaceRequired: 'No workspace selected. Cannot manage workspace memories.',
        workspaceRequiredToManage: 'Please select a workspace before managing memories.',
        loading: 'Loading…',
        failedLoad: 'Failed to load memories',
        failedAdd: 'Failed to add memory',
        failedUpdate: 'Failed to update memory',
        failedDelete: 'Failed to delete memory',
        failedClear: 'Failed to clear memories',
        failedTest: 'Failed to run retrieval test',
        testScoreLabel: 'Score',
        testSimilarityLabel: 'Similarity'
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
        embeddingSource: '嵌入来源',
        embeddingProvider: '服务商模型',
        embeddingLocal: '本地模型',
        embeddingDownload: '下载',
        embeddingCancel: '取消',
        embeddingInstalled: '已安装',
        embeddingDownloading: '下载中',
        embeddingDownloadError: '下载失败',
        globalMemory: '全局记忆',
        enableGlobalMemory: '启用全局记忆',
        enableGlobalWrite: '允许写入全局记忆',
        globalTopK: '全局检索数量',
        writePolicy: '写入策略',
        autoScope: '自动判定写入范围',
        defaultScope: '默认写入范围',
        addScope: '写入范围',
        scopeAuto: '自动',
        scopeWorkspace: '工作区',
        scopeGlobal: '全局',
        scopeAll: '全部',
        listScopeFilter: '范围筛选',
        stats: '统计',
        total: '记忆数量',
        enabled: '启用数量',
        disabled: '停用数量',
        addMemory: '添加记忆',
        add: '添加',
        addPlaceholder: '写下你想长期记住的内容…',
        searchMemory: '搜索记忆',
        searchPlaceholder: '输入关键词搜索…',
        testTitle: '检索测试',
        testPlaceholder: '输入问题后测试检索结果...',
        testAction: '测试检索',
        testEmpty: '没有检索结果。',
        memoryList: '记忆列表',
        clearAll: '全部清空',
        empty: '暂无记忆内容。',
        scopeAutoNoWorkspace: '未选择工作区且未启用全局记忆，无法自动判定写入范围。',
        workspaceRequired: '未选择工作区，无法管理工作区记忆。',
        workspaceRequiredToManage: '请先选择工作区后再管理记忆。',
        loading: '加载中…',
        failedLoad: '加载记忆失败',
        failedAdd: '添加记忆失败',
        failedUpdate: '更新记忆失败',
        failedDelete: '删除记忆失败',
        failedClear: '清空记忆失败',
        failedTest: '检索测试失败',
        testScoreLabel: '综合分',
        testSimilarityLabel: '相似度'
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
        embeddingSource: '埋め込みソース',
        embeddingProvider: 'プロバイダーモデル',
        embeddingLocal: 'ローカルモデル',
        embeddingDownload: 'ダウンロード',
        embeddingCancel: 'キャンセル',
        embeddingInstalled: 'インストール済み',
        embeddingDownloading: 'ダウンロード中',
        embeddingDownloadError: 'ダウンロード失敗',
        globalMemory: 'グローバルメモリー',
        enableGlobalMemory: 'グローバルメモリーを有効化',
        enableGlobalWrite: 'グローバル書き込みを許可',
        globalTopK: 'グローバル取得数',
        writePolicy: '書き込みポリシー',
        autoScope: '自動スコープ判定',
        defaultScope: 'デフォルト書き込みスコープ',
        addScope: '追加スコープ',
        scopeAuto: '自動',
        scopeWorkspace: 'ワークスペース',
        scopeGlobal: 'グローバル',
        scopeAll: 'すべて',
        listScopeFilter: 'スコープ絞り込み',
        stats: '統計',
        total: '合計',
        enabled: '有効',
        disabled: '無効',
        addMemory: '追加',
        add: '追加',
        addPlaceholder: 'メモリーを追加…',
        searchMemory: '検索',
        searchPlaceholder: 'キーワードで検索…',
        testTitle: '検索テスト',
        testPlaceholder: 'クエリを入力して検索結果を確認...',
        testAction: '検索をテスト',
        testEmpty: '検索結果がありません。',
        memoryList: '一覧',
        clearAll: '全て削除',
        empty: 'メモリーはまだありません。',
        scopeAutoNoWorkspace: 'ワークスペース未選択かつグローバルメモリーが無効のため、自動スコープ判定できません。',
        workspaceRequired: 'ワークスペース未選択のため、ワークスペースメモリーを管理できません。',
        workspaceRequiredToManage: 'メモリー管理の前にワークスペースを選択してください。',
        loading: '読み込み中…',
        failedLoad: 'メモリーの読み込みに失敗しました',
        failedAdd: 'メモリーの追加に失敗しました',
        failedUpdate: 'メモリーの更新に失敗しました',
        failedDelete: 'メモリーの削除に失敗しました',
        failedClear: 'メモリーの全削除に失敗しました',
        failedTest: '検索テストに失敗しました',
        testScoreLabel: 'スコア',
        testSimilarityLabel: '類似度'
      }
    } as const
    return dict[settings.language as keyof typeof dict] || dict.en
  })()

  // 与主会话保持一致：优先使用当前激活项目目录，再回退到全局 workspaceDir
  const workspaceDir = useMemo(() => {
    const projects = Array.isArray((settings as any)?.projects) ? (settings as any).projects : []
    const pid = String((ui as any)?.activeProjectId || '').trim()
    const p = pid ? projects.find((x: any) => String(x?.id || '').trim() === pid) : null
    const dir = String((p as any)?.dir || '').trim()
    if (dir) return dir
    return String((settings as any)?.workspaceDir || '').trim()
  }, [settings, ui])
  const memoryGlobalEnabled = Boolean((settings as any).memoryGlobalEnabled)

  const stats = useMemo(() => {
    const total = memoryItems.length
    const enabled = memoryItems.filter((m) => m.isEnabled).length
    return { total, enabled, disabled: total - enabled }
  }, [memoryItems])

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

  const selectedEmbeddingModelId = String(settings.memoryEmbeddingModelId || '').trim()
  const embeddingSource: 'provider' | 'local' = selectedEmbeddingModelId.startsWith('local:') ? 'local' : 'provider'
  const localModelOptions = useMemo(
    () =>
      embeddingCatalog.map((m) => ({
        id: `local:${m.id}`,
        baseId: m.id,
        name: m.name || m.id,
        sizeBytes: typeof m.sizeBytes === 'number' ? m.sizeBytes : null,
        installed: embeddingInstalledIds.includes(`local:${m.id}`)
      })),
    [embeddingCatalog, embeddingInstalledIds]
  )

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
    ;(async () => {
      try {
        const [catalogRes, installedRes] = await Promise.all([
          fetchBackendJson<{ ok: boolean; models?: Array<{ id: string; name?: string; sizeBytes?: number | null }> }>('/memory/embedding/models/catalog', {
            method: 'GET'
          }),
          fetchBackendJson<{ ok: boolean; models?: Array<{ id: string }> }>('/memory/embedding/models/installed', { method: 'GET' })
        ])
        if (cancelled) return
        const models = Array.isArray(catalogRes.models) ? catalogRes.models : []
        setEmbeddingCatalog(
          models
            .map((m) => ({
              id: String(m?.id || '').trim(),
              name: String(m?.name || m?.id || '').trim(),
              sizeBytes: typeof m?.sizeBytes === 'number' ? m.sizeBytes : null
            }))
            .filter((m) => Boolean(m.id))
        )
        const installed = Array.isArray(installedRes.models) ? installedRes.models : []
        setEmbeddingInstalledIds(
          installed
            .map((m) => String((m as any)?.id || '').trim())
            .filter(Boolean)
        )
      } catch {
        if (cancelled) return
        setEmbeddingCatalog([])
        setEmbeddingInstalledIds([])
      }
    })()
    return () => {
      cancelled = true
      const timers = embeddingPollTimersRef.current
      for (const k of Object.keys(timers)) {
        window.clearTimeout(timers[k])
      }
      embeddingPollTimersRef.current = {}
    }
  }, [])

  const pollEmbeddingTask = useCallback((localModelId: string, taskId: string) => {
    const tick = async () => {
      try {
        const st = await fetchBackendJson<{ ok: boolean; task?: any }>(`/memory/embedding/models/download/status?taskId=${encodeURIComponent(taskId)}`, { method: 'GET' })
        const task = (st as any)?.task || {}
        const statusRaw = String(task.status || '').trim()
        const nextStatus: 'starting' | 'running' | 'canceling' | 'done' | 'error' | 'canceled' =
          statusRaw === 'done'
            ? 'done'
            : statusRaw === 'error'
              ? 'error'
              : statusRaw === 'canceled'
                ? 'canceled'
                : Boolean(task.cancelRequested)
                  ? 'canceling'
                  : 'running'
        setEmbeddingDownloadByModelId((prev) => ({
          ...prev,
          [localModelId]: {
            taskId,
            status: nextStatus,
            error: statusRaw === 'error' ? String(task.error || 'download failed') : undefined,
            downloadedBytes: typeof task.downloadedBytes === 'number' ? task.downloadedBytes : undefined,
            totalBytes: typeof task.totalBytes === 'number' ? task.totalBytes : undefined
          }
        }))
        if (nextStatus === 'done') {
          const installedRes = await fetchBackendJson<{ ok: boolean; models?: Array<{ id: string }> }>('/memory/embedding/models/installed', { method: 'GET' })
          const installed = Array.isArray(installedRes.models) ? installedRes.models : []
          setEmbeddingInstalledIds(installed.map((m) => String((m as any)?.id || '').trim()).filter(Boolean))
          window.clearTimeout(embeddingPollTimersRef.current[localModelId])
          delete embeddingPollTimersRef.current[localModelId]
          return
        }
        if (nextStatus === 'error' || nextStatus === 'canceled') {
          window.clearTimeout(embeddingPollTimersRef.current[localModelId])
          delete embeddingPollTimersRef.current[localModelId]
          return
        }
      } catch (e) {
        setEmbeddingDownloadByModelId((prev) => ({
          ...prev,
          [localModelId]: { taskId, status: 'error', error: e instanceof Error ? e.message : 'download failed' }
        }))
        window.clearTimeout(embeddingPollTimersRef.current[localModelId])
        delete embeddingPollTimersRef.current[localModelId]
        return
      }
      embeddingPollTimersRef.current[localModelId] = window.setTimeout(() => void tick(), 1200)
    }
    embeddingPollTimersRef.current[localModelId] = window.setTimeout(() => void tick(), 500)
  }, [])

  const startEmbeddingDownload = useCallback(
    async (localModelId: string) => {
      const localId = String(localModelId || '').trim()
      if (!localId.startsWith('local:')) return
      const existing = embeddingDownloadByModelId[localId]
      if (existing && (existing.status === 'starting' || existing.status === 'running' || existing.status === 'canceling')) return
      setEmbeddingDownloadByModelId((prev) => ({ ...prev, [localId]: { taskId: '', status: 'starting' } }))
      const modelId = localId.slice('local:'.length)
      try {
        const res = await fetchBackendJson<{ ok: boolean; taskId?: string }>('/memory/embedding/models/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: modelId })
        })
        const taskId = String((res as any)?.taskId || '').trim()
        if (!taskId) throw new Error('No task id')
        setEmbeddingDownloadByModelId((prev) => ({ ...prev, [localId]: { taskId, status: 'running' } }))
        pollEmbeddingTask(localId, taskId)
      } catch (e) {
        setEmbeddingDownloadByModelId((prev) => ({
          ...prev,
          [localId]: { taskId: '', status: 'error', error: e instanceof Error ? e.message : 'download failed' }
        }))
      }
    },
    [embeddingDownloadByModelId, pollEmbeddingTask]
  )

  const cancelEmbeddingDownload = useCallback(async (localModelId: string) => {
    const localId = String(localModelId || '').trim()
    const taskId = String(embeddingDownloadByModelId[localId]?.taskId || '').trim()
    if (!taskId) return
    setEmbeddingDownloadByModelId((prev) => ({ ...prev, [localId]: { ...(prev[localId] || { taskId }), taskId, status: 'canceling' } }))
    try {
      await fetchBackendJson('/memory/embedding/models/download/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      })
    } catch (e) {
      setEmbeddingDownloadByModelId((prev) => ({
        ...prev,
        [localId]: { ...(prev[localId] || { taskId }), taskId, status: 'error', error: e instanceof Error ? e.message : 'cancel failed' }
      }))
    }
  }, [embeddingDownloadByModelId])

  useEffect(() => {
    if (embeddingSource !== 'local') return
    if (!selectedEmbeddingModelId) return
    if (embeddingInstalledIds.includes(selectedEmbeddingModelId)) return
    const st = embeddingDownloadByModelId[selectedEmbeddingModelId]
    if (st && (st.status === 'starting' || st.status === 'running' || st.status === 'canceling')) return
    void startEmbeddingDownload(selectedEmbeddingModelId)
  }, [embeddingSource, selectedEmbeddingModelId, embeddingInstalledIds, embeddingDownloadByModelId, startEmbeddingDownload])

  const ensureScopeAllowed = useCallback((scope: 'workspace' | 'global' | 'auto') => {
    if (scope === 'auto') {
      if (workspaceDir || memoryGlobalEnabled) return true
      setMemoryError(t.scopeAutoNoWorkspace)
      return false
    }
    if (scope === 'global') return true
    if (workspaceDir) return true
    setMemoryError(t.workspaceRequired)
    return false
  }, [workspaceDir, memoryGlobalEnabled, t.scopeAutoNoWorkspace, t.workspaceRequired])

  const loadMemoryItems = useCallback(async () => {
    if (!workspaceDir && !memoryGlobalEnabled) {
      setMemoryItems([])
      setEditingContentById({})
      return
    }
    setMemoryLoading(true)
    setMemoryError('')
    try {
      const q = new URLSearchParams()
      if (workspaceDir) q.set('workspaceDir', workspaceDir)
      q.set('includeInactive', '1')
      q.set('limit', '500')
      if (memoryGlobalEnabled) q.set('includeGlobal', '1')
      const res = await fetchBackendJson<{ ok: boolean; items?: Array<any> }>(`/memory/items?${q.toString()}`, { method: 'GET' })
      const next = (Array.isArray(res.items) ? res.items : [])
        .map((it) => {
          const status = String((it as any)?.status || 'active').toLowerCase()
          const scopeRaw = String((it as any)?.scope || 'workspace').toLowerCase()
          const scope: 'workspace' | 'global' = scopeRaw === 'global' ? 'global' : 'workspace'
          return {
            id: String((it as any)?.id || '').trim(),
            content: String((it as any)?.content || ''),
            status,
            isEnabled: status === 'active',
            scope
          }
        })
        .filter((it) => Boolean(it.id))
      setMemoryItems(next)
      setEditingContentById({})
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : t.failedLoad)
    } finally {
      setMemoryLoading(false)
    }
  }, [workspaceDir, memoryGlobalEnabled, t.failedLoad])

  useEffect(() => {
    void loadMemoryItems()
  }, [loadMemoryItems])

  useEffect(() => {
    if (addScope === 'workspace' && !workspaceDir && memoryGlobalEnabled) {
      setAddScope('global')
    }
    if (addScope === 'global' && !memoryGlobalEnabled) {
      setAddScope(workspaceDir ? 'workspace' : 'auto')
    }
    if (!Boolean((settings as any).memoryScopeAutoEnabled) && addScope === 'auto') {
      setAddScope(workspaceDir ? 'workspace' : memoryGlobalEnabled ? 'global' : 'workspace')
    }
  }, [addScope, workspaceDir, memoryGlobalEnabled, settings])

  const filteredMemories = useMemo(() => {
    const q = query.trim().toLowerCase()
    const scoped = listScopeFilter === 'all' ? memoryItems : memoryItems.filter((m) => m.scope === listScopeFilter)
    if (!q) return scoped
    return scoped.filter((m) => m.content.toLowerCase().includes(q))
  }, [query, memoryItems, listScopeFilter])

  const addMemoryItem = useCallback(async () => {
    const content = draft.trim()
    if (!content) return
    const scope = addScope
    if (!ensureScopeAllowed(scope)) return
    setMemoryError('')
    try {
      await fetchBackendJson('/memory/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceDir, content, source: 'settings', scope })
      })
      setDraft('')
      await loadMemoryItems()
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : t.failedAdd)
    }
  }, [draft, addScope, ensureScopeAllowed, workspaceDir, loadMemoryItems, t.failedAdd])

  const patchMemoryItem = useCallback(async (id: string, scope: 'workspace' | 'global', patch: Record<string, any>) => {
    if (!id) return
    if (!ensureScopeAllowed(scope)) return
    setMemoryError('')
    try {
      await fetchBackendJson('/memory/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceDir, id, patch, scope })
      })
      await loadMemoryItems()
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : t.failedUpdate)
    }
  }, [ensureScopeAllowed, workspaceDir, loadMemoryItems, t.failedUpdate])

  const deleteMemoryItem = useCallback(async (id: string, scope: 'workspace' | 'global') => {
    if (!id) return
    if (!ensureScopeAllowed(scope)) return
    setMemoryError('')
    try {
      await fetchBackendJson('/memory/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceDir, id, scope })
      })
      await loadMemoryItems()
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : t.failedDelete)
    }
  }, [ensureScopeAllowed, workspaceDir, loadMemoryItems, t.failedDelete])

  const clearAllMemories = useCallback(async () => {
    const rows = filteredMemories.filter((m) => ensureScopeAllowed(m.scope))
    const ids = rows.map((m) => ({ id: m.id, scope: m.scope })).filter((x) => Boolean(x.id))
    if (!ids.length) return
    setMemoryError('')
    try {
      for (const row of ids) {
        await fetchBackendJson('/memory/items', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceDir, id: row.id, scope: row.scope })
        })
      }
      await loadMemoryItems()
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : t.failedClear)
    }
  }, [ensureScopeAllowed, filteredMemories, workspaceDir, loadMemoryItems, t.failedClear])

  const runMemoryRetrievalTest = useCallback(async () => {
    const query = String(memoryTestQuery || '').trim()
    if (!query) {
      setMemoryTestItems([])
      setMemoryTestError('')
      return
    }
    if (!workspaceDir && !memoryGlobalEnabled) {
      setMemoryTestItems([])
      setMemoryTestError(t.workspaceRequiredToManage)
      return
    }
    setMemoryTestLoading(true)
    setMemoryTestError('')
    try {
      const res = await fetchBackendJson<{ ok: boolean; items?: Array<any> }>('/memory/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceDir,
          query,
          topK: Number(settings.memoryMaxRetrieveCount || 8),
          threshold: Number(settings.memorySimilarityThreshold ?? 0.25),
          includeGlobal: memoryGlobalEnabled,
          globalTopK: Number((settings as any).memoryGlobalRetrieveCount || 3),
          maxContentChars: 420
        })
      })
      const rows = Array.isArray(res.items) ? res.items : []
      setMemoryTestItems(
        rows
          .map((it) => ({
            id: String((it as any)?.id || '').trim(),
            scope: (String((it as any)?.scope || 'workspace').trim() === 'global' ? 'global' : 'workspace') as 'workspace' | 'global',
            type: String((it as any)?.type || '').trim(),
            content: String((it as any)?.content || '').trim(),
            score: Number((it as any)?.score || 0),
            similarity: Number((it as any)?.similarity || 0)
          }))
          .filter((it) => Boolean(it.id))
      )
    } catch (e) {
      setMemoryTestItems([])
      setMemoryTestError(e instanceof Error ? e.message : t.failedTest)
    } finally {
      setMemoryTestLoading(false)
    }
  }, [memoryTestQuery, workspaceDir, memoryGlobalEnabled, settings, t.workspaceRequiredToManage, t.failedTest])

  const thresholdPercent = Math.round(Math.min(1, Math.max(0, settings.memorySimilarityThreshold || 0)) * 100)

  return (
    <div className="p-6 space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <div className="text-[13px] font-semibold">{t.feature}</div>
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
            <div className="text-[13px] font-semibold">{t.retrieval}</div>
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

        <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
          <div className="text-[13px] font-semibold">{t.globalMemory}</div>
          <div className="flex items-center justify-between">
            <Label>{t.enableGlobalMemory}</Label>
            <Switch
              checked={Boolean((settings as any).memoryGlobalEnabled)}
              onCheckedChange={(c) => updateSettings({ memoryGlobalEnabled: Boolean(c) } as any)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>{t.enableGlobalWrite}</Label>
            <Switch
              checked={Boolean((settings as any).memoryGlobalWriteEnabled)}
              onCheckedChange={(c) => updateSettings({ memoryGlobalWriteEnabled: Boolean(c) } as any)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t.globalTopK}</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={Number((settings as any).memoryGlobalRetrieveCount || 3)}
              onChange={(e) => updateSettings({ memoryGlobalRetrieveCount: Math.max(1, Math.min(20, Number(e.target.value || 3))) } as any)}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3">
          <div className="text-[13px] font-semibold">{t.writePolicy}</div>
          <div className="flex items-center justify-between">
            <Label>{t.autoScope}</Label>
            <Switch
              checked={Boolean((settings as any).memoryScopeAutoEnabled)}
              onCheckedChange={(c) => updateSettings({ memoryScopeAutoEnabled: Boolean(c) } as any)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t.defaultScope}</Label>
            <Select
              value={String((settings as any).memoryDefaultWriteScope || 'workspace') === 'global' ? 'global' : 'workspace'}
              onValueChange={(val) => updateSettings({ memoryDefaultWriteScope: val === 'global' ? 'global' : 'workspace' } as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">{t.scopeWorkspace}</SelectItem>
                <SelectItem value="global">{t.scopeGlobal}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="text-[13px] font-semibold">{t.summary}</div>
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">{t.enableSummary}</span>
          </div>
          <Switch
            checked={settings.memoryAutoSummarizeEnabled}
            onCheckedChange={(c) => updateSettings({ memoryAutoSummarizeEnabled: c })}
          />
        </div>
      </Card>

      <Card className="p-5 space-y-2">
        <div className="text-[13px] font-semibold">{t.toolModel}</div>
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
        <div className="text-[13px] font-semibold">{t.embedding}</div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t.embeddingSource}</Label>
              <Select
                value={embeddingSource}
                onValueChange={(val) => {
                  const next = val === 'local' ? 'local' : 'provider'
                  if (next === 'local') {
                    const firstLocal = localModelOptions[0]?.id || ''
                    updateSettings({ memoryEmbeddingModelId: firstLocal })
                    if (firstLocal && !embeddingInstalledIds.includes(firstLocal)) {
                      void startEmbeddingDownload(firstLocal)
                    }
                  } else {
                    const firstProvider = availableModels[0] || ''
                    updateSettings({ memoryEmbeddingModelId: firstProvider })
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="provider">{t.embeddingProvider}</SelectItem>
                  <SelectItem value="local">{t.embeddingLocal}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>{embeddingSource === 'local' ? t.embeddingLocal : t.embeddingProvider}</Label>
              {embeddingSource === 'local' ? (
                <Select
                  value={selectedEmbeddingModelId}
                  onValueChange={(val) => {
                    updateSettings({ memoryEmbeddingModelId: val })
                    if (val && !embeddingInstalledIds.includes(val)) {
                      void startEmbeddingDownload(val)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.embeddingLocal} />
                  </SelectTrigger>
                  <SelectContent>
                    {localModelOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={selectedEmbeddingModelId}
                  onValueChange={(val) => updateSettings({ memoryEmbeddingModelId: val })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.embeddingProvider} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {embeddingSource === 'local' && selectedEmbeddingModelId ? (
            <div className="rounded-md border border-border bg-background px-3 py-2 text-xs space-y-1">
              {embeddingInstalledIds.includes(selectedEmbeddingModelId) ? (
                <div className="text-emerald-600 dark:text-emerald-400">{t.embeddingInstalled}</div>
              ) : (
                <>
                  <div className="text-muted-foreground">
                    {t.embeddingDownloading}
                    {(() => {
                      const st = embeddingDownloadByModelId[selectedEmbeddingModelId]
                      if (!st) return ''
                      if (typeof st.downloadedBytes === 'number' || typeof st.totalBytes === 'number') {
                        return ` ${formatBytes(st.downloadedBytes)} / ${formatBytes(st.totalBytes)}`
                      }
                      return ''
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const st = embeddingDownloadByModelId[selectedEmbeddingModelId]
                      const status = st?.status || 'idle'
                      if (status === 'running' || status === 'starting' || status === 'canceling') {
                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void cancelEmbeddingDownload(selectedEmbeddingModelId)}
                          >
                            {t.embeddingCancel}
                          </Button>
                        )
                      }
                      return (
                        <Button size="sm" variant="outline" onClick={() => void startEmbeddingDownload(selectedEmbeddingModelId)}>
                          {t.embeddingDownload}
                        </Button>
                      )
                    })()}
                    {(() => {
                      const st = embeddingDownloadByModelId[selectedEmbeddingModelId]
                      if (st?.status === 'error' && st.error) {
                        return <span className="text-destructive">{t.embeddingDownloadError}: {st.error}</span>
                      }
                      return null
                    })()}
                  </div>
                </>
              )}
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">{t.embeddingHint}</div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-[13px] font-semibold">{t.stats}</div>
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
        <div className="text-[13px] font-semibold">{t.addMemory}</div>
        <div className="space-y-1 max-w-[220px]">
          <Label>{t.addScope}</Label>
          <Select
            value={addScope}
            onValueChange={(val) => setAddScope(val === 'global' ? 'global' : val === 'workspace' ? 'workspace' : 'auto')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" disabled={!Boolean((settings as any).memoryScopeAutoEnabled)}>
                {t.scopeAuto}
              </SelectItem>
              <SelectItem value="workspace" disabled={!workspaceDir}>
                {t.scopeWorkspace}
              </SelectItem>
              <SelectItem value="global" disabled={!memoryGlobalEnabled}>
                {t.scopeGlobal}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Textarea
          className="min-h-[100px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.addPlaceholder}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void addMemoryItem()}
            disabled={memoryLoading}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            {t.add}
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-[13px] font-semibold">{t.searchMemory}</div>
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
        <div className="text-[13px] font-semibold">{t.testTitle}</div>
        <div className="flex items-center gap-2">
          <Input value={memoryTestQuery} onChange={(e) => setMemoryTestQuery(e.target.value)} placeholder={t.testPlaceholder} />
          <Button size="sm" className="gap-2" onClick={() => void runMemoryRetrievalTest()} disabled={memoryTestLoading}>
            <Play className="w-4 h-4" />
            {t.testAction}
          </Button>
        </div>
        {memoryTestError ? <div className="text-[12px] text-destructive">{memoryTestError}</div> : null}
        <div className="space-y-2">
          {memoryTestLoading ? (
            <div className="text-[13px] text-muted-foreground">{t.loading}</div>
          ) : memoryTestItems.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">{t.testEmpty}</div>
          ) : (
            memoryTestItems.map((it) => (
              <div key={it.id} className="rounded-md border border-border bg-background px-3 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0.5">
                      {it.scope === 'global' ? t.scopeGlobal : t.scopeWorkspace}
                    </Badge>
                    <span className="text-[12px] text-muted-foreground truncate">{it.type}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground shrink-0">
                    {t.testScoreLabel} {(it.score || 0).toFixed(3)} / {t.testSimilarityLabel} {(it.similarity || 0).toFixed(3)}
                  </div>
                </div>
                <div className="text-[12px] whitespace-pre-wrap break-words">{it.content}</div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold">{t.memoryList}</div>
          <div className="flex items-center gap-2">
            <div className="w-[150px]">
              <Select
                value={listScopeFilter}
                onValueChange={(val) => setListScopeFilter(val === 'workspace' ? 'workspace' : val === 'global' ? 'global' : 'all')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.listScopeFilter} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.scopeAll}</SelectItem>
                  <SelectItem value="workspace">{t.scopeWorkspace}</SelectItem>
                  <SelectItem value="global">{t.scopeGlobal}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => void clearAllMemories()}
              disabled={memoryLoading || filteredMemories.length === 0}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
              {t.clearAll}
            </Button>
          </div>
        </div>
        {memoryError ? <div className="text-[12px] text-destructive">{memoryError}</div> : null}
        {!workspaceDir && !memoryGlobalEnabled ? (
          <div className="text-[13px] text-muted-foreground">
            {t.workspaceRequiredToManage}
          </div>
        ) : null}

        <div className="space-y-2">
          {memoryLoading ? (
            <div className="text-[13px] text-muted-foreground">{t.loading}</div>
          ) : filteredMemories.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">{t.empty}</div>
          ) : (
            filteredMemories.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0.5">
                  {m.scope === 'global' ? t.scopeGlobal : t.scopeWorkspace}
                </Badge>
                <Checkbox
                  checked={m.isEnabled}
                  onCheckedChange={(c) => void patchMemoryItem(m.id, m.scope, { status: c ? 'active' : 'inactive' })}
                />
                <Input
                  className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 px-0 h-auto py-0"
                  value={Object.prototype.hasOwnProperty.call(editingContentById, m.id) ? editingContentById[m.id] : m.content}
                  onChange={(e) => {
                    const v = e.target.value
                    setEditingContentById((prev) => ({ ...prev, [m.id]: v }))
                  }}
                  onBlur={() => {
                    const next = Object.prototype.hasOwnProperty.call(editingContentById, m.id) ? editingContentById[m.id] : m.content
                    const trimmed = String(next || '').trim()
                    setEditingContentById((prev) => {
                      const cp = { ...prev }
                      delete cp[m.id]
                      return cp
                    })
                    if (!trimmed || trimmed === m.content) return
                    void patchMemoryItem(m.id, m.scope, { content: trimmed })
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void deleteMemoryItem(m.id, m.scope)}
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
    <div className="p-6 space-y-6">
      <Card className="p-5 space-y-3">
        <h3 className="text-[13px] font-semibold">{t.dbPath}</h3>
        <p className="text-[13px] text-muted-foreground">{t.dbPathHint}</p>
        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground break-all">
          {dbPath || '-'}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="text-[13px] font-semibold">{t.export}</h3>
        <p className="text-[13px] text-muted-foreground">{t.exportHint}</p>
        <Button
          onClick={() => void downloadJson()}
          className="gap-2"
        >
          {t.exportJson}
        </Button>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="text-[13px] font-semibold">{t.import}</h3>
        <p className="text-[13px] text-muted-foreground">{t.importHint}</p>
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
            <div className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
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
        <h3 className="text-[13px] font-semibold text-destructive">{t.danger}</h3>
        <p className="text-[13px] text-muted-foreground">{t.dangerHint}</p>
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
