export type ShortcutId =
  | 'openSettings'
  | 'openShortcuts'
  | 'toggleLeftSidebar'
  | 'openSidebarSearch'
  | 'newChat'
  | 'addProject'
  | 'toggleVoice'
  | 'toggleRightSidebar'
  | 'rightFiles'
  | 'rightGit'
  | 'rightTerminal'
  | 'rightPreview'

export type ShortcutBinding = {
  key: string
  shift?: boolean
  alt?: boolean
  primary?: boolean
}

export type ShortcutDef = {
  id: ShortcutId
  category: { zh: string; en: string; ja: string }
  title: { zh: string; en: string; ja: string }
  mac: string
  win: string
  binding: ShortcutBinding
}

export const isMacLike = () => {
  const p = typeof navigator !== 'undefined' ? String(navigator.platform || '') : ''
  return /Mac|iPhone|iPad|iPod/i.test(p)
}

export const normalizeBinding = (raw: any): ShortcutBinding | null => {
  if (!raw || typeof raw !== 'object') return null
  const key = String((raw as any).key || '').trim()
  if (!key) return null
  return {
    key: key.toLowerCase(),
    primary: (raw as any).primary !== false,
    shift: Boolean((raw as any).shift),
    alt: Boolean((raw as any).alt)
  }
}

export const bindingId = (b: ShortcutBinding) => {
  const key = String(b.key || '').toLowerCase()
  const primary = b.primary !== false ? '1' : '0'
  const shift = b.shift ? '1' : '0'
  const alt = b.alt ? '1' : '0'
  return `${primary}${shift}${alt}:${key}`
}

export const formatBindingParts = (b: ShortcutBinding, isMac: boolean) => {
  const parts: string[] = []
  const needPrimary = b.primary !== false
  if (isMac) {
    if (needPrimary) parts.push('⌘')
    if (b.alt) parts.push('⌥')
    if (b.shift) parts.push('⇧')
  } else {
    if (needPrimary) parts.push('Ctrl')
    if (b.alt) parts.push('Alt')
    if (b.shift) parts.push('Shift')
  }
  const k = String(b.key || '').trim()
  parts.push(k.length === 1 ? k.toUpperCase() : k)
  return parts
}

export const matchShortcut = (e: KeyboardEvent, binding: ShortcutBinding, isMac: boolean) => {
  const key = String(e.key || '').toLowerCase()
  if (key !== String(binding.key || '').toLowerCase()) return false
  const needPrimary = binding.primary !== false
  const hasPrimary = isMac ? e.metaKey : e.ctrlKey
  if (needPrimary && !hasPrimary) return false
  if (Boolean(binding.shift) !== Boolean(e.shiftKey)) return false
  if (Boolean(binding.alt) !== Boolean(e.altKey)) return false
  return true
}

export const SHORTCUTS: ShortcutDef[] = [
  {
    id: 'openSettings',
    category: { zh: '通用', en: 'General', ja: '一般' },
    title: { zh: '打开设置', en: 'Open settings', ja: '設定を開く' },
    mac: '⌘ ,',
    win: 'Ctrl + ,',
    binding: { key: ',', primary: true }
  },
  {
    id: 'openShortcuts',
    category: { zh: '通用', en: 'General', ja: '一般' },
    title: { zh: '打开快捷键', en: 'Open shortcuts', ja: 'ショートカットを開く' },
    mac: '⌘ /',
    win: 'Ctrl + /',
    binding: { key: '/', primary: true }
  },
  {
    id: 'toggleLeftSidebar',
    category: { zh: '侧边栏', en: 'Sidebar', ja: 'サイドバー' },
    title: { zh: '切换左侧栏', en: 'Toggle left sidebar', ja: '左サイドバーを切替' },
    mac: '⌘ B',
    win: 'Ctrl + B',
    binding: { key: 'b', primary: true }
  },
  {
    id: 'openSidebarSearch',
    category: { zh: '侧边栏', en: 'Sidebar', ja: 'サイドバー' },
    title: { zh: '打开侧边栏搜索', en: 'Open sidebar search', ja: 'サイドバー検索を開く' },
    mac: '⌘ K',
    win: 'Ctrl + K',
    binding: { key: 'k', primary: true }
  },
  {
    id: 'newChat',
    category: { zh: '对话', en: 'Chat', ja: 'チャット' },
    title: { zh: '新建对话', en: 'New chat', ja: '新規チャット' },
    mac: '⌘ ⇧ N',
    win: 'Ctrl + Shift + N',
    binding: { key: 'n', primary: true, shift: true }
  },
  {
    id: 'addProject',
    category: { zh: '项目', en: 'Projects', ja: 'プロジェクト' },
    title: { zh: '添加项目', en: 'Add project', ja: 'プロジェクト追加' },
    mac: '⌘ ⇧ O',
    win: 'Ctrl + Shift + O',
    binding: { key: 'o', primary: true, shift: true }
  },
  {
    id: 'toggleVoice',
    category: { zh: '语音', en: 'Voice', ja: '音声' },
    title: { zh: '开始/停止语音输入', en: 'Start/stop voice input', ja: '音声入力 開始/停止' },
    mac: '⌘ ⇧ V',
    win: 'Ctrl + Shift + V',
    binding: { key: 'v', primary: true, shift: true }
  },
  {
    id: 'toggleRightSidebar',
    category: { zh: '右侧栏', en: 'Right sidebar', ja: '右サイドバー' },
    title: { zh: '切换右侧栏', en: 'Toggle right sidebar', ja: '右サイドバーを切替' },
    mac: '⌘ ⌥ R',
    win: 'Ctrl + Alt + R',
    binding: { key: 'r', primary: true, alt: true }
  },
  {
    id: 'rightFiles',
    category: { zh: '右侧栏', en: 'Right sidebar', ja: '右サイドバー' },
    title: { zh: '打开文件面板', en: 'Open files panel', ja: 'ファイルを開く' },
    mac: '⌘ ⇧ E',
    win: 'Ctrl + Shift + E',
    binding: { key: 'e', primary: true, shift: true }
  },
  {
    id: 'rightGit',
    category: { zh: '右侧栏', en: 'Right sidebar', ja: '右サイドバー' },
    title: { zh: '打开 Git 面板', en: 'Open Git panel', ja: 'Git を開く' },
    mac: '⌘ ⇧ G',
    win: 'Ctrl + Shift + G',
    binding: { key: 'g', primary: true, shift: true }
  },
  {
    id: 'rightTerminal',
    category: { zh: '右侧栏', en: 'Right sidebar', ja: '右サイドバー' },
    title: { zh: '打开终端面板', en: 'Open terminal panel', ja: 'ターミナルを開く' },
    mac: '⌘ ⇧ T',
    win: 'Ctrl + Shift + T',
    binding: { key: 't', primary: true, shift: true }
  },
  {
    id: 'rightPreview',
    category: { zh: '右侧栏', en: 'Right sidebar', ja: '右サイドバー' },
    title: { zh: '打开预览面板', en: 'Open preview panel', ja: 'プレビューを開く' },
    mac: '⌘ ⇧ P',
    win: 'Ctrl + Shift + P',
    binding: { key: 'p', primary: true, shift: true }
  }
]
