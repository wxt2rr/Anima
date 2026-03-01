/// <reference types="vite/client" />

import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    anima: {
      backend: {
        getBaseUrl: () => Promise<{ ok: boolean; baseUrl: string }>
      }
      window: {
        openSettings: () => Promise<{ ok: boolean }>
        pickFiles: () => Promise<{ ok: boolean; canceled: boolean; paths: string[] }>
        pickDirectory: () => Promise<{ ok: boolean; canceled: boolean; path: string }>
      }
      fs: {
        readDir: (path: string) => Promise<{ ok: boolean; files?: Array<{ name: string; isDirectory: boolean; path: string }>; error?: string }>
        readFile: (path: string) => Promise<{ ok: boolean; content?: string; error?: string }>
        getCwd: () => Promise<{ ok: boolean; cwd?: string; error?: string }>
      }
      git: {
        checkIsRepo: (cwd: string) => Promise<{ ok: boolean; isRepo?: boolean; error?: string }>
        init: (cwd: string) => Promise<{ ok: boolean; error?: string }>
        getBranches: (cwd: string) => Promise<{ ok: boolean; branches?: string[]; current?: string; error?: string }>
        checkout: (params: { cwd: string; branch: string }) => Promise<{ ok: boolean; error?: string }>
        status: (cwd: string) => Promise<{ ok: boolean; status?: any; error?: string }>
        commit: (params: { cwd: string; message: string; files?: string[] }) => Promise<{ ok: boolean; result?: any; error?: string }>
        add: (params: { cwd: string; files: string[] }) => Promise<{ ok: boolean; error?: string }>
        unstage: (params: { cwd: string; files: string[] }) => Promise<{ ok: boolean; error?: string }>
        getStashes: (cwd: string) => Promise<{ ok: boolean; stashes?: any[]; error?: string }>
        getLog: (cwd: string) => Promise<{ ok: boolean; logs?: any[]; error?: string }>
        diff: (params: { cwd: string; file: string }) => Promise<{ ok: boolean; diff?: string; error?: string }>
      }
      terminal: {
        create: (params?: { cwd?: string; shellPath?: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
        resize: (params: { id: string; cols: number; rows: number }) => void
        write: (params: { id: string; data: string }) => void
        kill: (id: string) => void
        onData: (id: string, callback: (data: string) => void) => () => void
      }
      preview: {
        openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
        onServerDetected: (callback: (payload: { url: string; terminalId?: string }) => void) => () => void
      }
      update: {
        getState: () => Promise<{ ok: boolean; state: any }>
        check: (opts?: { interactive?: boolean }) => Promise<{ ok: boolean; updateInfo?: any; error?: string }>
        download: () => Promise<{ ok: boolean; error?: string }>
        quitAndInstall: () => Promise<{ ok: boolean; error?: string }>
        onState: (callback: (state: any) => void) => () => void
      }
      shell: {
        openPath: (path: string) => Promise<{ ok: boolean; error?: string }>
      }
    }
  }
}

export {}
