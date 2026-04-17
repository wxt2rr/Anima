import React, { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  ChevronRight, 
  ChevronDown, 
  RefreshCw,
  RotateCcw,
  Search,
  ArrowLeftRight,
  ZoomIn,
  ZoomOut,
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
  X
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import materialThemeRaw from 'material-icon-theme/dist/material-icons.json';
import { i18nText, resolveAppLang } from '@/i18n'

interface FileNode {
  name: string;
  isDirectory: boolean;
  path: string;
}

const INTERNAL_DND_PATH_MIME = 'application/x-anima-path'

const hasExternalFileType = (dt?: DataTransfer | null): boolean => {
  const types = Array.from(dt?.types || [])
  return types.includes('Files')
}

interface SelectedFile {
  path: string;
  name: string;
  content?: string;
  blobUrl?: string;
  type: 'image' | 'text' | 'pdf' | 'other';
  error?: string;
}

type MaterialThemeLike = {
  iconDefinitions?: Record<string, { iconPath?: string }>
  file?: string
  folder?: string
  folderExpanded?: string
  fileNames?: Record<string, string>
  fileExtensions?: Record<string, string>
  folderNames?: Record<string, string>
  folderNamesExpanded?: Record<string, string>
  rootFolderNames?: Record<string, string>
  rootFolderNamesExpanded?: Record<string, string>
}

const materialTheme = materialThemeRaw as MaterialThemeLike

const MATERIAL_ICON_URLS = import.meta.glob('./material-icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const iconUrlByFileName: Record<string, string> = {}
for (const [path, url] of Object.entries(MATERIAL_ICON_URLS)) {
  const name = String(path || '').split('/').pop() || ''
  if (name) iconUrlByFileName[name] = String(url || '')
}

const FILE_EXT_KEY_OVERRIDES: Record<string, string> = {
  js: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  html: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  wal: 'database',
  shm: 'database',
}

const FILE_NAME_KEY_OVERRIDES: Record<string, string> = {
  '.ds_store': 'document',
  'script.js': 'javascript',
  'index.html': 'html',
  'styles.css': 'css',
}

const FOLDER_NAME_KEY_OVERRIDES: Record<string, { closed: string; open: string }> = {
  '.anima': { closed: 'folder-private', open: 'folder-private-open' },
  '.agents': { closed: 'folder-private', open: 'folder-private-open' },
  '.tmp': { closed: 'folder-temp', open: 'folder-temp-open' },
}

const resolveIconUrlByThemeKey = (themeKey: string): string => {
  const key = String(themeKey || '').trim()
  if (!key) return ''
  const def = materialTheme.iconDefinitions?.[key]
  const iconPath = String(def?.iconPath || '').trim()
  const fileName = iconPath.split('/').pop() || ''
  return iconUrlByFileName[fileName] || ''
}

const resolveThemeKeyForFile = (name: string): string => {
  const base = String(name || '').trim().toLowerCase()
  if (!base) return String(materialTheme.file || 'file')
  if (FILE_NAME_KEY_OVERRIDES[base]) return FILE_NAME_KEY_OVERRIDES[base]
  const byName = materialTheme.fileNames?.[base]
  if (byName) return byName
  const ext = base.includes('.') ? (base.split('.').pop() || '') : ''
  if (ext) {
    const override = FILE_EXT_KEY_OVERRIDES[ext]
    if (override) return override
    const byExt = materialTheme.fileExtensions?.[ext]
    if (byExt) return byExt
    const tail = ext.includes('-') ? (ext.split('-').pop() || '') : ''
    if (tail) {
      const overrideTail = FILE_EXT_KEY_OVERRIDES[tail]
      if (overrideTail) return overrideTail
      const byTail = materialTheme.fileExtensions?.[tail]
      if (byTail) return byTail
    }
  }
  return String(materialTheme.file || 'file')
}

const resolveThemeKeyForFolder = (name: string, expanded: boolean, isRoot = false): string => {
  const base = String(name || '').trim().toLowerCase()
  if (!base) return expanded ? String(materialTheme.folderExpanded || 'folder-open') : String(materialTheme.folder || 'folder')
  const override = FOLDER_NAME_KEY_OVERRIDES[base]
  if (override) return expanded ? override.open : override.closed
  if (isRoot) {
    const rootKey = expanded ? materialTheme.rootFolderNamesExpanded?.[base] : materialTheme.rootFolderNames?.[base]
    if (rootKey) return rootKey
  }
  const byName = expanded ? materialTheme.folderNamesExpanded?.[base] : materialTheme.folderNames?.[base]
  if (byName) return byName
  if (base.startsWith('.')) return expanded ? 'folder-config-open' : 'folder-config'
  return expanded ? String(materialTheme.folderExpanded || 'folder-open') : String(materialTheme.folder || 'folder')
}

const renderMaterialIconByKey = (themeKey: string, alt: string) => {
  const src = resolveIconUrlByThemeKey(themeKey) || resolveIconUrlByThemeKey(String(materialTheme.file || 'file'))
  if (!src) {
    return <span className="inline-block w-4 h-4 rounded-[3px] bg-muted-foreground/30 shrink-0" aria-hidden="true" />
  }
  return <img src={src} alt={alt} className="w-4 h-4 shrink-0" draggable={false} />
}

const getFileIcon = (name: string) => {
  return renderMaterialIconByKey(resolveThemeKeyForFile(name), name || 'file')
};

const getFolderIcon = (name: string, expanded: boolean, isRoot = false) => {
  return renderMaterialIconByKey(resolveThemeKeyForFolder(name, expanded, isRoot), name || 'folder')
}

const getFileType = (name: string): SelectedFile['type'] => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) return 'image';
  if (['pdf'].includes(ext || '')) return 'pdf';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'html', 'css', 'json', 'md', 'txt', 'log', 'yaml', 'yml', 'xml', 'env', 'sh', 'gitignore'].includes(ext || '')) return 'text';
  return 'other';
};

const getLanguage = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js': return 'javascript';
    case 'jsx': return 'jsx';
    case 'ts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'json': return 'json';
    case 'html': return 'html';
    case 'css': return 'css';
    case 'py': return 'python';
    case 'md': return 'markdown';
    case 'yml':
    case 'yaml': return 'yaml';
    case 'sh': return 'bash';
    case 'xml': return 'xml';
    default: return 'text';
  }
};

export const FileExplorer: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const settings = useStore((s) => s.settings)
  const ui = useStore((s) => s.ui)
  const updateSettings = useStore((s) => s.updateSettings)
  const projects = Array.isArray(settings?.projects) ? ((settings as any).projects as any[]) : []
  const activeProjectId = String((ui as any)?.activeProjectId || '').trim()
  const activeProjectDir = activeProjectId
    ? String((projects.find((p) => String(p?.id || '').trim() === activeProjectId) as any)?.dir || '').trim()
    : ''
  const lang = resolveAppLang(settings?.language)
  const [rootPath, setRootPath] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const selectedBlobUrlRef = React.useRef<string | null>(null)
  const prevSidebarWidthRef = React.useRef<number>(240)
  const handledOpenRequestNonceRef = React.useRef<number>(0)
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false)
  const [swapPaneSides, setSwapPaneSides] = useState(false)
  const [isPreviewVisible, setIsPreviewVisible] = useState(false)
  
  // Resize state
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOverDirPath, setDragOverDirPath] = useState('')
  const [uploadingDirPath, setUploadingDirPath] = useState('')
  const [draggingPath, setDraggingPath] = useState('')

  useEffect(() => {
    return () => {
      const prev = selectedBlobUrlRef.current
      if (prev) URL.revokeObjectURL(prev)
      selectedBlobUrlRef.current = null
    }
  }, [])

  const clearSelectedFile = () => {
    const prev = selectedBlobUrlRef.current
    if (prev) URL.revokeObjectURL(prev)
    selectedBlobUrlRef.current = null
    setSelectedFile(null)
  }

  const handleClosePreview = () => {
    clearSelectedFile()
    setIsPreviewVisible(false)
  }

  useEffect(() => {
    if (selectedFile || loadingFile) return
    setIsPreviewVisible(false)
  }, [selectedFile, loadingFile])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      // Calculate new width relative to the sidebar container
      // Since FileExplorer is inside RightSidebar which is right-aligned, 
      // but the resize handle is between Tree (Left) and Preview (Right).
      // We are just changing the width of the Left div.
      // We need to account for the offset if needed, but since it's movement, delta is enough?
      // No, we need absolute position or delta.
      // Easiest is to use movementX but that can desync.
      // Better: width = e.clientX - containerLeft. 
      // But containerLeft changes if we move the window.
      // Let's use simple delta approach or just clamp the width based on movement.
      
      // Actually, since the sidebar is on the right of the screen usually, 
      // but inside the sidebar component, the File Explorer flows LTR.
      // Tree is on the left, Preview on right.
      // So increasing width means dragging to the right.
      // We can just take the previous width + movementX.
      setSidebarWidth(prev => {
        const delta = swapPaneSides ? -e.movementX : e.movementX
        const newWidth = prev + delta;
        return Math.max(150, Math.min(newWidth, 600)); // Clamp between 150px and 600px
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none'; // Prevent text selection
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isResizing, swapPaneSides]);

  useEffect(() => {
    if (!active && rootPath) return
    const init = async () => {
      const base = String(activeProjectDir || settings?.workspaceDir || '').trim()
      if (base) {
        setRootPath(base);
      } else {
        try {
          const res = await window.anima.fs.getCwd();
          if (res.ok && res.cwd) {
            updateSettings({ workspaceDir: res.cwd });
            setRootPath(res.cwd);
          }
        } catch (e) {
          console.error('Failed to get cwd', e);
        }
      }
    };
    init();
  }, [active, activeProjectDir, rootPath, settings?.workspaceDir, updateSettings]);

  useEffect(() => {
    const base = String(activeProjectDir || '').trim()
    if (!base) return
    if (rootPath === base) return
    setRootPath(base)
    setRefreshKey((k) => k + 1)
    clearSelectedFile()
  }, [activeProjectDir, rootPath]);

  const handlePickRoot = async () => {
    const res = await window.anima.window.pickDirectory();
    if (res.ok && !res.canceled) {
      updateSettings({ workspaceDir: res.path });
      setRootPath(res.path);
    }
  };

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
  };

  const handleDropFilesToDir = async (targetDir: string, files: File[]) => {
    const dir = String(targetDir || '').trim()
    if (!dir) return
    const sourcePaths = Array.from(files || [])
      .map((f: any) => String(f?.path || '').trim())
      .filter(Boolean)
    const filesNoPath = Array.from(files || []).filter((f: any) => !String(f?.path || '').trim())
    if (!sourcePaths.length && !filesNoPath.length) return

    if (sourcePaths.length) {
      setUploadingDirPath(dir)
      try {
        const res = await window.anima.fs.copyFilesToDir({ sourcePaths, targetDir: dir })
        if (res.ok) {
          if (Array.isArray(res.failed) && res.failed.length) {
            alert(i18nText(lang, 'fileExplorer.copyPartialFailed', { items: res.failed.slice(0, 3).map((x: any) => String(x?.sourcePath || '')).join(', ') }))
          }
          setRefreshKey((k) => k + 1)
        } else {
          console.error('copyFilesToDir failed', res.error)
          alert(i18nText(lang, 'fileExplorer.copyFailed', { error: String(res.error || 'unknown error') }))
        }
      } catch (e) {
        console.error('copyFilesToDir error', e)
        alert(i18nText(lang, 'fileExplorer.copyFailed', { error: String(e || 'unknown error') }))
      } finally {
        setUploadingDirPath('')
        setDragOverDirPath('')
      }
    }

    if (!filesNoPath.length) return
    setUploadingDirPath(dir)
    try {
      const payload: Array<{ name: string; bytes: number[] }> = []
      for (const f of filesNoPath) {
        const bytes = new Uint8Array(await f.arrayBuffer())
        if (!bytes.length) continue
        payload.push({ name: String(f.name || '').trim() || 'dropped-file', bytes: Array.from(bytes) })
      }
      if (!payload.length) return
      const res = await window.anima.fs.writeFilesToDir({ files: payload, targetDir: dir })
      if (res.ok) {
        if (Array.isArray(res.failed) && res.failed.length) {
          alert(i18nText(lang, 'fileExplorer.writePartialFailed', { items: res.failed.slice(0, 3).map((x: any) => String(x?.name || '')).join(', ') }))
        }
        setRefreshKey((k) => k + 1)
      } else {
        alert(i18nText(lang, 'fileExplorer.writeFailed', { error: String(res.error || 'unknown error') }))
      }
    } catch (e) {
      alert(i18nText(lang, 'fileExplorer.writeFailed', { error: String(e || 'unknown error') }))
    } finally {
      setUploadingDirPath('')
      setDragOverDirPath('')
    }
  }

  const handleMovePathsToDir = async (targetDir: string, sourcePaths: string[]) => {
    const dir = String(targetDir || '').trim()
    const sources = Array.isArray(sourcePaths) ? sourcePaths.map((p) => String(p || '').trim()).filter(Boolean) : []
    if (!dir || !sources.length) return
    setUploadingDirPath(dir)
    try {
      const res = await window.anima.fs.movePathsToDir({ sourcePaths: sources, targetDir: dir })
      if (res.ok) {
        if (Array.isArray(res.failed) && res.failed.length) {
          alert(i18nText(lang, 'fileExplorer.movePartialFailed', { items: res.failed.slice(0, 3).map((x: any) => String(x?.sourcePath || '')).join(', ') }))
        }
        setRefreshKey((k) => k + 1)
      } else {
        console.error('movePathsToDir failed', res.error)
        alert(i18nText(lang, 'fileExplorer.moveFailed', { error: String(res.error || 'unknown error') }))
      }
    } catch (e) {
      console.error('movePathsToDir error', e)
      alert(i18nText(lang, 'fileExplorer.moveFailed', { error: String(e || 'unknown error') }))
    } finally {
      setUploadingDirPath('')
      setDragOverDirPath('')
    }
  }

  const handleToggleExplorer = () => {
    setIsExplorerCollapsed((v) => {
      if (!v) prevSidebarWidthRef.current = sidebarWidth
      return !v
    })
    if (isExplorerCollapsed) setSidebarWidth(prevSidebarWidthRef.current || 240)
  }

  const handleOpenInFinder = async () => {
    const p = String(activeProjectDir || rootPath || settings?.workspaceDir || '').trim()
    if (!p) return
    await window.anima.shell.openPath(p)
  }

  const handleSwapPaneSides = () => {
    setSwapPaneSides((v) => !v)
  }

  const openFilePath = async (filePath: string) => {
    const isMissingFileError = (err: unknown): boolean => {
      const msg = String(err || '').toLowerCase()
      return msg.includes('enoent') || msg.includes('no such file or directory')
    }
    const normalized = String(filePath || '')
      .trim()
      .replace(/[?#].*$/, '');
    if (!normalized) return;
    setIsPreviewVisible(true)
    const name = normalized.split('/').pop() || normalized;
    setLoadingFile(true);
    const type = getFileType(name);
    
    if (type === 'text') {
      const prev = selectedBlobUrlRef.current
      if (prev) URL.revokeObjectURL(prev)
      selectedBlobUrlRef.current = null
      const res = await window.anima.fs.readFile(normalized);
      if (res.ok) {
        setSelectedFile({
          path: normalized,
          name,
          type,
          content: res.content
        });
      } else {
        if (isMissingFileError(res.error)) {
          clearSelectedFile()
          setLoadingFile(false)
          return
        }
        setSelectedFile({
          path: normalized,
          name,
          type,
          error: res.error
        });
      }
    } else {
      const prev = selectedBlobUrlRef.current
      if (prev) URL.revokeObjectURL(prev)
      selectedBlobUrlRef.current = null
      if (type === 'image' || type === 'pdf') {
        const res = await window.anima.fs.readFileBinary(normalized)
        if (res.ok && res.base64) {
          const binary = atob(res.base64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
          const mime = String(res.mime || '').trim() || (type === 'pdf' ? 'application/pdf' : 'application/octet-stream')
          const blob = new Blob([bytes], { type: mime })
          const blobUrl = URL.createObjectURL(blob)
          selectedBlobUrlRef.current = blobUrl
          setSelectedFile({ path: normalized, name, type, blobUrl })
        } else {
          if (isMissingFileError(res.error)) {
            clearSelectedFile()
            setLoadingFile(false)
            return
          }
          setSelectedFile({ path: normalized, name, type, error: res.error || 'Failed to read file' })
        }
      } else {
        setSelectedFile({ path: normalized, name, type })
      }
    }
    setLoadingFile(false);
  };

  const handleFileSelect = async (file: FileNode) => {
    if (file.isDirectory) return;
    await openFilePath(file.path);
  };

  useEffect(() => {
    if (!active) return
    const req = ui.fileExplorerRequest;
    const nonce = Number(req?.nonce || 0)
    if (!nonce) return;
    if (handledOpenRequestNonceRef.current === nonce) return
    const raw = String(req.path || '').trim();
    if (!raw) return;
    handledOpenRequestNonceRef.current = nonce
    const withoutScheme = raw.startsWith('file://') ? raw.slice('file://'.length) : raw;
    const withoutFragment = withoutScheme.replace(/[?#].*$/, '');
    const base = activeProjectDir || rootPath || settings?.workspaceDir || '';
    const fullPath = withoutFragment.startsWith('/')
      ? withoutFragment
      : (base ? `${base.replace(/\/$/, '')}/${withoutFragment.replace(/^\//, '')}` : withoutFragment);
    void openFilePath(fullPath);
  }, [active, activeProjectDir, rootPath, settings?.workspaceDir, ui.fileExplorerRequest]);

  if (!rootPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center space-y-4">
        <img src={resolveIconUrlByThemeKey('folder-open') || resolveIconUrlByThemeKey('folder')} alt="folder" className="w-12 h-12 opacity-30" draggable={false} />
        <p className="text-sm text-muted-foreground">{i18nText(lang, 'fileExplorer.noFolderOpened')}</p>
        <Button onClick={handlePickRoot} size="sm">{i18nText(lang, 'fileExplorer.openFolder')}</Button>
      </div>
    );
  }

  const treePane = isExplorerCollapsed ? (
        <div className="flex flex-col h-full shrink-0 border-r border-black/5 bg-white w-10">
          <div className="h-9 flex items-center justify-center border-b border-black/5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleToggleExplorer}
              title={i18nText(lang, 'fileExplorer.expand')}
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex-1 flex flex-col items-center gap-1 p-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleSwapPaneSides}
              title={swapPaneSides ? i18nText(lang, 'fileExplorer.moveExplorerLeft') : i18nText(lang, 'fileExplorer.moveExplorerRight')}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleRefresh}
              title={i18nText(lang, 'fileExplorer.refresh')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => void handleOpenInFinder()}
              title={i18nText(lang, 'fileExplorer.openInFinder')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div 
          className="flex flex-col h-full shrink-0 transition-none border-r border-black/5"
          style={{ width: isPreviewVisible ? sidebarWidth : '100%' }}
        >
          <div className="h-9 px-2 flex items-center justify-between border-b border-black/5 bg-white shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2">{i18nText(lang, 'fileExplorer.explorer')}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={handleToggleExplorer}
                title={i18nText(lang, 'fileExplorer.collapse')}
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={handleSwapPaneSides}
                title={swapPaneSides ? i18nText(lang, 'fileExplorer.moveExplorerLeft') : i18nText(lang, 'fileExplorer.moveExplorerRight')}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => void handleOpenInFinder()}
                title={i18nText(lang, 'fileExplorer.openInFinder')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={handleRefresh}
                title={i18nText(lang, 'fileExplorer.refresh')}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2">
               <FileTreeItem 
                 key={`${rootPath}-${refreshKey}`}
                 path={rootPath} 
                 name={rootPath.split('/').pop() || rootPath} 
                 isDirectory={true} 
                 defaultExpanded={true}
                 isRoot={true}
                 onSelect={handleFileSelect}
                 selectedPath={selectedFile?.path}
                 dragOverDirPath={dragOverDirPath}
                 uploadingDirPath={uploadingDirPath}
                 draggingPath={draggingPath}
                 onSetDragOverDirPath={setDragOverDirPath}
                 onSetDraggingPath={setDraggingPath}
                 onDropFilesToDir={handleDropFilesToDir}
                 onMovePathsToDir={handleMovePathsToDir}
               />
            </div>
          </ScrollArea>
        </div>
      )

  const resizeHandle = !isExplorerCollapsed && isPreviewVisible ? (
        <div
          className={cn(
            "w-1 h-full cursor-col-resize hover:bg-black/10 transition-colors flex items-center justify-center group z-10 shrink-0",
            isResizing && "bg-black/10"
          )}
          onMouseDown={() => setIsResizing(true)}
        >
          <div className="w-[1px] h-8 bg-black/10 group-hover:bg-black/20 transition-colors" />
        </div>
      ) : null

  const previewPane = (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white min-w-0">
        {selectedFile ? (
          <FilePreview file={selectedFile} loading={loadingFile} onClose={handleClosePreview} active={active} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2 p-8 text-center opacity-50">
            <Search className="w-10 h-10 stroke-1" />
            <p className="text-xs">{i18nText(lang, 'fileExplorer.selectFileToPreview')}</p>
          </div>
        )}
    </div>
  )

  return (
    <div className="flex h-full w-full overflow-hidden">
      {!isPreviewVisible ? (
        treePane
      ) : (
      <>
      {swapPaneSides ? (
        <>
          {previewPane}
          {resizeHandle}
          {treePane}
        </>
      ) : (
        <>
          {treePane}
          {resizeHandle}
          {previewPane}
        </>
      )}
      </>
      )}
    </div>
  );
};

const FileTreeItem: React.FC<{ 
  path: string, 
  name: string, 
  isDirectory: boolean, 
  defaultExpanded?: boolean,
  isRoot?: boolean,
  onSelect: (file: FileNode) => void,
  selectedPath?: string,
  dragOverDirPath: string,
  uploadingDirPath: string,
  draggingPath: string,
  onSetDragOverDirPath: (path: string) => void,
  onSetDraggingPath: (path: string) => void,
  onDropFilesToDir: (targetDir: string, files: File[]) => Promise<void>
  onMovePathsToDir: (targetDir: string, sourcePaths: string[]) => Promise<void>
}> = ({ path, name, isDirectory, defaultExpanded, isRoot = false, onSelect, selectedPath, dragOverDirPath, uploadingDirPath, draggingPath, onSetDragOverDirPath, onSetDraggingPath, onDropFilesToDir, onMovePathsToDir }) => {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isDirectory) return;
    const target = String(selectedPath || '').trim();
    if (!target) return;
    const prefix = path.endsWith('/') ? path : `${path}/`;
    if (target.startsWith(prefix) && !expanded) {
      setExpanded(true);
    }
  }, [expanded, isDirectory, path, selectedPath]);

  useEffect(() => {
    if (!isDirectory || !expanded || loaded) return;
    let cancelled = false;
    window.anima.fs.readDir(path).then((res) => {
      if (cancelled) return;
      if (res.ok && res.files) {
        setChildren(res.files);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, loaded, isDirectory, path]);

  const toggleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isDirectory) {
      onSelect({ name, isDirectory, path });
      return;
    }
    setExpanded(!expanded);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isDirectory) return
    const dragTypes = Array.from(e.dataTransfer?.types || [])
    const hasInternalPathType = dragTypes.includes(INTERNAL_DND_PATH_MIME) || dragTypes.includes('text/plain')
    const hasInternalPath = Boolean(String(draggingPath || '').trim())
    const hasExternalFiles = hasExternalFileType(e.dataTransfer)
    if (!hasExternalFiles && !hasInternalPathType && !hasInternalPath) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = hasExternalFiles ? 'copy' : 'move'
    if (dragOverDirPath !== path) onSetDragOverDirPath(path)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isDirectory) return
    const next = e.relatedTarget as Node | null
    if (next && (e.currentTarget as HTMLDivElement).contains(next)) return
    if (dragOverDirPath === path) onSetDragOverDirPath('')
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!isDirectory) return
    const internalPath = String(
      e.dataTransfer?.getData(INTERNAL_DND_PATH_MIME) ||
      e.dataTransfer?.getData('text/plain') ||
      draggingPath
    ).trim()
    const hasExternalFiles = hasExternalFileType(e.dataTransfer)
    if (!hasExternalFiles && !internalPath) return
    e.preventDefault()
    e.stopPropagation()

    if (internalPath) {
      const sourcePath = internalPath
      if (sourcePath === path) return
      const sourcePrefix = sourcePath.endsWith('/') ? sourcePath : `${sourcePath}/`
      if (path.startsWith(sourcePrefix)) return
      await onMovePathsToDir(path, [sourcePath])
      onSetDraggingPath('')
      return
    }
    const droppedFiles = Array.from(e.dataTransfer.files || [])
    if (!droppedFiles.length) {
      const lang = resolveAppLang(useStore.getState().settings?.language)
      alert(i18nText(lang, 'fileExplorer.externalDropEmpty'))
      return
    }
    await onDropFilesToDir(path, droppedFiles)
  }

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (isRoot) return
    onSetDraggingPath(path)
    e.dataTransfer.setData(INTERNAL_DND_PATH_MIME, path)
    e.dataTransfer.setData('text/plain', path)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    onSetDraggingPath('')
    onSetDragOverDirPath('')
  }

  return (
    <div>
      <div 
        className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm select-none transition-colors ${
          dragOverDirPath === path
            ? 'bg-primary/15 ring-1 ring-primary/30'
            : selectedPath === path
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
        } ${uploadingDirPath === path ? 'opacity-70' : ''}`}
        onClick={toggleExpand}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => {
          void handleDrop(e)
        }}
        draggable={!isRoot}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ paddingLeft: isDirectory ? undefined : '20px' }}
      >
        {isDirectory && (
          <span className="text-muted-foreground shrink-0">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
        <div className="shrink-0">
          {isDirectory ? (
            getFolderIcon(name, expanded, isRoot)
          ) : (
            getFileIcon(name)
          )}
        </div>
        <span className="truncate">{name}</span>
      </div>
      {isDirectory && expanded && (
        <div
          className="relative pl-3 ml-2.5 before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px before:bg-[repeating-linear-gradient(to_bottom,_#d4d4d8_0px,_#d4d4d8_3px,_transparent_3px,_transparent_11px)]"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => {
            void handleDrop(e)
          }}
        >
          {children.map(child => (
            <FileTreeItem 
              key={child.path} 
              {...child} 
              isRoot={false}
              onSelect={onSelect}
              selectedPath={selectedPath}
              dragOverDirPath={dragOverDirPath}
              uploadingDirPath={uploadingDirPath}
              draggingPath={draggingPath}
              onSetDragOverDirPath={onSetDragOverDirPath}
              onSetDraggingPath={onSetDraggingPath}
              onDropFilesToDir={onDropFilesToDir}
              onMovePathsToDir={onMovePathsToDir}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FilePreview: React.FC<{ file: SelectedFile, loading: boolean, onClose: () => void; active: boolean }> = ({ file, loading, onClose, active }) => {
  const lang = resolveAppLang(useStore((s) => s.settings?.language))
  const [scale, setScale] = useState(1);

  if (!active) {
    return (
      <div className="flex flex-col h-full">
        <div className="h-9 px-4 flex items-center justify-between border-b border-black/5 bg-white shrink-0">
          <div className="flex items-center gap-2 overflow-hidden">
            {getFileIcon(file.name)}
            <span className="text-xs font-medium truncate">{file.name}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title={i18nText(lang, 'common.close')}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">{i18nText(lang, 'fileExplorer.previewPaused')}</div>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">{i18nText(lang, 'fileExplorer.loading')}</div>;
  }

  if (file.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center text-destructive space-y-2">
        <p className="font-medium">{i18nText(lang, 'fileExplorer.errorLoadingFile')}</p>
        <p className="text-xs opacity-70">{file.error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-black/5 bg-white shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          {getFileIcon(file.name)}
          <span className="text-xs font-medium truncate">{file.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title={i18nText(lang, 'common.close')}>
            <X className="w-3.5 h-3.5" />
          </Button>
          {file.type === 'image' && (
            <>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setScale(s => Math.max(0.1, s - 0.1))}>
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[10px] w-8 text-center">{Math.round(scale * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setScale(s => Math.min(5, s + 0.1))}>
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setScale(1)}>
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 bg-white">
        <div className="min-h-full flex flex-col relative">
          {file.type === 'text' && (
            <div className="h-full text-xs">
              {file.name.endsWith('.md') ? (
                <div className="p-6 prose dark:prose-invert prose-sm max-w-none prose-headings:font-semibold prose-a:text-primary hover:prose-a:underline">
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {file.content}
                  </Markdown>
                </div>
              ) : (
                <SyntaxHighlighter
                  language={getLanguage(file.name)}
                  style={vscDarkPlus}
                  customStyle={{ margin: 0, padding: '1rem', height: '100%', fontSize: '12px', lineHeight: '1.5' }}
                  showLineNumbers={true}
                  wrapLines={true} // Allow wrapping for long lines if needed, or false for scroll
                >
                  {file.content || ''}
                </SyntaxHighlighter>
              )}
            </div>
          )}

          {file.type === 'image' && (
            <div className="flex items-center justify-center min-h-[300px] p-4">
              <img 
                src={file.blobUrl || `file://${file.path}`} 
                alt={file.name}
                style={{ transform: `scale(${scale})`, transition: 'transform 0.2s' }}
                className="max-w-full shadow-md rounded border bg-[url('https://ui.shadcn.com/placeholder.svg')] bg-repeat" // pattern bg for transparent images
              />
            </div>
          )}

          {file.type === 'pdf' && (
            <div className="h-full w-full flex flex-col">
              <iframe 
                src={file.blobUrl || `file://${file.path}`} 
                className="flex-1 w-full h-full border-0"
              />
            </div>
          )}

          {file.type === 'other' && (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
              <img src={resolveIconUrlByThemeKey(String(materialTheme.file || 'file'))} alt="file" className="w-16 h-16 opacity-20" draggable={false} />
              <div className="space-y-1">
                <p className="text-sm font-medium">{i18nText(lang, 'fileExplorer.previewNotAvailable')}</p>
                <p className="text-xs text-muted-foreground">{i18nText(lang, 'fileExplorer.previewNotAvailableHint')}</p>
              </div>
              <p className="text-xs font-mono bg-muted px-2 py-1 rounded">{file.path}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
