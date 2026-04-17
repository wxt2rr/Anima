import os from 'os'
import { spawn } from 'child_process'
import { normAbs } from './acpCore'

export type OsSandboxPermissionMode = 'workspace_whitelist' | 'full_access'

export type OsSandboxRunOptions = {
  command: string
  args?: string[]
  cwd: string
  workspaceDir: string
  permissionMode: OsSandboxPermissionMode
  timeoutMs?: number
  allowedRoots?: string[]
  env?: NodeJS.ProcessEnv
}

export type OsSandboxRunResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  sandbox: {
    enabled: boolean
    kind: 'none' | 'macos_sandbox_exec'
    reason: string
  }
}

function escapeProfileLiteral(v: string): string {
  return String(v || '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function uniqueRoots(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const s = String(raw || '').trim()
    if (!s) continue
    const p = normAbs(s)
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

function buildMacSandboxProfile(writeRoots: string[]): string {
  const roots = uniqueRoots(writeRoots)
  const rules = roots
    .map((root) => {
      const s = escapeProfileLiteral(root)
      return `(allow file-read* (literal "${s}") (subpath "${s}"))
(allow file-write* (literal "${s}") (subpath "${s}"))`
    })
    .join('\n')
  return `(version 1)
(deny default)
(import "system.sb")
(allow process*)
(allow signal (target self))
(allow sysctl-read)
(allow file-read*
  (subpath "/System")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/private/etc")
  (subpath "/private/var")
  (subpath "/dev")
)
(deny network*)
${rules}
`
}

function clampTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 120_000
  return Math.max(0, value)
}

export async function runWithOsSandbox(opts: OsSandboxRunOptions): Promise<OsSandboxRunResult> {
  const command = String(opts.command || '').trim()
  if (!command) throw new Error('command is required')
  const args = Array.isArray(opts.args) ? opts.args.map((v) => String(v)) : []
  const cwd = normAbs(String(opts.cwd || '').trim())
  const workspaceRaw = String(opts.workspaceDir || '').trim()
  if (!workspaceRaw) throw new Error('workspaceDir is required')
  const workspaceDir = normAbs(workspaceRaw)
  const timeoutMs = clampTimeout(opts.timeoutMs)
  const env = { ...process.env, ...(opts.env || {}) }

  const writeRoots = uniqueRoots([workspaceDir, os.tmpdir(), ...(opts.allowedRoots || [])])
  const useSandbox = process.platform === 'darwin' && opts.permissionMode !== 'full_access'
  const spawnCommand = useSandbox ? 'sandbox-exec' : command
  const spawnArgs = useSandbox ? ['-p', buildMacSandboxProfile(writeRoots), command, ...args] : args
  const sandboxMeta = useSandbox
    ? { enabled: true, kind: 'macos_sandbox_exec' as const, reason: 'permission_mode_workspace_whitelist' }
    : {
        enabled: false,
        kind: 'none' as const,
        reason: opts.permissionMode === 'full_access' ? 'permission_mode_full_access' : `platform_${process.platform}`
      }

  const child = spawn(spawnCommand, spawnArgs, { cwd, env, shell: false })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d: string) => (stdout += d))
  child.stderr.on('data', (d: string) => (stderr += d))

  const res = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    let settled = false
    const settle = (cb: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(t)
      cb()
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        settle(() => reject(new Error('Command timed out')))
        return
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          return
        }
      }, 1500)
      settle(() => reject(new Error('Command timed out')))
    }, timeoutMs)

    child.on('exit', (code, signal) => settle(() => resolve({ code, signal })))
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (useSandbox && e?.code === 'ENOENT') {
        settle(() => reject(new Error('sandbox-exec is not available on this system')))
        return
      }
      settle(() => reject(e))
    })
  })

  return { code: res.code, signal: res.signal, stdout, stderr, sandbox: sandboxMeta }
}
