import { Search, Trash2, MessageSquarePlus, PanelLeftClose, MoreHorizontal, Settings, Folder, FolderOpen, FolderPlus, ChevronDown, ChevronRight, Star, Pencil, Clock3, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, memo, type MouseEvent } from 'react'
import { useStore } from '../store/useStore'
import { useUpdateStore } from '../store/useUpdateStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AppShellLeftPane } from '@/components/layout/AppShellLeftPane'
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
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null)
  const updateState = useUpdateStore((s) => s.state)
  const setUpdateDialogOpen = useUpdateStore((s) => s.setDialogOpen)
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const reduceMotion = useReducedMotion()

  const t = (() => {
    const dict = {
      en: { 
        newChat: 'New Chat',
        newProject: 'New Project',
        addProject: 'Add project',
        emptyProjects: 'No projects',
        emptyProjectsHint: 'Add a project by selecting a folder.',
        untitled: 'New Chat', 
        search: 'Search',
        collapseSidebar: 'Collapse sidebar',
        searchChats: 'Search chats',
        addProjectTip: 'Add project',
        createChatTip: 'New chat',
        projectMenuTip: 'More actions',
        deleteChatTip: 'Delete chat',
        deleteProject: 'Delete project',
        deleteProjectTitle: 'Delete Project',
        deleteProjectDesc: 'Delete this project and all its chats? This action cannot be undone.',
        deleteTitle: 'Delete Chat',
        deleteDesc: 'Are you sure you want to delete this chat? This action cannot be undone.',
        cancel: 'Cancel',
        ok: 'OK',
        delete: 'Delete',
        settings: 'Settings',
        renameProject: 'Rename project',
        projectName: 'Project name',
        pin: 'Pin',
        unpin: 'Unpin',
        createChat: 'New chat'
      },
      zh: { 
        newChat: '新对话',
        newProject: '新建项目',
        addProject: '添加项目',
        emptyProjects: '暂无项目',
        emptyProjectsHint: '通过选择文件夹来添加一个项目。',
        untitled: '新对话', 
        search: '搜索',
        collapseSidebar: '收起侧边栏',
        searchChats: '搜索对话',
        addProjectTip: '添加项目',
        createChatTip: '新建对话',
        projectMenuTip: '更多操作',
        deleteChatTip: '删除对话',
        deleteProject: '删除项目',
        deleteProjectTitle: '删除项目',
        deleteProjectDesc: '确定要删除该项目及其全部对话吗？此操作无法撤销。',
        deleteTitle: '删除对话',
        deleteDesc: '确定要删除这个对话吗？此操作无法撤销。',
        cancel: '取消',
        ok: '确定',
        delete: '删除',
        settings: '设置',
        renameProject: '修改项目名称',
        projectName: '项目名称',
        pin: '置顶',
        unpin: '取消置顶',
        createChat: '新建对话'
      },
      ja: { 
        newChat: '新規チャット',
        newProject: '新規プロジェクト',
        addProject: 'プロジェクト追加',
        emptyProjects: 'プロジェクト未作成',
        emptyProjectsHint: 'フォルダーを選択してプロジェクトを追加します。',
        untitled: '新規チャット', 
        search: '検索',
        collapseSidebar: 'サイドバーを閉じる',
        searchChats: 'チャットを検索',
        addProjectTip: 'プロジェクト追加',
        createChatTip: '新規チャット',
        projectMenuTip: 'その他',
        deleteChatTip: 'チャットを削除',
        deleteProject: 'プロジェクトを削除',
        deleteProjectTitle: 'プロジェクトを削除',
        deleteProjectDesc: 'このプロジェクトと全てのチャットを削除しますか？この操作は取り消せません。',
        deleteTitle: 'チャットを削除',
        deleteDesc: 'このチャットを削除してもよろしいですか？この操作は取り消せません。',
        cancel: 'キャンセル',
        ok: 'OK',
        delete: '削除',
        settings: '設定',
        renameProject: '名前を変更',
        projectName: 'プロジェクト名',
        pin: '固定',
        unpin: '固定解除',
        createChat: '新規チャット'
      }
    } as const
    const lang = (settings?.language || 'en') as keyof typeof dict
    return dict[lang] || dict.en
  })()

  useEffect(() => {
    if (ui.sidebarCollapsed) return
    if (!ui.sidebarSearchOpen) return
    inputRef.current?.focus()
  }, [ui.sidebarCollapsed, ui.sidebarSearchOpen])

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
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.collapseSidebar}</TooltipContent>
          </Tooltip>
          {showUpdateEntry ? (
            <button
              className="h-7 px-2.5 rounded-full bg-blue-500 text-white text-[11px] font-medium leading-none hover:bg-blue-600 transition-colors"
              onClick={() => setUpdateDialogOpen(true)}
            >
              更新
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-[var(--app-left-pane-pad-x)] pb-2 space-y-0.5">
        <button
          type="button"
          className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-foreground/85 hover:bg-black/5 transition-colors text-left"
          onClick={() => void createChat()}
        >
          <MessageSquarePlus className="w-4 h-4 text-primary/80" />
          <span>{t.newChat}</span>
        </button>
        <button
          type="button"
          className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-foreground/85 hover:bg-black/5 transition-colors text-left"
          onClick={toggleSidebarSearch}
        >
          <Clock3 className="w-4 h-4 text-primary/80" />
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
          <Sparkles className="w-4 h-4 text-primary/80" />
          <span>技能</span>
        </button>
      </div>
      <div className="mx-[var(--app-left-pane-pad-x)] mb-1 h-px bg-black/5" />

      {/* Search Bar */}
      {!ui.sidebarCollapsed && ui.sidebarSearchOpen && (
        <div className="px-[var(--app-left-pane-pad-x)] pb-2 animate-in slide-in-from-top-2 duration-200">
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

      {/* Chat List */}
      <div className="px-[var(--app-left-pane-pad-x)] pb-1 pt-1 flex items-center justify-between text-[12px] text-muted-foreground/90">
        <span className="tracking-wide">线程</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-6 w-6 rounded-md hover:bg-black/5 flex items-center justify-center"
            onClick={() => void pickAndAddProject()}
            title={t.addProjectTip}
          >
            <FolderPlus className="w-3.5 h-3.5 text-primary/80" />
          </button>
          <button
            type="button"
            className={`h-6 w-6 rounded-md hover:bg-black/5 flex items-center justify-center ${ui.sidebarSearchOpen ? 'bg-black/5' : ''}`}
            onClick={toggleSidebarSearch}
            title={t.searchChats}
          >
            <Search className="w-3.5 h-3.5 text-primary/80" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-[var(--app-left-pane-pad-x)] pb-2 space-y-1 scrollbar-none">
        {projects.length === 0 ? (
          <div className="px-2 py-10 text-center space-y-3">
            <div className="text-sm font-medium text-foreground">{t.emptyProjects}</div>
            <div className="text-xs text-muted-foreground">{t.emptyProjectsHint}</div>
            <Button variant="outline" size="sm" onClick={() => void pickAndAddProject()} className="gap-2">
              <FolderPlus className="w-4 h-4" />
              {t.addProject}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const pid = p.id
              const collapsed = (ui.collapsedProjectIds || []).includes(pid)
              const activeProject = ui.activeProjectId === pid
              const list = chatsByProjectId[pid] || []
              const hasChats = list.length > 0

              return (
                <div key={pid} className="mx-0.5">
                  <div
                    className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all ${
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
                      <span className="relative w-3.5 h-3.5 shrink-0">
                        {collapsed ? (
                          <Folder className="w-3.5 h-3.5 text-primary transition-opacity group-hover:opacity-0" />
                        ) : (
                          <FolderOpen className="w-3.5 h-3.5 text-primary transition-opacity group-hover:opacity-0" />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </span>
                      </span>
                      <span className="truncate text-[13px] flex-1 leading-5 font-medium text-left">{p.name}</span>
                    </button>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={`p-1 rounded-lg transition-all hover:bg-black/5 dark:hover:bg-white/10 ${
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
                          className={`p-1 rounded-lg transition-all text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground ${
                            projectMenuOpenId === pid ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                          onClick={(e) => {
                            e.stopPropagation()
                            void createChatInProject(pid)
                          }}
                        >
                          <MessageSquarePlus className="w-3.5 h-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t.createChatTip}</TooltipContent>
                    </Tooltip>

                    <Popover open={projectMenuOpenId === pid} onOpenChange={(open) => setProjectMenuOpenId(open ? pid : null)}>
                      <PopoverTrigger
                        className={`p-1 rounded-lg transition-all text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground ${
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
                          <Pencil className="w-4 h-4" />
                          <span>{t.renameProject}</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                          onClick={() => {
                            setProjectMenuOpenId(null)
                            togglePinProject(pid)
                          }}
                        >
                          <Star className="w-4 h-4" />
                          <span>{p.pinned ? t.unpin : t.pin}</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
                          onClick={() => {
                            setProjectMenuOpenId(null)
                            void createChatInProject(pid)
                          }}
                        >
                          <MessageSquarePlus className="w-4 h-4" />
                          <span>{t.createChat}</span>
                        </button>
                        <button
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left text-destructive"
                          onClick={() => {
                            setProjectMenuOpenId(null)
                            setDeleteProjectId(pid)
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>{t.deleteProject}</span>
                        </button>
                      </PopoverContent>
                    </Popover>
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
                        {hasChats ? (
                          <div className="mt-1 space-y-0.5">
                            {list.map((chat) => {
                              const active = chat.id === activeChatId
                              const title = (chat.title || '').trim() || t.untitled
                              return (
                                <div
                                  key={chat.id}
                                  onClick={() => void setActiveChat(chat.id)}
                                  className={`group relative flex items-center gap-2 px-2.5 py-1 rounded-md cursor-pointer transition-all duration-200 ${
                                    active
                                      ? 'bg-black/5 text-foreground'
                                      : 'text-muted-foreground hover:bg-black/5 hover:text-foreground'
                                  }`}
                                >
                                  {/* 占位与项目图标同宽，保证对话标题与项目标题左对齐 */}
                                  <span className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span className="truncate text-[13px] flex-1 leading-5 text-foreground">{title}</span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setDeleteId(chat.id)
                                        }}
                                        className="p-1 rounded-lg transition-all text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{t.deleteChatTip}</TooltipContent>
                                  </Tooltip>
                                </div>
                              )
                            })}
                          </div>
                        ) : null}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
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
                if (deleteId) deleteChat(deleteId)
                setDeleteId(null)
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
        <div className="p-[var(--app-left-pane-pad-x)] mt-auto">
          <button
            className="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-[13px] text-foreground/85 hover:bg-black/5 transition-colors text-left"
            onClick={() => onOpenSettings?.()}
          >
            <Settings className="w-4 h-4 text-primary/80" />
            <span>{t.settings}</span>
          </button>
        </div>
      )}
      </TooltipProvider>
    </AppShellLeftPane>
  )
})
