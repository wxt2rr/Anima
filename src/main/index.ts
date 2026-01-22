import { app, shell, BrowserWindow, ipcMain, dialog, globalShortcut, type OpenDialogOptions } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as net from 'net'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFileService } from './services/fileService'
import { registerGitService } from './services/gitService'
import { registerTerminalService } from './services/terminalService'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let backendProcess: ChildProcessWithoutNullStreams | null = null

const BACKEND_HOST = '127.0.0.1'
const DEFAULT_BACKEND_PORT = 17333
let backendPort = DEFAULT_BACKEND_PORT
let backendBaseUrl = `http://${BACKEND_HOST}:${backendPort}`

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

function startBackend(port: number): ChildProcessWithoutNullStreams {
  const scriptPath = app.isPackaged
    ? join(process.resourcesPath, 'pybackend', 'server.py')
    : join(app.getAppPath(), 'pybackend', 'server.py')
  const python = resolvePythonExecutable()
  const configRoot = process.env.ANIMA_CONFIG_ROOT || join(app.getPath('userData'), 'pybackend')
  const child = spawn(python, [scriptPath, '--host', BACKEND_HOST, '--port', String(port)], {
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1', ANIMA_CONFIG_ROOT: configRoot }
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
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow
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

function registerIpcHandlers(): void {
  registerFileService()
  registerGitService()
  registerTerminalService()

  ipcMain.handle('anima:backend:getBaseUrl', async () => {
    return { ok: true, baseUrl: backendBaseUrl }
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

  ipcMain.handle('anima:window:openSettings', async () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.isMinimized()) settingsWindow.restore()
      settingsWindow.show()
      settingsWindow.focus()
      return { ok: true }
    }

    settingsWindow = new BrowserWindow({
      width: 1080,
      height: 720,
      show: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 18 },
      backgroundColor: '#F5F7FA',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        webviewTag: true
      }
    })

    settingsWindow.on('ready-to-show', () => {
      settingsWindow?.show()
    })

    settingsWindow.on('closed', () => {
      settingsWindow = null
    })

    settingsWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (is.dev) {
      const devUrl =
        process.env['ELECTRON_RENDERER_URL'] || process.env['VITE_DEV_SERVER_URL'] || 'http://localhost:5173/'
      try {
        await settingsWindow.loadURL(`${devUrl}#/settings`)
      } catch (error) {
        console.error('[settingsWindow loadURL failed]', error)
        await settingsWindow.loadURL(
          `data:text/html,${encodeURIComponent('<pre>Failed to load renderer dev server. Check main-process console.</pre>')}`
        )
      }
    } else {
      await settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/settings' })
    }

    return { ok: true }
  })

  ipcMain.handle('anima:dialog:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return { ok: true, canceled: res.canceled, paths: res.filePaths || [] }
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

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
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
    }
  })
  
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
  registerIpcHandlers()

  backendPort = await findAvailableBackendPort()
  backendBaseUrl = `http://${BACKEND_HOST}:${backendPort}`
  backendProcess = startBackend(backendPort)
  await waitForBackendReady(backendBaseUrl)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  await createWindow()

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
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill()
  }
})
