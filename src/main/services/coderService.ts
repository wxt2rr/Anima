import { app, ipcMain } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import net from 'net'
import path from 'path'

type CoderEndpointType = 'terminal' | 'desktop'
type CoderTransport = 'acp' | 'cdpbridge'

type CoderSettings = {
  enabled?: boolean
  name?: string
  endpointType?: CoderEndpointType
  transport?: CoderTransport
  autoStart?: boolean
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  remoteDebuggingPort?: number
}

let currentSettings: CoderSettings = {}
let coderProcess: ChildProcessWithoutNullStreams | null = null
let startedAt = 0
let lastError = ''
let lastLaunchAt = 0
let launchInFlight = false

function isRunning(): boolean {
  return Boolean(coderProcess && !coderProcess.killed && coderProcess.exitCode == null)
}

function resolveCwd(input?: string): string {
  const fallback = process.env.HOME || process.cwd()
  const cwd = String(input || '').trim()
  if (!cwd) return fallback
  try {
    const st = fs.statSync(cwd)
    if (st.isDirectory()) return cwd
  } catch {
    return fallback
  }
  return fallback
}

function normalizeSettings(raw?: CoderSettings): CoderSettings {
  const s = raw && typeof raw === 'object' ? raw : {}
  const endpointType: CoderEndpointType = s.endpointType === 'terminal' ? 'terminal' : 'desktop'
  const transport: CoderTransport = s.transport === 'acp' ? 'acp' : 'cdpbridge'
  const defaultPort = Number(s.remoteDebuggingPort || 9222) || 9222
  const fallbackDesktopArgs = ['-a', 'Codex', '--args', `--remote-debugging-port=${defaultPort}`]
  const fallbackArgs = transport === 'acp' ? ['--acp'] : fallbackDesktopArgs
  let args = Array.isArray(s.args) ? s.args.map((x) => String(x)) : fallbackArgs
  let command = String(s.command || '').trim()
  if (!command) {
    command = endpointType === 'desktop' && transport === 'cdpbridge' ? '/usr/bin/open' : 'codex'
  }
  if (
    endpointType === 'desktop' &&
    transport === 'cdpbridge' &&
    command === 'codex' &&
    args.some((x) => String(x).includes('--remote-debugging-port'))
  ) {
    command = '/usr/bin/open'
    args = fallbackDesktopArgs
  }
  return {
    enabled: Boolean(s.enabled),
    name: String(s.name || '').trim() || 'Coder',
    endpointType,
    transport,
    autoStart: Boolean(s.autoStart),
    command,
    args,
    cwd: String(s.cwd || '').trim(),
    env: s.env && typeof s.env === 'object' ? s.env : {},
    remoteDebuggingPort: defaultPort
  }
}

function buildEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue
    env[k] = String(v)
  }
  const defaultPath = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  env.PATH = env.PATH && String(env.PATH).trim() ? env.PATH : defaultPath
  if (!app.isPackaged) {
    const appPath = String(app.getAppPath() || '').trim()
    const home = String(env.HOME || '').trim()
    const entries: string[] = []
    if (appPath && fs.existsSync(path.join(appPath, 'anima'))) entries.push(appPath)
    if (home) {
      const userBin = path.join(home, '.anima', 'bin')
      if (fs.existsSync(userBin)) entries.push(userBin)
    }
    if (entries.length > 0) {
      const parts = String(env.PATH || '').split(':').filter(Boolean)
      env.PATH = Array.from(new Set([...entries, ...parts])).join(':')
    }
  }
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [k, v] of Object.entries(extraEnv)) env[k] = String(v)
  }
  return env
}

function connectPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Number.isFinite(port) || port <= 0) {
      resolve(false)
      return
    }
    const sock = new net.Socket()
    const done = (ok: boolean) => {
      try {
        sock.destroy()
      } catch {
        // ignore
      }
      resolve(ok)
    }
    sock.setTimeout(350)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
    sock.connect(port, '127.0.0.1')
  })
}

async function status() {
  const s = normalizeSettings(currentSettings)
  const running = isRunning()
  let debugPortReady = false
  if (s.transport === 'cdpbridge') {
    debugPortReady = await connectPort(Number(s.remoteDebuggingPort || 9222))
  }
  return {
    ok: true,
    running,
    pid: coderProcess?.pid ?? null,
    startedAt: startedAt || null,
    uptimeMs: running && startedAt ? Date.now() - startedAt : 0,
    lastError,
    settings: s,
    debugPortReady
  }
}

function doStop() {
  if (!coderProcess) return
  try {
    coderProcess.kill('SIGTERM')
  } catch (e: any) {
    lastError = e?.message || String(e)
  }
  coderProcess = null
  startedAt = 0
}

async function doStart() {
  const s = normalizeSettings(currentSettings)
  if (!s.enabled) return { ok: false, error: 'Coder is disabled' }
  if (isRunning()) {
    return { ok: true, alreadyRunning: true, pid: coderProcess?.pid ?? null }
  }
  if (s.endpointType === 'desktop' && s.transport === 'cdpbridge') {
    const ready = await connectPort(Number(s.remoteDebuggingPort || 9222))
    if (ready) {
      return { ok: true, alreadyRunning: true, external: true }
    }
    const now = Date.now()
    if (launchInFlight || now - lastLaunchAt < 8000) {
      return { ok: true, starting: true }
    }
  }
  const cmd = String(s.command || '').trim()
  if (!cmd) return { ok: false, error: 'Missing command' }
  const args = Array.isArray(s.args) ? s.args.map((x) => String(x)) : []
  try {
    launchInFlight = true
    lastLaunchAt = Date.now()
    const child = spawn(cmd, args, {
      cwd: resolveCwd(s.cwd),
      env: buildEnv(s.env),
      stdio: 'pipe'
    })
    child.stderr.on('data', (chunk: string | Buffer) => {
      const text = String(chunk || '').trim()
      if (text) lastError = text
    })
    child.on('exit', () => {
      coderProcess = null
      startedAt = 0
    })
    coderProcess = child
    startedAt = Date.now()
    lastError = ''
    return { ok: true, pid: child.pid }
  } catch (e: any) {
    lastError = e?.message || String(e)
    return { ok: false, error: lastError }
  } finally {
    launchInFlight = false
  }
}

export function registerCoderService() {
  ipcMain.handle('coder:configure', async (_event, params?: { settings?: CoderSettings }) => {
    currentSettings = normalizeSettings(params?.settings)
    const s = normalizeSettings(currentSettings)
    if (!s.enabled) {
      doStop()
      return { ok: true, started: false, reason: 'disabled' }
    }
    if (!s.autoStart) return { ok: true, started: false, reason: 'autoStartDisabled' }
    return await doStart()
  })

  ipcMain.handle('coder:autoStart', async () => {
    const s = normalizeSettings(currentSettings)
    if (!s.enabled || !s.autoStart) return { ok: true, started: false }
    return await doStart()
  })

  ipcMain.handle('coder:start', async (_event, params?: { settings?: CoderSettings }) => {
    if (params?.settings) currentSettings = normalizeSettings(params.settings)
    return await doStart()
  })

  ipcMain.handle('coder:stop', async () => {
    doStop()
    return { ok: true }
  })

  ipcMain.handle('coder:status', async () => {
    return status()
  })
}
