import { create } from 'zustand'

export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export type UpdateProgress = {
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
}

export type UpdateState = {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
  lastCheckedAt?: number
}

type UpdateStore = {
  dialogOpen: boolean
  state: UpdateState | null
  setDialogOpen: (open: boolean) => void
  setState: (next: UpdateState) => void
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  dialogOpen: false,
  state: null,
  setDialogOpen: (open) => set({ dialogOpen: open }),
  setState: (next) => set({ state: next })
}))

