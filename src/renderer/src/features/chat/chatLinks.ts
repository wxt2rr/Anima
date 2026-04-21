type ChatLinkKind = 'file' | 'preview' | 'none'

export function normalizeChatLinkTarget(raw: string): string {
  const rawText = String(raw || '').trim()
  if (!rawText) return ''
  let text = rawText
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1)
  text = text.replace(/[)\].,;:，。；：]+$/, '')
  if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1)
  text = text.replace(/^[`"'“”‘’]+/, '').replace(/[`"'“”‘’]+$/, '')
  text = text.replace(/[)\].,;:，。；：]+$/, '')
  return text.trim()
}

export function isFileLikeTarget(raw: string): boolean {
  const text = normalizeChatLinkTarget(raw)
  if (!text) return false
  if (
    text.startsWith('file://') ||
    text.startsWith('/') ||
    text.startsWith('\\') ||
    text.startsWith('./') ||
    text.startsWith('../') ||
    text.startsWith('~/')
  ) {
    return true
  }
  if (/\.(ts|tsx|js|jsx|py|md|json|yml|yaml|txt|log|html|css|png|jpe?g|gif|svg|webp|pdf|zip|tar|gz)$/i.test(text)) {
    return true
  }
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+$/.test(text)
}

export function classifyChatLinkTarget(raw: string): { kind: ChatLinkKind; target: string } {
  const text = normalizeChatLinkTarget(raw)
  if (!text) return { kind: 'none', target: '' }
  if (isFileLikeTarget(text)) return { kind: 'file', target: text }
  if (/^https?:\/\//i.test(text)) return { kind: 'preview', target: text }
  if (/^[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(text)) return { kind: 'preview', target: `http://${text}` }
  return { kind: 'none', target: text }
}

export function linkifyQuotedFileNames(input: string): string {
  return String(input || '').replace(/(`[^`]+`|"[^"]+"|'[^']+')/g, (token) => {
    const unwrapped = normalizeChatLinkTarget(token)
    if (!isFileLikeTarget(unwrapped)) return token
    return `[${unwrapped}](${unwrapped})`
  })
}

export function resolveChatAssetUrl(
  rawPath: string,
  backendBaseUrl: string,
  workspaceDir: string,
  endpoint: 'attachments' | 'artifacts' = 'attachments'
): string {
  const text = normalizeChatLinkTarget(rawPath)
  if (!text) return ''
  if (/^(https?:|data:|blob:|file:)/i.test(text)) return text
  const baseUrl = String(backendBaseUrl || '').trim()
  const ws = String(workspaceDir || '').trim()
  const apiEndpoint = endpoint === 'artifacts' ? 'artifacts' : 'attachments'
  if (text.startsWith('sandbox:')) {
    const rel = text.replace(/^sandbox:/, '')
    if (baseUrl && ws && rel.startsWith('/')) {
      const abs = `${ws.replace(/\/$/, '')}${rel}`
      return `${baseUrl}/api/artifacts/file?path=${encodeURIComponent(abs)}&workspaceDir=${encodeURIComponent(ws)}`
    }
    return ''
  }
  if (baseUrl && ws && (text.startsWith('/.anima/') || text.includes('/.anima/artifacts/'))) {
    const abs = text.startsWith('/') ? `${ws.replace(/\/$/, '')}${text}` : text
    return `${baseUrl}/api/artifacts/file?path=${encodeURIComponent(abs)}&workspaceDir=${encodeURIComponent(ws)}`
  }
  if (baseUrl) {
    return `${baseUrl}/api/${apiEndpoint}/file?path=${encodeURIComponent(text)}${ws ? `&workspaceDir=${encodeURIComponent(ws)}` : ''}`
  }
  return text.startsWith('/') ? `file://${text}` : text
}

export function hydrateMarkdownHtml(
  html: string,
  opts: { backendBaseUrl?: string; workspaceDir?: string }
): string {
  const baseUrl = String(opts.backendBaseUrl || '').trim()
  const workspaceDir = String(opts.workspaceDir || '').trim()
  return String(html || '').replace(/<img\b([^>]*?)data-chat-image-src="([^"]+)"([^>]*)>/g, (_m, before, rawSrc, after) => {
    const normalized = normalizeChatLinkTarget(rawSrc)
    const endpoint = normalized.startsWith('sandbox:') || normalized.includes('/.anima/artifacts/') ? 'artifacts' : 'attachments'
    const resolved = resolveChatAssetUrl(normalized, baseUrl, workspaceDir, endpoint)
    const clickTarget = normalized || resolved
    const attrs = [`${before}${after}`.trim(), resolved ? `src="${resolved}"` : '', clickTarget ? `data-chat-link-target="${escapeHtmlAttr(clickTarget)}"` : '']
      .filter(Boolean)
      .join(' ')
      .trim()
    return `<img ${attrs}>`
  })
}

function escapeHtmlAttr(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
