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
  const exists = async (p: string) => {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  }

  const uniquePath = async (dir: string, baseName: string) => {
    const parsed = path.parse(baseName)
    const rawName = parsed.name || 'file'
    const ext = parsed.ext || ''
    let idx = 0
    while (idx < 10000) {
      const candidateName = idx === 0 ? `${rawName}${ext}` : `${rawName} (${idx})${ext}`
      const candidatePath = path.join(dir, candidateName)
      if (!(await exists(candidatePath))) return candidatePath
      idx += 1
    }
    throw new Error('cannot resolve unique file name')
  }

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

  ipcMain.handle('fs:copyFilesToDir', async (_, params: { sourcePaths?: string[]; targetDir?: string }) => {
    try {
      const targetDir = String(params?.targetDir || '').trim()
      const sourcePaths = Array.isArray(params?.sourcePaths)
        ? params!.sourcePaths.map((p) => String(p || '').trim()).filter(Boolean)
        : []
      if (!targetDir) return { ok: false, error: 'targetDir is required' }
      if (!sourcePaths.length) return { ok: false, error: 'sourcePaths is required' }

      const targetStat = await fs.stat(targetDir)
      if (!targetStat.isDirectory()) return { ok: false, error: 'targetDir is not a directory' }

      const copied: Array<{ sourcePath: string; targetPath: string }> = []
      const failed: Array<{ sourcePath: string; error: string }> = []
      for (const sourcePath of sourcePaths) {
        try {
          const srcStat = await fs.stat(sourcePath)
          if (!srcStat.isFile()) throw new Error('source is not a file')
          const destPath = await uniquePath(targetDir, path.basename(sourcePath))
          await fs.copyFile(sourcePath, destPath)
          copied.push({ sourcePath, targetPath: destPath })
        } catch (error: any) {
          failed.push({ sourcePath, error: String(error?.message || error || 'copy failed') })
        }
      }

      return { ok: true, copied, failed }
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error || 'copy failed') }
    }
  })

  ipcMain.handle('fs:movePathsToDir', async (_, params: { sourcePaths?: string[]; targetDir?: string }) => {
    try {
      const targetDir = String(params?.targetDir || '').trim()
      const sourcePaths = Array.isArray(params?.sourcePaths)
        ? params!.sourcePaths.map((p) => String(p || '').trim()).filter(Boolean)
        : []
      if (!targetDir) return { ok: false, error: 'targetDir is required' }
      if (!sourcePaths.length) return { ok: false, error: 'sourcePaths is required' }

      const targetStat = await fs.stat(targetDir)
      if (!targetStat.isDirectory()) return { ok: false, error: 'targetDir is not a directory' }

      const moved: Array<{ sourcePath: string; targetPath: string }> = []
      const failed: Array<{ sourcePath: string; error: string }> = []
      for (const sourcePath of sourcePaths) {
        try {
          const srcStat = await fs.stat(sourcePath)
          const normalizedSource = path.resolve(sourcePath)
          const normalizedTargetDir = path.resolve(targetDir)
          if (normalizedSource === normalizedTargetDir) throw new Error('cannot move path into itself')

          if (srcStat.isDirectory()) {
            const prefix = `${normalizedSource}${path.sep}`
            if (normalizedTargetDir.startsWith(prefix)) {
              throw new Error('cannot move directory into its descendant')
            }
          }

          const sourceName = path.basename(normalizedSource)
          const destPath = await uniquePath(normalizedTargetDir, sourceName)
          await fs.rename(normalizedSource, destPath)
          moved.push({ sourcePath, targetPath: destPath })
        } catch (error: any) {
          failed.push({ sourcePath, error: String(error?.message || error || 'move failed') })
        }
      }

      return { ok: true, moved, failed }
    } catch (error: any) {
      return { ok: false, error: String(error?.message || error || 'move failed') }
    }
  })

  ipcMain.handle(
    'fs:writeFilesToDir',
    async (_, params: { files?: Array<{ name?: string; bytes?: number[] }>; targetDir?: string }) => {
      try {
        const targetDir = String(params?.targetDir || '').trim()
        const files = Array.isArray(params?.files) ? params!.files : []
        if (!targetDir) return { ok: false, error: 'targetDir is required' }
        if (!files.length) return { ok: false, error: 'files is required' }

        const targetStat = await fs.stat(targetDir)
        if (!targetStat.isDirectory()) return { ok: false, error: 'targetDir is not a directory' }

        const written: Array<{ name: string; targetPath: string }> = []
        const failed: Array<{ name: string; error: string }> = []
        for (const item of files) {
          const name = String(item?.name || '').trim() || `dropped-${Date.now()}`
          const bytes = Array.isArray(item?.bytes) ? item!.bytes : []
          if (!bytes.length) {
            failed.push({ name, error: 'empty file bytes' })
            continue
          }
          try {
            const destPath = await uniquePath(targetDir, path.basename(name))
            await fs.writeFile(destPath, Buffer.from(Uint8Array.from(bytes)))
            written.push({ name, targetPath: destPath })
          } catch (error: any) {
            failed.push({ name, error: String(error?.message || error || 'write failed') })
          }
        }

        return { ok: true, written, failed }
      } catch (error: any) {
        return { ok: false, error: String(error?.message || error || 'write failed') }
      }
    }
  )
}
