import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  filterSlashCommands,
  parseProjectSlashCommandFile,
  parseSlashInput,
  renderSlashCommandTemplate,
  type SlashCommandEntry
} from '../src/renderer/src/lib/slashCommands'

test('parseSlashInput: 识别命令名、参数和建议态', () => {
  assert.deepEqual(parseSlashInput('/review'), {
    raw: '/review',
    name: 'review',
    args: '',
    query: 'review',
    shouldSuggest: true,
    isCommand: true
  })

  assert.deepEqual(parseSlashInput('/review login flow'), {
    raw: '/review login flow',
    name: 'review',
    args: 'login flow',
    query: 'review',
    shouldSuggest: false,
    isCommand: true
  })

  assert.equal(parseSlashInput('hello world'), null)
  assert.equal(parseSlashInput('/review\nmore'), null)
})

test('parseProjectSlashCommandFile: 从 markdown 文件生成项目命令', () => {
  const cmd = parseProjectSlashCommandFile('/repo/.anima/commands/review-diff.md', `
# Review Diff

检查当前改动，并输出风险点。

请审查以下改动：
{{args}}
`)

  assert.ok(cmd)
  assert.equal(cmd?.name, 'review-diff')
  assert.equal(cmd?.source, 'project')
  assert.equal(cmd?.description, '检查当前改动，并输出风险点。')
  assert.equal(String(cmd?.template || '').includes('{{args}}'), true)
})

test('renderSlashCommandTemplate: 替换模板变量并保留未知变量原样', () => {
  const text = renderSlashCommandTemplate('审查 {{args}} @ {{workspace}} / {{unknown}}', {
    args: '登录流程',
    workspace: '/repo/demo'
  })

  assert.equal(text, '审查 登录流程 @ /repo/demo / {{unknown}}')
})

test('filterSlashCommands: 前缀命中优先于描述命中', () => {
  const commands: SlashCommandEntry[] = [
    {
      id: 'review',
      name: 'review',
      title: '/review',
      description: '审查当前改动',
      source: 'builtin',
      kind: 'prompt'
    },
    {
      id: 'coder-status',
      name: 'coder-status',
      title: '/coder-status',
      description: '查看 coder 状态',
      source: 'builtin',
      kind: 'action'
    },
    {
      id: 'ship-check',
      name: 'ship-check',
      title: '/ship-check',
      description: 'review release readiness',
      source: 'project',
      kind: 'prompt',
      filePath: '/repo/.anima/commands/ship-check.md',
      template: '...'
    }
  ]

  const names = filterSlashCommands(commands, 're').map((item) => item.name)
  assert.deepEqual(names, ['review', 'ship-check'])
})
