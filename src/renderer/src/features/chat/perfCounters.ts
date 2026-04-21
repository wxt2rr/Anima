type CounterName = 'messageRowRender' | 'markdownCompile' | 'codeHighlight'

const counters: Record<CounterName, number> = {
  messageRowRender: 0,
  markdownCompile: 0,
  codeHighlight: 0
}

export function bumpChatPerfCounter(name: CounterName): void {
  if (import.meta.env.PROD) return
  counters[name] += 1
}

export function readChatPerfCounters(): Record<CounterName, number> {
  return { ...counters }
}

export function resetChatPerfCounters(): void {
  counters.messageRowRender = 0
  counters.markdownCompile = 0
  counters.codeHighlight = 0
}
