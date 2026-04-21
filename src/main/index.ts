import { app, shell, BrowserWindow, ipcMain, dialog, globalShortcut, nativeImage, Menu, screen, type MenuItemConstructorOptions, type OpenDialogOptions } from 'electron'
import { join, extname } from 'path'
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as net from 'net'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import Store from 'electron-store'
import { registerFileService } from './services/fileService'
import { registerGitService } from './services/gitService'
import { registerTerminalService } from './services/terminalService'
import { registerAcpService } from './services/acpService'
import { createStatusCenterService } from './services/statusCenterService'

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcessWithoutNullStreams | null = null
let statusCenterService: ReturnType<typeof createStatusCenterService> | null = null
let pendingSpellProbe:
  | {
      webContentsId: number
      resolve: (result: { ok: boolean; misspelledWord?: string; suggestions?: string[]; error?: string }) => void
      timer: NodeJS.Timeout
    }
  | null = null

type WindowState = {
  bounds?: { x?: number; y?: number; width: number; height: number }
  isMaximized?: boolean
}

const windowStore = new Store<{ mainWindow: WindowState }>({ name: 'window-state' })

const remoteDebuggingPort = String(process.env.ANIMA_REMOTE_DEBUGGING_PORT || '').trim()
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function getDefaultBounds(): { width: number; height: number } {
  const work = screen.getPrimaryDisplay().workAreaSize
  const maxW = Math.max(800, work.width - 80)
  const maxH = Math.max(600, work.height - 80)
  const base = { width: 1280, height: 820 }
  return {
    width: clamp(base.width, 800, maxW),
    height: clamp(base.height, 600, maxH)
  }
}

function restoreWindowState(): { bounds: { width: number; height: number; x?: number; y?: number }; isMaximized: boolean } {
  const saved = (windowStore.get('mainWindow') || {}) as WindowState
  const def = getDefaultBounds()
  const b = saved.bounds
  const bounds = {
    width: clamp(Number(b?.width || def.width), 800, 10000),
    height: clamp(Number(b?.height || def.height), 600, 10000),
    x: typeof b?.x === 'number' ? b.x : undefined,
    y: typeof b?.y === 'number' ? b.y : undefined
  }
  return { bounds, isMaximized: Boolean(saved.isMaximized) }
}

function attachWindowStatePersistence(win: BrowserWindow): void {
  let t: NodeJS.Timeout | null = null

  const save = () => {
    if (win.isDestroyed()) return
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    windowStore.set('mainWindow', { bounds, isMaximized })
  }

  const scheduleSave = () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      t = null
      save()
    }, 250)
  }

  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('close', () => {
    if (t) clearTimeout(t)
    save()
  })
}

type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
type UpdateProgress = { percent?: number; bytesPerSecond?: number; transferred?: number; total?: number }
type UpdateState = {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
  lastCheckedAt?: number
}

let updateState: UpdateState = {
  status: is.dev ? 'disabled' : 'idle',
  currentVersion: app.getVersion()
}

const BACKEND_HOST = '127.0.0.1'
const DEFAULT_BACKEND_PORT = 17333
let backendPort = DEFAULT_BACKEND_PORT
let backendBaseUrl = `http://${BACKEND_HOST}:${backendPort}`

const CLI_BIN_SUBDIR = '.anima/bin'
const CLI_SHIM_NAME = 'anima'

if (is.dev) {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

function resolvePythonExecutable(): string {
  const condaPrefix = String(process.env.CONDA_PREFIX || '').trim()
  const venvPrefix = String(process.env.VIRTUAL_ENV || '').trim()
  const candidates = [
    String(process.env.ANIMA_PYTHON || '').trim(),
    String(process.env.PYTHON || '').trim(),
    condaPrefix ? join(condaPrefix, 'bin', 'python') : '',
    venvPrefix ? join(venvPrefix, 'bin', 'python') : '',
    'python3',
    'python'
  ].filter(Boolean)

  for (const c of candidates) {
    if (c.includes('/') || c.includes('\\')) {
      if (existsSync(c)) return c
      continue
    }
    return c
  }

  return 'python3'
}

function buildCliShimContent(): string {
  if (app.isPackaged) {
    const resourcesPathEscaped = String(process.resourcesPath || '').replace(/"/g, '\\"')
    return [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `RES_DIR="${resourcesPathEscaped}"`,
      'export PYTHONPATH="$RES_DIR/pybackend${PYTHONPATH:+:$PYTHONPATH}"',
      'if command -v python3 >/dev/null 2>&1; then',
      '  exec python3 -m anima_cli.main "$@"',
      'fi',
      'exec python -m anima_cli.main "$@"'
    ].join('\n') + '\n'
  }

  const repoCliPath = join(app.getAppPath(), CLI_SHIM_NAME).replace(/"/g, '\\"')
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `exec "${repoCliPath}" "$@"`
  ].join('\n') + '\n'
}

function ensurePathLineInRcFile(rcPath: string): void {
  const exportLine = 'export PATH="$HOME/.anima/bin:$PATH"'
  const marker = '# Anima CLI 自动写入'
  let content = ''
  if (existsSync(rcPath)) {
    try {
      content = readFileSync(rcPath, 'utf-8')
    } catch {
      content = ''
    }
  }
  if (content.includes('.anima/bin')) return

  const needsNewline = content.length > 0 && !content.endsWith('\n')
  const next =
    content +
    (needsNewline ? '\n' : '') +
    `${marker}\n${exportLine}\n`
  writeFileSync(rcPath, next, 'utf-8')
}

function ensureCliShimInstalled(): void {
  try {
    const homeDir = app.getPath('home')
    const binDir = join(homeDir, CLI_BIN_SUBDIR)
    mkdirSync(binDir, { recursive: true })
    const shimPath = join(binDir, CLI_SHIM_NAME)
    writeFileSync(shimPath, buildCliShimContent(), { encoding: 'utf-8', mode: 0o755 })

    const shellPath = String(process.env.SHELL || '').trim()
    const rcCandidates: string[] = []
    if (shellPath.endsWith('/zsh')) {
      rcCandidates.push(join(homeDir, '.zshrc'))
    } else if (shellPath.endsWith('/bash')) {
      rcCandidates.push(join(homeDir, '.bash_profile'), join(homeDir, '.bashrc'))
    }
    rcCandidates.push(join(homeDir, '.zshrc'))

    const seen = new Set<string>()
    for (const rc of rcCandidates) {
      if (seen.has(rc)) continue
      seen.add(rc)
      try {
        ensurePathLineInRcFile(rc)
      } catch {
        continue
      }
    }
  } catch (e) {
    if (is.dev) console.warn('[cli] ensure shim failed', e)
  }
}

function startBackend(port: number): ChildProcessWithoutNullStreams {
  const scriptPath = app.isPackaged
    ? join(process.resourcesPath, 'pybackend', 'server.py')
    : join(app.getAppPath(), 'pybackend', 'server.py')
  const python = resolvePythonExecutable()
  const bundledSkillsDir = process.env.ANIMA_BUNDLED_SKILLS_DIR || (app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'skills'))
  const bundledCommandsDir =
    process.env.ANIMA_BUNDLED_COMMANDS_DIR ||
    (app.isPackaged ? join(process.resourcesPath, 'skills', 'commands') : join(app.getAppPath(), 'expand_command'))
  const homeDir = app.getPath('home')
  const userSkillsDir = process.env.ANIMA_SKILLS_DIR || join(homeDir, '.config', 'anima', 'skills')

  const ensureDir = (p: string) => {
    try {
      mkdirSync(p, { recursive: true })
    } catch (e) {
      return
    }
  }

  const copyDirRecursive = (src: string, dst: string, overwriteExisting: boolean) => {
    ensureDir(dst)
    const entries = readdirSync(src, { withFileTypes: true })
    for (const ent of entries) {
      const s = join(src, ent.name)
      const d = join(dst, ent.name)
      if (ent.isDirectory()) {
        copyDirRecursive(s, d, overwriteExisting)
      } else if (ent.isFile()) {
        if (!overwriteExisting && existsSync(d)) continue
        try {
          copyFileSync(s, d)
        } catch (e) {
          continue
        }
      }
    }
  }

  const installBundledSkills = (srcRoot: string, dstRoot: string, overwriteExisting: boolean) => {
    if (!srcRoot || !existsSync(srcRoot)) return
    ensureDir(dstRoot)
    let entries: string[] = []
    try {
      entries = readdirSync(srcRoot)
    } catch {
      entries = []
    }
    for (const name of entries) {
      const src = join(srcRoot, name)
      const dst = join(dstRoot, name)
      try {
        if (!statSync(src).isDirectory()) continue
      } catch {
        continue
      }
      if (!existsSync(join(src, 'SKILL.md'))) continue
      if (overwriteExisting && existsSync(dst)) {
        try {
          rmSync(dst, { recursive: true, force: true })
        } catch {
          continue
        }
      } else if (existsSync(dst)) {
        continue
      }
      copyDirRecursive(src, dst, overwriteExisting)
    }
  }

  installBundledSkills(bundledSkillsDir, userSkillsDir, is.dev)

  const extraEnv: Record<string, string> = { PYTHONUNBUFFERED: '1' }
  extraEnv.ANIMA_SKILLS_DIR = userSkillsDir
  extraEnv.ANIMA_BUNDLED_COMMANDS_DIR = bundledCommandsDir
  if (is.dev) {
    if (!process.env.ANIMA_VOICE_DEBUG) extraEnv.ANIMA_VOICE_DEBUG = '1'
    if (!process.env.ANIMA_TG_DEBUG) extraEnv.ANIMA_TG_DEBUG = '1'
    extraEnv.ANIMA_DEV_MODE = '1'
    extraEnv.ANIMA_DEV_REPO_ROOT = app.getAppPath()
  }
  const extraPaths = [
    '/opt/anaconda3/bin',
    '/usr/local/anaconda3/bin',
    join(homeDir, 'anaconda3', 'bin'),
    join(homeDir, 'miniconda3', 'bin'),
    join(homeDir, 'miniforge3', 'bin')
  ]
  const defaultPath = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  const inheritedPath = String(process.env.PATH || '').trim()
  const pathParts = inheritedPath ? inheritedPath.split(':').filter(Boolean) : []
  const merged = Array.from(new Set([...extraPaths, ...defaultPath.split(':'), ...pathParts])).filter(Boolean).join(':')
  extraEnv.PATH = merged

  const child = spawn(python, [scriptPath, '--host', BACKEND_HOST, '--port', String(port)], {
    stdio: 'pipe',
    env: { ...process.env, ...extraEnv }
  })
  child.stdout.on('data', (buf) => {
    if (is.dev) process.stdout.write(buf)
  })
  child.stderr.on('data', (buf) => {
    if (is.dev) process.stderr.write(buf)
  })
  child.on('exit', () => {
    backendProcess = null
  })
  return child
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

async function findAvailableBackendPort(): Promise<number> {
  if (await canListen(BACKEND_HOST, DEFAULT_BACKEND_PORT)) return DEFAULT_BACKEND_PORT
  for (let port = DEFAULT_BACKEND_PORT + 1; port <= DEFAULT_BACKEND_PORT + 100; port += 1) {
    if (await canListen(BACKEND_HOST, port)) return port
  }
  return DEFAULT_BACKEND_PORT
}

async function waitForBackendReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { method: 'GET' })
      if (res.ok) return
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

function getDevToolsTargetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  return null
}

function toggleDevTools(): void {
  const win = getDevToolsTargetWindow()
  if (!win) return
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools()
  } else {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

function normalizeReleaseNotes(notes: any): string | undefined {
  if (!notes) return undefined
  if (typeof notes === 'string') return notes.trim() || undefined
  if (Array.isArray(notes)) {
    const lines = notes
      .map((n) => {
        if (!n) return ''
        if (typeof n === 'string') return n.trim()
        const v = String((n as any).note || (n as any).notes || (n as any).body || '').trim()
        return v
      })
      .filter(Boolean)
    const joined = lines.join('\n\n').trim()
    return joined || undefined
  }
  return undefined
}

function broadcastUpdateState(): void {
  const wins = [mainWindow].filter((w): w is BrowserWindow => Boolean(w && !w.isDestroyed()))
  for (const w of wins) {
    if (!w.webContents.isDestroyed()) w.webContents.send('anima:update:state', updateState)
  }
}

function setUpdateState(patch: Partial<UpdateState>): void {
  updateState = { ...updateState, ...patch }
  broadcastUpdateState()
}

function trySetDockIcon(): void {
  if (process.platform !== 'darwin') return
  const dock = (app as any).dock
  if (!dock || typeof dock.setIcon !== 'function') return

  const idlePath = statusCenterService?.getPreferredIconPathForState?.('idle') || ''
  if (idlePath && existsSync(idlePath)) {
    const img = nativeImage.createFromPath(idlePath)
    if (!img.isEmpty()) {
      dock.setIcon(img)
      return
    }
  }

  const p = join(process.cwd(), 'images', 'logo_padded.png')
  if (!existsSync(p)) return
  const img = nativeImage.createFromPath(p)
  if (img.isEmpty()) return
  dock.setIcon(img)
}

function getDevIconPath(): string | undefined {
  const p = join(process.cwd(), 'images', 'logo_padded.png')
  return is.dev && existsSync(p) ? p : undefined
}

function registerIpcHandlers(): void {
  registerFileService()
  registerGitService()
  registerTerminalService()
  registerAcpService()

  ipcMain.handle('anima:app:getInfo', async () => {
    return {
      ok: true,
      name: app.getName(),
      version: app.getVersion(),
      author: 'wangxt',
      repositoryUrl: 'https://github.com/wxt2rr/Anima'
    }
  })

  ipcMain.handle('anima:backend:getBaseUrl', async () => {
    return { ok: true, baseUrl: backendBaseUrl }
  })

  ipcMain.handle('anima:spell:probeAtPoint', async (evt, params: any) => {
    const wc = evt.sender
    const x = Number(params?.x)
    const y = Number(params?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, error: 'Invalid point' }
    }

    if (pendingSpellProbe) {
      try {
        clearTimeout(pendingSpellProbe.timer)
        pendingSpellProbe.resolve({ ok: false, error: 'Interrupted' })
      } catch {
        //
      }
      pendingSpellProbe = null
    }

    return await new Promise<{ ok: boolean; misspelledWord?: string; suggestions?: string[]; error?: string }>((resolve) => {
      const timer = setTimeout(() => {
        if (!pendingSpellProbe || pendingSpellProbe.webContentsId !== wc.id) return
        pendingSpellProbe = null
        resolve({ ok: true, misspelledWord: '', suggestions: [] })
      }, 350)

      pendingSpellProbe = {
        webContentsId: wc.id,
        resolve,
        timer
      }

      try {
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 })
      } catch (error: any) {
        clearTimeout(timer)
        pendingSpellProbe = null
        resolve({ ok: false, error: error?.message || String(error) })
      }
    })
  })

  ipcMain.handle('anima:statusCenter:getState', async () => {
    if (!statusCenterService) return { ok: false, error: 'status center not ready' }
    return { ok: true, ...statusCenterService.getState() }
  })

  ipcMain.handle('anima:statusCenter:applySettings', async (_evt, params: any) => {
    if (!statusCenterService) return { ok: false, error: 'status center not ready' }
    try {
      statusCenterService.applySettings(params?.settings || {})
      trySetDockIcon()
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('anima:statusCenter:setState', async (_evt, params: any) => {
    if (!statusCenterService) return { ok: false, error: 'status center not ready' }
    try {
      const state = String(params?.state || '').trim() as any
      if (!state) return { ok: false, error: 'Missing state' }
      statusCenterService.setState({
        state,
        title: String(params?.title || '').trim() || undefined,
        progress: typeof params?.progress === 'number' ? Number(params.progress) : undefined
      } as any)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('anima:statusCenter:uploadTrayIcon', async (_evt, params: any) => {
    if (!statusCenterService) return { ok: false, error: 'status center not ready' }
    try {
      return statusCenterService.uploadTrayIcon({
        state: String(params?.state || 'idle') as any,
        size: Number(params?.size || 18),
        sourcePath: String(params?.sourcePath || '')
      })
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('anima:statusCenter:uploadTrayFrame', async (_evt, params: any) => {
    if (!statusCenterService) return { ok: false, error: 'status center not ready' }
    try {
      return statusCenterService.uploadTrayFrame({
        state: String(params?.state || 'running') as any,
        sourcePath: String(params?.sourcePath || '')
      })
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('anima:statusCenter:reloadIcons', async () => {
    if (!statusCenterService) return { ok: false, error: 'status center not ready' }
    try {
      const current = statusCenterService.getState()
      statusCenterService.applySettings(current.settings)
      trySetDockIcon()
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('preview:openExternal', async (_, url: string) => {
    try {
      const target = String(url || '').trim()
      if (!target) return { ok: false, error: 'Empty URL' }
      await shell.openExternal(target)
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('anima:dialog:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return { ok: true, canceled: res.canceled, paths: res.filePaths || [] }
  })

  ipcMain.handle('anima:attachment:saveImage', async (_evt, params: any) => {
    try {
      const ws = String(params?.workspaceDir || '').trim()
      const rawName = String(params?.fileName || '').trim()
      const mime = String(params?.mime || '').trim().toLowerCase()
      const bytesInput = params?.bytes
      const bytes =
        bytesInput instanceof Uint8Array
          ? bytesInput
          : Array.isArray(bytesInput)
            ? Uint8Array.from(bytesInput)
            : null
      if (!bytes || bytes.length === 0) {
        return { ok: false, error: 'Invalid image bytes' }
      }

      const extByMime: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
        'image/svg+xml': '.svg'
      }
      const ext = extname(rawName).trim().toLowerCase() || extByMime[mime] || '.png'
      const useWorkspaceDir = ws && existsSync(ws) && statSync(ws).isDirectory()
      const baseDir = useWorkspaceDir ? join(ws, '.anima', 'attachments') : join(app.getPath('temp'), 'anima', 'attachments')
      mkdirSync(baseDir, { recursive: true })
      const outName = `pasted-${Date.now()}-${Math.random().toString(16).slice(2, 8)}${ext}`
      const outPath = join(baseDir, outName)
      writeFileSync(outPath, Buffer.from(bytes))
      return { ok: true, path: outPath }
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('anima:shell:openPath', async (_, path: string) => {
    try {
      const target = String(path || '').trim()
      if (!target) return { ok: false, error: 'Empty path' }
      const res = await shell.openPath(target)
      if (res) {
        return { ok: false, error: res }
      }
      return { ok: true }
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) }
    }
  })

  ipcMain.handle('anima:dialog:pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = res.filePaths && res.filePaths.length ? res.filePaths[0] : ''
    return { ok: true, canceled: res.canceled, path }
  })

  ipcMain.handle('anima:update:getState', async () => {
    return { ok: true, state: updateState }
  })

  ipcMain.handle('anima:update:check', async (_evt, opts?: { interactive?: boolean }) => {
    if (is.dev) return { ok: false, error: 'updates disabled in dev' }
    setUpdateState({ status: 'checking', error: undefined, lastCheckedAt: Date.now() })
    try {
      const res = await autoUpdater.checkForUpdates()
      return { ok: true, updateInfo: res?.updateInfo || null }
    } catch (e: any) {
      const msg = String(e?.message || e || '').trim() || 'Unknown error'
      setUpdateState({ status: 'error', error: msg })
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('anima:update:download', async () => {
    if (is.dev) return { ok: false, error: 'updates disabled in dev' }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e: any) {
      const msg = String(e?.message || e || '').trim() || 'Unknown error'
      setUpdateState({ status: 'error', error: msg })
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('anima:update:quitAndInstall', async () => {
    if (is.dev) return { ok: false, error: 'updates disabled in dev' }
    try {
      autoUpdater.quitAndInstall()
      return { ok: true }
    } catch (e: any) {
      const msg = String(e?.message || e || '').trim() || 'Unknown error'
      return { ok: false, error: msg }
    }
  })

  // Window Controls
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })
}

function setupAppMenu(): void {
  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    enabled: !is.dev,
    click: () => {
      void autoUpdater.checkForUpdates()
    }
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [checkForUpdatesItem, { type: 'separator' }, { role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function setupAutoUpdates(): void {
  if (is.dev) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', async (err) => {
    const msg = String((err as any)?.message || err || '').trim() || 'Unknown error'
    setUpdateState({ status: 'error', error: msg })
  })

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', error: undefined, lastCheckedAt: Date.now() })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      availableVersion: String((info as any)?.version || '').trim() || undefined,
      releaseNotes: normalizeReleaseNotes((info as any)?.releaseNotes),
      progress: undefined,
      error: undefined
    })
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateState({ status: 'not-available', availableVersion: undefined, releaseNotes: undefined, progress: undefined, error: undefined })
  })

  autoUpdater.on('download-progress', (p: any) => {
    setUpdateState({
      status: 'downloading',
      progress: {
        percent: typeof p?.percent === 'number' ? p.percent : undefined,
        bytesPerSecond: typeof p?.bytesPerSecond === 'number' ? p.bytesPerSecond : undefined,
        transferred: typeof p?.transferred === 'number' ? p.transferred : undefined,
        total: typeof p?.total === 'number' ? p.total : undefined
      }
    })
  })

  autoUpdater.on('update-downloaded', () => {
    setUpdateState({ status: 'downloaded', progress: { percent: 100 } })
  })

  void autoUpdater.checkForUpdates().catch((e: any) => {
    const msg = String(e?.message || e || '').trim() || 'Unknown error'
    setUpdateState({ status: 'error', error: msg })
  })
}

async function createWindow(): Promise<void> {
  const restored = restoreWindowState()
  mainWindow = new BrowserWindow({
    ...restored.bounds,
    show: false,
    titleBarStyle: 'hiddenInset', // Use hiddenInset to show traffic lights inside the window content area
    trafficLightPosition: { x: 20, y: 18 }, // Adjust traffic light position
    backgroundColor: '#F5F7FA',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true
    },
    icon: getDevIconPath()
  })
  if (restored.isMaximized) mainWindow.maximize()
  attachWindowStatePersistence(mainWindow)
  
  // We want native traffic lights, so do NOT hide them
  // if (process.platform === 'darwin') {
  //   mainWindow.setWindowButtonVisibility(false)
  // }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (pendingSpellProbe && pendingSpellProbe.webContentsId === mainWindow?.webContents.id) {
      try {
        clearTimeout(pendingSpellProbe.timer)
        const misspelledWord = String(params.misspelledWord || '').trim()
        const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions.map((s) => String(s || '').trim()).filter(Boolean) : []
        pendingSpellProbe.resolve({ ok: true, misspelledWord, suggestions })
      } catch (error: any) {
        pendingSpellProbe.resolve({ ok: false, error: error?.message || String(error) })
      } finally {
        pendingSpellProbe = null
      }
      return
    }

    const items: MenuItemConstructorOptions[] = []
    const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : []
    const misspelledWord = String(params.misspelledWord || '').trim()

    if (misspelledWord && suggestions.length > 0) {
      for (const suggestion of suggestions.slice(0, 6)) {
        items.push({
          label: suggestion,
          click: () => {
            mainWindow?.webContents.replaceMisspelling(suggestion)
          }
        })
      }
      items.push({ type: 'separator' })
    } else if (misspelledWord) {
      items.push({ label: 'No spelling suggestions', enabled: false })
      items.push({ type: 'separator' })
    }

    if (params.isEditable) {
      items.push({ role: 'undo' })
      items.push({ role: 'redo' })
      items.push({ type: 'separator' })
      items.push({ role: 'cut' })
      items.push({ role: 'copy' })
      items.push({ role: 'paste' })
      items.push({ role: 'selectAll' })
    } else if (String(params.selectionText || '').trim()) {
      items.push({ role: 'copy' })
      items.push({ role: 'selectAll' })
    }

    if (!items.length) return
    Menu.buildFromTemplate(items).popup({ window: mainWindow || undefined })
  })

  if (is.dev) {
    mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
      console.error('[mainWindow did-fail-load]', { errorCode, errorDescription, validatedURL })
    })
    mainWindow.webContents.on('render-process-gone', (_, details) => {
      console.error('[mainWindow render-process-gone]', details)
    })
  }

  if (is.dev) {
    const devUrl =
      process.env['ELECTRON_RENDERER_URL'] || process.env['VITE_DEV_SERVER_URL'] || 'http://localhost:5173/'
    try {
      await mainWindow.loadURL(devUrl)
    } catch (error) {
      console.error('[mainWindow loadURL failed]', error)
      await mainWindow.loadURL(
        `data:text/html,${encodeURIComponent('<pre>Failed to load renderer dev server. Check main-process console.</pre>')}`
      )
    }
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.anima.app')
  ensureCliShimInstalled()
  statusCenterService = createStatusCenterService(() => mainWindow)
  statusCenterService.ensureTray()
  registerIpcHandlers()
  trySetDockIcon()
  setupAppMenu()

  backendPort = await findAvailableBackendPort()
  backendBaseUrl = `http://${BACKEND_HOST}:${backendPort}`
  backendProcess = startBackend(backendPort)
  await waitForBackendReady(backendBaseUrl)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await createWindow()
  setupAutoUpdates()

  const shortcut = process.env.ANIMA_DEVTOOLS_SHORTCUT || 'CommandOrControl+Alt+I'
  globalShortcut.register(shortcut, toggleDevTools)
  if (process.env.ANIMA_OPEN_DEVTOOLS === '1') toggleDevTools()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  statusCenterService?.dispose()
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill()
  }
})
