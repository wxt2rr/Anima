import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUpdateStore } from '../store/useUpdateStore'
import { useStore } from '../store/useStore'
import { i18nText, resolveAppLang } from '@/i18n'

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
  const lang = resolveAppLang(useStore((s) => s.settings?.language))
  const dialogOpen = useUpdateStore((s) => s.dialogOpen)
  const setDialogOpen = useUpdateStore((s) => s.setDialogOpen)
  const updateState = useUpdateStore((s) => s.state)
  const [actionLoading, setActionLoading] = useState(false)

  const t = useMemo(() => {
    return {
      title: i18nText(lang, 'update.title'),
      found: i18nText(lang, 'update.found'),
      upToDate: i18nText(lang, 'update.upToDate'),
      error: i18nText(lang, 'update.error'),
      cancel: i18nText(lang, 'update.cancel'),
      later: i18nText(lang, 'update.later'),
      downloadNow: i18nText(lang, 'update.downloadNow'),
      downloading: i18nText(lang, 'update.downloading'),
      downloaded: i18nText(lang, 'update.downloaded'),
      restartNow: i18nText(lang, 'update.restartNow')
    }
  }, [lang])

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
            <div className="text-xs font-medium text-muted-foreground mb-2">{i18nText(lang, 'update.releaseNotes')}</div>
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
          <span />

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
