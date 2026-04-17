import { app, ipcMain, webContents, dialog, BrowserWindow, type MessageBoxOptions } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import Store from 'electron-store';
import {
  buildKey,
  isObject,
  isWithin,
  mapAcpUpdateToUiEvent,
  normAbs,
  randomId,
  resolvePathInWorkspace,
  type AcpAgentConfig,
  type AcpAgentKind,
  type AcpUiEvent,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type SessionKey
} from './acpCore';
import { runWithOsSandbox } from './osSandboxRunner';

type AcpPermissionMode = 'workspace_whitelist' | 'full_access';
const ACP_WHITELIST_ROOT = normAbs('/Users/wangxt/.config/anima');

class JsonRpcPeer {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private bufIn: Buffer = Buffer.alloc(0);
  private configuredFraming: 'auto' | 'jsonl' | 'content_length';
  private detectedFraming: 'jsonl' | 'content_length' | null = null;

  constructor(
    private proc: ChildProcessWithoutNullStreams,
    opts: { framing?: 'auto' | 'jsonl' | 'content_length' } | undefined,
    private handlers: {
      onNotification: (method: string, params: any) => void;
      onRequest: (method: string, params: any) => Promise<any>;
      onError: (err: Error) => void;
    }
  ) {
    this.configuredFraming = (opts?.framing || 'auto') as any;
    this.proc.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string | Buffer) => {
      const text = String(chunk || '').trim();
      if (text) this.handlers.onError(new Error(text));
    });
  }

  sendRequest(method: string, params?: any): Promise<any> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    this.writeMessage(msg);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  sendNotification(method: string, params?: any): void {
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.writeMessage(msg);
  }

  private writeMessage(msg: any) {
    const jsonText = JSON.stringify(msg);
    const framing = this.configuredFraming === 'auto' ? this.detectedFraming || 'jsonl' : this.configuredFraming;
    const out =
      framing === 'content_length'
        ? Buffer.concat([Buffer.from(`Content-Length: ${Buffer.byteLength(jsonText, 'utf8')}\r\n\r\n`, 'utf8'), Buffer.from(jsonText, 'utf8')])
        : Buffer.from(jsonText + '\n', 'utf8');
    try {
      this.proc.stdin.write(out);
    } catch (e) {
      this.handlers.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async onMessage(msg: JsonRpcMessage) {
    if (isObject(msg) && 'method' in msg && 'id' in msg) {
      const req = msg as JsonRpcRequest;
      try {
        const result = await this.handlers.onRequest(req.method, req.params);
        const res: JsonRpcResponse = { jsonrpc: '2.0', id: req.id, result };
        this.writeMessage(res);
      } catch (e: any) {
        const res: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32000, message: e?.message || String(e) }
        };
        this.writeMessage(res);
      }
      return;
    }

    if (isObject(msg) && 'id' in msg && !('method' in msg)) {
      const res = msg as JsonRpcResponse;
      const idNum = typeof res.id === 'number' ? res.id : Number(res.id);
      const waiter = this.pending.get(idNum);
      if (!waiter) return;
      this.pending.delete(idNum);
      if (res.error) waiter.reject(new Error(res.error.message || 'JSON-RPC error'));
      else waiter.resolve(res.result);
      return;
    }

    if (isObject(msg) && 'method' in msg && !('id' in msg)) {
      const n = msg as JsonRpcNotification;
      this.handlers.onNotification(n.method, n.params);
    }
  }

  private detectContentLengthHeaderStart(): boolean {
    if (!this.bufIn.length) return false;
    const prefix = this.bufIn.slice(0, Math.min(this.bufIn.length, 16)).toString('ascii');
    return prefix.toLowerCase().startsWith('content-length:');
  }

  private parseJsonlMessages(): JsonRpcMessage[] {
    const out: JsonRpcMessage[] = [];
    while (true) {
      const idx = this.bufIn.indexOf(0x0a);
      if (idx < 0) break;
      const lineBuf = this.bufIn.slice(0, idx);
      this.bufIn = this.bufIn.slice(idx + 1);
      const text = lineBuf.toString('utf8').trim();
      if (!text) continue;
      try {
        out.push(JSON.parse(text) as JsonRpcMessage);
      } catch {
        continue;
      }
    }
    return out;
  }

  private parseContentLengthMessages(): JsonRpcMessage[] {
    const out: JsonRpcMessage[] = [];
    while (true) {
      const headerEnd = this.bufIn.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd < 0) break;
      const headerText = this.bufIn.slice(0, headerEnd).toString('ascii');
      const m = headerText.match(/content-length:\s*(\d+)/i);
      const len = m ? Number(m[1]) : NaN;
      if (!Number.isFinite(len) || len < 0) {
        this.bufIn = this.bufIn.slice(headerEnd + 4);
        continue;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + len;
      if (this.bufIn.length < bodyEnd) break;
      const body = this.bufIn.slice(bodyStart, bodyEnd);
      this.bufIn = this.bufIn.slice(bodyEnd);
      try {
        out.push(JSON.parse(body.toString('utf8')) as JsonRpcMessage);
      } catch {
        continue;
      }
    }
    return out;
  }

  private onStdout(chunk: Buffer) {
    try {
      this.bufIn = this.bufIn.length ? Buffer.concat([this.bufIn, chunk]) : chunk;

      const shouldTryContentLength =
        this.configuredFraming === 'content_length' ||
        (this.configuredFraming === 'auto' && (this.detectedFraming === 'content_length' || this.detectContentLengthHeaderStart()));

      const msgs = shouldTryContentLength ? this.parseContentLengthMessages() : this.parseJsonlMessages();
      if (msgs.length && this.configuredFraming === 'auto' && this.detectedFraming == null) {
        this.detectedFraming = shouldTryContentLength ? 'content_length' : 'jsonl';
      }
      for (const msg of msgs) void this.onMessage(msg);
    } catch (e) {
      this.handlers.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

class MockSession {
  private aborted = false;
  private running = false;

  constructor(private emit: (evt: AcpUiEvent) => void) {}

  cancel() {
    this.aborted = true;
  }

  async prompt(promptText: string, runId?: string) {
    if (this.running) throw new Error('Already running');
    this.running = true;
    this.aborted = false;
    try {
      this.emit({ type: 'stage', stage: 'acp:mock:thinking', runId });
      await new Promise((r) => setTimeout(r, 150));
      if (this.aborted) throw new Error('Canceled');
      this.emit({ type: 'reasoning_delta', content: '分析中…\n', runId });
      await new Promise((r) => setTimeout(r, 150));
      if (this.aborted) throw new Error('Canceled');
      this.emit({ type: 'delta', content: `Mock agent reply: ${promptText}\n`, runId });
      this.emit({ type: 'done', runId, traces: [], artifacts: [], usage: null });
    } catch (e: any) {
      const msg = String(e?.message || e || 'Unknown error');
      if (msg.toLowerCase().includes('canceled')) {
        this.emit({ type: 'error', error: 'Canceled', runId });
      } else {
        this.emit({ type: 'error', error: msg, runId });
      }
    } finally {
      this.running = false;
      this.emit({ type: 'stage', stage: '', runId });
    }
  }
}

type AcpSession = {
  id: string;
  key: SessionKey;
  workspaceDir: string;
  threadId: string;
  agent: AcpAgentConfig;
  approvalMode: 'per_action' | 'per_project' | 'always';
  permissionMode: AcpPermissionMode;
  approvedActions: Map<string, boolean>;
  webContentsId: number;
  remoteSessionId?: string;
  proc?: ChildProcessWithoutNullStreams;
  peer?: JsonRpcPeer;
  mock?: MockSession;
  running?: boolean;
  createdAt: number;
  lastError?: string;
  agentInfo?: any;
};

const sessionsById = new Map<string, AcpSession>();
const sessionIdByKey = new Map<SessionKey, string>();
const sessionStore = new Store<{ sessions: Record<string, { remoteSessionId?: string; updatedAt: number }> }>({
  name: 'acp-sessions'
});
const approvalsStore = new Store<{ approvals: Record<string, Record<string, boolean>> }>({
  name: 'acp-approvals'
});

const ACP_PROTOCOL_VERSION = 1;

function buildInitializeParams() {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientInfo: {
      name: 'anima',
      title: 'Anima',
      version: app.getVersion()
    },
    clientCapabilities: {
      fs: {
        readTextFile: false,
        writeTextFile: false
      },
      terminal: false
    }
  };
}

function getStoredApproval(workspaceDir: string, action: string): boolean {
  const root = normAbs(workspaceDir);
  const all = approvalsStore.get('approvals') || {};
  const entry = all[root] || {};
  return entry[action] === true;
}

function setStoredApproval(workspaceDir: string, action: string, allowed: boolean) {
  const root = normAbs(workspaceDir);
  const all = approvalsStore.get('approvals') || {};
  const entry = all[root] || {};
  entry[action] = allowed === true;
  all[root] = entry;
  approvalsStore.set('approvals', all);
}

function resetStoredApprovals(workspaceDir?: string) {
  if (workspaceDir) {
    const root = normAbs(workspaceDir);
    const all = approvalsStore.get('approvals') || {};
    delete all[root];
    approvalsStore.set('approvals', all);
    return;
  }
  approvalsStore.set('approvals', {});
}

function getStoredRemoteSessionId(key: string): string | undefined {
  const all = sessionStore.get('sessions') || {};
  const entry = all[key];
  const sid = String(entry?.remoteSessionId || '').trim();
  return sid || undefined;
}

function setStoredRemoteSessionId(key: string, remoteSessionId: string) {
  const all = sessionStore.get('sessions') || {};
  all[key] = { remoteSessionId, updatedAt: Date.now() };
  sessionStore.set('sessions', all);
}

async function ensureApproved(session: AcpSession, action: string, detail: string): Promise<void> {
  const mode = session.approvalMode || 'per_action';
  if (mode === 'always') return;
  if (mode === 'per_project') {
    const cached = session.approvedActions.get(action);
    if (cached === true) return;
    if (getStoredApproval(session.workspaceDir, action)) {
      session.approvedActions.set(action, true);
      return;
    }
  }

  const wc = webContents.fromId(session.webContentsId);
  const win = wc ? BrowserWindow.fromWebContents(wc) : null;
  const title = 'Anima Permission';
  const allowLabel = mode === 'per_project' ? 'Allow for project' : 'Allow once';
  const scopeNote =
    session.permissionMode === 'full_access'
      ? 'Current mode: full access (no path restrictions).'
      : `Allowed paths:\n- ${session.workspaceDir}\n- ${ACP_WHITELIST_ROOT}`;
  const message = `Allow agent action?\n\nAction:\n${action}\n\nTarget:\n${detail}\n\nWorkspace:\n${session.workspaceDir}\n\n${scopeNote}`;
  const opts: MessageBoxOptions = {
    type: 'question',
    buttons: ['Deny', allowLabel],
    defaultId: 1,
    cancelId: 0,
    title,
    message,
    noLink: true
  };
  const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  const allow = res.response === 1;
  if (!allow) throw new Error('Permission denied');
  if (mode === 'per_project') {
    session.approvedActions.set(action, true);
    setStoredApproval(session.workspaceDir, action, true);
  }
}

function isSessionPathAllowed(session: AcpSession, p: string): boolean {
  if (session.permissionMode === 'full_access') return true;
  return isWithin(session.workspaceDir, p) || isWithin(ACP_WHITELIST_ROOT, p);
}

async function handleClientToolRequest(session: AcpSession, method: string, params: any): Promise<any> {
  const workspaceDir = session.workspaceDir;

  if (method === 'fs/readFile') {
    const p = resolvePathInWorkspace(workspaceDir, String(params?.path || ''));
    if (!p) throw new Error('path is required');
    if (!isSessionPathAllowed(session, p)) throw new Error('Path outside workspace');
    await ensureApproved(session, 'fs/readFile', p);
    const content = await fs.readFile(p, 'utf8');
    return { ok: true, content };
  }

  if (method === 'fs/writeFile') {
    const p = resolvePathInWorkspace(workspaceDir, String(params?.path || ''));
    if (!p) throw new Error('path is required');
    if (!isSessionPathAllowed(session, p)) throw new Error('Path outside workspace');
    await ensureApproved(session, 'fs/writeFile', p);
    const content = String(params?.content ?? '');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
    return { ok: true };
  }

  if (method === 'fs/readDir') {
    const p = resolvePathInWorkspace(workspaceDir, String(params?.path || ''));
    if (!p) throw new Error('path is required');
    if (!isSessionPathAllowed(session, p)) throw new Error('Path outside workspace');
    await ensureApproved(session, 'fs/readDir', p);
    const dirents = await fs.readdir(p, { withFileTypes: true });
    return {
      ok: true,
      entries: dirents
        .map((d) => ({
          name: d.name,
          isDirectory: d.isDirectory(),
          path: path.join(p, d.name)
        }))
        .sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        })
    };
  }

  if (method === 'terminal/run') {
    const cmd = String(params?.command || '').trim();
    if (!cmd) throw new Error('command is required');
    const args = Array.isArray(params?.args) ? params.args.map((x: any) => String(x)) : [];
    const cwdRaw = String(params?.cwd || '').trim();
    const cwd = cwdRaw ? resolvePathInWorkspace(workspaceDir, cwdRaw) : workspaceDir;
    if (!isSessionPathAllowed(session, cwd)) throw new Error('Cwd outside workspace');
    await ensureApproved(session, 'terminal/run', `${cmd} ${args.join(' ')}`.trim());
    const timeoutMs = typeof params?.timeoutMs === 'number' ? params.timeoutMs : 120_000;
    const res = await runWithOsSandbox({
      command: cmd,
      args,
      cwd,
      workspaceDir,
      permissionMode: session.permissionMode,
      timeoutMs,
      allowedRoots: [ACP_WHITELIST_ROOT],
      env: process.env
    });
    return { ok: true, code: res.code, signal: res.signal, stdout: res.stdout, stderr: res.stderr, sandbox: res.sandbox };
  }

  throw new Error(`Unsupported method: ${method}`);
}

function emitToRenderer(session: AcpSession, evt: AcpUiEvent) {
  const channel = `acp:event:${session.id}`;
  try {
    const wc = webContents.fromId(session.webContentsId);
    if (wc && !wc.isDestroyed()) wc.send(channel, evt);
  } catch {
    return;
  }
}

async function ensureSpawned(session: AcpSession) {
  const kind = String(session.agent.kind || 'native_acp').trim() as AcpAgentKind;
  if (kind === 'mock') {
    if (!session.mock) session.mock = new MockSession((evt) => emitToRenderer(session, evt));
    session.agentInfo = { name: session.agent.name || 'Mock Agent', version: '0', capabilities: { mock: true } };
    return;
  }
  if (session.proc && session.peer) return;
  const command = String(session.agent.command || '').trim();
  if (!command) throw new Error('Agent command is required');
  const args = Array.isArray(session.agent.args) ? session.agent.args.map((s) => String(s)) : [];
  const env = { ...process.env, ...(session.agent.env || {}) };

  const proc = spawn(command, args, { cwd: session.workspaceDir, env, stdio: 'pipe' });
  session.proc = proc;

  proc.on('exit', (code, signal) => {
    session.proc = undefined;
    session.peer = undefined;
    session.running = false;
    session.lastError = `Agent exited (code=${code}, signal=${signal})`;
    emitToRenderer(session, { type: 'error', error: session.lastError });
  });

  session.peer = new JsonRpcPeer(proc, { framing: (session.agent as any)?.framing }, {
    onNotification: (method, params) => {
      const update =
        method === 'session/update' && isObject(params) && isObject((params as any).update)
          ? {
              ...(params as any).update,
              type: String((params as any).update.sessionUpdate || ''),
              runId: (params as any).runId
            }
          : isObject(params)
            ? (('type' in params) ? params : { ...params, type: method })
            : { type: method, ...params };
      const mapped = mapAcpUpdateToUiEvent(update);
      if (mapped) emitToRenderer(session, mapped);
    },
    onRequest: async (method, params) => {
      return handleClientToolRequest(session, method, params);
    },
    onError: (err) => {
      session.lastError = err.message || String(err);
      emitToRenderer(session, { type: 'error', error: session.lastError });
    }
  });

  const initRes = await session.peer.sendRequest('initialize', buildInitializeParams()).catch(() => null);
  if (initRes) session.agentInfo = initRes;

  if (!session.remoteSessionId) {
    const stored = getStoredRemoteSessionId(session.key);
    if (stored) session.remoteSessionId = stored;
  }

  if (session.remoteSessionId) {
      const loadRes = await session.peer
      .sendRequest('session/load', { sessionId: session.remoteSessionId, cwd: session.workspaceDir, threadId: session.threadId, mcpServers: [] })
      .catch(() => null);
    if (!loadRes) session.remoteSessionId = undefined;
  }

  if (!session.remoteSessionId) {
    const res = await session.peer.sendRequest('session/new', { cwd: session.workspaceDir, threadId: session.threadId, mcpServers: [] }).catch(() => ({}));
    if (isObject(res) && typeof res.sessionId === 'string' && res.sessionId.trim()) {
      session.remoteSessionId = res.sessionId.trim();
      setStoredRemoteSessionId(session.key, session.remoteSessionId);
    }
  }
}

export function registerAcpService() {
  ipcMain.handle(
    'acp:session:create',
    async (
      event,
      params: {
        workspaceDir: string;
        threadId: string;
        agent: AcpAgentConfig;
        approvalMode?: 'per_action' | 'per_project' | 'always';
        permissionMode?: AcpPermissionMode;
      }
    ) => {
      try {
        const workspaceDir = normAbs(String(params?.workspaceDir || '').trim());
        const threadId = String(params?.threadId || '').trim();
        const agent = params?.agent;
        const agentId = String(agent?.id || '').trim();
        const permissionMode = params?.permissionMode === 'full_access' ? 'full_access' : 'workspace_whitelist';
        if (!workspaceDir) return { ok: false, error: 'workspaceDir is required' };
        if (!threadId) return { ok: false, error: 'threadId is required' };
        if (!agentId) return { ok: false, error: 'agent.id is required' };

        const key = buildKey(workspaceDir, threadId, agentId);
        const existingId = sessionIdByKey.get(key);
        if (existingId) {
          const existing = sessionsById.get(existingId);
          if (existing) {
            existing.permissionMode = permissionMode;
            return { ok: true, sessionId: existing.id };
          }
          sessionIdByKey.delete(key);
        }

        const id = randomId('acps');
        const session: AcpSession = {
          id,
          key,
          workspaceDir,
          threadId,
          agent: { ...agent, id: agentId },
          approvalMode: (params?.approvalMode || 'per_action') as any,
          permissionMode,
          approvedActions: new Map<string, boolean>(),
          webContentsId: event.sender.id,
          createdAt: Date.now()
        };
        sessionsById.set(id, session);
        sessionIdByKey.set(key, id);
        await ensureSpawned(session);
        return { ok: true, sessionId: id };
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
      }
    }
  );

  ipcMain.handle('acp:status', async () => {
    try {
      const sessions = Array.from(sessionsById.values()).map((s) => ({
        id: s.id,
        key: s.key,
        workspaceDir: s.workspaceDir,
        threadId: s.threadId,
        agent: s.agent,
        agentInfo: s.agentInfo ?? null,
        approvalMode: s.approvalMode,
        remoteSessionId: s.remoteSessionId,
        running: Boolean(s.running),
        pid: s.proc?.pid ?? null,
        uptimeMs: Date.now() - s.createdAt,
        lastError: s.lastError || ''
      }));
      return { ok: true, sessions };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('acp:approvals:reset', async (_event, params?: { workspaceDir?: string }) => {
    try {
      const wd = params?.workspaceDir ? String(params.workspaceDir).trim() : '';
      resetStoredApprovals(wd || undefined);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle(
    'acp:session:prompt',
    async (_event, params: { sessionId: string; prompt: string; runId?: string }) => {
      const id = String(params?.sessionId || '').trim();
      const session = sessionsById.get(id);
      if (!session) return { ok: false, error: 'No session' };
      try {
        await ensureSpawned(session);
        const runId = typeof params?.runId === 'string' ? params.runId : undefined;
        if (session.mock) {
          void session.mock.prompt(String(params?.prompt || ''), runId);
          return { ok: true };
        }
        if (!session.peer) throw new Error('Agent not running');
        session.running = true;
        void session.peer
          .sendRequest('session/prompt', {
            sessionId: session.remoteSessionId,
            prompt: [{ type: 'text', text: String(params?.prompt || '') }],
            runId
          })
          .then((result) => {
            session.running = false;
            if (isObject(result) && typeof result.stopReason === 'string') {
              emitToRenderer(session, { type: 'done', runId });
            }
          })
          .catch((e: any) => {
            session.running = false;
            session.lastError = e?.message || String(e);
            emitToRenderer(session, { type: 'error', error: String(session.lastError || 'Unknown error'), runId });
          });
        return { ok: true };
      } catch (e: any) {
        session.lastError = e?.message || String(e);
        return { ok: false, error: e?.message || String(e) };
      }
    }
  );

  ipcMain.handle('acp:session:cancel', async (_event, params: { sessionId: string; runId?: string }) => {
    const id = String(params?.sessionId || '').trim();
    const session = sessionsById.get(id);
    if (!session) return { ok: false, error: 'No session' };
    try {
      await ensureSpawned(session);
      if (session.mock) {
        session.mock.cancel();
        return { ok: true };
      }
      if (!session.peer) throw new Error('Agent not running');
      session.peer.sendNotification('session/cancel', { sessionId: session.remoteSessionId, runId: params?.runId });
      return { ok: true };
    } catch (e: any) {
      session.lastError = e?.message || String(e);
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('acp:session:close', async (_event, params: { sessionId: string }) => {
    const id = String(params?.sessionId || '').trim();
    const session = sessionsById.get(id);
    if (!session) return { ok: false, error: 'No session' };
    try {
      if (session.proc && !session.proc.killed) {
        try {
          session.peer?.sendNotification('session/close', { sessionId: session.remoteSessionId });
        } catch (e) {
          void e;
        }
        try {
          session.proc.kill('SIGTERM');
        } catch (e) {
          void e;
        }
      }
      sessionsById.delete(id);
      sessionIdByKey.delete(session.key);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}
