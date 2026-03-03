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
        openSettings: () => Promise<{ ok: boolean }>
        pickFiles: () => Promise<{ ok: boolean; canceled: boolean; paths: string[] }>
        pickDirectory: () => Promise<{ ok: boolean; canceled: boolean; path: string }>
      }
      fs: {
        readDir: (path: string) => Promise<{ ok: boolean; files?: Array<{ name: string; isDirectory: boolean; path: string }>; error?: string }>
        readFile: (path: string) => Promise<{ ok: boolean; content?: string; error?: string }>
        readFileBinary: (path: string) => Promise<{ ok: boolean; base64?: string; mime?: string; error?: string }>
      }
      git: {
        status: (cwd: string) => Promise<{ ok: boolean; status?: any; error?: string }>
        commit: (params: { cwd: string; message: string; files?: string[] }) => Promise<{ ok: boolean; result?: any; error?: string }>
        diff: (params: { cwd: string; file: string }) => Promise<{ ok: boolean; diff?: string; error?: string }>
      }
      terminal: {
        create: (params?: { cwd?: string; shellPath?: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
        resize: (params: { id: string; cols: number; rows: number }) => void
        write: (params: { id: string; data: string }) => void
        kill: (id: string) => void
        onData: (id: string, callback: (data: string) => void) => () => void
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
