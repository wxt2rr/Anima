import {
  InputSearch as Search,
  Trash as Trash2,
  MessageText as MessageCircle,
  SidebarCollapse as PanelLeftClose,
  MoreHoriz as MoreHorizontal,
  Settings,
  Folder,
  Folder as FolderOpen,
  FolderPlus,
  NavArrowRight as ChevronRight,
  Star,
  EditPencil as Pencil,
  Clock as Clock3,
  MagicWand as Sparkles,
  Send,
  Laptop as Monitor
} from 'iconoir-react'
import { useEffect, useMemo, useRef, useState, memo, type MouseEvent } from 'react'
import { useStore } from '../store/useStore'
import { useUpdateStore } from '../store/useUpdateStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AppShellLeftPane } from '@/components/layout/AppShellLeftPane'
import { i18nText, resolveAppLang } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export const ChatHistoryPanel = memo(function ChatHistoryPanel({
  onOpenSettings,
  width = 288,
  onResizeStart
}: {
  onOpenSettings?: () => void
  width?: number
  onResizeStart?: (e: MouseEvent<HTMLDivElement>) => void
}) {
  const {
    chats,
    activeChatId,
    createChat,
    createChatInProject,
    setActiveChat,
    deleteChat,
    deleteProject,
    addProject,
    renameProject,
    togglePinProject,
    setActiveProject,
    toggleProjectCollapsed,
    settings,
    ui,
    setActiveTab,
    setSidebarSearchQuery,
    toggleSidebarCollapsed,
    toggleSidebarSearch
  } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null)
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null)
  const updateState = useUpdateStore((s) => s.state)
  const setUpdateDialogOpen = useUpdateStore((s) => s.setDialogOpen)
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const reduceMotion = useReducedMotion()
  const deleteChatTimerRef = useRef<number | null>(null)
  const lang = resolveAppLang(settings?.language)

  const t = useMemo(
    () => ({
      newChat: i18nText(lang, 'chatHistory.newChat'),
      newProject: i18nText(lang, 'chatHistory.newProject'),
      addProject: i18nText(lang, 'chatHistory.addProject'),
      emptyProjects: i18nText(lang, 'chatHistory.emptyProjects'),
      emptyProjectsHint: i18nText(lang, 'chatHistory.emptyProjectsHint'),
      emptyChats: i18nText(lang, 'chatHistory.emptyChats'),
      projectSection: i18nText(lang, 'chatHistory.projectSection'),
      chatSection: i18nText(lang, 'chatHistory.chatSection'),
      untitled: i18nText(lang, 'chatHistory.untitled'),
      search: i18nText(lang, 'chatHistory.search'),
      collapseSidebar: i18nText(lang, 'chatHistory.collapseSidebar'),
      searchChats: i18nText(lang, 'chatHistory.searchChats'),
      addProjectTip: i18nText(lang, 'chatHistory.addProjectTip'),
      createChatTip: i18nText(lang, 'chatHistory.createChatTip'),
      projectMenuTip: i18nText(lang, 'chatHistory.projectMenuTip'),
      deleteChatTip: i18nText(lang, 'chatHistory.deleteChatTip'),
      deleteProject: i18nText(lang, 'chatHistory.deleteProject'),
      deleteProjectTitle: i18nText(lang, 'chatHistory.deleteProjectTitle'),
      deleteProjectDesc: i18nText(lang, 'chatHistory.deleteProjectDesc'),
      deleteTitle: i18nText(lang, 'chatHistory.deleteTitle'),
      deleteDesc: i18nText(lang, 'chatHistory.deleteDesc'),
      cancel: i18nText(lang, 'chatHistory.cancel'),
      ok: i18nText(lang, 'chatHistory.ok'),
      delete: i18nText(lang, 'chatHistory.delete'),
      settings: i18nText(lang, 'chatHistory.settings'),
      renameProject: i18nText(lang, 'chatHistory.renameProject'),
      projectName: i18nText(lang, 'chatHistory.projectName'),
      pin: i18nText(lang, 'chatHistory.pin'),
      unpin: i18nText(lang, 'chatHistory.unpin'),
      createChat: i18nText(lang, 'chatHistory.createChat'),
      update: i18nText(lang, 'chatHistory.update'),
      skills: i18nText(lang, 'chatHistory.skills')
    }),
    [lang]
  )

  useEffect(() => {
    if (ui.sidebarCollapsed) return
    if (!ui.sidebarSearchOpen) return
    inputRef.current?.focus()
  }, [ui.sidebarCollapsed, ui.sidebarSearchOpen])

  useEffect(() => {
    return () => {
      if (deleteChatTimerRef.current != null) {
        window.clearTimeout(deleteChatTimerRef.current)
        deleteChatTimerRef.current = null
      }
    }
  }, [])

  const visibleChats = useMemo(() => {
    const q = (ui.sidebarSearchQuery || '').trim().toLowerCase()
    if (!q) return chats
    return chats.filter((c) => (c.title || '').toLowerCase().includes(q))
  }, [chats, ui.sidebarSearchQuery])

  const projects = useMemo(() => {
    const arr = Array.isArray(settings?.projects) ? settings!.projects : []
    const copy = [...arr]
    copy.sort((a, b) => {
      const ap = a.pinned ? 1 : 0
      const bp = b.pinned ? 1 : 0
      if (ap !== bp) return bp - ap
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    return copy
  }, [settings])

  const chatsByProjectId = useMemo(() => {
    const by: Record<string, typeof visibleChats> = {}
    for (const c of visibleChats) {
      const pid = String((c as any)?.meta?.projectId || '').trim() || '__unassigned__'
      if (!by[pid]) by[pid] = []
      by[pid].push(c)
    }
    for (const pid of Object.keys(by)) {
      by[pid].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    }
    return by
  }, [visibleChats])
  const unassignedChats = chatsByProjectId['__unassigned__'] || []
  const clampTitle = (raw: string, maxChars = 18): string => {
    const chars = Array.from(String(raw || ''))
    if (chars.length <= maxChars) return chars.join('')
    return `${chars.slice(0, maxChars).join('')}...`
  }

  const renderChatRows = (list: typeof visibleChats) => (
    <div className="mt-1 space-y-0.5">
      <AnimatePresence initial={false}>
        {list.map((chat) => {
          const active = chat.id === activeChatId
          const title = (chat.title || '').trim() || t.untitled
          const displayTitle = clampTitle(title)
          const source = String((chat as any)?.meta?.source || '').trim().toLowerCase()
          const isTelegram = source === 'telegram'
          const isPendingDelete = pendingDeleteChatId === chat.id
          return (
            <motion.div
              key={chat.id}
              layout
              initial={false}
              animate={reduceMotion ? { opacity: 1 } : isPendingDelete ? { opacity: 0.7, x: 8, scale: 0.98 } : { opacity: 1, x: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 90, y: -14, rotate: 6, scale: 0.72, filter: 'blur(6px)' }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      duration: 0.52,
                      ease: [0.22, 1, 0.36, 1],
                      layout: { duration: 0.38, ease: [0.22, 1, 0.36, 1] }
                    }
              }
            >
              <div
                onClick={() => void setActiveChat(chat.id)}
                className={`group relative flex items-center gap-2 pl-2.5 pr-0 py-1 cursor-pointer transition-all duration-200 ${
                  active ? 'rounded-xl bg-black/5 text-foreground' : 'rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground'
                }`}
              >
                <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center text-foreground/70" aria-hidden="true">
                  {isTelegram ? <Send className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                </span>
                <span className="block truncate text-[13px] flex-1 min-w-0 leading-5 text-foreground" title={title}>
                  {displayTitle}
                </span>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteId(chat.id)
                        }}
                        className="h-6 w-6 rounded-lg transition-all text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t.deleteChatTip}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )

  const pickAndAddProject = async () => {
    const res = await window.anima?.window?.pickDirectory?.()
    if (!res?.ok || res.canceled) return
    const dir = String(res.path || '').trim()
    if (!dir) return
    await addProject(dir)
  }

  const beginRenameProject = (projectId: string) => {
    const p = projects.find((x) => x.id === projectId)
    if (!p) return
    setRenameTargetId(projectId)
    setRenameDraft(String(p.name || '').trim())
  }

  const commitRenameProject = () => {
    if (!renameTargetId) return
    const next = String(renameDraft || '').trim()
    if (!next) return
    renameProject(renameTargetId, next)
    setRenameTargetId(null)
    setRenameDraft('')
  }

  const showUpdateEntry = useMemo(() => {
    const st = updateState?.status
    return st === 'available' || st === 'downloading' || st === 'downloaded'
  }, [updateState?.status])

  return (
    <AppShellLeftPane
      width={width}
      collapsed={ui.sidebarCollapsed}
      bleedPx={12}
      showResizeHandle
      resizeInteractive={!ui.sidebarCollapsed}
      onResizeStart={onResizeStart}
      className="rounded-none"
    >
      <TooltipProvider delayDuration={300}>
      <div className="[&_svg.lucide]:h-4 [&_svg.lucide]:w-4 [&_svg.lucide]:[stroke-width:1.75] [&_svg.lucide]:transition-colors [&_svg.lucide]:duration-150">
      {/* Header Area */}
      <div className="h-[var(--app-left-pane-header-height)] flex items-center justify-between px-[var(--app-left-pane-pad-x)] shrink-0 draggable">
        <div className="w-[var(--app-left-pane-leading-safe)] h-full" />
        <div className="flex items-center gap-[var(--app-left-pane-header-btn-gap)] no-drag">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebarCollapsed}
                className="h-[var(--app-left-pane-header-btn-size)] w-[var(--app-left-pane-header-btn-size)] rounded-[var(--app-left-pane-header-btn-radius)]"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.collapseSidebar}</TooltipContent>
          </Tooltip>
          {showUpdateEntry ? (
            <button
              className="h-7 px-2.5 rounded-full bg-blue-500 text-white text-[11px] font-medium leading-none hover:bg-blue-600 transition-colors"
              onClick={() => setUpdateDialogOpen(true)}
            >
              {t.update}
            </button>
          ) : null}
        </div>
      </div>

      <div className="pl-[calc(var(--app-left-pane-pad-x)-6px)] pr-[var(--app-left-pane-pad-x)] pb-2 space-y-0.5">
        <button
          type="button"
          className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-foreground/85 hover:bg-black/5 transition-colors text-left"
          onClick={() => void createChat()}
        >
          <MessageCircle className="w-3.5 h-3.5 text-foreground/65" />
          <span>{t.newChat}</span>
        </button>
        <button
          type="button"
          className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-foreground/85 hover:bg-black/5 transition-colors text-left"
          onClick={toggleSidebarSearch}
        >
          <Clock3 className="w-3.5 h-3.5 text-foreground/65" />
          <span>{t.search}</span>
        </button>
        <button
          type="button"
          className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-foreground/85 hover:bg-black/5 transition-colors text-left"
          onClick={() => {
            setActiveTab('skills')
            onOpenSettings?.()
          }}
        >
          <Sparkles className="w-3.5 h-3.5 text-foreground/65" />
          <span>{t.skills}</span>
        </button>
      </div>
      {/* Search Bar */}
      {!ui.sidebarCollapsed && ui.sidebarSearchOpen && (
        <div className="pl-[calc(var(--app-left-pane-pad-x)-6px)] pr-[var(--app-left-pane-pad-x)] pb-2 animate-in slide-in-from-top-2 duration-200">
           <div className="relative group">
            <Search className="w-3.5 h-3.5 text-muted-foreground/70 absolute left-2.5 top-1/2 -translate-y-1/2 z-10" />
            <Input
              ref={inputRef}
              value={ui.sidebarSearchQuery}
              onChange={(e) => setSidebarSearchQuery(e.target.value)}
              placeholder={t.search}
              className="w-full h-8 pl-8 pr-3 text-sm bg-black/5 dark:bg-white/5 border-transparent focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring transition-all placeholder:text-muted-foreground/50 shadow-none"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pl-[calc(var(--app-left-pane-pad-x)-6px)] pr-[var(--app-left-pane-pad-x)] pb-12 space-y-1 scrollbar-none">
        <div className="space-y-3">
          <div className="pt-1">
            <div className="flex items-center justify-between text-[12px] text-muted-foreground/90">
              <span className="tracking-wide ml-2.5">{t.chatSection}</span>
              <div className="w-[76px] flex items-center justify-end gap-1">
                <button
                  type="button"
                  className="h-6 w-6 rounded-md hover:bg-black/5 flex items-center justify-center"
                  onClick={() => {
                    setActiveProject('')
                    void createChat()
                  }}
                  title={t.createChatTip}
                >
                  <MessageCircle className="w-3.5 h-3.5 text-foreground/65" />
                </button>
              </div>
            </div>
            {unassignedChats.length > 0 ? renderChatRows(unassignedChats) : null}
            {unassignedChats.length === 0 ? <div className="mt-1 px-2.5 text-xs text-muted-foreground text-center">{t.emptyChats}</div> : null}
          </div>

          <div>
            <div className="flex items-center justify-between text-[12px] text-muted-foreground/90">
              <span className="tracking-wide ml-2.5">{t.projectSection}</span>
              <div className="w-[76px] flex items-center justify-end gap-1">
                <button
                  type="button"
                  className="h-6 w-6 rounded-md hover:bg-black/5 flex items-center justify-center"
                  onClick={() => void pickAndAddProject()}
                  title={t.addProjectTip}
                >
                  <FolderPlus className="w-3.5 h-3.5 text-foreground/65" />
                </button>
              </div>
            </div>
            {projects.length === 0 ? <div className="mt-1 px-2.5 text-xs text-muted-foreground text-center">{t.emptyChats}</div> : null}
          </div>

          {projects.map((p) => {
            const pid = p.id
            const collapsed = (ui.collapsedProjectIds || []).includes(pid)
            const activeProject = ui.activeProjectId === pid
            const list = chatsByProjectId[pid] || []
            const hasChats = list.length > 0

            return (
              <div key={pid}>
                <div
                  className={`group flex items-center gap-2 pl-2.5 pr-0 py-1.5 rounded-md transition-all ${
                    activeProject ? 'text-foreground' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground'
                  }`}
                >
                  <button
                    type="button"
                    className="flex items-center justify-start gap-2 flex-1 min-w-0 cursor-pointer text-left"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveProject(pid)
                      toggleProjectCollapsed(pid)
                    }}
                  >
                    <span className="w-3.5 h-3.5 shrink-0">
                      {collapsed ? <Folder className="w-3.5 h-3.5 text-foreground/70" /> : <FolderOpen className="w-3.5 h-3.5 text-foreground/70" />}
                    </span>
                    <span className="truncate text-[13px] flex-1 leading-5 font-medium text-left">{p.name}</span>
                  </button>

                  <div className="w-[76px] flex items-center justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={`h-6 w-6 rounded-lg transition-all hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center ${
                            p.pinned ? 'text-primary' : 'text-muted-foreground'
                          } ${projectMenuOpenId === pid ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            togglePinProject(pid)
                          }}
                        >
                          <Star className={`w-3.5 h-3.5 ${p.pinned ? 'fill-current' : ''}`} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{p.pinned ? t.unpin : t.pin}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={`h-6 w-6 rounded-lg transition-all text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground flex items-center justify-center ${
                            projectMenuOpenId === pid ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void createChatInProject(pid)
                          }}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t.createChatTip}</TooltipContent>
                    </Tooltip>

                    <Popover open={projectMenuOpenId === pid} onOpenChange={(open) => setProjectMenuOpenId(open ? pid : null)}>
                      <PopoverTrigger
                        className={`h-6 w-6 rounded-lg transition-all text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground flex items-center justify-center ${
                          projectMenuOpenId === pid ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </PopoverTrigger>
                      <PopoverContent className="w-44 p-1" align="end">
                        <button
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                          onClick={() => {
                            setProjectMenuOpenId(null)
                            beginRenameProject(pid)
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>{t.renameProject}</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                          onClick={() => {
                            setProjectMenuOpenId(null)
                            togglePinProject(pid)
                          }}
                        >
                          <Star className="w-3.5 h-3.5" />
                          <span>{p.pinned ? t.unpin : t.pin}</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                          onClick={() => {
                            setProjectMenuOpenId(null)
                            void createChatInProject(pid)
                          }}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>{t.createChat}</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left text-destructive"
                          onClick={() => {
                            setProjectMenuOpenId(null)
                            setDeleteProjectId(pid)
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{t.deleteProject}</span>
                        </button>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {!collapsed ? (
                    <motion.div
                      key={`${pid}-body`}
                      initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {hasChats ? renderChatRows(list) : null}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      </div>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deleteTitle}</DialogTitle>
            <DialogDescription>{t.deleteDesc}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const targetId = String(deleteId || '').trim()
                setDeleteId(null)
                if (!targetId) return
                setPendingDeleteChatId(targetId)
                if (deleteChatTimerRef.current != null) {
                  window.clearTimeout(deleteChatTimerRef.current)
                }
                deleteChatTimerRef.current = window.setTimeout(() => {
                  deleteChat(targetId)
                  setPendingDeleteChatId(null)
                  deleteChatTimerRef.current = null
                }, 260)
              }}
            >
              {t.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteProjectId} onOpenChange={(open) => !open && setDeleteProjectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deleteProjectTitle}</DialogTitle>
            <DialogDescription>{t.deleteProjectDesc}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProjectId(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteProjectId) void deleteProject(deleteProjectId)
                setDeleteProjectId(null)
              }}
            >
              {t.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTargetId} onOpenChange={(open) => !open && setRenameTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.renameProject}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t.projectName}</div>
            <Input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTargetId(null)}>
              {t.cancel}
            </Button>
            <Button onClick={commitRenameProject}>{t.ok}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer */}
      {!ui.sidebarCollapsed && (
        <div className="absolute bottom-2 left-0 w-full px-[var(--app-left-pane-pad-x)]">
          <button
            className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-foreground/85 hover:bg-black/5 transition-colors text-left"
            onClick={() => onOpenSettings?.()}
          >
            <Settings className="w-3.5 h-3.5 text-foreground/65" />
            <span>{t.settings}</span>
          </button>
        </div>
      )}
      </div>
      </TooltipProvider>
    </AppShellLeftPane>
  )
})
