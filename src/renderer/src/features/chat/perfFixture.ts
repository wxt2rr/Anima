import type { Message } from '@/store/useStore'

export function createChatPerfFixture(turns = 160): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < turns; i += 1) {
    const turnId = `perf-turn-${i}`
    messages.push({
      id: `perf-user-${i}`,
      role: 'user',
      content: `请分析第 ${i} 轮的 TypeScript 示例，并给出修改建议。`,
      timestamp: i * 4,
      turnId
    } as Message)
    messages.push({
      id: `perf-assistant-${i}`,
      role: 'assistant',
      content: [
        `## 第 ${i} 轮分析`,
        '',
        '下面是一个用于制造长 Markdown 和代码块压力的示例。',
        '',
        '```ts',
        ...Array.from({ length: 80 }, (_, line) => `export const value${line} = ${line} + ${i}`),
        '```',
        '',
        '| 项 | 值 |',
        '| --- | --- |',
        `| turn | ${i} |`,
        '| status | done |'
      ].join('\n'),
      timestamp: i * 4 + 1,
      turnId
    } as Message)
    messages.push({
      id: `perf-tool-${i}`,
      role: 'tool',
      content: '',
      timestamp: i * 4 + 2,
      turnId,
      meta: {
        toolTraces: [
          {
            id: `trace-${i}`,
            name: 'rg_search',
            status: 'succeeded',
            argsPreview: { text: JSON.stringify({ query: `value${i}` }) },
            resultPreview: { text: `found ${i}` },
            durationMs: 10 + i
          }
        ]
      }
    } as Message)
  }
  return messages
}
