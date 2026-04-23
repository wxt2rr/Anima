const LATIN_TOKEN_RE = /[a-z0-9]+/g
const HAN_RUN_RE = /[\u3400-\u9fff]+/g

const normalizeText = (value: string) => String(value || '').trim().toLowerCase()

const buildChineseWordSlices = (text: string): string[] => {
  const slices: string[] = []
  const hanRuns = text.match(HAN_RUN_RE) || []
  for (const run of hanRuns) {
    if (!run) continue
    slices.push(run)
    if (run.length < 2) continue
    for (let size = 2; size <= Math.min(4, run.length); size += 1) {
      for (let i = 0; i + size <= run.length; i += 1) {
        slices.push(run.slice(i, i + size))
      }
    }
  }
  return slices
}

const segmentWithIntl = (text: string): string[] => {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return []
  const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' })
  const segments = segmenter.segment(text)
  const words: string[] = []
  for (const part of segments) {
    if (!part.segment) continue
    const token = normalizeText(part.segment)
    if (!token) continue
    words.push(token)
  }
  return words
}

export const tokenizeSearchText = (value: string): string[] => {
  const text = normalizeText(value)
  if (!text) return []

  const tokenSet = new Set<string>()

  const latinTokens = text.match(LATIN_TOKEN_RE) || []
  for (const token of latinTokens) {
    const normalized = normalizeText(token)
    if (normalized) tokenSet.add(normalized)
  }

  const intlTokens = segmentWithIntl(text)
  for (const token of intlTokens) {
    tokenSet.add(token)
  }

  const chineseSlices = buildChineseWordSlices(text)
  for (const token of chineseSlices) {
    tokenSet.add(token)
  }

  tokenSet.add(text)
  return Array.from(tokenSet)
}

export const matchesChatTitleSearch = (title: string, query: string): boolean => {
  const normalizedTitle = normalizeText(title)
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true
  if (!normalizedTitle) return false

  if (normalizedTitle.includes(normalizedQuery)) return true

  const titleTokens = new Set(tokenizeSearchText(normalizedTitle))
  const queryTokens = tokenizeSearchText(normalizedQuery)
  if (!queryTokens.length) return false

  return queryTokens.every((token) => {
    if (!token) return true
    if (titleTokens.has(token)) return true
    return normalizedTitle.includes(token)
  })
}
