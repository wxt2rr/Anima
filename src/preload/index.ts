import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const animaAPI = {
  backend: {
    getBaseUrl: () => ipcRenderer.invoke('anima:backend:getBaseUrl')
  },
  window: {
    openSettings: () => ipcRenderer.invoke('anima:window:openSettings'),
    pickFiles: () => ipcRenderer.invoke('anima:dialog:pickFiles'),
    pickDirectory: () => ipcRenderer.invoke('anima:dialog:pickDirectory')
  },
  fs: {
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
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
