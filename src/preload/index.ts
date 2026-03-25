import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const animaAPI = {
  app: {
    getInfo: () => ipcRenderer.invoke('anima:app:getInfo')
  },
  backend: {
    getBaseUrl: () => ipcRenderer.invoke('anima:backend:getBaseUrl')
  },
  window: {
    pickFiles: () => ipcRenderer.invoke('anima:dialog:pickFiles'),
    pickDirectory: () => ipcRenderer.invoke('anima:dialog:pickDirectory'),
    saveImageAttachment: (params: { bytes: Uint8Array | number[]; fileName?: string; workspaceDir?: string; mime?: string }) =>
      ipcRenderer.invoke('anima:attachment:saveImage', params)
  },
  fs: {
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    readFileBinary: (path: string) => ipcRenderer.invoke('fs:readFileBinary', path),
    getCwd: () => ipcRenderer.invoke('fs:getCwd')
  },
  git: {
    checkIsRepo: (cwd: string) => ipcRenderer.invoke('git:checkIsRepo', cwd),
    init: (cwd: string) => ipcRenderer.invoke('git:init', cwd),
    getBranches: (cwd: string) => ipcRenderer.invoke('git:getBranches', cwd),
    checkout: (params: any) => ipcRenderer.invoke('git:checkout', params),
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    commit: (params: any) => ipcRenderer.invoke('git:commit', params),
    add: (params: any) => ipcRenderer.invoke('git:add', params),
    unstage: (params: any) => ipcRenderer.invoke('git:unstage', params),
    getStashes: (cwd: string) => ipcRenderer.invoke('git:getStashes', cwd),
    getLog: (cwd: string) => ipcRenderer.invoke('git:getLog', cwd),
    diff: (params: any) => ipcRenderer.invoke('git:diff', params)
  },
  terminal: {
    create: (params: any) => ipcRenderer.invoke('terminal:create', params),
    resize: (params: any) => ipcRenderer.send('terminal:resize', params),
    write: (params: any) => ipcRenderer.send('terminal:write', params),
    kill: (id: string) => ipcRenderer.send('terminal:kill', id),
    onData: (id: string, callback: (data: string) => void) => {
        const channel = `terminal:data:${id}`;
        const subscription = (_: any, data: string) => callback(data);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
    }
  },
  acp: {
    createSession: (params: any) => ipcRenderer.invoke('acp:session:create', params),
    status: () => ipcRenderer.invoke('acp:status'),
    resetApprovals: (params?: any) => ipcRenderer.invoke('acp:approvals:reset', params),
    prompt: (params: any) => ipcRenderer.invoke('acp:session:prompt', params),
    cancel: (params: any) => ipcRenderer.invoke('acp:session:cancel', params),
    close: (params: any) => ipcRenderer.invoke('acp:session:close', params),
    onEvent: (sessionId: string, callback: (evt: any) => void) => {
      const channel = `acp:event:${sessionId}`
      const subscription = (_: any, evt: any) => callback(evt)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
  },
  coder: {
    configure: (params?: any) => ipcRenderer.invoke('coder:configure', params),
    autoStart: () => ipcRenderer.invoke('coder:autoStart'),
    start: (params?: any) => ipcRenderer.invoke('coder:start', params),
    stop: () => ipcRenderer.invoke('coder:stop'),
    status: () => ipcRenderer.invoke('coder:status')
  },
  statusCenter: {
    getState: () => ipcRenderer.invoke('anima:statusCenter:getState'),
    applySettings: (params: { settings?: any }) => ipcRenderer.invoke('anima:statusCenter:applySettings', params),
    setState: (params: { state: 'idle' | 'running' | 'waiting_user' | 'done' | 'error'; title?: string; progress?: number }) =>
      ipcRenderer.invoke('anima:statusCenter:setState', params),
    uploadTrayIcon: (params: { state: 'idle' | 'running' | 'waiting_user' | 'done' | 'error'; size?: 22; sourcePath: string }) =>
      ipcRenderer.invoke('anima:statusCenter:uploadTrayIcon', params),
    uploadTrayFrame: (params: { state?: 'idle' | 'running' | 'waiting_user' | 'done' | 'error'; sourcePath: string }) =>
      ipcRenderer.invoke('anima:statusCenter:uploadTrayFrame', params),
    reloadIcons: () => ipcRenderer.invoke('anima:statusCenter:reloadIcons')
  },
  preview: {
    openExternal: (url: string) => ipcRenderer.invoke('preview:openExternal', url),
    onServerDetected: (callback: (payload: { url: string; terminalId?: string }) => void) => {
      const channel = 'preview:serverDetected'
      const subscription = (_: any, payload: { url: string; terminalId?: string }) => callback(payload)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
  },
  update: {
    getState: () => ipcRenderer.invoke('anima:update:getState'),
    check: (opts?: { interactive?: boolean }) => ipcRenderer.invoke('anima:update:check', opts),
    download: () => ipcRenderer.invoke('anima:update:download'),
    quitAndInstall: () => ipcRenderer.invoke('anima:update:quitAndInstall'),
    onState: (callback: (state: any) => void) => {
      const channel = 'anima:update:state'
      const subscription = (_: any, state: any) => callback(state)
      ipcRenderer.on(channel, subscription)
      return () => ipcRenderer.removeListener(channel, subscription)
    }
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('anima:shell:openPath', path)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('anima', animaAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  const w = window as any
  w.electron = electronAPI
  w.anima = animaAPI
}
