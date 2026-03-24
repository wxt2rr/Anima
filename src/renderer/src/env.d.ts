/// <reference types="vite/client" />

import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    anima: {
      app: {
        getInfo: () => Promise<{ ok: boolean; name?: string; version?: string; author?: string; repositoryUrl?: string; error?: string }>
      }
      backend: {
        getBaseUrl: () => Promise<{ ok: boolean; baseUrl: string }>
      }
      window: {
        pickFiles: () => Promise<{ ok: boolean; canceled: boolean; paths: string[] }>
        pickDirectory: () => Promise<{ ok: boolean; canceled: boolean; path: string }>
        saveImageAttachment: (params: { bytes: Uint8Array | number[]; fileName?: string; workspaceDir?: string; mime?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
      }
      fs: {
        readDir: (path: string) => Promise<{ ok: boolean; files?: Array<{ name: string; isDirectory: boolean; path: string }>; error?: string }>
        readFile: (path: string) => Promise<{ ok: boolean; content?: string; error?: string }>
        readFileBinary: (path: string) => Promise<{ ok: boolean; base64?: string; mime?: string; error?: string }>
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
      acp: {
        createSession: (params: {
          workspaceDir: string
          threadId: string
          permissionMode?: 'workspace_whitelist' | 'full_access'
          approvalMode?: 'per_action' | 'per_project' | 'always'
          agent: { id: string; name?: string; kind?: 'mock' | 'native_acp' | 'adapter' | 'acpx_bridge'; command?: string; args?: string[]; env?: Record<string, string>; framing?: 'auto' | 'jsonl' | 'content_length' }
        }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>
        status: () => Promise<{ ok: boolean; sessions?: Array<{ id: string; key: string; workspaceDir: string; threadId: string; agent: any; agentInfo?: any; approvalMode: string; remoteSessionId?: string; running: boolean; pid?: number | null; uptimeMs: number; lastError?: string }>; error?: string }>
        resetApprovals: (params?: { workspaceDir?: string }) => Promise<{ ok: boolean; error?: string }>
        prompt: (params: { sessionId: string; prompt: string; runId?: string }) => Promise<{ ok: boolean; error?: string }>
        cancel: (params: { sessionId: string; runId?: string }) => Promise<{ ok: boolean; error?: string }>
        close: (params: { sessionId: string }) => Promise<{ ok: boolean; error?: string }>
        onEvent: (
          sessionId: string,
          callback: (evt: { type: string; [k: string]: any }) => void
        ) => () => void
      }
      coder: {
        configure: (params?: { settings?: any }) => Promise<{ ok: boolean; [k: string]: any }>
        autoStart: () => Promise<{ ok: boolean; [k: string]: any }>
        start: (params?: { settings?: any }) => Promise<{ ok: boolean; [k: string]: any }>
        stop: () => Promise<{ ok: boolean; error?: string }>
        status: () => Promise<{ ok: boolean; running?: boolean; pid?: number | null; startedAt?: number | null; uptimeMs?: number; lastError?: string; settings?: any; debugPortReady?: boolean; error?: string }>
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
