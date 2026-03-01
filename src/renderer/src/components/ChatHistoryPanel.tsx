import { Search, Trash2, SquarePen, PanelLeftClose, MoreHorizontal, MessageSquare, Settings, RefreshCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, memo } from 'react'
import { useStore } from '../store/useStore'
import { useUpdateStore } from '../store/useUpdateStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export const ChatHistoryPanel = memo(function ChatHistoryPanel({ onOpenSettings, width = 288 }: { onOpenSettings?: () => void, width?: number }) {
  const {
    chats,
    activeChatId,
    createChat,
    setActiveChat,
    deleteChat,
    settings,
    ui,
    setSidebarSearchQuery,
    toggleSidebarCollapsed,
    toggleSidebarSearch
  } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)
  const updateState = useUpdateStore((s) => s.state)
  const setUpdateDialogOpen = useUpdateStore((s) => s.setDialogOpen)

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setIsSettingsOpen(true)
  }

  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setIsSettingsOpen(false)
    }, 300)
  }

  const t = (() => {
    const dict = {
      en: { 
        newChat: 'New Chat', 
        untitled: 'New Chat', 
        search: 'Search',
        deleteTitle: 'Delete Chat',
        deleteDesc: 'Are you sure you want to delete this chat? This action cannot be undone.',
        cancel: 'Cancel',
        delete: 'Delete',
        settings: 'Settings'
      },
      zh: { 
        newChat: '新对话', 
        untitled: '新对话', 
        search: '搜索',
        deleteTitle: '删除对话',
        deleteDesc: '确定要删除这个对话吗？此操作无法撤销。',
        cancel: '取消',
        delete: '删除',
        settings: '设置'
      },
      ja: { 
        newChat: '新規チャット', 
        untitled: '新規チャット', 
        search: '検索',
        deleteTitle: 'チャットを削除',
        deleteDesc: 'このチャットを削除してもよろしいですか？この操作は取り消せません。',
        cancel: 'キャンセル',
        delete: '削除',
        settings: '設定'
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

  const showUpdateEntry = useMemo(() => {
    const st = updateState?.status
    return st === 'available' || st === 'downloading' || st === 'downloaded' || st === 'error'
  }, [updateState?.status])

  return (
    <Card
      style={{ width: ui.sidebarCollapsed ? 0 : width }}
      className={`flex flex-col no-drag transition-all duration-300 ease-in-out relative overflow-hidden border-[3px] border-black/5 dark:border-white/10 rounded-xl shadow-none ${
        ui.sidebarCollapsed ? 'opacity-0 p-0 m-0 border-0' : ''
      }`}
    >
      {/* Header Area */}
      <div className="h-[52px] flex items-start justify-between px-4 shrink-0 draggable">
        {/* Traffic Lights Placeholder */}
        <div className="w-[80px] h-full" />
        {/* Actions */}
        <div className="flex items-center gap-1 no-drag mt-[0px]">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebarCollapsed}
            className="h-7 w-7"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebarSearch}
            className={`h-7 w-7 transition-colors ${
              ui.sidebarSearchOpen ? 'bg-black/5 dark:bg-white/10 text-foreground' : ''
            }`}
          >
            <Search className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={createChat}
            className="h-7 w-7"
          >
            <SquarePen className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      {!ui.sidebarCollapsed && ui.sidebarSearchOpen && (
        <div className="px-3 pb-2 animate-in slide-in-from-top-2 duration-200">
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
      <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-1 scrollbar-none">
        {visibleChats.map((chat) => {
          const active = chat.id === activeChatId
          const title = (chat.title || '').trim() || t.untitled
          return (
            <div
              key={chat.id}
              onClick={() => setActiveChat(chat.id)}
              className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-xl cursor-pointer transition-all duration-200 mx-1 ${
                active
                  ? 'bg-secondary text-foreground font-semibold shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-foreground' : 'opacity-70'}`} />
              <span className="truncate text-[13px] flex-1 leading-5">{title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteId(chat.id)
                }}
                className={`p-1 rounded-lg transition-all text-muted-foreground hover:text-destructive ${
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
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

      {/* Footer */}
      {!ui.sidebarCollapsed && (
        <div className="p-3 mt-auto flex items-center justify-between">
          <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <PopoverTrigger asChild onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
              <button className="p-2 rounded-md text-primary hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus:outline-none focus-visible:outline-none">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent 
              className="w-40 p-1" 
              align="start" 
              side="top"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left focus:outline-none focus-visible:outline-none"
                onClick={() => {
                  onOpenSettings?.()
                  setIsSettingsOpen(false)
                }}
              >
                <Settings className="w-4 h-4" />
                <span>{t.settings}</span>
              </button>
            </PopoverContent>
          </Popover>

          {showUpdateEntry ? (
            <button
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors text-xs text-foreground"
              onClick={() => setUpdateDialogOpen(true)}
            >
              <RefreshCcw className="w-3.5 h-3.5 text-primary" />
              <span>更新</span>
            </button>
          ) : (
            <span />
          )}
        </div>
      )}
    </Card>
  )
})
