import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...options }).trim()
}

function runInherit(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...options })
}

function parseArgs(argv) {
  const args = { version: null, dryRun: false, message: null, notes: null, notesFile: null, ghRelease: false }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (v === '--gh-release') {
      args.ghRelease = true
      continue
    }
    if (v === '-m' || v === '--message') {
      args.message = argv[i + 1] || null
      i++
      continue
    }
    if (v === '--notes') {
      args.notes = argv[i + 1] || null
      i++
      continue
    }
    if (v === '--notes-file') {
      args.notesFile = argv[i + 1] || null
      i++
      continue
    }
    if (!args.version && !v.startsWith('-')) {
      args.version = v
      continue
    }
    throw new Error(`Unknown argument: ${v}`)
  }
  return args
}

function normalizeVersion(input) {
  const raw = String(input || '').trim()
  const v = raw.startsWith('v') ? raw.slice(1) : raw
  if (!/^\d+\.\d+\.\d+([\-+][0-9A-Za-z.-]+)?$/.test(v)) {
    throw new Error(`Invalid version: ${raw}`)
  }
  return v
}

async function promptVersion() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => rl.question('Version (e.g. 0.1.2): ', resolve))
  rl.close()
  return answer
}

function readTextFile(filePath) {
  const p = String(filePath || '').trim()
  if (!p) return ''
  return readFileSync(p, 'utf8')
}

function readPackageJson() {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  return { raw, json: JSON.parse(raw) }
}

function writePackageJson(json) {
  const out = JSON.stringify(json, null, 2) + '\n'
  writeFileSync(new URL('../package.json', import.meta.url), out, 'utf8')
}

function changelogPath() {
  return new URL('../CHANGELOG.md', import.meta.url)
}

function normalizeNotesText(notesText) {
  const s = String(notesText || '').trim()
  return s
}

function formatChangelogEntry(version, notesText) {
  const date = new Date().toISOString().slice(0, 10)
  const header = `## v${version} - ${date}`
  const raw = normalizeNotesText(notesText)
  if (!raw) return `${header}\n\n- (no notes)\n`
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const bullets = lines.length ? lines.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n') : '- (no notes)'
  return `${header}\n\n${bullets}\n`
}

function upsertChangelog(version, notesText) {
  const fileUrl = changelogPath()
  const existing = existsSync(fileUrl) ? readFileSync(fileUrl, 'utf8') : ''
  const entry = formatChangelogEntry(version, notesText)
  const title = '# Changelog\n\n'
  const next = (() => {
    const base = existing.trim() ? existing : title
    if (!base.startsWith('# Changelog')) return `${title}${entry}\n${base.trim()}\n`
    const afterTitle = base.replace(/^# Changelog\s*/m, '# Changelog\n')
    const parts = afterTitle.split(/\n{2,}/)
    if (parts.length === 0) return `${title}${entry}\n`
    const [first, ...rest] = parts
    const remainder = rest.length ? `\n\n${rest.join('\n\n').trim()}\n` : '\n'
    return `${first.trim()}\n\n${entry.trim()}\n${remainder}`.trimEnd() + '\n'
  })()
  writeFileSync(fileUrl, next, 'utf8')
}

function ensureGhAvailable() {
  try {
    run('gh', ['--version'])
    return true
  } catch {
    return false
  }
}

function writeTempNotesFile(tag, notesText) {
  const dir = path.join(os.tmpdir(), 'anima-release-notes')
  mkdirSync(dir, { recursive: true })
  const fp = path.join(dir, `${tag}.md`)
  writeFileSync(fp, String(notesText || '').trim() + '\n', 'utf8')
  return fp
}

function upsertGhRelease(tag, notesText) {
  const notes = normalizeNotesText(notesText)
  if (!notes) return
  if (!ensureGhAvailable()) {
    process.stderr.write('gh CLI not found; skip GitHub release notes.\n')
    return
  }
  const fp = writeTempNotesFile(tag, notes)
  const exists = (() => {
    try {
      run('gh', ['release', 'view', tag])
      return true
    } catch {
      return false
    }
  })()
  if (exists) {
    runInherit('gh', ['release', 'edit', tag, '--notes-file', fp])
    return
  }
  runInherit('gh', ['release', 'create', tag, '--title', tag, '--notes-file', fp])
}

function ensureGitRepo() {
  const inside = run('git', ['rev-parse', '--is-inside-work-tree'])
  if (inside !== 'true') throw new Error('Not a git repository')
}

function ensureCleanWorkingTree() {
  const status = run('git', ['status', '--porcelain'])
  if (status) {
    throw new Error('Working tree is not clean. Commit/stash changes first.')
  }
}

function ensureTagNotExists(tag) {
  try {
    run('git', ['rev-parse', '--verify', tag])
    throw new Error(`Tag already exists: ${tag}`)
  } catch (e) {
    const msg = String(e?.message || e)
    if (msg.includes('Tag already exists')) throw e
  }
}

async function main() {
  const { version: versionArg, dryRun, message, notes, notesFile, ghRelease } = parseArgs(process.argv.slice(2))
  const inputVersion = versionArg || (await promptVersion())
  const version = normalizeVersion(inputVersion)
  const tag = `v${version}`

  ensureGitRepo()
  ensureCleanWorkingTree()
  ensureTagNotExists(tag)

  const { json } = readPackageJson()
  const prev = String(json.version || '').trim()
  if (!prev) throw new Error('package.json missing version')
  if (prev === version) throw new Error(`Version is already ${version}`)

  json.version = version
  const notesText = normalizeNotesText(notesFile ? readTextFile(notesFile) : notes)
  const shouldWriteChangelog = Boolean(notesText)

  if (dryRun) {
    process.stdout.write(`[dry-run] bump version ${prev} -> ${version}\n`)
    if (shouldWriteChangelog) process.stdout.write('[dry-run] update CHANGELOG.md\n')
    process.stdout.write(`[dry-run] git add package.json${shouldWriteChangelog ? ' CHANGELOG.md' : ''}\n`)
    process.stdout.write(`[dry-run] git commit -m "${message || `release: ${tag}`}"\n`)
    process.stdout.write(`[dry-run] git tag ${tag}\n`)
    process.stdout.write('[dry-run] git push\n')
    process.stdout.write(`[dry-run] git push origin ${tag}\n`)
    if (ghRelease && notesText) process.stdout.write(`[dry-run] gh release create/edit ${tag} with notes\n`)
    return
  }

  writePackageJson(json)
  if (shouldWriteChangelog) upsertChangelog(version, notesText)

  runInherit('git', ['add', 'package.json', ...(shouldWriteChangelog ? ['CHANGELOG.md'] : [])])
  runInherit('git', ['commit', '-m', message || `release: ${tag}`])
  runInherit('git', ['tag', tag])
  runInherit('git', ['push'])
  runInherit('git', ['push', 'origin', tag])
  if (ghRelease && notesText) upsertGhRelease(tag, notesText)
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + '\n')
  process.exit(1)
})
