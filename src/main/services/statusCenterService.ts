import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import { join, extname } from 'path'
import { copyFileSync, existsSync, mkdirSync } from 'fs'

export type RunStateKind = 'idle' | 'running' | 'waiting_user' | 'done' | 'error'

type IconConfig = {
  sizes?: Record<string, string>
  frames?: string[]
}

type StatusCenterSettings = {
  tray?: {
    enabled?: boolean
    animated?: boolean
    frameIntervalMs?: number
    fallbackToBuiltin?: boolean
    icons?: Partial<Record<RunStateKind, IconConfig>>
  }
}

type NormalizedIconConfig = {
  sizes: Record<string, string>
  frames: string[]
}

type NormalizedSettings = {
  tray: {
    enabled: boolean
    animated: boolean
    frameIntervalMs: number
    fallbackToBuiltin: boolean
    icons: Record<RunStateKind, NormalizedIconConfig>
  }
}

type RunState = {
  state: RunStateKind
  title?: string
  progress?: number
  updatedAt: number
}

const DEFAULT_SETTINGS: NormalizedSettings = {
  tray: {
    enabled: true,
    animated: true,
    frameIntervalMs: 260,
    fallbackToBuiltin: true,
    icons: {
      idle: { sizes: {}, frames: [] },
      running: { sizes: {}, frames: [] },
      waiting_user: { sizes: {}, frames: [] },
      done: { sizes: {}, frames: [] },
      error: { sizes: {}, frames: [] }
    }
  }
}

const ALL_STATES: RunStateKind[] = ['idle', 'running', 'waiting_user', 'done', 'error']

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)))
}

function safeText(v: unknown): string {
  return String(v || '').trim()
}

function normalizeIconConfig(raw: any): NormalizedIconConfig {
  const sizes = raw?.sizes && typeof raw.sizes === 'object' ? raw.sizes : {}
  const frames = Array.isArray(raw?.frames) ? raw.frames : []
  const nextSizes: Record<string, string> = {}
  for (const k of ['16', '18', '22']) {
    const p = safeText(sizes[k])
    if (p) nextSizes[k] = p
  }
  return {
    sizes: nextSizes,
    frames: frames.map((x: any) => safeText(x)).filter(Boolean)
  }
}

function normalizeSettings(raw: any): NormalizedSettings {
  const trayRaw = raw?.tray && typeof raw.tray === 'object' ? raw.tray : {}
  const iconsRaw = trayRaw.icons && typeof trayRaw.icons === 'object' ? trayRaw.icons : {}
  const icons: Record<RunStateKind, NormalizedIconConfig> = {
    idle: normalizeIconConfig(iconsRaw.idle),
    running: normalizeIconConfig(iconsRaw.running),
    waiting_user: normalizeIconConfig(iconsRaw.waiting_user),
    done: normalizeIconConfig(iconsRaw.done),
    error: normalizeIconConfig(iconsRaw.error)
  }
  return {
    tray: {
      enabled: trayRaw.enabled !== false,
      animated: trayRaw.animated !== false,
      frameIntervalMs: clampInt(Number(trayRaw.frameIntervalMs || DEFAULT_SETTINGS.tray.frameIntervalMs), 120, 1200),
      fallbackToBuiltin: trayRaw.fallbackToBuiltin !== false,
      icons
    }
  }
}

function stateLabel(state: RunStateKind): string {
  if (state === 'running') return 'Running'
  if (state === 'waiting_user') return 'Waiting User'
  if (state === 'done') return 'Done'
  if (state === 'error') return 'Error'
  return 'Idle'
}

function builtinSvg(state: RunStateKind, phase: number): string {
  const stroke = '#111111'
  const base = '<rect x="0" y="0" width="22" height="22" fill="transparent"/>'
  if (state === 'running') {
    const h1 = phase % 3 === 0 ? 12 : phase % 3 === 1 ? 8 : 10
    const h2 = phase % 3 === 0 ? 8 : phase % 3 === 1 ? 12 : 10
    const h3 = phase % 3 === 0 ? 10 : phase % 3 === 1 ? 10 : 12
    return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${base}<rect x="4" y="${18 - h1}" width="3" height="${h1}" rx="1" fill="${stroke}"/><rect x="9.5" y="${18 - h2}" width="3" height="${h2}" rx="1" fill="${stroke}"/><rect x="15" y="${18 - h3}" width="3" height="${h3}" rx="1" fill="${stroke}"/></svg>`
  }
  if (state === 'waiting_user') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${base}<circle cx="11" cy="6" r="2.2" fill="${stroke}"/><rect x="9.7" y="9.5" width="2.6" height="8" rx="1.3" fill="${stroke}"/></svg>`
  }
  if (state === 'done') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${base}<path d="M5 11.5l3.2 3.2L17 6.8" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  }
  if (state === 'error') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${base}<path d="M6.5 6.5l9 9m0-9l-9 9" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round"/></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${base}<circle cx="11" cy="11" r="4.2" fill="${stroke}"/></svg>`
}

function imageFromSvg(svg: string, size: number) {
  const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = nativeImage.createFromDataURL(data)
  if (img.isEmpty()) return nativeImage.createEmpty()
  const resized = img.resize({ width: size, height: size })
  resized.setTemplateImage(true)
  return resized
}

function fallbackPng(size: number) {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'images', 'logo_padded.png')]
    : [join(process.cwd(), 'images', 'logo_padded.png')]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) continue
    return img.resize({ width: size, height: size })
  }
  return nativeImage.createEmpty()
}

export function createStatusCenterService(getMainWindow: () => BrowserWindow | null) {
  let tray: Tray | null = null
  let timer: NodeJS.Timeout | null = null
  let frameIndex = 0
  let settings: NormalizedSettings = DEFAULT_SETTINGS
  let runState: RunState = { state: 'idle', updatedAt: Date.now() }

  const clearAnimation = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const getTrayDir = () => {
    const root = join(app.getPath('userData'), 'status-center', 'tray-icons')
    mkdirSync(root, { recursive: true })
    return root
  }

  const resolveIconPath = (state: RunStateKind, sizeKey: '16' | '18' | '22') => {
    if (state === 'idle') return ''
    const path = safeText(settings.tray.icons[state]?.sizes?.[sizeKey])
    if (!path || !existsSync(path)) return ''
    return path
  }

  const resolveFirstFramePath = (state: RunStateKind) => {
    if (state === 'idle') return ''
    const frames = settings.tray.icons[state]?.frames || []
    for (const item of frames) {
      const pick = safeText(item)
      if (pick && existsSync(pick)) return pick
    }
    return ''
  }

  const getPreferredIconPathForState = (state: RunStateKind): string => {
    if (state === 'idle') return ''
    const firstFrame = resolveFirstFramePath(state)
    if (firstFrame) return firstFrame
    return resolveIconPath(state, '22')
  }

  const resolveFramePath = (state: RunStateKind, idx: number) => {
    const frames = (settings.tray.icons[state]?.frames || []).map((x) => safeText(x)).filter((x) => x && existsSync(x))
    if (!frames.length) return ''
    const pick = frames[idx % frames.length]
    if (!pick || !existsSync(pick)) return ''
    return pick
  }

  const imageForCurrent = () => {
    const display: '22' = '22'
    const renderSize = 18
    if (runState.state === 'idle') {
      return fallbackPng(renderSize)
    }
    if (settings.tray.animated) {
      const framePath = resolveFramePath(runState.state, frameIndex)
      if (framePath) {
        const img = nativeImage.createFromPath(framePath)
        if (!img.isEmpty()) {
          return img.resize({ width: renderSize, height: renderSize })
        }
      }
    }
    const iconPath = getPreferredIconPathForState(runState.state) || resolveIconPath(runState.state, display)
    if (iconPath) {
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) {
        return img.resize({ width: renderSize, height: renderSize })
      }
    }
    if (!settings.tray.fallbackToBuiltin) return nativeImage.createEmpty()
    return fallbackPng(renderSize)
  }

  const refreshTrayMenu = () => {
    if (!tray) return
    const label = stateLabel(runState.state)
    const title = safeText(runState.title)
    const statusLine = title ? `${label}: ${title}` : label
    const menu = Menu.buildFromTemplate([
      { label: `Anima · ${statusLine}`, enabled: false },
      { type: 'separator' },
      {
        label: '打开主窗口',
        click: () => {
          const win = getMainWindow()
          if (!win || win.isDestroyed()) return
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
      },
      {
        label: '退出',
        click: () => {
          app.quit()
        }
      }
    ])
    tray.setContextMenu(menu)
    tray.setToolTip(statusLine)
  }

  const refreshTrayImage = () => {
    if (!tray) return
    tray.setImage(imageForCurrent())
  }

  const restartAnimation = () => {
    clearAnimation()
    if (!tray) return
    if (!settings.tray.animated) return
    const frames = (settings.tray.icons[runState.state]?.frames || []).map((x) => safeText(x)).filter((x) => x && existsSync(x))
    if (frames.length <= 1) return
    const interval = clampInt(settings.tray.frameIntervalMs, 120, 1200)
    timer = setInterval(() => {
      frameIndex += 1
      refreshTrayImage()
    }, interval)
  }

  const ensureTray = () => {
    if (process.platform !== 'darwin') return
    if (!settings.tray.enabled) {
      if (tray) {
        clearAnimation()
        tray.destroy()
        tray = null
      }
      return
    }
    if (!tray) {
      tray = new Tray(imageForCurrent())
      try {
        tray.setIgnoreDoubleClickEvents(true)
      } catch {
        // ignore platform-specific unsupported behavior
      }
      tray.on('click', () => {
        if (!tray) return
        tray.popUpContextMenu()
      })
    }
    refreshTrayImage()
    refreshTrayMenu()
    restartAnimation()
  }

  const applySettings = (raw: any) => {
    settings = normalizeSettings(raw)
    ensureTray()
    refreshTrayMenu()
    refreshTrayImage()
  }

  const setState = (next: Partial<RunState> & { state: RunStateKind }) => {
    runState = {
      state: next.state,
      title: safeText(next.title),
      progress: typeof next.progress === 'number' ? next.progress : undefined,
      updatedAt: Date.now()
    }
    frameIndex = 0
    ensureTray()
    refreshTrayMenu()
    refreshTrayImage()
    restartAnimation()
  }

  const uploadTrayIcon = (params: { state: RunStateKind; size?: number; sourcePath: string }) => {
    const state = ALL_STATES.includes(params.state) ? params.state : 'idle'
    if (state === 'idle') return { ok: false, error: 'Idle icon is fixed to built-in logo' }
    const src = safeText(params.sourcePath)
    if (!src || !existsSync(src)) return { ok: false, error: 'Source file not found' }
    const size = Number(params.size || 18)
    const sizeKey = size === 22 ? '22' : size === 16 ? '16' : '18'
    const ext = (extname(src).trim().toLowerCase() || '.png').slice(0, 8)
    const dir = join(getTrayDir(), state)
    mkdirSync(dir, { recursive: true })
    const fileName = `${state}-${sizeKey}-${Date.now()}${ext}`
    const dst = join(dir, fileName)
    copyFileSync(src, dst)
    return { ok: true, path: dst, state, size: Number(sizeKey) }
  }

  const uploadTrayFrame = (params: { state: RunStateKind; sourcePath: string }) => {
    const state = ALL_STATES.includes(params.state) ? params.state : 'running'
    const src = safeText(params.sourcePath)
    if (!src || !existsSync(src)) return { ok: false, error: 'Source file not found' }
    const ext = (extname(src).trim().toLowerCase() || '.png').slice(0, 8)
    const dir = join(getTrayDir(), state)
    mkdirSync(dir, { recursive: true })
    const fileName = `${state}-frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const dst = join(dir, fileName)
    copyFileSync(src, dst)
    return { ok: true, path: dst, state }
  }

  const getState = () => ({
    settings,
    runState
  })

  const dispose = () => {
    clearAnimation()
    if (tray) {
      tray.destroy()
      tray = null
    }
  }

  return {
    ensureTray,
    applySettings,
    setState,
    uploadTrayIcon,
    uploadTrayFrame,
    getPreferredIconPathForState,
    getState,
    dispose
  }
}
