import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, OpenInWindow as ExternalLink, Refresh as RotateCw, Bug, Play, ZoomIn, ZoomOut } from 'iconoir-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store/useStore'
import { i18nText, resolveAppLang } from '@/i18n'

type Props = {
  initialUrl?: string
  active?: boolean
}

export const BrowserPreview: React.FC<Props> = ({ initialUrl, active = true }) => {
  const lang = resolveAppLang(useStore((s) => s.settings?.language))
  const [url, setUrl] = useState('')
  const [currentSrc, setCurrentSrc] = useState('')
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [webviewEl, setWebviewEl] = useState<any | null>(null)
  const webviewRef = useRef<any | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoomFactor, setZoomFactor] = useState(1.0)
  // Default to true to auto-fit on load
  const [autoFit, setAutoFit] = useState(true)

  const normalizeUrl = useCallback((raw: string) => {
    const text = String(raw || '').trim()
    if (!text) return ''
    if (/^https?:\/\//i.test(text)) return text
    return `http://${text}`
  }, [])

  const applyZoom = useCallback((factor: number) => {
    if (webviewRef.current) {
      try {
        webviewRef.current.setZoomFactor(factor)
        setZoomFactor(factor)
      } catch (e) {
        console.error('Failed to set zoom:', e)
      }
    }
  }, [])

  const handleFitWidth = useCallback(() => {
    if (!containerRef.current) return
    const width = containerRef.current.clientWidth
    // Assume standard desktop width is 1280px
    const targetWidth = 1280
    // If container is smaller than target, scale down
    // If container is larger, keep 100% (or scale up? usually 100% is fine)
    let factor = width / targetWidth
    // Clamp factor to reasonable limits (e.g. 0.1 to 2.0)
    factor = Math.max(0.1, Math.min(1.0, factor))
    
    applyZoom(factor)
    setZoomFactor(factor)
  }, [applyZoom])

  const handleZoomIn = useCallback(() => {
    setAutoFit(false)
    const next = Math.min(3.0, zoomFactor + 0.1)
    applyZoom(next)
  }, [zoomFactor, applyZoom])

  const handleZoomOut = useCallback(() => {
    setAutoFit(false)
    const next = Math.max(0.1, zoomFactor - 0.1)
    applyZoom(next)
  }, [zoomFactor, applyZoom])

  const handleGo = useCallback(() => {
    const target = normalizeUrl(url)
    if (!target) return
    setCurrentSrc(target)
    if (webviewRef.current) {
      try {
        webviewRef.current.loadURL(target)
      } catch {
        return
      }
    }
  }, [normalizeUrl, url])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleGo()
    },
    [handleGo]
  )

  const updateNavState = useCallback(() => {
    const wv = webviewRef.current
    if (!wv) return
    try {
      setCanBack(Boolean(wv.canGoBack?.()))
      setCanForward(Boolean(wv.canGoForward?.()))
    } catch {
      return
    }
  }, [])

  // Resize observer to handle auto-fit when sidebar resizes
  useEffect(() => {
    if (!active) return
    if (!containerRef.current || !autoFit) return
    const ro = new ResizeObserver(() => {
      if (autoFit) handleFitWidth()
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [active, autoFit, handleFitWidth])

  useEffect(() => {
    if (!active) return
    const next = String(initialUrl || '').trim()
    if (!next) return
    const normalized = normalizeUrl(next)
    setUrl(normalized)
    setCurrentSrc(normalized)
    if (webviewRef.current) {
      try {
        webviewRef.current.loadURL(normalized)
      } catch {
        return
      }
    }
  }, [active, initialUrl, normalizeUrl])

  useEffect(() => {
    if (!active) return
    if (!webviewEl) return
    const wv = webviewEl

    const handleDidStart = () => setIsLoading(true)
    const handleDidStop = () => {
      setIsLoading(false)
      updateNavState()
      // Apply auto-fit if enabled
      if (autoFit) {
        handleFitWidth()
      }
    }
    const handleNavigate = (e: any) => {
      const nextUrl = String(e?.url || '').trim()
      if (nextUrl) {
        setUrl(nextUrl)
        setCurrentSrc(nextUrl)
      }
      updateNavState()
    }

    wv.addEventListener('did-start-loading', handleDidStart)
    wv.addEventListener('did-stop-loading', handleDidStop)
    wv.addEventListener('did-navigate', handleNavigate)
    wv.addEventListener('did-navigate-in-page', handleNavigate)

    updateNavState()

    return () => {
      wv.removeEventListener('did-start-loading', handleDidStart)
      wv.removeEventListener('did-stop-loading', handleDidStop)
      wv.removeEventListener('did-navigate', handleNavigate)
      wv.removeEventListener('did-navigate-in-page', handleNavigate)
    }
  }, [active, updateNavState, webviewEl, autoFit, handleFitWidth])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    if (!active) {
      try {
        wv.setAudioMuted?.(true)
      } catch {
        return
      }
      try {
        wv.stop?.()
      } catch {
        return
      }
      return
    }
    try {
      wv.setAudioMuted?.(false)
    } catch {
      return
    }
    updateNavState()
    if (autoFit) handleFitWidth()
  }, [active, autoFit, handleFitWidth, updateNavState])

  const attachWebviewRef = useCallback((el: any | null) => {
    webviewRef.current = el
    setWebviewEl(el)
  }, [])

  const hasSrc = Boolean(currentSrc)

  const canControl = useMemo(() => Boolean(webviewEl && hasSrc), [hasSrc, webviewEl])

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="h-10 px-2 flex items-center gap-1 border-b border-black/5 bg-white shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={!String(url || '').trim()}
          onClick={handleGo}
          title={i18nText(lang, 'browserPreview.go')}
        >
          <Play className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={!canControl || !canBack}
          onClick={() => webviewRef.current?.goBack?.()}
          title={i18nText(lang, 'browserPreview.back')}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={!canControl || !canForward}
          onClick={() => webviewRef.current?.goForward?.()}
          title={i18nText(lang, 'browserPreview.forward')}
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={!canControl}
          onClick={() => webviewRef.current?.reload?.()}
          title={i18nText(lang, 'browserPreview.refresh')}
        >
          <RotateCw className="w-3.5 h-3.5" />
        </Button>
        
        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5 px-1 border-l border-r border-black/10 mx-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={!canControl}
            onClick={handleZoomOut}
            title={i18nText(lang, 'browserPreview.zoomOut')}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] min-w-[36px] font-mono tabular-nums"
            disabled={!canControl}
            onClick={() => {
              if (autoFit) {
                // Toggle off auto-fit -> reset to 100%
                setAutoFit(false)
                applyZoom(1.0)
              } else {
                // Toggle on auto-fit
                setAutoFit(true)
                handleFitWidth()
              }
            }}
            title={autoFit ? i18nText(lang, 'browserPreview.autoFitReset') : i18nText(lang, 'browserPreview.clickAutoFit')}
          >
            {Math.round(zoomFactor * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={!canControl}
            onClick={handleZoomIn}
            title={i18nText(lang, 'browserPreview.zoomIn')}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Input
          className="h-7 text-xs flex-1 ml-1"
          placeholder={i18nText(lang, 'browserPreview.urlPlaceholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={!hasSrc}
          onClick={async () => {
            const target = normalizeUrl(url || currentSrc)
            if (!target) return
            await window.anima.preview.openExternal(target)
          }}
          title={i18nText(lang, 'browserPreview.openInBrowser')}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={!canControl}
          onClick={() => webviewRef.current?.openDevTools?.()}
          title={i18nText(lang, 'browserPreview.openDevtools')}
        >
          <Bug className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="flex-1 relative bg-white" ref={containerRef}>
        {hasSrc ? (
          <>
            {React.createElement('webview' as any, {
              ref: attachWebviewRef,
              src: currentSrc,
              className: 'w-full h-full',
              allowpopups: 'true'
            })}
            {isLoading && (
              <div className="absolute top-2 right-2 text-[10px] text-muted-foreground bg-white border border-black/10 rounded px-2 py-1">
                {i18nText(lang, 'common.loading')}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2">
            <p className="text-sm">{i18nText(lang, 'browserPreview.ready')}</p>
            <Button size="sm" onClick={handleGo}>
              {i18nText(lang, 'browserPreview.startPreview')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
