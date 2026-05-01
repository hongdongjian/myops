import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, File, ArrowLeft, Home } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface FsEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
}

interface FsEntriesData {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

interface FilePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  title?: string;
  initialPath?: string;
}

export function FilePicker({ open, onOpenChange, onSelect, title = 'Select File', initialPath }: FilePickerProps) {
  const [currentPath, setCurrentPath] = useState<string>(initialPath ?? '');
  const [manualInput, setManualInput] = useState('');

  const { data, isLoading, error } = useQuery<FsEntriesData>({
    queryKey: ['fs', 'entries', currentPath],
    queryFn: () => apiGet<FsEntriesData>(`/api/fs/entries?path=${encodeURIComponent(currentPath)}`),
    enabled: open,
    staleTime: 5000,
  });

  const navigate = useCallback((path: string) => {
    setCurrentPath(path);
  }, []);

  const handleSelect = (path: string) => {
    onSelect(path);
    onOpenChange(false);
  };

  const handleManualConfirm = () => {
    if (manualInput.trim()) {
      handleSelect(manualInput.trim());
    }
  };

  const pathParts = (data?.path ?? '').split('/').filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto whitespace-nowrap pb-1">
            <button
              className="hover:text-foreground"
              onClick={() => navigate('')}
            >
              <Home className="h-3 w-3" />
            </button>
            {pathParts.map((part, i) => {
              const fullPath = '/' + pathParts.slice(0, i + 1).join('/');
              return (
                <span key={fullPath} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <button
                    className="hover:text-foreground max-w-[120px] truncate"
                    onClick={() => navigate(fullPath)}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => data?.parent && navigate(data.parent)}
              disabled={!data?.parent}
              className="h-7 px-2"
            >
              <ArrowLeft className="h-3 w-3" />
            </Button>
            <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
              {data?.path || '~'}
            </span>
          </div>

          <div className="max-h-56 overflow-y-auto rounded border border-border">
            {isLoading && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">Loading…</div>
            )}
            {error && (
              <div className="px-3 py-4 text-center text-xs text-destructive">{(error as Error).message}</div>
            )}
            {data?.entries.map((entry) => (
              <button
                key={entry.path}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/60 border-b border-border/40 last:border-0"
                onClick={() => entry.type === 'directory' ? navigate(entry.path) : handleSelect(entry.path)}
              >
                {entry.type === 'directory' ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-mono">{entry.name}</span>
                {entry.type === 'directory' && (
                  <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
              </button>
            ))}
            {data?.entries.length === 0 && !isLoading && (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">Empty directory</div>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Or enter path manually:</p>
            <div className="flex gap-2">
              <Input
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="/path/to/binary"
                className="font-mono text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleManualConfirm()}
              />
              <Button size="sm" variant="outline" onClick={handleManualConfirm} disabled={!manualInput.trim()}>
                Use
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
