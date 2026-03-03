import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path from 'path';

function guessMime(filePath: string): string {
  const ext = path.extname(String(filePath || '')).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.pdf') return 'application/pdf'
  return 'application/octet-stream'
}

export function registerFileService() {
  ipcMain.handle('fs:readDir', async (_, dirPath: string) => {
    try {
      const dirents = await fs.readdir(dirPath, { withFileTypes: true });
      return {
        ok: true,
        files: dirents.map(d => ({
          name: d.name,
          isDirectory: d.isDirectory(),
          path: path.join(dirPath, d.name)
        })).sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        })
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { ok: true, content };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('fs:readFileBinary', async (_, filePath: string) => {
    try {
      const buf = await fs.readFile(filePath)
      return { ok: true, base64: Buffer.from(buf).toString('base64'), mime: guessMime(filePath) }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle('fs:getCwd', async () => {
    return { ok: true, cwd: process.cwd() };
  });
}
