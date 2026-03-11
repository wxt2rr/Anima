import fs from 'node:fs'
import path from 'node:path'

function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

function findApps(distDir) {
  const out = []
  const stack = [distDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name.endsWith('.app')) out.push(p)
        else stack.push(p)
      }
    }
  }
  return out
}

function checkOne(appPath) {
  const resources = path.join(appPath, 'Contents', 'Resources')
  const missing = []
  if (!exists(resources)) missing.push('Contents/Resources')
  if (!exists(path.join(resources, 'app.asar'))) missing.push('Contents/Resources/app.asar')
  if (!exists(path.join(resources, 'pybackend', 'server.py'))) missing.push('Contents/Resources/pybackend/server.py')
  if (!exists(path.join(resources, 'skills'))) missing.push('Contents/Resources/skills')
  return { appPath, ok: missing.length === 0, missing }
}

function parseArgs(argv) {
  const res = { dist: 'dist', app: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dist') res.dist = String(argv[i + 1] || '')
    if (a === '--app') res.app = String(argv[i + 1] || '')
  }
  return res
}

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()
const distDir = path.resolve(root, args.dist || 'dist')

const apps = args.app ? [path.resolve(root, args.app)] : findApps(distDir)
if (!apps.length) {
  process.stderr.write(`No .app found under ${distDir}\n`)
  process.exit(2)
}

let failed = 0
for (const appPath of apps) {
  const r = checkOne(appPath)
  if (r.ok) {
    process.stdout.write(`[ok] ${r.appPath}\n`)
  } else {
    failed++
    process.stdout.write(`[fail] ${r.appPath}\n`)
    for (const m of r.missing) process.stdout.write(`  - missing ${m}\n`)
  }
}

process.exit(failed ? 1 : 0)

