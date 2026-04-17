import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Button } from '@/components/ui/button'
import { Plus, X } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { i18nText, resolveAppLang } from '@/i18n'

type TerminalTab = {
  id: string
  title: string
}

export const TerminalPanel: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const projects = useStore((s) => s.settings?.projects)
  const workspaceDirSetting = useStore((s) => s.settings?.workspaceDir)
  const activeProjectId = useStore((s) => s.ui.activeProjectId)
  const workspaceDir = useMemo(() => {
    const list = Array.isArray(projects) ? (projects as any[]) : []
    const pid = String(activeProjectId || '').trim()
    const activeProjectDir = pid
      ? String((list.find((p) => String(p?.id || '').trim() === pid) as any)?.dir || '').trim()
      : ''
    return activeProjectDir || workspaceDirSetting || undefined
  }, [activeProjectId, projects, workspaceDirSetting])
  const lang = resolveAppLang(useStore((s) => s.settings?.language))

  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const tabsRef = useRef<TerminalTab[]>([])

  const terminalMapRef = useRef(new Map<string, Terminal>())
  const fitAddonMapRef = useRef(new Map<string, FitAddon>())
  const cleanupMapRef = useRef(new Map<string, () => void>())

  const openIfNeeded = (id: string, el: HTMLDivElement | null) => {
    if (!active) return
    if (!el) return
    if (terminalMapRef.current.has(id)) return

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 12,
      fontFamily:
        "'JetBrainsMono Nerd Font', 'JetBrainsMono Nerd Font Mono', 'MesloLGS NF', 'MesloLGS Nerd Font', 'Symbols Nerd Font', 'Symbols Nerd Font Mono', 'JetBrains Mono', 'Menlo', monospace",
      theme: { background: '#1e1e1e' },
      allowProposedApi: false
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)
    fitAddon.fit()

    terminalMapRef.current.set(id, term)
    fitAddonMapRef.current.set(id, fitAddon)

    term.onData((data) => {
      window.anima.terminal.write({ id, data })
    })

    const cleanup = window.anima.terminal.onData(id, (data) => {
      term.write(data)
    })
    cleanupMapRef.current.set(id, cleanup)

    window.anima.terminal.resize({ id, cols: term.cols, rows: term.rows })
  }

  const createTerminal = async () => {
    const res = await window.anima.terminal.create({ cwd: workspaceDir })
    if (!res.ok || !res.id) return

    setTabs((prev) => {
      const next = [...prev, { id: res.id!, title: i18nText(lang, 'terminal.tabTitle', { index: prev.length + 1 }) }]
      return next
    })
    setActiveId(res.id)
  }

  const closeTerminal = (id: string) => {
    const cleanup = cleanupMapRef.current.get(id)
    cleanup?.()
    cleanupMapRef.current.delete(id)

    const term = terminalMapRef.current.get(id)
    term?.dispose()
    terminalMapRef.current.delete(id)

    fitAddonMapRef.current.delete(id)
    window.anima.terminal.kill(id)

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeIdRef.current === id) setActiveId(next[0]?.id ?? null)
      return next
    })
  }

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    const handleResize = () => {
      if (!active) return
      if (!activeId) return
      const fitAddon = fitAddonMapRef.current.get(activeId)
      const term = terminalMapRef.current.get(activeId)
      if (!fitAddon || !term) return
      fitAddon.fit()
      window.anima.terminal.resize({ id: activeId, cols: term.cols, rows: term.rows })
    }

    if (!active) return
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [active, activeId])

  useEffect(() => {
    const cleanupMap = cleanupMapRef.current
    const terminalMap = terminalMapRef.current
    const fitAddonMap = fitAddonMapRef.current

    return () => {
      for (const t of tabsRef.current) {
        const cleanup = cleanupMap.get(t.id)
        cleanup?.()
        cleanupMap.delete(t.id)

        const term = terminalMap.get(t.id)
        term?.dispose()
        terminalMap.delete(t.id)
        fitAddonMap.delete(t.id)
        window.anima.terminal.kill(t.id)
      }
    }
  }, [])

  const hasActive = Boolean(activeId)

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="h-8 flex items-center justify-between px-2 bg-[#252526] border-b border-[#333]">
        <div className="flex items-center gap-1 min-w-0">
          {tabs.map((t) => {
            const active = t.id === activeId
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs min-w-0 ${
                  active ? 'bg-[#1e1e1e] text-gray-200' : 'text-gray-400 hover:bg-[#333]'
                }`}
                title={t.title}
              >
                <span className="truncate">{t.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTerminal(t.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      closeTerminal(t.id)
                    }
                  }}
                  className="shrink-0 p-0.5 rounded hover:bg-[#444]"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            )
          })}
          {tabs.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-[#333] text-gray-400"
              onClick={() => void createTerminal()}
              title={i18nText(lang, 'terminal.create')}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        {tabs.length === 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-[#333] text-gray-400"
            onClick={() => void createTerminal()}
            title={i18nText(lang, 'terminal.create')}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {tabs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="text-xs text-gray-400">{i18nText(lang, 'terminal.noActive')}</div>
            <Button size="sm" variant="secondary" onClick={() => void createTerminal()}>
              <Plus className="w-4 h-4 mr-2" />
              {i18nText(lang, 'terminal.create')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 relative overflow-hidden">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`absolute inset-0 p-1 ${t.id === activeId ? 'block' : 'hidden'}`}
            >
              <div className="w-full h-full overflow-hidden" ref={(el) => openIfNeeded(t.id, el)} />
            </div>
          ))}
          {!hasActive && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
              {i18nText(lang, 'terminal.noActive')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
