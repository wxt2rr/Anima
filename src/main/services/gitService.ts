import { ipcMain } from 'electron';
import simpleGit from 'simple-git';

function toIpcSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function registerGitService() {
  ipcMain.handle('git:checkIsRepo', async (_, cwd: string) => {
    try {
      const git = simpleGit(cwd);
      const isRepo = await git.checkIsRepo();
      return { ok: true, isRepo };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:init', async (_, cwd: string) => {
    try {
      const git = simpleGit(cwd);
      await git.init();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:getBranches', async (_, cwd: string) => {
    try {
      const git = simpleGit(cwd);
      let branches: string[] = [];
      let current = '';

      try {
        const summary = await git.branchLocal();
        branches = summary.all || [];
        current = summary.current || '';
      } catch {
        // ignore and fall back to raw commands
      }

      if (!current) {
        try {
          current = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
        } catch {
          // ignore
        }
      }

      if (!branches.length) {
        try {
          const out = await git.raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
          branches = out
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        } catch {
          // ignore
        }
      }

      if (current && !branches.includes(current)) branches = [current, ...branches];
      branches = Array.from(new Set(branches));

      return { ok: true, branches, current };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:checkout', async (_, { cwd, branch }: { cwd: string; branch: string }) => {
    try {
      const git = simpleGit(cwd);
      await git.checkout(branch);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:status', async (_, cwd: string) => {
    try {
      const git = simpleGit(cwd);
      const status = await git.status();
      return { ok: true, status: toIpcSafe(status) };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:commit', async (_, { cwd, message, files }: { cwd: string; message: string; files?: string[] }) => {
    try {
      const git = simpleGit(cwd);
      // files logic is handled in frontend by calling add/reset before commit usually, 
      // but if provided here we can use it. 
      // simple-git commit accepts files as second arg.
      // However, usually we stage first.
      // Let's assume files are already staged or we stage them now.
      if (files && files.length > 0) {
        await git.add(files);
      }
      const result = await git.commit(message);
      return { ok: true, result: toIpcSafe(result) };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:add', async (_, { cwd, files }: { cwd: string, files: string[] }) => {
    try {
      const git = simpleGit(cwd);
      await git.add(files);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:unstage', async (_, { cwd, files }: { cwd: string, files: string[] }) => {
    try {
      const git = simpleGit(cwd);
      await git.reset(['--', ...files]);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:getStashes', async (_, cwd: string) => {
    try {
      const git = simpleGit(cwd);
      const stashList = await git.stashList();
      return { ok: true, stashes: stashList.all };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:getLog', async (_, cwd: string) => {
    try {
      const git = simpleGit(cwd);
      const log = await git.log({ maxCount: 20 });
      return { ok: true, logs: log.all };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('git:diff', async (_, { cwd, file }: { cwd: string, file: string }) => {
    try {
        const git = simpleGit(cwd);
        const diff = await git.diff([file]);
        return { ok: true, diff };
    } catch (error: any) {
        return { ok: false, error: error.message };
    }
  });
}
