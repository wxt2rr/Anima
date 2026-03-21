import { app, ipcMain } from 'electron';
import * as os from 'os';
import * as pty from 'node-pty';
import fs from 'fs';
import path from 'path';

const terminals = new Map<string, pty.IPty>();
let didEnsureNodePtyPermissions = false;
const lastPreviewUrlByTerminalId = new Map<string, string>();

function pickShell(shellPath?: string): string {
  if (os.platform() === 'win32') return shellPath || 'powershell.exe';
  const candidates = [
    shellPath,
    process.env.SHELL,
    '/bin/zsh',
    '/usr/bin/zsh',
    '/bin/bash',
    '/usr/bin/bash'
  ].filter((v): v is string => Boolean(v && String(v).trim()));
  for (const s of candidates) {
    try {
      if (s.includes('/') && fs.existsSync(s)) return s;
    } catch {
      continue;
    }
  }
  return String(candidates[0] || '/bin/zsh');
}

function ensureExecutable(filePath: string) {
  const st = fs.statSync(filePath);
  const mode = st.mode & 0o777;
  if ((mode & 0o111) !== 0) return;
  fs.chmodSync(filePath, mode | 0o111);
}

function ensureNodePtyPermissions() {
  if (didEnsureNodePtyPermissions) return;
  if (os.platform() === 'win32') {
    didEnsureNodePtyPermissions = true;
    return;
  }

  const candidateRoots: string[] = [];
  try {
    const pkgPath = require.resolve('node-pty/package.json');
    candidateRoots.push(path.dirname(pkgPath));
    if (pkgPath.includes('app.asar')) {
      candidateRoots.push(path.dirname(pkgPath.replace('app.asar', 'app.asar.unpacked')));
    }
  } catch {
    return;
  }

  const platformArchDirs = [
    path.join('prebuilds', `${process.platform}-${process.arch}`),
    path.join('build', 'Release'),
    path.join('build', 'Debug')
  ];

  for (const root of candidateRoots) {
    for (const d of platformArchDirs) {
      const helper = path.join(root, d, 'spawn-helper');
      try {
        if (fs.existsSync(helper)) ensureExecutable(helper);
      } catch {
        continue;
      }
    }
  }
  didEnsureNodePtyPermissions = true;
}

function prependPathEntries(currentPath: string, entries: string[]): string {
  const parts = currentPath.split(':').filter((v) => Boolean(v && String(v).trim()));
  const merged = [...entries, ...parts].filter((v) => Boolean(v && String(v).trim()));
  return Array.from(new Set(merged)).join(':');
}

function buildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    env[k] = String(v);
  }
  const defaultPath = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  env.PATH = env.PATH && String(env.PATH).trim() ? env.PATH : defaultPath;
  env.TERM = env.TERM || 'xterm-256color';
  env.COLORTERM = env.COLORTERM || 'truecolor';
  if (!env.LANG || !String(env.LANG).trim()) env.LANG = 'en_US.UTF-8';
  if (!env.LC_CTYPE || !String(env.LC_CTYPE).trim()) env.LC_CTYPE = env.LANG;
  if (!env.LC_ALL || !String(env.LC_ALL).trim()) env.LC_ALL = env.LANG;

  if (!app.isPackaged) {
    const devPathEntries: string[] = [];
    const appPath = String(app.getAppPath() || '').trim();
    const home = String(env.HOME || '').trim();
    const animaUserBin = home ? path.join(home, '.anima', 'bin') : '';
    if (appPath && fs.existsSync(path.join(appPath, 'anima'))) devPathEntries.push(appPath);
    if (animaUserBin && fs.existsSync(animaUserBin)) devPathEntries.push(animaUserBin);
    if (devPathEntries.length > 0) env.PATH = prependPathEntries(String(env.PATH || ''), devPathEntries);
  }

  return env;
}

function resolveCwd(input?: string): string {
  const fallback = process.env.HOME || process.cwd();
  const cwd = String(input || '').trim();
  if (!cwd) return fallback;
  try {
    const st = fs.statSync(cwd);
    if (st.isDirectory()) return cwd;
  } catch {
    return fallback;
  }
  return fallback;
}

function normalizeDetectedUrl(raw: string): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  let candidate = text;
  if (!/^https?:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  try {
    const u = new URL(candidate);
    const port = u.port ? Number(u.port) : 0;
    if (u.hostname === '0.0.0.0' || u.hostname === '::' || u.hostname === '[::]' || u.hostname === '::1') {
      if (port > 0) return `http://127.0.0.1:${port}${u.pathname || '/'}${u.search}${u.hash}`;
      return `http://127.0.0.1${u.pathname || '/'}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return null;
  }
}

function extractPreviewUrls(chunk: string): string[] {
  const urls: string[] = [];
  const fullUrlRegex = /https?:\/\/[^\s"'<>]+/gi;
  const hostPortRegex = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})(?:\/[^\s"'<>]*)?/gi;

  for (const m of chunk.matchAll(fullUrlRegex)) {
    const normalized = normalizeDetectedUrl(m[0]);
    if (normalized) urls.push(normalized);
  }
  for (const m of chunk.matchAll(hostPortRegex)) {
    const normalized = normalizeDetectedUrl(m[0]);
    if (normalized) urls.push(normalized);
  }
  return urls;
}

export function registerTerminalService() {
  ipcMain.handle('terminal:create', (event, { cwd, shellPath }: { cwd?: string, shellPath?: string } = {}) => {
    try {
      ensureNodePtyPermissions();
      const shell = pickShell(shellPath);
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: resolveCwd(cwd),
        env: buildEnv() as any,
        encoding: 'utf8'
      });

      const id = Math.random().toString(36).substring(7);
      terminals.set(id, ptyProcess);

      ptyProcess.onData((data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(`terminal:data:${id}`, data);
        }

        const candidates = extractPreviewUrls(data);
        for (const u of candidates) {
          const last = lastPreviewUrlByTerminalId.get(id);
          if (last === u) continue;
          lastPreviewUrlByTerminalId.set(id, u);
          if (!event.sender.isDestroyed()) {
            event.sender.send('preview:serverDetected', { url: u, terminalId: id });
          }
          break;
        }
      });

      ptyProcess.onExit(() => {
        if (!event.sender.isDestroyed()) {
            event.sender.send(`terminal:exit:${id}`);
        }
        terminals.delete(id);
        lastPreviewUrlByTerminalId.delete(id);
      });

      return { ok: true, id };
    } catch (error: any) {
      console.error('Failed to create terminal:', error);
      return {
        ok: false,
        error: error?.message,
        details: {
          code: error?.code,
          errno: error?.errno,
          syscall: error?.syscall,
          path: error?.path
        }
      };
    }
  });

  ipcMain.on('terminal:write', (_, { id, data }: { id: string, data: string }) => {
    const term = terminals.get(id);
    if (term) {
      term.write(data);
    }
  });

  ipcMain.on('terminal:resize', (_, { id, cols, rows }: { id: string, cols: number, rows: number }) => {
    const term = terminals.get(id);
    if (term) {
      term.resize(cols, rows);
    }
  });

  ipcMain.on('terminal:kill', (_, id: string) => {
    const term = terminals.get(id);
    if (term) {
      term.kill();
      terminals.delete(id);
    }
  });
}
