import React, { useState, useEffect } from 'react';
import { RefreshCw, Check, Play, Plus, GitBranch, GitCommit, Archive, ChevronRight, ChevronDown, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { useStore } from '@/store/useStore';

export const GitPanel: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const settings = useStore((s) => s.settings)
  const ui = useStore((s) => s.ui)
  const projects = Array.isArray(settings?.projects) ? ((settings as any).projects as any[]) : []
  const activeProjectId = String((ui as any)?.activeProjectId || '').trim()
  const activeProjectDir = activeProjectId
    ? String((projects.find((p) => String(p?.id || '').trim() === activeProjectId) as any)?.dir || '').trim()
    : ''
  const [cwd, setCwd] = useState<string>('');
  const [isRepo, setIsRepo] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [stashes, setStashes] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Accordion states
  const [changesOpen, setChangesOpen] = useState(true);
  const [stashesOpen, setStashesOpen] = useState(true);
  const [headOpen, setHeadOpen] = useState(true);
  const debugEnabled = typeof import.meta !== 'undefined' && Boolean((import.meta as any).env?.DEV)
  const debugRef = React.useRef({ renders: 0, refreshes: 0 })
  debugRef.current.renders += 1
  if (debugEnabled) {
    console.debug('[GitPanel][render]', {
      renders: debugRef.current.renders,
      active,
      activeProjectDir,
      workspaceDir: settings?.workspaceDir || '',
      cwd,
      isRepo,
      loading
    })
  }

  const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    let timer: number | null = null
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('timeout')), ms)
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer != null) window.clearTimeout(timer)
    }
  }

  const refreshAll = async (path: string) => {
    debugRef.current.refreshes += 1
    const refreshId = debugRef.current.refreshes
    if (debugEnabled) {
      console.debug('[GitPanel][refresh:start]', {
        refreshId,
        path,
        active,
        cwd,
        workspaceDir: settings?.workspaceDir || ''
      })
    }
    setLoading(true);
    try {
      const repoCheck = await withTimeout(window.anima.git.checkIsRepo(path), 3000);
      const nextIsRepo = Boolean(repoCheck?.ok && repoCheck?.isRepo)
      setIsRepo(nextIsRepo);
      if (debugEnabled) {
        console.debug('[GitPanel][refresh:repoCheck]', { refreshId, path, repoCheck, nextIsRepo })
      }

      if (!nextIsRepo) {
        setStatus(null)
        setBranches([])
        setCurrentBranch('')
        setStashes([])
        setLogs([])
        if (debugEnabled) {
          console.debug('[GitPanel][refresh:end]', { refreshId, path, nextIsRepo, reason: 'not_repo' })
        }
        return
      }

      const [statusRes, branchRes, stashRes, logRes] = await Promise.all([
        window.anima.git.status(path),
        window.anima.git.getBranches(path),
        window.anima.git.getStashes(path),
        window.anima.git.getLog(path)
      ]);

      if (statusRes.ok) setStatus(statusRes.status);
      if (branchRes.ok) {
        setBranches(branchRes.branches || []);
        setCurrentBranch(branchRes.current || branchRes.branches?.[0] || '');
      }
      if (stashRes.ok) setStashes(stashRes.stashes || []);
      if (logRes.ok) setLogs(logRes.logs || []);
      if (debugEnabled) {
        console.debug('[GitPanel][refresh:end]', {
          refreshId,
          path,
          nextIsRepo,
          statusOk: statusRes.ok,
          branchOk: branchRes.ok,
          stashOk: stashRes.ok,
          logOk: logRes.ok
        })
      }
    } catch (error) {
      if (debugEnabled) {
        console.debug('[GitPanel][refresh:error]', {
          refreshId,
          path,
          error: error instanceof Error ? error.message : String(error || '')
        })
      }
      setIsRepo(false)
      setStatus(null)
      setBranches([])
      setCurrentBranch('')
      setStashes([])
      setLogs([])
    } finally {
      setLoading(false);
    }
  };

  // Initialize: Check if current opened directory is a repo
  useEffect(() => {
    if (!active) return
    if (debugEnabled) {
      console.debug('[GitPanel][effect:init]', {
        active,
        activeProjectDir,
        workspaceDir: settings?.workspaceDir || '',
        cwd
      })
    }
    const init = async () => {
        const base = String(activeProjectDir || settings?.workspaceDir || '').trim()
        if (base) {
            setCwd(base);
            refreshAll(base);
        } else {
             // Try to auto-detect if not set
            try {
                const res = await window.anima.fs.getCwd();
                if (res.ok && res.cwd) {
                    setCwd(res.cwd);
                    refreshAll(res.cwd);
                }
            } catch (e) {
                console.error('Failed to get cwd', e);
            }
        }
    };
    init();
  }, [active, activeProjectDir, settings?.workspaceDir]);

  const handlePickRepo = async () => {
    const res = await window.anima.window.pickDirectory();
    if (res.ok && !res.canceled) {
      setCwd(res.path);
      refreshAll(res.path);
    }
  };

  const handleInit = async () => {
      setLoading(true);
      await window.anima.git.init(cwd);
      refreshAll(cwd);
      setLoading(false);
  };

  const handleCommit = async () => {
    if (!message) return;
    setLoading(true);
    await window.anima.git.commit({ cwd, message });
    setMessage('');
    refreshAll(cwd);
    setLoading(false);
  };

  const handleStageFile = async (file: string) => {
      await window.anima.git.add({ cwd, files: [file] });
      refreshAll(cwd);
  };

  const handleUnstageFile = async (file: string) => {
      await window.anima.git.unstage({ cwd, files: [file] });
      refreshAll(cwd);
  };

  const handleBranchSwitch = async (branch: string) => {
      setLoading(true);
      await window.anima.git.checkout({ cwd, branch });
      refreshAll(cwd);
      setLoading(false);
  };

  if (!cwd) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
        <GitBranch className="w-12 h-12 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No repository opened.</p>
        <Button onClick={handlePickRepo} size="sm">Open Repository</Button>
      </div>
    );
  }

  if (!isRepo) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 space-y-6 text-center">
            <FolderPlus className="w-16 h-16 text-muted-foreground/20" />
            <div className="space-y-2">
                <h3 className="font-semibold">No Git Repository</h3>
                <p className="text-sm text-muted-foreground">The current folder is not a git repository.</p>
            </div>
            <Button onClick={handleInit}>Initialize Repository</Button>
            {!activeProjectDir && <Button variant="ghost" size="sm" onClick={handlePickRepo}>Open Different Folder</Button>}
        </div>
      );
  }

  // Group files into Staged vs Changes
  // simple-git status: 
  // 'index': 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' -> Staged status
  // 'working_dir': 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!' -> Working dir status
  // Combine for simplified view: 
  // Actually, usually we show "Staged Changes" and "Changes" sections.
  // For this simplified implementation, let's put everything in one "Changes" list 
  // but use the checkbox to indicate staged status? 
  // Or better, strictly follow VS Code style: Staged Changes vs Changes.
  // Let's stick to the user's screenshot: "Changes(1)". It seems to mix them or just show modified.
  // User asked for "Changes", "Stashes", "HEAD".
  // Let's list all modified files in "Changes". Checkbox checked = Staged.
  
  const allChangedFiles = status?.files || [];

  return (
    <div className="flex flex-col h-full bg-white">
       {/* Header */}
       <div className="h-10 px-3 flex items-center justify-between border-b border-black/5 shrink-0">
         <div className="flex items-center gap-2 max-w-[70%]">
             <GitBranch className="w-4 h-4 text-muted-foreground" />
             <Select value={currentBranch} onValueChange={handleBranchSwitch}>
                <SelectTrigger className="h-7 text-xs border-none bg-transparent focus:ring-0 p-0 gap-1 w-auto max-w-full">
                    <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                    {branches.map(b => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
                </SelectContent>
             </Select>
         </div>
         <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refreshAll(cwd)}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
             <Button variant="ghost" size="icon" className="h-7 w-7">
                <Play className="w-3.5 h-3.5" />
             </Button>
         </div>
      </div>
      
      {/* Commit Input */}
      <div className="p-3 space-y-3 shrink-0 border-b border-black/5">
        <Textarea 
          placeholder="Commit message..." 
          className="resize-none h-20 text-xs bg-muted/30"
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
        <Button className="w-full h-8 text-xs" onClick={handleCommit} disabled={!message || loading}>
          <Check className="w-3.5 h-3.5 mr-2" />
          Commit
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col">
            
            {/* Changes Section */}
            <Collapsible open={changesOpen} onOpenChange={setChangesOpen} className="w-full">
                <CollapsibleTrigger className="flex items-center w-full px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                    {changesOpen ? <ChevronDown className="w-3.5 h-3.5 mr-1" /> : <ChevronRight className="w-3.5 h-3.5 mr-1" />}
                    Changes ({allChangedFiles.length})
                    <div className="ml-auto flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus className="w-3.5 h-3.5" />
                    </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="px-0 pb-2">
                        {allChangedFiles.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-4 italic">No changes detected</p>
                        )}
                        {allChangedFiles.map((file: any) => {
                            const isStaged = file.index !== '?' && file.index !== ' ' && file.index !== undefined;
                            return (
                                <div key={file.path} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 group text-sm">
                                    <Checkbox 
                                        checked={isStaged} 
                                        onCheckedChange={(checked) => checked ? handleStageFile(file.path) : handleUnstageFile(file.path)}
                                        className="w-3.5 h-3.5 rounded-[2px]"
                                    />
                                    <span className="text-xs truncate flex-1" title={file.path}>{file.path}</span>
                                    <span className="text-[10px] font-mono text-muted-foreground w-4 text-center">
                                        {file.working_dir !== ' ' ? file.working_dir : file.index}
                                    </span>
                                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleStageFile(file.path)}>
                                            <Plus className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {/* Stashes Section */}
            <Collapsible open={stashesOpen} onOpenChange={setStashesOpen} className="w-full">
                <CollapsibleTrigger className="flex items-center w-full px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                    {stashesOpen ? <ChevronDown className="w-3.5 h-3.5 mr-1" /> : <ChevronRight className="w-3.5 h-3.5 mr-1" />}
                    Stashes
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="px-0 pb-2">
                        {stashes.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2 italic">No stashes</p>
                        ) : (
                            stashes.map((stash: any, i) => (
                                <div key={i} className="flex items-center gap-2 px-4 py-1.5 hover:bg-accent/50 text-xs truncate">
                                    <Archive className="w-3 h-3 text-muted-foreground shrink-0" />
                                    <span className="truncate">{stash.message || `stash@{${i}}`}</span>
                                </div>
                            ))
                        )}
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {/* HEAD Section */}
            <Collapsible open={headOpen} onOpenChange={setHeadOpen} className="w-full">
                <CollapsibleTrigger className="flex items-center w-full px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
                    {headOpen ? <ChevronDown className="w-3.5 h-3.5 mr-1" /> : <ChevronRight className="w-3.5 h-3.5 mr-1" />}
                    HEAD
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <div className="px-0 pb-2">
                        {logs.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4 italic">No commits yet</p>
                        ) : (
                            <div className="space-y-1">
                                {logs.map((commit: any) => (
                                    <div key={commit.hash} className="px-4 py-2 hover:bg-accent/50 flex flex-col gap-0.5 border-l-2 border-transparent hover:border-primary ml-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium truncate max-w-[200px]">{commit.message}</span>
                                            <span className="text-[10px] text-muted-foreground">{commit.date.substring(0, 10)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                            <GitCommit className="w-3 h-3" />
                                            <span className="font-mono">{commit.hash.substring(0, 7)}</span>
                                            <span>•</span>
                                            <span>{commit.author_name}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </CollapsibleContent>
            </Collapsible>

        </div>
      </ScrollArea>
    </div>
  );
};
