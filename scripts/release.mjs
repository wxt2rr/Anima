import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...options }).trim()
}

function runInherit(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...options })
}

function parseArgs(argv) {
  const args = { version: null, dryRun: false, message: null }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (v === '-m' || v === '--message') {
      args.message = argv[i + 1] || null
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

function readPackageJson() {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  return { raw, json: JSON.parse(raw) }
}

function writePackageJson(json) {
  const out = JSON.stringify(json, null, 2) + '\n'
  writeFileSync(new URL('../package.json', import.meta.url), out, 'utf8')
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
  const { version: versionArg, dryRun, message } = parseArgs(process.argv.slice(2))
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

  if (dryRun) {
    process.stdout.write(`[dry-run] bump version ${prev} -> ${version}\n`)
    process.stdout.write(`[dry-run] git add package.json\n`)
    process.stdout.write(`[dry-run] git commit -m "${message || `release: ${tag}`}"\n`)
    process.stdout.write(`[dry-run] git tag ${tag}\n`)
    process.stdout.write('[dry-run] git push\n')
    process.stdout.write(`[dry-run] git push origin ${tag}\n`)
    return
  }

  writePackageJson(json)

  runInherit('git', ['add', 'package.json'])
  runInherit('git', ['commit', '-m', message || `release: ${tag}`])
  runInherit('git', ['tag', tag])
  runInherit('git', ['push'])
  runInherit('git', ['push', 'origin', tag])
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + '\n')
  process.exit(1)
})
