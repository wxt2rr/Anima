import React, { useState, useEffect } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  ChevronRight, 
  ChevronDown, 
  File as FileIcon, 
  Folder, 
  FolderOpen, 
  RefreshCw,
  FileImage,
  FileCode,
  FileText,
  FileJson,
  FileArchive,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';

interface FileNode {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface SelectedFile {
  path: string;
  name: string;
  content?: string;
  type: 'image' | 'text' | 'pdf' | 'other';
  error?: string;
}

const getFileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <FileImage className="w-4 h-4 text-purple-500" />;
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'html':
    case 'css':
      return <FileCode className="w-4 h-4 text-primary" />;
    case 'json':
    case 'yaml':
    case 'yml':
      return <FileJson className="w-4 h-4 text-yellow-500" />;
    case 'md':
    case 'txt':
    case 'log':
      return <FileText className="w-4 h-4 text-slate-500" />;
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
      return <FileArchive className="w-4 h-4 text-red-500" />;
    default:
      return <FileIcon className="w-4 h-4 text-muted-foreground" />;
  }
};

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

export const FileExplorer: React.FC = () => {
  const { settings, updateSettings, ui } = useStore();
  const [rootPath, setRootPath] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  
  // Resize state
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

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
        const newWidth = prev + e.movementX;
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
  }, [isResizing]);

  useEffect(() => {
    const init = async () => {
      if (settings?.workspaceDir) {
        setRootPath(settings.workspaceDir);
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
  }, [settings?.workspaceDir, updateSettings]);

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

  const openFilePath = async (filePath: string) => {
    const normalized = String(filePath || '')
      .trim()
      .replace(/[?#].*$/, '');
    if (!normalized) return;
    const name = normalized.split('/').pop() || normalized;
    setLoadingFile(true);
    const type = getFileType(name);
    
    if (type === 'text') {
      const res = await window.anima.fs.readFile(normalized);
      if (res.ok) {
        setSelectedFile({
          path: normalized,
          name,
          type,
          content: res.content
        });
      } else {
        setSelectedFile({
          path: normalized,
          name,
          type,
          error: res.error
        });
      }
    } else {
      // For images/pdf, we just use the path
      setSelectedFile({
        path: normalized,
        name,
        type
      });
    }
    setLoadingFile(false);
  };

  const handleFileSelect = async (file: FileNode) => {
    if (file.isDirectory) return;
    await openFilePath(file.path);
  };

  useEffect(() => {
    const req = ui.fileExplorerRequest;
    if (!req?.nonce) return;
    const raw = String(req.path || '').trim();
    if (!raw) return;
    const withoutScheme = raw.startsWith('file://') ? raw.slice('file://'.length) : raw;
    const withoutFragment = withoutScheme.replace(/[?#].*$/, '');
    const base = rootPath || settings?.workspaceDir || '';
    const fullPath = withoutFragment.startsWith('/')
      ? withoutFragment
      : (base ? `${base.replace(/\/$/, '')}/${withoutFragment.replace(/^\//, '')}` : withoutFragment);
    const dir = fullPath.split('/').slice(0, -1).join('/');
    if (dir && settings?.workspaceDir !== dir && !fullPath.startsWith((settings?.workspaceDir || '').replace(/\/$/, '') + '/')) {
      updateSettings({ workspaceDir: dir });
      setRootPath(dir);
      setRefreshKey((k) => k + 1);
    }
    void openFilePath(fullPath);
  }, [rootPath, settings?.workspaceDir, ui.fileExplorerRequest, updateSettings]);

  if (!rootPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center space-y-4">
        <FolderOpen className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No folder opened.</p>
        <Button onClick={handlePickRoot} size="sm">Open Folder</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Left: File Tree */}
      <div 
        className="flex flex-col h-full shrink-0 transition-none border-r border-border" // Remove transition during resize
        style={{ width: sidebarWidth }}
      >
        <div className="h-9 px-4 flex items-center justify-between border-b border-border/40 bg-muted/5 shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Explorer</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={handleRefresh} title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
             <FileTreeItem 
               key={`${rootPath}-${refreshKey}`}
               path={rootPath} 
               name={rootPath.split('/').pop() || rootPath} 
               isDirectory={true} 
               defaultExpanded={true}
               onSelect={handleFileSelect}
               selectedPath={selectedFile?.path}
             />
          </div>
        </ScrollArea>
      </div>

      {/* Resize Handle */}
      <div
        className={cn(
          "w-1 h-full cursor-col-resize hover:bg-primary/50 transition-colors flex items-center justify-center group z-10 shrink-0",
          isResizing && "bg-primary/50"
        )}
        onMouseDown={() => setIsResizing(true)}
      >
        {/* Optional: Visual indicator */}
        <div className="w-[1px] h-8 bg-border group-hover:bg-primary/80 transition-colors" />
      </div>

      {/* Right: Preview */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-background min-w-0">
        {selectedFile ? (
          <FilePreview file={selectedFile} loading={loadingFile} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-2 p-8 text-center opacity-50">
            <Search className="w-10 h-10 stroke-1" />
            <p className="text-xs">Select a file to preview</p>
          </div>
        )}
      </div>
    </div>
  );
};

const FileTreeItem: React.FC<{ 
  path: string, 
  name: string, 
  isDirectory: boolean, 
  defaultExpanded?: boolean,
  onSelect: (file: FileNode) => void,
  selectedPath?: string
}> = ({ path, name, isDirectory, defaultExpanded, onSelect, selectedPath }) => {
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

  return (
    <div>
      <div 
        className={`flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm select-none transition-colors ${selectedPath === path ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
        onClick={toggleExpand}
        style={{ paddingLeft: isDirectory ? undefined : '20px' }}
      >
        {isDirectory && (
          <span className="text-muted-foreground shrink-0">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
        <div className="shrink-0">
          {isDirectory ? (
            expanded ? <FolderOpen className="w-4 h-4 text-primary" /> : <Folder className="w-4 h-4 text-primary" />
          ) : (
            getFileIcon(name)
          )}
        </div>
        <span className="truncate">{name}</span>
      </div>
      {isDirectory && expanded && (
        <div className="pl-3 border-l border-border/40 ml-2.5">
          {children.map(child => (
            <FileTreeItem 
              key={child.path} 
              {...child} 
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FilePreview: React.FC<{ file: SelectedFile, loading: boolean }> = ({ file, loading }) => {
  const [scale, setScale] = useState(1);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading...</div>;
  }

  if (file.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center text-destructive space-y-2">
        <p className="font-medium">Error loading file</p>
        <p className="text-xs opacity-70">{file.error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-9 px-4 flex items-center justify-between border-b border-border bg-muted/10 shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          {getFileIcon(file.name)}
          <span className="text-xs font-medium truncate">{file.name}</span>
        </div>
        <div className="flex items-center gap-1">
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
      <ScrollArea className="flex-1 bg-background">
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
                src={`file://${file.path}`} 
                alt={file.name}
                style={{ transform: `scale(${scale})`, transition: 'transform 0.2s' }}
                className="max-w-full shadow-md rounded border bg-[url('https://ui.shadcn.com/placeholder.svg')] bg-repeat" // pattern bg for transparent images
              />
            </div>
          )}

          {file.type === 'pdf' && (
            <div className="h-full w-full flex flex-col">
              <iframe 
                src={`file://${file.path}`} 
                className="flex-1 w-full h-full border-0"
              />
            </div>
          )}

          {file.type === 'other' && (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
              <FileIcon className="w-16 h-16 text-muted-foreground/20" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Preview not available</p>
                <p className="text-xs text-muted-foreground">This file type cannot be previewed directly.</p>
              </div>
              <p className="text-xs font-mono bg-muted px-2 py-1 rounded">{file.path}</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
