import type { ChatMessageViewModel } from './types'

export type ChatUserNavItem = {
  id: string
  topRatio: number
  widthPx: number
  content: string
}

export function buildUserNavigationItems(rows: ChatMessageViewModel[]): ChatUserNavItem[] {
  const userRows = rows.filter((row) => row.role === 'user')
  if (userRows.length === 0) return []
  const maxLen = Math.max(1, ...userRows.map((row) => (typeof row.source.content === 'string' ? row.source.content.length : 0)))
  const denom = Math.log(1 + maxLen)
  const totalRows = Math.max(1, rows.length - 1)
  return userRows.map((row) => {
    const content = typeof row.source.content === 'string' ? row.source.content : ''
    const len = content.length
    const norm = denom > 0 ? Math.log(1 + Math.max(0, len)) / denom : 0
    return {
      id: String(row.source.id || ''),
      topRatio: Math.max(0, Math.min(1, row.index / totalRows)),
      widthPx: 4 + norm * 14,
      content
    }
  })
}
