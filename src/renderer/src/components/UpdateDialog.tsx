import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUpdateStore } from '../store/useUpdateStore'

function formatPercent(v: number | undefined): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return ''
  const clamped = Math.max(0, Math.min(100, v))
  return `${clamped.toFixed(0)}%`
}

function toNotesText(raw: string | undefined): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  return s
}

export function UpdateDialog() {
  const dialogOpen = useUpdateStore((s) => s.dialogOpen)
  const setDialogOpen = useUpdateStore((s) => s.setDialogOpen)
  const updateState = useUpdateStore((s) => s.state)
  const [actionLoading, setActionLoading] = useState(false)

  const t = useMemo(() => {
    return {
      title: '软件更新',
      found: '发现新版本可用',
      upToDate: '当前已是最新版本',
      error: '更新失败',
      cancel: '取消',
      later: '稍后',
      downloadNow: '立即下载',
      downloading: '下载中…',
      downloaded: '下载完成！准备安装。',
      restartNow: '立即重启'
    }
  }, [])

  const status = updateState?.status || 'disabled'
  const currentVersion = updateState?.currentVersion || ''
  const availableVersion = updateState?.availableVersion || ''
  const notesText = toNotesText(updateState?.releaseNotes)
  const percent = updateState?.progress?.percent

  const headline =
    status === 'available' || status === 'downloading' || status === 'downloaded'
      ? t.found
      : status === 'not-available' || status === 'idle'
        ? t.upToDate
        : status === 'error'
          ? t.error
          : ''

  const handleCheck = async () => {
    if (!window.anima?.update?.check) return
    setActionLoading(true)
    try {
      await window.anima.update.check({ interactive: true })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!window.anima?.update?.download) return
    setActionLoading(true)
    try {
      await window.anima.update.download()
    } finally {
      setActionLoading(false)
    }
  }

  const handleRestart = async () => {
    if (!window.anima?.update?.quitAndInstall) return
    setActionLoading(true)
    try {
      await window.anima.update.quitAndInstall()
    } finally {
      setActionLoading(false)
    }
  }

  useEffect(() => {
    if (!dialogOpen) return
    if (!window.anima?.update?.getState) return
    void window.anima.update.getState().catch(() => {})
  }, [dialogOpen])

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
        </DialogHeader>

        {headline ? <div className="text-sm text-muted-foreground">{headline}</div> : null}

        {currentVersion || availableVersion ? (
          <div className="mt-2 flex items-center gap-3 text-sm font-mono">
            <span className="px-2 py-1 rounded-md bg-muted">{currentVersion || '--'}</span>
            <span className="text-muted-foreground">→</span>
            <span className="px-2 py-1 rounded-md bg-muted">{availableVersion || '--'}</span>
          </div>
        ) : null}

        {notesText ? (
          <div className="mt-4 rounded-lg border border-black/5 dark:border-white/10 bg-secondary/10 p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">更新内容</div>
            <div className="text-sm whitespace-pre-wrap leading-6 max-h-[260px] overflow-auto">{notesText}</div>
          </div>
        ) : null}

        {status === 'downloading' ? (
          <div className="mt-4 rounded-lg border border-emerald-500/15 bg-emerald-500/10 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-emerald-700 dark:text-emerald-300">{t.downloading}</span>
              <span className="text-emerald-700/80 dark:text-emerald-300/80">{formatPercent(percent)}</span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-emerald-500/15 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, typeof percent === 'number' ? percent : 0))}%` }}
              />
            </div>
          </div>
        ) : null}

        {status === 'downloaded' ? (
          <div className="mt-4 rounded-lg border border-emerald-500/15 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            {t.downloaded}
          </div>
        ) : null}

        {status === 'error' && updateState?.error ? (
          <div className="mt-4 rounded-lg border border-destructive/15 bg-destructive/10 p-3 text-sm text-destructive whitespace-pre-wrap">
            {String(updateState.error || '')}
          </div>
        ) : null}

        <DialogFooter className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleCheck} disabled={actionLoading || status === 'disabled'}>
              检查更新
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {status === 'downloaded' ? (
              <>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={actionLoading}>
                  {t.later}
                </Button>
                <Button onClick={handleRestart} disabled={actionLoading}>
                  {t.restartNow}
                </Button>
              </>
            ) : status === 'available' ? (
              <>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={actionLoading}>
                  {t.cancel}
                </Button>
                <Button onClick={handleDownload} disabled={actionLoading}>
                  {t.downloadNow}
                </Button>
              </>
            ) : status === 'downloading' ? (
              <>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={actionLoading}>
                  {t.cancel}
                </Button>
                <Button disabled>{t.downloading}</Button>
              </>
            ) : (
              <Button onClick={() => setDialogOpen(false)} disabled={actionLoading}>
                {t.cancel}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

